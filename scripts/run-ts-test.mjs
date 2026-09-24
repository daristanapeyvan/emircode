#!/usr/bin/env node
/**
 * Bundles a TypeScript test file (resolving the "@/..." alias from tsconfig.json) with esbuild
 * and runs it with Node. Usage: node scripts/run-ts-test.mjs test_agent_reliability.ts
 */
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const entry = process.argv[2];
if (!entry) {
  console.error('usage: node scripts/run-ts-test.mjs <test-file.ts>');
  process.exit(2);
}

const dir = mkdtempSync(path.join(tmpdir(), 'emir-code-test-'));
const outfile = path.join(dir, 'test.cjs');
try {
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile,
    logLevel: 'error',
    tsconfig: 'tsconfig.json',
  });
  const result = spawnSync(process.execPath, [outfile, ...process.argv.slice(3)], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
