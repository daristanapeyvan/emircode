/**
 * test_sandbox.ts
 * The isolated environment of agent commands, tried for real on the system the test runs on:
 * Windows (AppContainer via native/windows/bin/emir-sandbox.exe, built by scripts/build-sandbox.cjs)
 * and Linux (bubblewrap, when installed and allowed). A program in it must reach the project folder
 * and nothing else: not a file next to the project, not the home folder, not the network.
 *
 * Run: node scripts/build-sandbox.cjs && node scripts/run-ts-test.mjs test_sandbox.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Sandbox, linuxMounts, isSandboxSetupFailure, commandEnvironment } from './electron/sandbox';

let passed = 0;
const failures: string[] = [];
function check(condition: boolean, message: string, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`✅ ${message}`);
  } else {
    failures.push(message);
    console.error(`❌ ${message}${detail !== undefined ? `\n   → ${JSON.stringify(detail).slice(0, 900)}` : ''}`);
  }
}
const section = (title: string) => console.log(`\n--- ${title} ---`);

function runPlan(plan: { command: string; args: string[]; shell: boolean; env?: Record<string, string> }, cwd: string): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    // The same reduced environment the app gives commands (a fuller one hid a launcher failure).
    const child = spawn(plan.command, plan.args, { cwd, shell: plan.shell, windowsHide: true, env: { ...commandEnvironment(), ...(plan.env || {}) } });
    let output = '';
    child.stdout?.on('data', (d) => (output += d));
    child.stderr?.on('data', (d) => (output += d));
    const timer = setTimeout(() => child.kill(), 30000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: null, output: String(err) });
    });
  });
}

const PROBE = `
const fs = require('fs'), path = require('path'), os = require('os'), net = require('net');
const r = {};
const t = (n, f) => { try { f(); r[n] = 'allowed'; } catch (e) { r[n] = 'denied'; } };
t('readInside', () => fs.readFileSync(path.join(process.cwd(), 'probe.js')));
t('writeInside', () => fs.writeFileSync(path.join(process.cwd(), 'written.txt'), 'x'));
t('readNextToProject', () => fs.readFileSync(path.join(process.cwd(), '..', 'secret.txt')));
t('writeNextToProject', () => fs.writeFileSync(path.join(process.cwd(), '..', 'escaped.txt'), 'x'));
t('listHome', () => { const entries = fs.readdirSync(os.homedir()); if (entries.length === 0) throw new Error('empty'); });
try { require('child_process').execFileSync(process.execPath, ['-v'], { stdio: 'pipe', timeout: 5000 }); r.childProcess = 'allowed'; }
catch (e) { r.childProcess = e.code === 'EMIRCODE_ISOLATED' ? 'refused clearly' : 'failed: ' + (e.code || e.message); }
const s = net.connect({ host: '1.1.1.1', port: 443 });
const done = (v) => { r.internet = v; s.destroy(); console.log(JSON.stringify(r)); };
const timer = setTimeout(() => done('denied'), 5000);
s.on('connect', () => { clearTimeout(timer); done('allowed'); });
s.on('error', () => { clearTimeout(timer); done('denied'); });
`;

async function main() {
  section('Linux mounts (any system)');
  const exists = (p: string) => ['/home', '/home/ada/.nvm', '/home/ada/.cargo'].includes(p);
  const mounts = linuxMounts('/home/ada/work/site', '/home/ada/.nvm/versions/node/v22/bin/node', '/home/ada', exists).join(' ');
  check(mounts.startsWith('--ro-bind / /'), 'The system is mounted read-only', mounts);
  check(/--tmpfs \/home/.test(mounts) && /--tmpfs \/tmp/.test(mounts), 'Home folders and /tmp are replaced by empty private ones', mounts);
  check(/--bind \/home\/ada\/work\/site \/home\/ada\/work\/site/.test(mounts), 'The project folder is mounted writable', mounts);
  check(/--ro-bind \/home\/ada\/\.nvm \/home\/ada\/\.nvm/.test(mounts) && /--ro-bind \/home\/ada\/\.cargo/.test(mounts), 'Language tools in the home folder stay readable', mounts);
  check(!/\.ssh/.test(mounts), 'Nothing else of the home folder comes back', mounts);
  check(isSandboxSetupFailure(125, 'emir-sandbox: the project folder does not exist') && !isSandboxSetupFailure(125, 'a program that exits with 125'), 'Launcher setup failures are told apart from a program exit code 125');

  const resources = path.resolve('native', 'windows', 'bin');
  const sandbox = new Sandbox(resources);
  const status = await sandbox.status({ enabled: true, network: false });
  section(`This system: ${status.method}, ${status.supported ? 'supported' : `not supported (${status.reason})`}`);
  if (!status.supported) {
    console.log('(no isolated environment here: the live checks are skipped)');
    return;
  }

  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'emir-sbx-'));
  const project = path.join(base, 'project');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(base, 'secret.txt'), 'secret');
  fs.writeFileSync(path.join(project, 'probe.js'), PROBE);
  try {
    if (process.platform === 'win32') {
      check(status.node?.isolated === true, 'Node can run isolated on this computer', status.node);
      console.log(`   (Python here: ${status.python?.isolated ? 'isolated' : status.python?.reason || 'not found'})`);
      const npm = await sandbox.plan('npm', ['test'], project, { enabled: true, network: false });
      check(!npm.isolated && npm.reason === 'isolationStartsPrograms', 'npm runs without isolation on Windows, with the reason', npm);
      const runner = await sandbox.plan('node', ['--test'], project, { enabled: true, network: false });
      check(!runner.isolated && runner.reason === 'isolationTestRunner', "Node's test runner runs without isolation on Windows", runner);
    }
    const off = await sandbox.plan('node', ['probe.js'], project, { enabled: false, network: false });
    check(!off.isolated && off.reason === 'isolationOff', 'With the setting off nothing is isolated', off);

    const plan = await sandbox.plan('node', ['probe.js'], project, { enabled: true, network: false });
    check(plan.isolated, 'node probe.js is planned isolated', plan);
    const res = await runPlan(plan, project);
    let r: Record<string, string> = {};
    try {
      r = JSON.parse(res.output.trim().split('\n').pop() || '{}');
    } catch {
      r = {};
    }
    check(res.code === 0 && r.readInside === 'allowed' && r.writeInside === 'allowed', 'Inside the project the program reads and writes', { code: res.code, r, out: res.output.slice(0, 300) });
    check(r.readNextToProject === 'denied' && r.writeNextToProject === 'denied', 'A file next to the project can be neither read nor written', r);
    check(!fs.existsSync(path.join(base, 'escaped.txt')), 'Nothing was written outside the project');
    check(r.listHome === 'denied', 'The home folder is out of reach (Windows: denied; Linux: an empty private one)', r);
    check(r.internet === 'denied', 'No internet without the network setting', r);
    if (process.platform === 'win32') {
      check(r.childProcess === 'refused clearly', 'Starting another program fails at once with a clear message instead of hanging', r);
    } else {
      check(r.childProcess === 'allowed', 'On Linux a program may start others inside the isolation', r);
    }

    const withNet = await sandbox.plan('node', ['probe.js'], project, { enabled: true, network: true });
    const netRes = await runPlan(withNet, project);
    const rn = JSON.parse(netRes.output.trim().split('\n').pop() || '{}');
    console.log(`   (with the network setting the internet is: ${rn.internet}; CI runners may block it)`);
    check(rn.readNextToProject === 'denied', 'The network setting does not open the file system', rn);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

main()
  .catch((err) => {
    failures.push(`crashed: ${err?.stack || err}`);
    console.error(err);
  })
  .finally(() => {
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length > 0) {
      console.error(failures.map((f) => ` - ${f}`).join('\n'));
      process.exitCode = 1;
    }
  });
