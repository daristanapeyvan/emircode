/**
 * test_sandbox.ts
 * The isolated environment of agent commands, tried for real on the system the test runs on:
 * Windows (native/windows/bin/emir-sandbox.exe, built by scripts/build-sandbox.cjs) and Linux
 * (bubblewrap, when installed and allowed). A program in it must reach the project folder and
 * nothing else: not a file next to the project, not the home folder, not the network.
 *
 * On Windows a whole process tree (npm test) is isolated only by the separate account, which an
 * administrator sets up once ("emir-sandbox.exe --setup"). Where it is set up, the test tries it;
 * where it is not, the tree must at least run write-protected. EMIR_REQUIRE_FULL=1 (CI) makes a
 * missing or broken setup a failure.
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
    // On GitHub the failure becomes an annotation of the run, readable without the job log.
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=${process.platform}: ${message}::${detail !== undefined ? JSON.stringify(detail).slice(0, 700).replace(/\r?\n/g, ' ') : 'failed'}`);
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
    const timer = setTimeout(() => child.kill(), 90000);
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

/** The probe's result: the last line of the output that is a JSON object (npm prints around it). */
function probeResult(output: string): Record<string, string> {
  const line = output.split(/\r?\n/).reverse().find((l) => l.trim().startsWith('{'));
  try {
    return line ? JSON.parse(line) : {};
  } catch {
    return {};
  }
}

// A file of the user in the real home folder. Isolated programs get a home folder of their own (on
// Linux with the folders of language tools in it), so the probe is told where this file is.
const HOME_SECRET = path.join(os.homedir(), `.emir-code-sandbox-test-${process.pid}.txt`);
const PROBE = `
const fs = require('fs'), path = require('path'), os = require('os'), net = require('net');
const r = {};
const t = (n, f) => { try { f(); r[n] = 'allowed'; } catch (e) { r[n] = 'denied'; } };
t('readInside', () => fs.readFileSync(path.join(process.cwd(), 'probe.js')));
t('writeInside', () => fs.writeFileSync(path.join(process.cwd(), 'written.txt'), 'x'));
t('readNextToProject', () => fs.readFileSync(path.join(process.cwd(), '..', 'secret.txt')));
t('writeNextToProject', () => fs.writeFileSync(path.join(process.cwd(), '..', 'escaped.txt'), 'x'));
t('readHome', () => fs.readFileSync(${JSON.stringify(HOME_SECRET)}));
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
  if (process.env.GITHUB_ACTIONS) console.log(`::notice title=${process.platform} isolation::${status.method}, ${status.supported ? 'supported' : `not supported (${status.reason})`}${status.full ? `, full isolation ${status.full.working ? `working, network ${status.full.network}` : `not working: ${status.full.error || 'not set up'}`}` : ''}`);
  if (!status.supported) {
    console.log('(no isolated environment here: the live checks are skipped)');
    return;
  }

  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'emir-sbx-'));
  const project = path.join(base, 'project');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(base, 'secret.txt'), 'secret');
  fs.writeFileSync(HOME_SECRET, 'secret');
  fs.writeFileSync(path.join(project, 'probe.js'), PROBE);
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'probe', version: '1.0.0', scripts: { test: 'node probe.js' } }));
  const off = { enabled: true, network: false };
  const windows = process.platform === 'win32';
  const full = status.full;
  try {
    if (windows) {
      console.log(`   (Python in an AppContainer here: ${status.python?.isolated ? 'isolated' : status.python?.reason || 'not found'})`);
      console.log(`   (full isolation here: ${full?.working ? `working, network ${full.network}` : full?.configured ? `set up but not starting: ${full.error}` : 'not set up'})`);
      if (process.env.EMIR_REQUIRE_FULL === '1') check(!!full?.working, 'Full isolation is set up and starts programs (required on this system)', full);
    }
    const disabled = await sandbox.plan('node', ['probe.js'], project, { enabled: false, network: false });
    check(!disabled.isolated && disabled.level === 'none' && disabled.reason === 'isolationOff', 'With the setting off nothing is isolated', disabled);

    // One program (node probe.js).
    const plan = await sandbox.plan('node', ['probe.js'], project, off);
    check(plan.isolated && plan.level === 'full', 'node probe.js is planned isolated', plan);
    check((await sandbox.prepare(plan)).ok, 'The project folder is opened to the isolated program');
    const res = await runPlan(plan, project);
    const r = probeResult(res.output);
    check(res.code === 0 && r.readInside === 'allowed' && r.writeInside === 'allowed', 'Inside the project the program reads and writes', { code: res.code, r, out: res.output.slice(0, 300) });
    check(r.readNextToProject === 'denied' && r.writeNextToProject === 'denied', 'A file next to the project can be neither read nor written', r);
    check(!fs.existsSync(path.join(base, 'escaped.txt')), 'Nothing was written outside the project');
    check(r.readHome === 'denied', "A file in the user's home folder cannot be read", r);
    if (windows && full?.working && full.network !== 'blocked') {
      console.log(`   (the firewall does not block the account's network here: ${full.network}; internet: ${r.internet})`);
    } else {
      check(r.internet === 'denied', 'No internet without the network setting', r);
    }
    if (windows && !full?.working) {
      check(r.childProcess === 'refused clearly', 'In an AppContainer, starting another program fails at once with a clear message instead of hanging', r);
    } else {
      check(r.childProcess === 'allowed', 'A program may start others inside the isolation', r);
    }

    const withNet = await sandbox.plan('node', ['probe.js'], project, { enabled: true, network: true });
    await sandbox.prepare(withNet);
    const rn = probeResult((await runPlan(withNet, project)).output);
    console.log(`   (with the network setting the internet is: ${rn.internet}; CI runners may block it)`);
    check(rn.readNextToProject === 'denied', 'The network setting does not open the file system', rn);

    // A process tree (npm test starts cmd.exe, which starts node, which starts node).
    if (windows) {
      section(full?.working ? 'A process tree under the separate account' : 'A process tree, write-protected (full isolation is not set up)');
      const npm = await sandbox.plan('npm', ['test'], project, off);
      const runner = await sandbox.plan('node', ['--test'], project, off);
      check((await sandbox.prepare(npm)).ok, 'The project folder is prepared for npm test', npm);
      fs.rmSync(path.join(project, 'written.txt'), { force: true });
      const tree = await runPlan(npm, project);
      const t = probeResult(tree.output);
      check(tree.code === 0 && t.writeInside === 'allowed' && t.childProcess === 'allowed', 'npm test runs: the tree starts, writes into the project and starts programs of its own', { code: tree.code, t, out: tree.output.slice(-600) });
      check(t.writeNextToProject === 'denied' && !fs.existsSync(path.join(base, 'escaped.txt')), 'It cannot write next to the project', t);
      if (full?.working) {
        check(npm.level === 'full' && runner.level === 'full', 'npm and the test runner are planned fully isolated', { npm: npm.level, runner: runner.level });
        check(t.readNextToProject === 'denied' && t.readHome === 'denied', "It cannot read a file next to the project or in the user's home folder", t);
        if (full.network === 'blocked') check(t.internet === 'denied', 'It has no internet', t);
      } else {
        check(npm.level === 'write' && !npm.isolated && npm.reason === 'isolationWriteOnly', 'npm is planned write-protected, and says so', npm);
        check(runner.level === 'write' && !runner.isolated, "Node's test runner is planned write-protected", runner);
        console.log(`   (write-protected programs can read the user's files: readNextToProject=${t.readNextToProject}; internet=${t.internet})`);
      }
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(HOME_SECRET, { force: true });
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
