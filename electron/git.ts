/**
 * Read-only git for the agent (git_status / git_diff), which runs without approval.
 *
 * A repository's own settings can make git run programs: an fsmonitor command, hooks (git status
 * may write the index and fire one), external diff and textconv drivers, clean/smudge filters and
 * signature checks. They are switched off for these calls, so opening a downloaded project cannot
 * turn them into the project's commands.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const NO_HOOKS_DIR = path.join(os.tmpdir(), 'emir-code-no-git-hooks');
const MAX_OUTPUT = 2 * 1024 * 1024;

export function runGit(args: string[], cwd: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('git', args, {
      cwd,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      if (stdout.length < MAX_OUTPUT) stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      if (stderr.length < 64 * 1024) stderr += d.toString();
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.on('error', (err) => resolve({ code: null, stdout: '', stderr: err.message }));
  });
}

/** `-c` options that switch off every setting of this repository that would run a program. */
export async function gitSafetyOptions(cwd: string): Promise<string[]> {
  await fs.promises.mkdir(NO_HOOKS_DIR, { recursive: true }).catch(() => {});
  const options = [
    '-c', 'core.fsmonitor=false',
    '-c', `core.hooksPath=${NO_HOOKS_DIR}`,
    '-c', 'diff.external=',
    '-c', 'log.showSignature=false',
    '-c', 'status.submoduleSummary=false',
  ];
  // `git config` only reads settings; it runs none of them.
  const filters = await runGit(['config', '--get-regexp', '^filter\\.'], cwd);
  const names = new Set<string>();
  for (const line of filters.stdout.split(/\r?\n/)) {
    const m = line.match(/^filter\.(.+)\.(?:clean|smudge|process|required)\s/i);
    if (m) names.add(m[1]);
  }
  for (const name of names) {
    options.push('-c', `filter.${name}.clean=`, '-c', `filter.${name}.smudge=`, '-c', `filter.${name}.process=`, '-c', `filter.${name}.required=false`);
  }
  return options;
}

export async function readOnlyGit(action: 'status' | 'diff' | 'log', cwd: string): Promise<{ success: boolean; output: string; error?: string }> {
  const command =
    action === 'status'
      ? ['status', '--porcelain=v1', '--ignore-submodules=all']
      : action === 'diff'
        ? ['diff', '--no-ext-diff', '--no-textconv', '--ignore-submodules=all']
        : ['log', '-n', '10', '--oneline', '--no-show-signature'];
  const res = await runGit(['--no-optional-locks', ...(await gitSafetyOptions(cwd)), ...command], cwd);
  return {
    success: res.code === 0,
    output: res.stdout.trim(),
    error: res.code !== 0 ? res.stderr.trim() : undefined,
  };
}
