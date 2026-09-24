/**
 * electron-api-mock.ts — an fs-backed stand-in for window.electronAPI, used by the agent tests.
 * Mirrors electron/main.ts where it matters for the agent: workspace jail, one-time mutation
 * tokens with base-hash conflicts, and the command allowlist.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const IGNORED = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.venv']);
export const sha = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

const IS_WIN = process.platform === 'win32';
/** npm is a .cmd shim on Windows and needs a shell there. */
export function runNpm(args: string[], cwd: string, timeout = 60000) {
  return IS_WIN
    ? spawnSync(['npm.cmd', ...args].join(' '), { cwd, encoding: 'utf8', timeout, shell: true })
    : spawnSync('npm', args, { cwd, encoding: 'utf8', timeout });
}

export function makeElectronApi(root: string) {
  const rootAbs = path.resolve(root);
  const resolve = (rel: string) => {
    const p = path.resolve(rootAbs, rel || '.');
    if (p !== rootAbs && !p.startsWith(rootAbs + path.sep)) throw new Error('Yol çalışma alanı dışında');
    return p;
  };
  const tokens = new Map<string, any>();
  const scan = (dir: string, depth: number, max: number): any[] => {
    if (depth > max) return [];
    const out: any[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (IGNORED.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(rootAbs, full).replace(/\\/g, '/');
      if (entry.isDirectory()) out.push({ name: entry.name, path: full, relativePath: rel, isDirectory: true, children: scan(full, depth + 1, max) });
      else out.push({ name: entry.name, path: full, relativePath: rel, isDirectory: false, size: fs.statSync(full).size });
    }
    return out.sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1));
  };
  const walkFiles = (dir: string, acc: string[] = []) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (IGNORED.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkFiles(full, acc);
      else acc.push(full);
    }
    return acc;
  };
  return {
    readGit: async () => ({ success: false, output: '', error: 'fatal: not a git repository' }),
    listWorkspaceFiles: async (opts?: { subPath?: string; maxDepth?: number }) => {
      try {
        return { success: true, files: scan(resolve(opts?.subPath || ''), 1, opts?.maxDepth || 5) };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    },
    readWorkspaceFile: async (rel: string) => {
      try {
        const content = fs.readFileSync(resolve(rel), 'utf8');
        return { success: true, content, hash: sha(content) };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    },
    searchWorkspaceCode: async (query: string) => {
      const matches: any[] = [];
      for (const file of walkFiles(rootAbs)) {
        const lines = fs.readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, i) => {
          if (line.toLowerCase().includes(query.toLowerCase())) {
            matches.push({ relativePath: path.relative(rootAbs, file).replace(/\\/g, '/'), lineNumber: i + 1, lineContent: line });
          }
        });
      }
      return { success: true, matches: matches.slice(0, 200) };
    },
    requestMutationToken: async ({ relativePath, operation, expectedBaseHash, allowOverwrite }: any) => {
      const p = resolve(relativePath);
      let diskHash = '';
      if (fs.existsSync(p)) {
        diskHash = sha(fs.readFileSync(p, 'utf8'));
        if ((operation === 'edit' || operation === 'delete') && expectedBaseHash && diskHash !== expectedBaseHash) {
          return { success: false, conflict: true, error: 'Çakışma Tespiti: Dosya dışarıdan değiştirilmiş.' };
        }
        if (operation === 'create' && !allowOverwrite) {
          return { success: false, conflict: true, error: `Oluşturulmak istenen "${relativePath}" dosyası diskte zaten mevcut.` };
        }
      } else if (operation === 'edit' || operation === 'delete') {
        return { success: false, error: `Hedef dosya (${relativePath}) diskte bulunamadı.` };
      }
      const token = crypto.randomBytes(16).toString('hex');
      tokens.set(token, { relativePath, operation });
      return { success: true, token, baseHash: diskHash };
    },
    applyApprovedMutation: async ({ token, relativePath, operation, newContent }: any) => {
      const rec = tokens.get(token);
      if (!rec || rec.relativePath !== relativePath || rec.operation !== operation) return { success: false, error: 'token mismatch' };
      tokens.delete(token);
      try {
        const p = resolve(relativePath);
        if (operation === 'delete') fs.unlinkSync(p);
        else {
          fs.mkdirSync(path.dirname(p), { recursive: true });
          fs.writeFileSync(p, newContent || '', 'utf8');
        }
        return { success: true, approvedHash: sha(newContent || '') };
      } catch (err: any) {
        // electron/main.ts returns failures instead of throwing
        return { success: false, error: err.message };
      }
    },
    runApprovedCommand: async ({ binary, args, timeoutMs }: any) => {
      // Mirrors electron/main.ts workspace:runApprovedCommand policy
      const allowed = ['npm', 'node', 'cargo', 'pytest', 'python'];
      if (!allowed.includes(binary)) return { success: false, exitCode: 1, output: '', error: `Güvenlik Politikası: "${binary}" yürütülebilir dosyasına izin verilmiyor.` };
      if (args.some((a: string) => /[;&|`$<>\r\n]/.test(a))) return { success: false, exitCode: 1, output: '', error: 'Güvenlik Koruması: yasaklı karakter' };
      if (binary === 'npm') {
        const sub = (args[0] || '').toLowerCase();
        if (!['test', 'run'].includes(sub)) return { success: false, exitCode: 1, output: '', error: `Güvenlik Politikası: npm altında sadece test ve tanımlı betikler çalıştırılabilir. Verilen: "${sub}"` };
        if (!fs.existsSync(path.join(rootAbs, 'package.json'))) return { success: false, exitCode: 1, output: '', error: 'Proje klasöründe "package.json" dosyası mevcut değil. npm komutları çalıştırılamaz.' };
        if (sub === 'run' && !['test', 'build', 'lint', 'typecheck', 'check'].includes((args[1] || '').toLowerCase())) {
          return { success: false, exitCode: 1, output: '', error: `Güvenlik Politikası: "npm run ${args[1]}" izin verilen betikler (test, build, lint, typecheck) arasında değil.` };
        }
      }
      const res =
        binary === 'npm'
          ? runNpm(args, rootAbs, timeoutMs || 60000)
          : spawnSync(binary, args, { cwd: rootAbs, encoding: 'utf8', timeout: timeoutMs || 60000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
      const output = `${res.stdout || ''}${res.stderr || ''}`;
      return { success: res.status === 0, exitCode: res.status, output, error: res.error ? String(res.error.message) : undefined };
    },
    webSearch: async () => {
      throw new Error('web disabled in tests');
    },
    webFetch: async () => {
      throw new Error('web disabled in tests');
    },
  };
}
