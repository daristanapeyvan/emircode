/**
 * Which programs the agent may start, and with which arguments. Pure functions, used by the main
 * process (the authority) and by the end-to-end test harness, which mirrors it.
 *
 * The rules decide what may START. What a started program does afterwards is limited by the
 * isolated environment (see sandbox.ts) where one is available, and by the user's approval.
 */

export const ALLOWED_BINARIES = ['npm', 'node', 'cargo', 'pytest', 'python'] as const;
export const ALLOWED_NPM_SCRIPTS = ['test', 'build', 'lint', 'typecheck', 'check'] as const;
export const ALLOWED_PYTHON_MODULES = ['pytest', 'unittest', 'doctest', 'py_compile'] as const;
export const ALLOWED_CARGO_SUBCOMMANDS = ['build', 'check', 'test', 'run', 'fmt', 'clippy', 'bench', 'doc'] as const;

/** Why a command was refused; `key` is the text in the `main` translations, `params` fill it. */
export type CommandBlock = {
  ok: false;
  code:
    | 'npx'
    | 'binary'
    | 'characters'
    | 'npm_subcommand'
    | 'npm_option'
    | 'no_package_json'
    | 'npm_script'
    | 'windows_characters'
    | 'inline_code'
    | 'python_module'
    | 'cargo_subcommand';
  key:
    | 'npxBlocked'
    | 'binaryNotAllowed'
    | 'forbiddenCharacters'
    | 'npmSubcommandNotAllowed'
    | 'npmOptionNotAllowed'
    | 'noPackageJson'
    | 'npmScriptNotAllowed'
    | 'windowsUnsafeArgument'
    | 'inlineCodeBlocked'
    | 'pythonModuleNotAllowed'
    | 'cargoSubcommandNotAllowed';
  params: Record<string, string>;
};
export type CommandCheck = { ok: true } | CommandBlock;

export interface CommandContext {
  hasPackageJson: boolean;
  platform: NodeJS.Platform;
}

const block = (code: CommandBlock['code'], key: CommandBlock['key'], params: Record<string, string> = {}): CommandBlock => ({
  ok: false,
  code,
  key,
  params,
});

/** Characters that would chain, redirect or substitute commands in any shell. */
const SHELL_METACHARACTERS = /[;&|`$<>\r\n]/;
/** Characters cmd.exe interprets even inside quotes (npm runs through cmd.exe on Windows). */
const CMD_METACHARACTERS = /["%^!()]/;

/** Node options that take their value in the next argument. */
const NODE_VALUE_OPTIONS = new Set(['-r', '--require', '--import', '--loader', '--experimental-loader', '-C', '--conditions', '--input-type', '--env-file', '--title']);
/** Python options that take their value in the next argument. */
const PYTHON_VALUE_OPTIONS = new Set(['-W', '-X', '--check-hash-based-pycs']);

/**
 * Inline code on the command line (`node -e`, `node -p`, `python -c`): the model would run code
 * that is in no file, so the user could not read it before approving and the file checks never see it.
 * Only the options before the script count; later arguments belong to the script.
 */
function findInlineCode(binary: string, args: string[]): string | null {
  if (binary === 'node') {
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (!a.startsWith('-') || a === '-' || a === '--') return null;
      if (/^--(?:eval|print)(?:=|$)/.test(a)) return a.split('=')[0];
      if (/^-[A-Za-z]*[ep][A-Za-z]*$/.test(a)) return a;
      if (/^--(?:import|loader|experimental-loader|require)=data:/i.test(a)) return a.split('=')[0];
      if (NODE_VALUE_OPTIONS.has(a)) {
        if (/^data:/i.test(args[i + 1] || '')) return a;
        i++;
      }
    }
    return null;
  }
  if (binary === 'python') {
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (!a.startsWith('-') || a === '-' || a === '--') return null;
      if (/^-[A-Za-z]*c/.test(a) && !a.startsWith('--')) return '-c';
      if (/^-[A-Za-z]*m/.test(a) && !a.startsWith('--')) return null; // -m ends the options
      if (PYTHON_VALUE_OPTIONS.has(a)) i++;
    }
  }
  return null;
}

/** The module of `python -m module` (also `-mmodule` and `-Bm module`), or null. */
function pythonModule(args: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('-') || a.startsWith('--') || a === '-') return null;
    if (/^-[WX]./.test(a)) continue; // -Wignore, -Xutf8: the value is attached
    const m = a.match(/^-[A-Za-z]*?m(.*)$/);
    if (m) return (m[1] || args[i + 1] || '').trim();
    if (PYTHON_VALUE_OPTIONS.has(a)) i++;
  }
  return null;
}

export function checkCommand(binaryInput: string, args: string[], ctx: CommandContext): CommandCheck {
  const binary = String(binaryInput || '').trim().toLowerCase();

  if (binary === 'npx' || args.some((a) => a.toLowerCase().includes('npx'))) return block('npx', 'npxBlocked');
  if (!(ALLOWED_BINARIES as readonly string[]).includes(binary)) return block('binary', 'binaryNotAllowed', { binary });

  for (const arg of args) {
    if (SHELL_METACHARACTERS.test(arg)) return block('characters', 'forbiddenCharacters', { arg });
  }

  const inline = findInlineCode(binary, args);
  if (inline) return block('inline_code', 'inlineCodeBlocked', { binary, flag: inline });

  if (binary === 'python') {
    const module = pythonModule(args);
    if (module !== null && !(ALLOWED_PYTHON_MODULES as readonly string[]).includes(module)) {
      return block('python_module', 'pythonModuleNotAllowed', { module: module || '?' });
    }
  }

  if (binary === 'cargo') {
    const sub = (args[0] || '').toLowerCase();
    if (!(ALLOWED_CARGO_SUBCOMMANDS as readonly string[]).includes(sub)) {
      return block('cargo_subcommand', 'cargoSubcommandNotAllowed', { sub });
    }
  }

  if (binary === 'npm') {
    const sub = (args[0] || '').toLowerCase();
    if (sub !== 'test' && sub !== 'run') return block('npm_subcommand', 'npmSubcommandNotAllowed', { sub });
    if (!ctx.hasPackageJson) return block('no_package_json', 'noPackageJson');
    const scriptIndex = sub === 'run' ? 1 : 0;
    const script = sub === 'run' ? (args[1] || '').toLowerCase() : 'test';
    if (!(ALLOWED_NPM_SCRIPTS as readonly string[]).includes(script)) return block('npm_script', 'npmScriptNotAllowed', { script });
    // npm's own options (--script-shell, --prefix, --userconfig ...) change what npm runs; only the
    // arguments after "--", which npm hands to the script, are free.
    const rest = args.slice(scriptIndex + 1);
    const separator = rest.indexOf('--');
    const npmOptions = separator === -1 ? rest : rest.slice(0, separator);
    const option = npmOptions.find((a) => a.startsWith('-'));
    if (option) return block('npm_option', 'npmOptionNotAllowed', { option });
    if (ctx.platform === 'win32') {
      const bad = args.find((a) => CMD_METACHARACTERS.test(a));
      if (bad !== undefined) return block('windows_characters', 'windowsUnsafeArgument', { arg: bad });
    }
  }

  return { ok: true };
}

/**
 * Files that change what a later command runs or that hold credentials: npm and pip settings can
 * point the script shell or the registry anywhere and store access tokens.
 */
export const CREDENTIAL_OR_RUNNER_CONFIG = /(?:^|\/)(?:\.npmrc|\.yarnrc(?:\.yml)?|\.pypirc|\.netrc|_netrc|\.git-credentials|pip\.conf|pip\.ini)$/i;
