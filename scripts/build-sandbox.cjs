#!/usr/bin/env node
/**
 * Builds native/windows/bin/emir-sandbox.exe (the AppContainer launcher of agent commands, next to
 * node-guard.cjs, which it loads into isolated node programs) with the
 * C# compiler of the .NET Framework, which every Windows 10 and 11 installation has. On other
 * systems it does nothing: Linux uses bubblewrap, which is not built.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

if (process.platform !== 'win32') process.exit(0);

const root = path.resolve(__dirname, '..');
const sourceDir = path.join(root, 'native', 'windows');
const sources = fs.readdirSync(sourceDir).filter((f) => f.endsWith('.cs')).map((f) => path.join(sourceDir, f));
const outDir = path.join(root, 'native', 'windows', 'bin');
const output = path.join(outDir, 'emir-sandbox.exe');
const windir = process.env.WINDIR || 'C:\\Windows';
const csc = [
  path.join(windir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
  path.join(windir, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
].find((p) => fs.existsSync(p));

if (!csc) {
  console.error('build-sandbox: the .NET Framework C# compiler (csc.exe) was not found');
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
const res = spawnSync(csc, ['/nologo', '/target:exe', '/platform:anycpu', '/optimize+', '/r:System.Security.dll', `/out:${output}`, ...sources], { encoding: 'utf8' });
if (res.status !== 0) {
  console.error(res.stdout || res.stderr);
  process.exit(res.status || 1);
}
fs.copyFileSync(path.join(root, 'native', 'windows', 'node-guard.cjs'), path.join(outDir, 'node-guard.cjs'));
console.log(`build-sandbox: ${path.relative(root, output)}`);
