/**
 * The isolated environment of the agent's commands (run_command).
 *
 * Windows: native/windows/emir-sandbox.exe, in one of three ways.
 *   - Full isolation set up (once, with an administrator): every command runs as a local account
 *     of its own with a restricted token. It cannot open the user's profile, writes only into the
 *     project folder, and the Windows firewall blocks its network (not connections to this computer
 *     itself).
 *   - Otherwise Python and plain `node file.js` run in an AppContainer: only the project folder, no
 *     network at all. Node cannot start other programs there (it needs named pipes an AppContainer
 *     may not create).
 *   - Everything else (npm, cargo, test runners) then runs write-protected, at the low integrity
 *     level: it cannot change anything outside the project, but it can read the user's files and
 *     use the network. That is not isolation, and the app does not call it so.
 * Linux: bubblewrap. The whole system is mounted read-only, the home folder is replaced by an
 *   empty one (only the project folder and the folders of the language tools come back), /tmp is
 *   private and the network is cut unless allowed.
 * Elsewhere, or when the tool is missing, commands run as before, without isolation.
 *
 * Every plan says whether the command runs isolated and, when not, why (a `main` text key).
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface IsolationOptions {
  /** The user's setting: run commands isolated where possible. */
  enabled: boolean;
  /** The user's setting: isolated commands may use the internet. */
  network: boolean;
}

export type SandboxMethod = 'appcontainer' | 'bubblewrap' | 'none';

/**
 * What a command is kept from: `full` - the user's files and (unless allowed) the network;
 * `write` - only changing things outside the project; `none` - nothing.
 */
export type IsolationLevel = 'full' | 'write' | 'none';

/** Why a command does not run isolated (keys of the `main` translations). */
export type IsolationReason =
  | 'isolationOff'
  | 'isolationUnsupportedOs'
  | 'isolationLauncherMissing'
  | 'isolationBwrapMissing'
  | 'isolationBwrapUnusable'
  | 'isolationInterpreterMissing'
  | 'isolationInterpreterUnreadable'
  | 'isolationWriteOnly'
  | 'isolationNetworkOpen';

/** Something the user should know about an isolated command (keys of the `main` translations). */
export type IsolationWarning = 'isolationParentOpen';

export interface CommandPlan {
  command: string;
  args: string[];
  /** npm on Windows runs through cmd.exe. */
  shell: boolean;
  /** Fully isolated, network included where the user wants it blocked. */
  isolated: boolean;
  level: IsolationLevel;
  reason?: IsolationReason;
  warning?: IsolationWarning;
  /** Extra environment for the program (Linux: npm's cache inside the private /tmp). */
  env?: Record<string, string>;
  /** Windows: launcher arguments that open the folders to the program before it runs. */
  prepare?: string[];
}

/** Windows: the separate account that isolates every command (set up once by an administrator). */
export interface FullIsolationStatus {
  configured: boolean;
  /** A program really started as the account. */
  working: boolean;
  /** Whether the firewall rule cuts the account's network. */
  network: 'blocked' | 'open' | 'unknown';
  error?: string;
}

export interface InterpreterStatus {
  path?: string;
  isolated: boolean;
  reason?: IsolationReason;
}

export interface SandboxStatus {
  method: SandboxMethod;
  /** The system can isolate commands at all. */
  supported: boolean;
  /** Supported and turned on in the settings. */
  active: boolean;
  reason?: IsolationReason;
  /** Windows: whether Python and Node can run isolated on this computer. */
  python?: InterpreterStatus;
  node?: InterpreterStatus;
  /** Windows: full isolation of every command. */
  full?: FullIsolationStatus;
}

const run = (
  file: string,
  args: string[],
  timeoutMs: number,
  cwd?: string,
  env?: NodeJS.ProcessEnv
): Promise<{ code: number | null; stdout: string; stderr: string }> =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true, cwd, env, encoding: 'utf8' }, (err: any, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : null) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });

/** The first match of a program on PATH (where / which); Store aliases of Python are skipped. */
async function locate(program: string, extension = '.exe'): Promise<string | null> {
  if (process.platform === 'win32') {
    const res = await run('where.exe', [program], 5000);
    const hits = res.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    return hits.find((h) => !/\\WindowsApps\\/i.test(h) && h.toLowerCase().endsWith(extension)) || null;
  }
  const res = await run('/bin/sh', ['-c', `command -v ${program}`], 5000);
  const hit = res.stdout.trim().split('\n')[0];
  return hit ? fs.realpathSync(hit) : null;
}

export class Sandbox {
  private interpreters = new Map<string, Promise<InterpreterStatus & { readDirs: string[] }>>();
  private bwrap: Promise<{ path: string | null; usable: boolean }> | null = null;
  private full: Promise<FullIsolationStatus> | null = null;
  private prepared = new Map<string, Promise<{ ok: boolean; error?: string }>>();

  /** `resourcesDir` holds emir-sandbox.exe and node-guard.cjs (Windows). */
  constructor(private readonly resourcesDir: string) {}

  get method(): SandboxMethod {
    if (process.platform === 'win32') return 'appcontainer';
    if (process.platform === 'linux') return 'bubblewrap';
    return 'none';
  }

  private get launcher(): string {
    return path.join(this.resourcesDir, 'emir-sandbox.exe');
  }

  private get nodeGuard(): string {
    return path.join(this.resourcesDir, 'node-guard.cjs');
  }

  /** Forgets what was found out (after the user allowed Python, or installed a tool). */
  reset(): void {
    this.interpreters.clear();
    this.bwrap = null;
    this.full = null;
    this.prepared.clear();
  }

  async status(options: IsolationOptions): Promise<SandboxStatus> {
    const method = this.method;
    if (method === 'none') return { method, supported: false, active: false, reason: 'isolationUnsupportedOs' };
    if (method === 'appcontainer') {
      if (!fs.existsSync(this.launcher)) return { method, supported: false, active: false, reason: 'isolationLauncherMissing' };
      const [python, node, full] = await Promise.all([this.windowsInterpreter('python'), this.windowsInterpreter('node'), this.fullIsolation()]);
      const strip = ({ readDirs, ...rest }: InterpreterStatus & { readDirs: string[] }): InterpreterStatus => rest;
      return { method, supported: true, active: options.enabled, reason: options.enabled ? undefined : 'isolationOff', python: strip(python), node: strip(node), full };
    }
    const bwrap = await this.bubblewrap();
    if (!bwrap.path) return { method, supported: false, active: false, reason: 'isolationBwrapMissing' };
    if (!bwrap.usable) return { method, supported: false, active: false, reason: 'isolationBwrapUnusable' };
    return { method, supported: true, active: options.enabled, reason: options.enabled ? undefined : 'isolationOff' };
  }

  /** How a command that the policy allowed is started. */
  async plan(binary: string, args: string[], root: string, options: IsolationOptions): Promise<CommandPlan> {
    const plain = (reason: IsolationReason): CommandPlan =>
      process.platform === 'win32' && binary === 'npm'
        ? { command: ['npm.cmd', ...args.map((a) => (/\s/.test(a) ? `"${a}"` : a))].join(' '), args: [], shell: true, isolated: false, level: 'none', reason }
        : { command: binary, args, shell: false, isolated: false, level: 'none', reason };

    if (!options.enabled) return plain('isolationOff');
    if (this.method === 'appcontainer') return this.planWindows(binary, args, root, options, plain);
    if (this.method === 'bubblewrap') return this.planLinux(binary, args, root, options, plain);
    return plain('isolationUnsupportedOs');
  }

  // ---------------------------------------------------------------- Windows

  private async planWindows(binary: string, args: string[], root: string, options: IsolationOptions, plain: (r: IsolationReason) => CommandPlan): Promise<CommandPlan> {
    if (!fs.existsSync(this.launcher)) return plain('isolationLauncherMissing');
    const viaPython = binary === 'python' || binary === 'pytest';
    const program = await this.windowsProgram(binary);

    // 1. The separate account: every command, whole process trees included.
    const full = await this.fullIsolation();
    if (full.working && program) {
      const options1 = ['--mode', 'user', '--root', root, ...program.reads.flatMap((dir) => ['--read', dir]), ...(options.network ? ['--net'] : [])];
      const networkOpen = !options.network && full.network === 'open';
      return {
        command: this.launcher,
        args: [...options1, '--', program.path, ...program.args, ...args],
        shell: false,
        isolated: !networkOpen,
        level: 'full',
        reason: networkOpen ? 'isolationNetworkOpen' : undefined,
        warning: (await this.parentOpen(root)) ? 'isolationParentOpen' : undefined,
        env: program.env,
        prepare: [...options1, '--prepare'],
      };
    }

    // 2. An AppContainer: one program that starts no others.
    const single = viaPython || (binary === 'node' && !args.some((a) => /^--(?:test|watch|run)\b/.test(a)));
    if (single) {
      const interpreter = await this.windowsInterpreter(viaPython ? 'python' : 'node');
      if (interpreter.isolated && interpreter.path) {
        const launcherArgs = ['--root', root];
        for (const dir of interpreter.readDirs) launcherArgs.push('--read', dir);
        if (options.network) launcherArgs.push('--net');
        launcherArgs.push('--', interpreter.path);
        if (binary === 'pytest') launcherArgs.push('-m', 'pytest');
        if (binary === 'node') launcherArgs.push('--preserve-symlinks', '--preserve-symlinks-main', '--require', this.nodeGuard);
        launcherArgs.push(...args);
        return { command: this.launcher, args: launcherArgs, shell: false, isolated: true, level: 'full' };
      }
    }

    // 3. Write-protected: it cannot change anything outside the project.
    if (!program) return plain('isolationInterpreterMissing');
    return {
      command: this.launcher,
      args: ['--mode', 'low', '--root', root, '--', program.path, ...program.args, ...args],
      shell: false,
      isolated: false,
      level: 'write',
      reason: 'isolationWriteOnly',
      env: program.env,
      prepare: ['--mode', 'low', '--root', root, '--prepare'],
    };
  }

  /**
   * Where a command's program is, and what it needs outside the project: the launcher starts the
   * program itself (npm is npm.cmd, pytest runs as "python -m pytest"), and tools that keep their
   * files in the user's profile get those folders readable and named in the environment, because
   * isolated programs have a home folder of their own.
   */
  private async windowsProgram(binary: string): Promise<{ path: string; args: string[]; reads: string[]; env: Record<string, string> } | null> {
    const home = os.homedir();
    const env: Record<string, string> = {};
    const reads: string[] = [];
    const keep = (dir: string | undefined | null) => {
      if (dir && fs.existsSync(dir) && !reads.includes(dir)) reads.push(dir);
    };
    let exe: string | null;
    let args: string[] = [];
    if (binary === 'npm') {
      exe = await locate('npm', '.cmd');
      const node = await locate('node');
      keep(node && path.dirname(node));
      keep(process.env.APPDATA && path.join(process.env.APPDATA, 'npm'));
    } else if (binary === 'python' || binary === 'pytest') {
      exe = await locate('python');
      if (binary === 'pytest') args = ['-m', 'pytest'];
      // Packages installed with "pip install --user" live in the user's profile.
      const userBase = process.env.APPDATA && path.join(process.env.APPDATA, 'Python');
      if (userBase && fs.existsSync(userBase)) {
        env.PYTHONUSERBASE = userBase;
        keep(userBase);
      }
    } else if (binary === 'cargo') {
      exe = await locate('cargo');
      const cargoHome = process.env.CARGO_HOME || path.join(home, '.cargo');
      const rustupHome = process.env.RUSTUP_HOME || path.join(home, '.rustup');
      if (fs.existsSync(cargoHome)) env.CARGO_HOME = cargoHome;
      if (fs.existsSync(rustupHome)) env.RUSTUP_HOME = rustupHome;
      keep(cargoHome);
      keep(rustupHome);
    } else {
      exe = await locate(binary);
    }
    if (!exe) return null;
    keep(path.dirname(exe));
    return { path: exe, args, reads, env };
  }

  /** Whether the separate account is set up, starts programs, and has its network cut. */
  private fullIsolation(): Promise<FullIsolationStatus> {
    if (this.full) return this.full;
    this.full = (async (): Promise<FullIsolationStatus> => {
      const account = await run(this.launcher, ['--account-status'], 20000);
      if (!/^configured/m.test(account.stdout)) return { configured: false, working: false, network: 'unknown' };
      const probeRoot = path.join(os.tmpdir(), 'emir-code-isolation-check');
      fs.mkdirSync(probeRoot, { recursive: true });
      const check = await run(this.launcher, ['--mode', 'user', '--check', '--root', probeRoot], 60000, probeRoot, commandEnvironment());
      if (check.code !== 0) {
        const error = (check.stderr.split(/\r?\n/).find((l) => l.includes('emir-sandbox:')) || '').replace(/^.*emir-sandbox:\s*/, '') || `exit ${check.code}`;
        return { configured: true, working: false, network: 'unknown', error };
      }
      const probe = await run(this.launcher, ['--mode', 'user', '--net-probe', '--root', probeRoot], 30000, probeRoot, commandEnvironment());
      return { configured: true, working: true, network: probe.code === 0 ? 'blocked' : probe.code === 3 ? 'open' : 'unknown' };
    })();
    return this.full;
  }

  /** True when the folder next to the project is open to every account of this computer. */
  private async parentOpen(root: string): Promise<boolean> {
    const res = await run(this.launcher, ['--audit', '--root', root], 10000);
    return /^parent-open/m.test(res.stdout);
  }

  /**
   * Opens the project folder (and the tools' folders) to the program before it runs. Done once per
   * folder; on a large folder the first time takes a while, so it is not part of the command's
   * time limit.
   */
  prepare(plan: CommandPlan): Promise<{ ok: boolean; error?: string }> {
    if (!plan.prepare) return Promise.resolve({ ok: true });
    const key = plan.prepare.join('\n');
    let pending = this.prepared.get(key);
    if (!pending) {
      pending = (async () => {
        const res = await run(this.launcher, plan.prepare!, 600000);
        if (res.code === 0) return { ok: true };
        const error = (res.stderr.split(/\r?\n/).find((l) => l.includes('emir-sandbox:')) || '').replace(/^.*emir-sandbox:\s*/, '') || `exit ${res.code}`;
        return { ok: false, error };
      })();
      this.prepared.set(key, pending);
      pending.then((result) => {
        if (!result.ok) this.prepared.delete(key);
      });
    }
    return pending;
  }

  /** Sets up the separate account (a Windows administrator prompt). */
  async setupFull(): Promise<{ ok: boolean; error?: string }> {
    return this.accounts('--setup');
  }

  /** Removes the separate account again (a Windows administrator prompt). */
  async removeFull(): Promise<{ ok: boolean; error?: string }> {
    return this.accounts('--remove');
  }

  private async accounts(action: '--setup' | '--remove'): Promise<{ ok: boolean; error?: string }> {
    if (process.platform !== 'win32' || !fs.existsSync(this.launcher)) return { ok: false };
    const res = await run(this.launcher, [action], 300000);
    this.full = null;
    this.prepared.clear();
    if (res.code === 0) return { ok: true };
    return { ok: false, error: (res.stderr.split(/\r?\n/).find((l) => l.includes('emir-sandbox:')) || '').replace(/^.*emir-sandbox:\s*/, '') || `exit ${res.code}` };
  }

  /**
   * Finds the interpreter and starts it once in the AppContainer, in an empty folder of its own
   * (never a real project or the temp folder: the container gets write access to that folder).
   */
  private windowsInterpreter(kind: 'python' | 'node'): Promise<InterpreterStatus & { readDirs: string[] }> {
    const cached = this.interpreters.get(kind);
    if (cached) return cached;
    const probe = (async () => {
      const exe = await locate(kind);
      if (!exe) return { isolated: false, reason: 'isolationInterpreterMissing' as IsolationReason, readDirs: [] };
      const readDirs = [path.dirname(exe)];
      if (kind === 'node') readDirs.push(this.resourcesDir);
      if (kind === 'python') {
        // Packages installed with "pip install --user" live in the user's profile.
        const site = await run(exe, ['-c', 'import site; print(site.getusersitepackages())'], 10000);
        const userSite = site.stdout.trim();
        if (site.code === 0 && userSite && fs.existsSync(userSite)) readDirs.push(userSite);
      }
      const probeRoot = path.join(os.tmpdir(), 'emir-code-isolation-check');
      fs.mkdirSync(probeRoot, { recursive: true });
      const probeArgs = ['--root', probeRoot];
      for (const dir of readDirs) probeArgs.push('--read', dir);
      probeArgs.push('--', exe, ...(kind === 'python' ? ['-c', 'pass'] : ['--preserve-symlinks', '--preserve-symlinks-main', '-e', '0']));
      // The same reduced environment real commands get, so the check fails where they would.
      const res = await run(this.launcher, probeArgs, 20000, probeRoot, commandEnvironment());
      return res.code === 0
        ? { path: exe, isolated: true, readDirs }
        : { path: exe, isolated: false, reason: 'isolationInterpreterUnreadable' as IsolationReason, readDirs };
    })();
    this.interpreters.set(kind, probe);
    return probe;
  }

  /**
   * Python installed by an administrator outside Program Files (C:\Python3xx) cannot be read by
   * isolated programs. With the user's approval (a Windows administrator prompt) its folder gets
   * the read rule that Program Files has for every AppContainer.
   */
  async allowPython(): Promise<{ ok: boolean; error?: string }> {
    if (process.platform !== 'win32') return { ok: false };
    const exe = await locate('python');
    if (!exe) return { ok: false, error: 'python not found' };
    const dir = path.dirname(exe);
    const command = `Start-Process -FilePath icacls.exe -ArgumentList @('"${dir}"', '/grant', '*S-1-15-2-1:(OI)(CI)(RX)', '/C', '/Q') -Verb RunAs -Wait -WindowStyle Hidden`;
    const res = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], 120000);
    this.interpreters.delete('python');
    return res.code === 0 ? { ok: true } : { ok: false, error: res.stderr.trim() || `exit ${res.code}` };
  }

  // ---------------------------------------------------------------- Linux (bubblewrap)

  private bubblewrap(): Promise<{ path: string | null; usable: boolean }> {
    if (this.bwrap) return this.bwrap;
    this.bwrap = (async () => {
      const bwrap = await locate('bwrap');
      if (!bwrap) return { path: null, usable: false };
      const res = await run(bwrap, ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--unshare-all', '--die-with-parent', '--', '/bin/true'], 10000);
      return { path: bwrap, usable: res.code === 0 };
    })();
    return this.bwrap;
  }

  private async planLinux(binary: string, args: string[], root: string, options: IsolationOptions, plain: (r: IsolationReason) => CommandPlan): Promise<CommandPlan> {
    const bwrap = await this.bubblewrap();
    if (!bwrap.path) return plain('isolationBwrapMissing');
    if (!bwrap.usable) return plain('isolationBwrapUnusable');
    const program = await locate(binary);
    if (!program) return plain('isolationInterpreterMissing');
    return {
      command: bwrap.path,
      args: [...linuxMounts(root, program), '--unshare-all', ...(options.network ? ['--share-net'] : []), '--die-with-parent', '--new-session', '--chdir', root, '--', program, ...args],
      shell: false,
      isolated: true,
      level: 'full',
      env: { npm_config_cache: '/tmp/.npm', npm_config_update_notifier: 'false', XDG_CACHE_HOME: '/tmp/.cache' },
    };
  }
}

/** Folders of language tools that live in the home folder and must stay visible (read-only). */
const HOME_TOOL_DIRS = ['.nvm', '.volta', '.fnm', '.local/share/fnm', '.local/share/pnpm', '.npm-global', '.pyenv', '.local/lib', '.local/bin', '.cargo', '.rustup', '.deno', '.bun'];

/** bubblewrap mounts: the system read-only, home and /tmp private, the project writable. */
export function linuxMounts(root: string, program: string, home = os.homedir(), exists: (p: string) => boolean = fs.existsSync): string[] {
  const posix = path.posix;
  // /run stays (read-only): with the network allowed, DNS often lives under /run.
  const args = ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--tmpfs', '/tmp'];
  const homes = new Set(['/home', '/root', posix.dirname(home) === '/' ? home : '']);
  for (const dir of homes) if (dir && exists(dir)) args.push('--tmpfs', dir);
  const visible = HOME_TOOL_DIRS.map((d) => posix.join(home, d)).filter((d) => exists(d));
  // A program installed under the home folder (nvm, pyenv...) stays reachable.
  if (program.startsWith(home + '/') && !visible.some((d) => program.startsWith(d + '/'))) visible.push(posix.dirname(program));
  for (const dir of visible) args.push('--ro-bind', dir, dir);
  args.push('--bind', root, root, '--setenv', 'HOME', home, '--setenv', 'TMPDIR', '/tmp');
  return args;
}

/**
 * Windows folders every program expects. They hold paths, not secrets; without USERPROFILE and
 * LOCALAPPDATA an AppContainer process cannot even be created (ERROR_ENVVAR_NOT_FOUND).
 */
const WINDOWS_SYSTEM_VARIABLES = [
  'SystemDrive', 'windir', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432',
  'CommonProgramFiles', 'CommonProgramFiles(x86)', 'ALLUSERSPROFILE', 'PUBLIC', 'HOMEDRIVE', 'HOMEPATH', 'USERNAME',
  'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS',
];

/**
 * The environment of the agent's commands: the paths and system variables programs need, nothing
 * else (tokens and keys in the user's environment stay out).
 */
export function commandEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: source.PATH || source.Path || '',
    SystemRoot: source.SystemRoot || '',
    COMSPEC: source.COMSPEC || '',
    PATHEXT: source.PATHEXT || '',
    TEMP: source.TEMP || source.TMPDIR || '/tmp',
    TMP: source.TMP || source.TMPDIR || '/tmp',
    NODE_ENV: 'test',
    // Output is decoded as UTF-8; without this, Python on Windows prints in the ANSI code page
    // and Turkish text reaches the agent as "Kullan\uFFFDm".
    PYTHONIOENCODING: 'utf-8',
    // POSIX / Linux essentials
    HOME: source.HOME || os.homedir() || '',
    USER: source.USER || '',
    SHELL: source.SHELL || '/bin/sh',
    LANG: source.LANG || 'C.UTF-8',
    LC_ALL: source.LC_ALL || '',
    XDG_DATA_HOME: source.XDG_DATA_HOME || '',
    XDG_CONFIG_HOME: source.XDG_CONFIG_HOME || '',
    XDG_CACHE_HOME: source.XDG_CACHE_HOME || '',
  };
  if (process.platform === 'win32') {
    for (const name of WINDOWS_SYSTEM_VARIABLES) {
      if (source[name]) env[name] = source[name];
    }
  }
  return env;
}

/** Launcher output that means the isolated environment itself could not start. */
export function isSandboxSetupFailure(exitCode: number | null, output: string): boolean {
  return exitCode === 125 && /emir-sandbox:/.test(output);
}

