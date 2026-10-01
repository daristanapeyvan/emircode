/**
 * The isolated environment of the agent's commands (run_command).
 *
 * Windows: an AppContainer, started by native/windows/emir-sandbox.exe. The program sees the
 *   project folder (read and write) and the folders of the program itself (read); the user's other
 *   files, the network (unless allowed) and local services such as Ollama stay out of reach. Node
 *   cannot start other programs in an AppContainer (it needs named pipes there), so npm and cargo,
 *   which always start other programs, and node's test runner run without isolation; Python and
 *   plain `node file.js` run isolated.
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

/** Why a command does not run isolated (keys of the `main` translations). */
export type IsolationReason =
  | 'isolationOff'
  | 'isolationUnsupportedOs'
  | 'isolationLauncherMissing'
  | 'isolationBwrapMissing'
  | 'isolationBwrapUnusable'
  | 'isolationStartsPrograms'
  | 'isolationTestRunner'
  | 'isolationInterpreterMissing'
  | 'isolationInterpreterUnreadable';

export interface CommandPlan {
  command: string;
  args: string[];
  /** npm on Windows runs through cmd.exe. */
  shell: boolean;
  isolated: boolean;
  reason?: IsolationReason;
  /** Extra environment for the program (Linux: npm's cache inside the private /tmp). */
  env?: Record<string, string>;
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
async function locate(program: string): Promise<string | null> {
  if (process.platform === 'win32') {
    const res = await run('where.exe', [program], 5000);
    const hits = res.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    return hits.find((h) => !/\\WindowsApps\\/i.test(h) && /\.exe$/i.test(h)) || null;
  }
  const res = await run('/bin/sh', ['-c', `command -v ${program}`], 5000);
  const hit = res.stdout.trim().split('\n')[0];
  return hit ? fs.realpathSync(hit) : null;
}

export class Sandbox {
  private interpreters = new Map<string, Promise<InterpreterStatus & { readDirs: string[] }>>();
  private bwrap: Promise<{ path: string | null; usable: boolean }> | null = null;

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
  }

  async status(options: IsolationOptions): Promise<SandboxStatus> {
    const method = this.method;
    if (method === 'none') return { method, supported: false, active: false, reason: 'isolationUnsupportedOs' };
    if (method === 'appcontainer') {
      if (!fs.existsSync(this.launcher)) return { method, supported: false, active: false, reason: 'isolationLauncherMissing' };
      const [python, node] = await Promise.all([this.windowsInterpreter('python'), this.windowsInterpreter('node')]);
      const strip = ({ readDirs, ...rest }: InterpreterStatus & { readDirs: string[] }): InterpreterStatus => rest;
      return { method, supported: true, active: options.enabled, reason: options.enabled ? undefined : 'isolationOff', python: strip(python), node: strip(node) };
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
        ? { command: ['npm.cmd', ...args.map((a) => (/\s/.test(a) ? `"${a}"` : a))].join(' '), args: [], shell: true, isolated: false, reason }
        : { command: binary, args, shell: false, isolated: false, reason };

    if (!options.enabled) return plain('isolationOff');
    if (this.method === 'appcontainer') return this.planWindows(binary, args, root, options, plain);
    if (this.method === 'bubblewrap') return this.planLinux(binary, args, root, options, plain);
    return plain('isolationUnsupportedOs');
  }

  // ---------------------------------------------------------------- Windows (AppContainer)

  private async planWindows(binary: string, args: string[], root: string, options: IsolationOptions, plain: (r: IsolationReason) => CommandPlan): Promise<CommandPlan> {
    if (!fs.existsSync(this.launcher)) return plain('isolationLauncherMissing');
    if (binary === 'npm' || binary === 'cargo') return plain('isolationStartsPrograms');
    const viaPython = binary === 'python' || binary === 'pytest';
    if (binary === 'node' && args.some((a) => /^--(?:test|watch|run)\b/.test(a))) return plain('isolationTestRunner');
    if (!viaPython && binary !== 'node') return plain('isolationStartsPrograms');

    const interpreter = await this.windowsInterpreter(viaPython ? 'python' : 'node');
    if (!interpreter.isolated || !interpreter.path) return plain(interpreter.reason || 'isolationInterpreterMissing');

    const launcherArgs = ['--root', root];
    for (const dir of interpreter.readDirs) launcherArgs.push('--read', dir);
    if (options.network) launcherArgs.push('--net');
    launcherArgs.push('--', interpreter.path);
    if (binary === 'pytest') launcherArgs.push('-m', 'pytest');
    if (binary === 'node') launcherArgs.push('--preserve-symlinks', '--preserve-symlinks-main', '--require', this.nodeGuard);
    launcherArgs.push(...args);
    return { command: this.launcher, args: launcherArgs, shell: false, isolated: true };
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

