/**
 * agent-e2e.ts — end-to-end benchmark of the coding agent against a LOCAL Ollama model.
 *
 * Runs the real AgentEngine (autonomous profile, web access off) in temporary workspaces with an
 * fs-backed window.electronAPI that mirrors electron/main.ts (mutation tokens, command policy),
 * then verifies the produced files independently (npm test, Python AST parse, JSON, HTML checks).
 *
 * Requires a running Ollama with the model pulled. On a CPU-only laptop a 7B model needs
 * 5-15 minutes per scenario.
 *
 * Usage:
 *   node scripts/run-ts-test.mjs scripts/agent-e2e.ts <model> [scenario,scenario,...] [outDir]
 *   e.g. node scripts/run-ts-test.mjs scripts/agent-e2e.ts qwen2.5-coder:7b web-new,web-followup,js-bugfix
 * Scenarios: web-new, web-followup, repair-corrupted, js-bugfix, python-cli, json-config
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { agentEngine } from '../src/lib/agent/AgentEngine';
import { useSettingsStore } from '../src/stores/settingsStore';
import { DEFAULT_SETTINGS } from '../src/types/settings';
import { checkFileSanity } from '../src/lib/agent/FileSanity';
import { looksJsonEscaped, extractLocalScripts, extractLocalStylesheets } from '../src/lib/agent/TaskValidator';

const [model, scenarioArg, outDirArg] = process.argv.slice(2);
if (!model) {
  console.error('usage: node scripts/run-ts-test.mjs scripts/agent-e2e.ts <model> [scenarios] [outDir]');
  process.exit(2);
}
const outDir = path.resolve(outDirArg || path.join(os.tmpdir(), 'emir-code-agent-e2e'));
fs.mkdirSync(outDir, { recursive: true });

const IS_WIN = process.platform === 'win32';
/** npm is a .cmd shim on Windows and needs a shell there. */
function runNpm(args: string[], cwd: string, timeout = 60000) {
  return IS_WIN
    ? spawnSync(['npm.cmd', ...args].join(' '), { cwd, encoding: 'utf8', timeout, shell: true })
    : spawnSync('npm', args, { cwd, encoding: 'utf8', timeout });
}

/** A page damaged the way v1.5.x wrote it to disk: one line, literal \n and \" sequences. */
const CORRUPTED_PAGE =
  '<!DOCTYPE html>\\n<html lang=\\"tr\\">\\n<head>\\n  <meta charset=\\"UTF-8\\">\\n  <title>Arkadaşım İçin</title>\\n  <style>\\n    .container { max-width: 640px; margin: 0 auto; padding: 2rem; background: #fff; }\\n    h1 { color: #b91c1c; }\\n  </style>\\n</head>\\n<body>\\n  <div class=\\"container\\">\\n    <h1>Sevgili Dostum</h1>\\n    <p>Seninle geçen her gün bir hediye.</p>\\n    <button id=\\"hello\\">Merhaba de</button>\\n  </div>\\n  <script>\\n    document.getElementById(\\"hello\\").addEventListener(\\"click\\", () => alert(\\"Merhaba!\\"));\\n  </script>\\n</body>\\n</html>';

const sha = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const IGNORED = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.venv']);

function makeElectronApi(root: string) {
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
    webSearch: async () => { throw new Error('web disabled in harness'); },
    webFetch: async () => { throw new Error('web disabled in harness'); },
  };
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------
interface Scenario {
  id: string;
  goal: string;
  seed?: (dir: string) => void;
  dependsOn?: string;
  verify: (dir: string) => { ok: boolean; notes: string[] };
}

const htmlFiles = (dir: string) => fs.readdirSync(dir).filter((f) => /\.html?$/i.test(f));
const readAllText = (dir: string, exts: RegExp) => {
  let out = '';
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (!IGNORED.has(e.name)) walk(f); }
      else if (exts.test(e.name)) out += '\n' + fs.readFileSync(f, 'utf8');
    }
  };
  walk(dir);
  return out;
};
const sanityErrorsIn = (dir: string) => {
  const notes: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (!IGNORED.has(e.name)) walk(f); continue; }
      const rel = path.relative(dir, f).replace(/\\/g, '/');
      for (const issue of checkFileSanity(rel, fs.readFileSync(f, 'utf8'))) {
        if (issue.severity === 'error') notes.push(`${rel}: ${issue.message}`);
      }
    }
  };
  walk(dir);
  return notes;
};

/** CSS and JavaScript the page really loads: inline blocks plus linked local files that exist. */
function pageAssets(dir: string, pageRel: string, page: string) {
  const read = (ref: string) => {
    const file = path.join(dir, path.dirname(pageRel), ref.split(/[?#]/)[0]);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  };
  const inline = (tag: string) =>
    [...page.matchAll(new RegExp(`<${tag}\\b(?![^>]*\\bsrc=)[^>]*>([\\s\\S]*?)</${tag}>`, 'gi'))].map((m) => m[1]).join('\n');
  return {
    css: [inline('style'), ...extractLocalStylesheets(page).map(read)].join('\n'),
    js: [inline('script'), ...extractLocalScripts(page).map(read)].join('\n'),
  };
}

function verifyStyledPage(dir: string, needScript: boolean) {
  const notes: string[] = [];
  const pages = htmlFiles(dir);
  if (pages.length === 0) return { ok: false, notes: ['no html file'] };
  const pageRel = pages.includes('index.html') ? 'index.html' : pages[0];
  const page = fs.readFileSync(path.join(dir, pageRel), 'utf8');
  // Only what the page loads counts: a script.js that is never linked does nothing in the browser.
  const { css, js } = pageAssets(dir, pageRel, page);
  const cssRules = (css.match(/[^{}]+\{[^{}]*:[^{}]*\}/g) || []).length;
  const escaped = looksJsonEscaped(page);
  const hasViewport = /name=["']viewport["']/i.test(page);
  const hasScript = /addEventListener|onclick|onsubmit|querySelector|getElementById/i.test(js + page);
  const sanity = sanityErrorsIn(dir);
  notes.push(`pages=${pages.join(',')} lines=${page.split('\n').length} cssRules=${cssRules} viewport=${hasViewport} script=${hasScript} escaped=${escaped}`);
  notes.push(...sanity.map((s) => `SANITY: ${s}`));
  const ok = !escaped && cssRules >= 6 && hasViewport && (!needScript || hasScript) && sanity.length === 0;
  return { ok, notes };
}

const SCENARIOS: Scenario[] = [
  {
    id: 'web-new',
    goal: 'Bir kahve dükkanı için tek sayfalık modern bir web sitesi oluştur: menü (en az 6 ürün, fiyatlarıyla), hakkımızda ve iletişim bölümleri olsun. Responsive olsun ve iletişim formu JavaScript ile doğrulansın.',
    verify: (dir) => verifyStyledPage(dir, true),
  },
  {
    id: 'web-followup',
    dependsOn: 'web-new',
    goal: 'başlıkların rengini koyu mavi (#1e3a8a) yap ve sayfanın en altına telif yazısı olan bir footer ekle',
    verify: (dir) => {
      const base = verifyStyledPage(dir, false);
      const text = readAllText(dir, /\.(html?|css)$/i).toLowerCase();
      const color = text.includes('#1e3a8a');
      const footer = text.includes('<footer');
      base.notes.push(`color=${color} footer=${footer}`);
      return { ok: base.ok && color && footer, notes: base.notes };
    },
  },
  {
    id: 'repair-corrupted',
    goal: 'Sitede Script ve CSS Etiketleri Eksik Kalmış',
    seed: (dir) => {
      fs.writeFileSync(path.join(dir, 'index.html'), CORRUPTED_PAGE, 'utf8');
    },
    // A repair must keep the page's content, remove the escape corruption and leave working
    // CSS/JS; the request does not ask for responsiveness, so the viewport tag is not required.
    verify: (dir) => {
      const page = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
      const { css: cssText, js: linkedJs } = pageAssets(dir, 'index.html', page);
      const jsText = linkedJs + page;
      const escaped = looksJsonEscaped(page);
      const kept = ['Sevgili Dostum', 'Seninle geçen her gün bir hediye', 'Merhaba de'].filter((t) => page.includes(t));
      const cssRules = (cssText.match(/[^{}]+\{[^{}]*:[^{}]*\}/g) || []).length;
      const hasScript = /addEventListener|onclick/i.test(jsText);
      const sanity = sanityErrorsIn(dir);
      return {
        ok: !escaped && kept.length === 3 && cssRules >= 2 && hasScript && sanity.length === 0,
        notes: [`escaped=${escaped} keptContent=${kept.length}/3 cssRules=${cssRules} script=${hasScript}`, ...sanity],
      };
    },
  },
  {
    id: 'js-bugfix',
    goal: 'Testler başarısız oluyor. src/price.js dosyasındaki hataları düzelt (negatif fiyatlar ve yüzde indirim hesaplaması) ve npm test ile doğrula.',
    seed: (dir) => {
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'shop', version: '1.0.0', scripts: { test: 'node --test' } }, null, 2));
      fs.writeFileSync(
        path.join(dir, 'src/price.js'),
        `function formatPrice(value) {\n  // Returns prices like "12,50 TL"\n  const fixed = Math.abs(value).toFixed(2).replace('.', ',');\n  return fixed + ' TL';\n}\n\nfunction applyDiscount(price, percent) {\n  return price - price * percent;\n}\n\nmodule.exports = { formatPrice, applyDiscount };\n`
      );
      fs.writeFileSync(
        path.join(dir, 'test/price.test.js'),
        `const test = require('node:test');\nconst assert = require('node:assert');\nconst { formatPrice, applyDiscount } = require('../src/price');\n\ntest('formats positive prices', () => assert.strictEqual(formatPrice(12.5), '12,50 TL'));\ntest('formats negative prices with a minus sign', () => assert.strictEqual(formatPrice(-3), '-3,00 TL'));\ntest('applies percentage discounts', () => assert.strictEqual(applyDiscount(200, 10), 180));\n`
      );
    },
    verify: (dir) => {
      const res = runNpm(['test'], dir);
      const sanity = sanityErrorsIn(dir);
      const testUnchanged = fs.readFileSync(path.join(dir, 'test/price.test.js'), 'utf8').includes("'-3,00 TL'");
      return {
        ok: res.status === 0 && sanity.length === 0 && testUnchanged,
        notes: [`npm test exit=${res.status} testsUnchanged=${testUnchanged}`, ...(res.stdout || '').split('\n').filter((l) => /^# (pass|fail)/.test(l)), ...sanity],
      };
    },
  },
  {
    id: 'python-cli',
    goal: 'Python ile komut satırından çalışan bir yapılacaklar listesi (todo) uygulaması yaz: ekle, listele, tamamla ve sil komutları olsun; veriler todos.json dosyasında saklansın.',
    verify: (dir) => {
      const pyFiles = fs.readdirSync(dir).filter((f) => f.endsWith('.py'));
      const notes: string[] = [`py=${pyFiles.join(',')}`];
      let ok = pyFiles.length > 0;
      for (const f of pyFiles) {
        const res = spawnSync('python', ['-c', `import ast,sys; ast.parse(open(sys.argv[1],encoding='utf-8').read())`, f], { cwd: dir, encoding: 'utf8' });
        notes.push(`${f}: ast.parse exit=${res.status}${res.stderr ? ' ' + res.stderr.trim().split('\n').pop() : ''}`);
        if (res.status !== 0) ok = false;
      }
      const sanity = sanityErrorsIn(dir);
      notes.push(...sanity);
      return { ok: ok && sanity.length === 0, notes };
    },
  },
  {
    id: 'json-config',
    goal: "package.json dosyasına 'start' script'i olarak 'node src/index.js' ekle ve src/index.js dosyasını konsola 'Merhaba dünya' yazdıracak şekilde oluştur.",
    seed: (dir) => {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'hello', version: '0.1.0', private: true, scripts: { test: 'echo ok' } }, null, 2));
    },
    verify: (dir) => {
      const notes: string[] = [];
      let pkg: any = null;
      try {
        pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      } catch (e: any) {
        notes.push(`package.json invalid: ${e.message}`);
      }
      const start = pkg?.scripts?.start;
      const keptTest = pkg?.scripts?.test === 'echo ok';
      const run = spawnSync('node', ['src/index.js'], { cwd: dir, encoding: 'utf8' });
      notes.push(`start=${start} keptTest=${keptTest} output=${JSON.stringify((run.stdout || '').trim())}`);
      return { ok: !!pkg && /node\s+src\/index\.js/.test(start || '') && keptTest && /merhaba/i.test(run.stdout || ''), notes };
    },
  },
];

// ---------------------------------------------------------------------------
async function runScenario(s: Scenario, previousContext?: string, reuseDir?: string) {
  const dir = reuseDir || path.join(outDir, `${model.replace(/[:/]/g, '_')}__${s.id}`);
  if (!reuseDir) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    s.seed?.(dir);
  }
  (globalThis as any).window = { electronAPI: makeElectronApi(dir) };

  const started = Date.now();
  const log: string[] = [];
  const stamp = () => `${((Date.now() - started) / 1000).toFixed(0).padStart(4)}s`;
  let finalStatus = 'unknown';
  let finalText = '';
  let modelSteps = 0;
  const steps: any[] = [];

  await agentEngine.runGoal(
    s.goal,
    model,
    {
      onStep: (step) => {
        steps.push(step);
        if (step.type === 'thought') modelSteps++;
        const line = `${stamp()} [${step.type}${step.status ? ':' + step.status : ''}] ${step.title ? step.title + ' — ' : ''}${String(step.content).replace(/\s+/g, ' ').slice(0, 220)}`;
        log.push(line);
        console.log(line);
        if (step.type === 'final_answer') finalText = step.content;
      },
      onStatusChange: (st) => {
        if (['finished', 'error', 'idle'].includes(st)) finalStatus = st;
      },
      onLog: (msg) => {
        const line = `${stamp()} · ${msg.replace(/\s+/g, ' ').slice(0, 220)}`;
        log.push(line);
        if (/Adım \d+:|Model profili|sıkıştır|kesildi|tekrar|desteklemiyor/.test(msg)) console.log(line);
      },
      onRequestChangesetApproval: async () => true,
      onRequestDeleteApproval: async () => true,
      onRequestCommandApproval: async () => true,
      onRequestClarification: async (q) => (q.options && q.options[0]) || 'En uygun seçeneği uygula',
    },
    'autonomous',
    60,
    { previousContext }
  );

  const secs = Math.round((Date.now() - started) / 1000);
  const verdict = s.verify(dir);
  const result = {
    model,
    scenario: s.id,
    status: finalStatus,
    verified: verdict.ok,
    seconds: secs,
    modelSteps,
    notes: verdict.notes,
    final: finalText.slice(0, 400),
    dir,
  };
  fs.writeFileSync(path.join(dir, '_agent_log.txt'), log.join('\n'), 'utf8');
  console.log(`\n=== RESULT ${model} ${s.id}: status=${finalStatus} verified=${verdict.ok} time=${secs}s steps=${modelSteps}\n${verdict.notes.map((n) => '    ' + n).join('\n')}\n`);
  return { result, dir, previousContext: `Previous request: ${s.goal}\nOutcome: ${finalText.slice(0, 1200) || finalStatus}\nFiles changed in this session: ${steps.filter((x) => x.type === 'tool_result' && x.status === 'success' && /"([^"]+)"/.test(x.content)).map((x) => x.content.match(/"([^"]+)"/)[1]).filter((v, i, a) => a.indexOf(v) === i).join(', ')}` };
}

async function main() {
  useSettingsStore.setState({
    settings: {
      ...DEFAULT_SETTINGS,
      securityProfile: 'autonomous',
      webAccess: { enabled: false, chatEnabled: false, codingEnabled: false },
    },
    hardware: {
      cpu: { model: 'AMD Ryzen 5 7530U', cores: 6, logicalProcessors: 12 },
      ram: { totalBytes: 15.9e9, availableBytes: 6e9, totalGb: 14.8, availableGb: 6 },
    },
  } as any);

  const ids = (scenarioArg || 'web-new').split(',');
  const results: any[] = [];
  const contexts: Record<string, { dir: string; previousContext: string }> = {};
  for (const id of ids) {
    const s = SCENARIOS.find((x) => x.id === id);
    if (!s) throw new Error(`unknown scenario ${id}`);
    let prev: { dir: string; previousContext: string } | undefined;
    if (s.dependsOn) {
      prev = contexts[s.dependsOn];
      if (!prev) {
        console.log(`skip ${id}: depends on ${s.dependsOn}`);
        continue;
      }
    }
    console.log(`\n######## ${model} :: ${id} ########`);
    const out = await runScenario(s, prev?.previousContext, prev?.dir);
    contexts[id] = { dir: out.dir, previousContext: out.previousContext };
    results.push(out.result);
    fs.writeFileSync(path.join(outDir, `results_${model.replace(/[:/]/g, '_')}.json`), JSON.stringify(results, null, 2));
  }
  console.log('\nSUMMARY');
  for (const r of results) console.log(`${r.verified ? 'PASS' : 'FAIL'}  ${r.model}  ${r.scenario}  status=${r.status}  ${r.seconds}s  steps=${r.modelSteps}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
