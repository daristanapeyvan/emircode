/**
 * test_security.ts
 * The main process rules for the agent: which commands may start, which settings files stay
 * closed, read-only git that ignores a repository's program-running settings, and the address
 * checks of web access.
 *
 * Run: node scripts/run-ts-test.mjs test_security.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkCommand, CREDENTIAL_OR_RUNNER_CONFIG } from './electron/commandPolicy';
import { readOnlyGit } from './electron/git';
import { isPrivateAddress, checkUrlShape, parseDuckDuckGoLite, htmlToText, decodeEntities } from './electron/web';

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

// ---------------------------------------------------------------------------
section('Command policy');
const win = { hasPackageJson: true, platform: 'win32' as NodeJS.Platform };
const linux = { hasPackageJson: true, platform: 'linux' as NodeJS.Platform };
const allowed = (cmd: string, ctx = linux) => {
  const [binary, ...args] = cmd.split(' ');
  return checkCommand(binary, args, ctx);
};
const expectOk = (cmd: string, ctx = linux) => check(allowed(cmd, ctx).ok, `allowed: ${cmd}`, allowed(cmd, ctx));
const expectBlocked = (cmd: string, code: string, ctx = linux) => {
  const res = allowed(cmd, ctx);
  check(!res.ok && res.code === code, `blocked (${code}): ${cmd}`, res);
};

expectOk('npm test');
expectOk('npm run build');
expectOk('npm test -- --watch=false');
expectOk('node app.js');
expectOk('node --test');
expectOk('node app.js -e value');
expectOk('python main.py --name x');
expectOk('python -m pytest -q');
expectOk('python -u main.py');
expectOk('pytest -q tests');
expectOk('cargo test');
expectOk('cargo run --release');

expectBlocked('npx vite', 'npx');
expectBlocked('bash script.sh', 'binary');
expectBlocked('pip install requests', 'binary');
expectBlocked('node app.js;calc', 'characters');
expectBlocked('node -e require("fs")', 'inline_code');
expectBlocked('node --eval=1', 'inline_code');
expectBlocked('node -p process.env', 'inline_code');
expectBlocked('node -pe 1', 'inline_code');
expectBlocked('node --import data:text/javascript,1', 'inline_code');
expectBlocked('node -r data:text/javascript,1 app.js', 'inline_code');
expectBlocked('python -c print(1)', 'inline_code');
expectBlocked('python -Bc print(1)', 'inline_code');
expectBlocked('python -m pip install requests', 'python_module');
expectBlocked('python -mpip install requests', 'python_module');
expectBlocked('python -m http.server', 'python_module');
expectBlocked('cargo install ripgrep', 'cargo_subcommand');
expectBlocked('npm install', 'npm_subcommand');
expectBlocked('npm test --script-shell=calc.exe', 'npm_option');
expectBlocked('npm run test --userconfig=x', 'npm_option');
expectBlocked('npm run deploy', 'npm_script');
expectBlocked('npm test -- %PATH%', 'windows_characters', win);
check(!checkCommand('npm', ['test'], { hasPackageJson: false, platform: 'linux' }).ok, 'npm without package.json is refused');

section('Settings files that hold credentials or change commands');
for (const file of ['.npmrc', 'sub/.npmrc', '.yarnrc.yml', '.pypirc', '.netrc', '_netrc', '.git-credentials', 'pip.ini']) {
  check(CREDENTIAL_OR_RUNNER_CONFIG.test(file), `closed: ${file}`);
}
for (const file of ['package.json', 'src/npmrc.js', 'README.md']) {
  check(!CREDENTIAL_OR_RUNNER_CONFIG.test(file), `open: ${file}`);
}

// ---------------------------------------------------------------------------
section('Web addresses');
for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', '2002:c0a8:101::1']) {
  check(isPrivateAddress(ip), `private: ${ip}`);
}
for (const ip of ['1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
  check(!isPrivateAddress(ip), `public: ${ip}`);
}
for (const url of ['http://localhost:3000', 'http://printer.local/', 'http://127.0.0.1/', 'http://[::1]/', 'file:///etc/passwd', 'ftp://example.com', 'http://user:pw@example.com/', 'not a url']) {
  check(!checkUrlShape(url).ok, `refused address: ${url}`);
}
check(checkUrlShape('https://example.com/docs?q=1').ok, 'accepted address: https://example.com/docs?q=1');

section('Search page parsing');
{
  const page = `<table><tr><td><a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=x" class='result-link'>Example &amp; Co</a></td></tr>
  <tr><td class='result-snippet'>First &#8220;snippet&#8221;</td></tr>
  <tr><td><a href="http://localhost:8080/" class='result-link'>Local</a></td></tr><tr><td class='result-snippet'>hidden</td></tr></table>`;
  const res = parseDuckDuckGoLite(page, 5, 'Search result');
  check(res.recognized && res.items.length === 1, 'One public result; the local one is dropped', res);
  check(res.items[0]?.url === 'https://example.com/a' && res.items[0]?.title === 'Example & Co', 'The redirect link is resolved and entities decoded', res.items[0]);
  check(res.items[0]?.snippet === 'First “snippet”', 'Numeric entities in the snippet are decoded', res.items[0]);
  check(res.items[0]?.id === 'web-001', 'Results get source ids', res.items[0]);
  check(parseDuckDuckGoLite('<p>No results.</p>', 5, 'x').recognized, 'A "no results" page is recognized');
  check(!parseDuckDuckGoLite('<html><body><div class="new-layout">...</div></body></html>', 5, 'x').recognized, 'An unknown layout is reported, not taken for zero results');
}
{
  const page = htmlToText('<html><head><title>T&#252;rk&ccedil;e</title><style>x{}</style></head><body><h1>Head</h1><p>A &amp; B</p><script>evil()</script></body></html>', 'Page');
  check(!page.text.includes('evil') && page.text.includes('## Head') && page.text.includes('A & B'), 'Page text keeps headings, drops scripts', page);
  check(decodeEntities('&#x41;&#66;&lt;') === 'AB<', 'Hex, decimal and named entities decode');
}

// ---------------------------------------------------------------------------
async function gitTests() {
  section('Read-only git ignores the repository\'s program-running settings');
  const hasGit = spawnSync('git', ['--version']).status === 0;
  if (!hasGit) {
    console.log('(git not installed: skipped)');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emir-git-'));
  const git = (...args: string[]) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  try {
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    git('config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
    git('add', 'a.txt');
    git('commit', '-q', '-m', 'first');
    // A hostile repository: every setting below makes git run a program.
    fs.writeFileSync(path.join(dir, '.gitattributes'), '*.txt filter=evil diff=conv\n');
    git('config', 'filter.evil.clean', 'touch marker_filter; cat');
    git('config', 'filter.evil.smudge', 'touch marker_smudge; cat');
    git('config', 'diff.conv.textconv', 'touch marker_textconv; cat');
    git('config', 'diff.external', 'touch marker_external');
    git('config', 'core.fsmonitor', 'touch marker_fsmonitor');
    fs.mkdirSync(path.join(dir, '.git', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.git', 'hooks', 'post-index-change'), '#!/bin/sh\ntouch marker_hook\n', { mode: 0o755 });
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo\n');
    const markers = () => fs.readdirSync(dir).filter((f) => f.startsWith('marker_'));

    const status = await readOnlyGit('status', dir);
    const diff = await readOnlyGit('diff', dir);
    const log = await readOnlyGit('log', dir);
    check(markers().length === 0, 'status, diff and log ran none of the repository\'s commands', markers());
    check(status.success && /a\.txt/.test(status.output), 'status still reports the changed file', status);
    check(diff.success && /\+two/.test(diff.output), 'diff still shows the change', diff);
    check(log.success && /first/.test(log.output), 'log still lists the commit', log);

    // Control: plain git in the same repository does run them (the repository really is hostile).
    git('diff');
    git('status');
    console.log(`   (plain git ran: ${markers().join(', ') || 'none'})`);
    check(markers().length > 0, 'Control: plain git runs at least one of those commands');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

gitTests()
  .catch((err) => {
    failures.push(`git tests crashed: ${err?.stack || err}`);
    console.error(err);
  })
  .finally(() => {
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length > 0) {
      console.error(failures.map((f) => ` - ${f}`).join('\n'));
      process.exitCode = 1;
    }
  });
