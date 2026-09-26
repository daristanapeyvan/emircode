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
 * Scenarios: web-new, web-followup, repair-corrupted, js-bugfix, python-cli, json-config,
 *            nav-links, six-products (both replay requests from the in-app reports),
 *            wizard-site, wizard-mini, wizard-script (requests and run options of the wizards)
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { agentEngine } from '../src/lib/agent/AgentEngine';
import { useSettingsStore } from '../src/stores/settingsStore';
import { DEFAULT_SETTINGS } from '../src/types/settings';
import { checkFileSanity } from '../src/lib/agent/FileSanity';
import { looksJsonEscaped, extractLocalScripts, extractLocalStylesheets } from '../src/lib/agent/TaskValidator';
import { makeElectronApi, runNpm, IGNORED } from './electron-api-mock';
import type { RunGoalOptions } from '../src/lib/agent/AgentEngine';
import { compileSitePrompt, createWizardData } from '../src/lib/wizard/siteWizard';
import { compileMiniAppPrompt, getMiniApp, CompiledTool } from '../src/lib/wizard/miniApps';
import { compileScriptPrompt, getScript } from '../src/lib/wizard/scripts';

const [model, scenarioArg, outDirArg] = process.argv.slice(2);
if (!model) {
  console.error('usage: node scripts/run-ts-test.mjs scripts/agent-e2e.ts <model> [scenarios] [outDir]');
  process.exit(2);
}
const outDir = path.resolve(outDirArg || path.join(os.tmpdir(), 'emir-code-agent-e2e'));
fs.mkdirSync(outDir, { recursive: true });

/** A page damaged the way v1.5.x wrote it to disk: one line, literal \n and \" sequences. */
const CORRUPTED_PAGE =
  '<!DOCTYPE html>\\n<html lang=\\"tr\\">\\n<head>\\n  <meta charset=\\"UTF-8\\">\\n  <title>Arkadaşım İçin</title>\\n  <style>\\n    .container { max-width: 640px; margin: 0 auto; padding: 2rem; background: #fff; }\\n    h1 { color: #b91c1c; }\\n  </style>\\n</head>\\n<body>\\n  <div class=\\"container\\">\\n    <h1>Sevgili Dostum</h1>\\n    <p>Seninle geçen her gün bir hediye.</p>\\n    <button id=\\"hello\\">Merhaba de</button>\\n  </div>\\n  <script>\\n    document.getElementById(\\"hello\\").addEventListener(\\"click\\", () => alert(\\"Merhaba!\\"));\\n  </script>\\n</body>\\n</html>';

/** A landing page whose menu links all point to "#" (in-app report: "Get these working"). */
const NAV_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Nova Technology</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 0; }
        header { background-color: #333; color: white; padding: 10px 20px; display: flex; justify-content: space-between; align-items: center; }
        nav a { color: white; text-decoration: none; margin: 0 15px; }
        .hero { background-color: #f4f4f4; padding: 50px 20px; text-align: center; }
        .features { display: flex; flex-wrap: wrap; justify-content: center; padding: 20px; }
        .feature-card { background-color: white; border: 1px solid #ddd; margin: 10px; padding: 20px; width: calc(33% - 40px); }
        footer { background-color: #333; color: white; text-align: center; padding: 10px 20px; }
        @media (max-width: 768px) {
            .feature-card { width: calc(100% - 40px); }
        }
    </style>
</head>
<body>
    <header>
        <strong>Nova</strong>
        <nav>
            <a href="#">Home</a>
            <a href="#">About</a>
            <a href="#">Services</a>
            <a href="#">Contact</a>
        </nav>
    </header>
    <section class="hero">
        <h1>Welcome to Nova Technology</h1>
        <p>Innovating the future with cutting-edge solutions.</p>
        <button onclick="showAlert()">Learn More</button>
    </section>
    <section class="features">
        <div class="feature-card"><h3>AI Solutions</h3><p>Empowering businesses with artificial intelligence.</p></div>
        <div class="feature-card"><h3>Cloud Services</h3><p>Scalable and secure cloud infrastructure.</p></div>
        <div class="feature-card"><h3>Data Analytics</h3><p>Insights that drive better decisions.</p></div>
    </section>
    <footer>
        <p>&copy; 2026 Nova Technology. All rights reserved.</p>
    </footer>
    <script>
        function showAlert() {
            alert('Thank you for your interest!');
        }
    </script>
</body>
</html>
`;

/** A shop page with two products and a cart counter (in-app report: "6 products" run that fell apart). */
const SHOP_PAGE = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Süt Dükkanı</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; background: #f7f7f7; }
    header { background: #2b6cb0; color: #fff; padding: 16px; display: flex; justify-content: space-between; }
    .products { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; padding: 24px; }
    .product { background: #fff; border-radius: 8px; padding: 16px; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1); }
    .product h3 { margin: 0 0 8px; }
    .product button { background: #2b6cb0; color: #fff; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; }
  </style>
</head>
<body>
  <header><h1>Süt Dükkanı</h1><span>Sepet: <strong id="cart-count">0</strong></span></header>
  <main class="products">
    <div class="product">
      <h3>Tam Yağlı Süt</h3>
      <p>Günlük taze, 1 litre cam şişede.</p>
      <p class="price">35 TL</p>
      <button class="add-to-cart">Sepete Ekle</button>
    </div>
    <div class="product">
      <h3>Süzme Yoğurt</h3>
      <p>Kıvamlı, 500 gram.</p>
      <p class="price">55 TL</p>
      <button class="add-to-cart">Sepete Ekle</button>
    </div>
  </main>
  <script>
    let count = 0;
    document.querySelectorAll('.add-to-cart').forEach((button) => {
      button.addEventListener('click', () => {
        count += 1;
        document.getElementById('cart-count').textContent = String(count);
      });
    });
  </script>
</body>
</html>
`;



// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------
interface Scenario {
  id: string;
  goal: string;
  /** Run options a wizard sends with its request. */
  options?: RunGoalOptions;
  seed?: (dir: string) => void;
  dependsOn?: string;
  verify: (dir: string) => { ok: boolean; notes: string[] };
}

const wizardOptions = (c: { displayGoal: string; checklist: string[]; design: any; contracts?: boolean; seedFiles?: RunGoalOptions['seedFiles']; scriptOutputs?: string[]; applyFlag?: string }): RunGoalOptions => ({
  displayGoal: c.displayGoal,
  checklist: c.checklist,
  design: c.design,
  contracts: c.contracts,
  seedFiles: c.seedFiles,
  scriptOutputs: c.scriptOutputs,
  applyFlag: c.applyFlag,
});

const SITE_REQUEST = compileSitePrompt({
  ...createWizardData('simple'),
  siteName: 'Kahve Durağı',
  siteType: 'Kafe',
  description: 'Taze kavrulmuş kahve ve ev yapımı tatlılar sunan samimi bir mahalle kafesi.',
});
const MINI_REQUEST: CompiledTool = compileMiniAppPrompt(getMiniApp('pomodoro')!, {}, { title: '', language: 'tr', theme: 'auto' });
const SCRIPT_REQUEST: CompiledTool = compileScriptPrompt(getScript('toplu-adlandir')!, {}, { language: 'python', fileName: '', test: true, requestLanguage: 'tr' });

/** The theme the wizard asked for really reached the page. */
function verifyThemed(dir: string) {
  const theme = path.join(dir, 'theme', 'theme.css');
  const marker = fs.existsSync(theme) ? fs.readFileSync(theme, 'utf8').match(/emir-theme (\{[^}]*\})/)?.[1] : undefined;
  const page = fs.existsSync(path.join(dir, 'index.html')) ? fs.readFileSync(path.join(dir, 'index.html'), 'utf8') : '';
  return { themed: !!marker && page.includes('theme/theme.css'), marker: marker || 'none' };
}

/** Syntax check of a page's inline scripts with node --check. */
function inlineScriptsParse(page: string): { ok: boolean; note: string } {
  const code = [...page.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join('\n;\n');
  if (!code.trim()) return { ok: false, note: 'no inline script' };
  const file = path.join(os.tmpdir(), `emir-e2e-inline-${Date.now()}.js`);
  fs.writeFileSync(file, code, 'utf8');
  const res = spawnSync('node', ['--check', file], { encoding: 'utf8' });
  fs.rmSync(file, { force: true });
  return { ok: res.status === 0, note: res.status === 0 ? 'inline JS parses' : `inline JS syntax error: ${(res.stderr || '').trim().split('\n').slice(0, 4).join(' | ')}` };
}

/** Runs the generated rename script on fresh sample files: preview must change nothing, --uygula must rename. */
function verifyRenameScript(dir: string) {
  const notes: string[] = [];
  const script = path.join(dir, 'toplu_adlandir.py');
  if (!fs.existsSync(script)) return { ok: false, notes: ['toplu_adlandir.py missing'] };
  const parse = spawnSync('python', ['-c', 'import ast,sys; ast.parse(open(sys.argv[1],encoding="utf-8").read())', script], { encoding: 'utf8' });
  notes.push(`ast.parse exit=${parse.status}`);
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'emir-e2e-rename-'));
  const names = ['Tatil 2.jpg', 'Tatil 10.jpg', 'deniz.JPG', 'notlar.txt'];
  for (const n of names) fs.writeFileSync(path.join(box, n), `içerik ${n}`, 'utf8');
  const list = () => fs.readdirSync(box).filter((f) => !f.startsWith('_') && !/islem_kaydi/i.test(f)).sort();
  const env = { ...process.env, PYTHONIOENCODING: 'utf-8' };
  const preview = spawnSync('python', [script, box], { encoding: 'utf8', env, timeout: 60000 });
  const afterPreview = list();
  const previewSafe = JSON.stringify(afterPreview) === JSON.stringify([...names].sort());
  notes.push(`preview exit=${preview.status} unchanged=${previewSafe}`);
  const apply = spawnSync('python', [script, box, '--uygula'], { encoding: 'utf8', env, timeout: 60000 });
  const afterApply = list();
  // The request states these names for the default settings (natural order, extensions kept).
  const expected = ['Tatil 10_004.jpg', 'Tatil 2_003.jpg', 'deniz_001.JPG', 'notlar_002.txt'].sort();
  const renamed = JSON.stringify(afterApply) === JSON.stringify(expected);
  const contentsKept = afterApply.every((f) => /^içerik /.test(fs.readFileSync(path.join(box, f), 'utf8')));
  const logged = fs.readdirSync(box).some((f) => /islem_kaydi/i.test(f)) || fs.existsSync(path.join(dir, 'islem_kaydi.csv'));
  notes.push(`apply exit=${apply.status} files=${afterApply.join(', ')} expectedNames=${renamed} contentsKept=${contentsKept} log=${logged}`);
  if (apply.status !== 0) notes.push(`stderr: ${(apply.stderr || '').trim().split('\n').slice(-3).join(' | ')}`);
  const sanity = sanityErrorsIn(dir);
  notes.push(...sanity);
  fs.rmSync(box, { recursive: true, force: true });
  return { ok: parse.status === 0 && preview.status === 0 && previewSafe && apply.status === 0 && renamed && contentsKept && logged && sanity.length === 0, notes };
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
  {
    // In-app report: the request was split into "Home About Services Contact" + "Get these working".
    id: 'nav-links',
    goal: 'Home About Services Contact\n\nGet these working. You can change the page content using JavaScript.',
    seed: (dir) => {
      fs.writeFileSync(path.join(dir, 'index.html'), NAV_PAGE, 'utf8');
    },
    verify: (dir) => {
      const page = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
      const nav = page.match(/<nav\b[\s\S]*?<\/nav>/i)?.[0] || '';
      const hrefs = [...nav.matchAll(/href\s*=\s*["']#([\w-]+)["']/gi)].map((m) => m[1]);
      const ids = new Set([...page.matchAll(/\bid\s*=\s*["']([\w-]+)["']/gi)].map((m) => m[1]));
      const anchored = hrefs.filter((h) => ids.has(h)).length;
      const scripts = [...page.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join('\n');
      const scripted = /addEventListener|onclick/.test(scripts) && /nav|data-(?:page|section|target)|nav-link|href|hash/.test(scripts);
      const styleTags = (page.match(/<style\b/gi) || []).length;
      const scriptTags = (page.match(/<script\b/gi) || []).length;
      const sanity = sanityErrorsIn(dir);
      return {
        ok: (anchored >= 3 || scripted) && styleTags === 1 && scriptTags <= 2 && sanity.length === 0,
        notes: [`navAnchorsToIds=${anchored} scriptedNav=${scripted} styleTags=${styleTags} scriptTags=${scriptTags}`, ...sanity],
      };
    },
  },
  {
    // In-app report: this request turned a working page into dozens of scattered <style>/<script> tags.
    id: 'six-products',
    goal: '2 tane değil 6 tane ürün listelenecek html de',
    seed: (dir) => {
      fs.writeFileSync(path.join(dir, 'index.html'), SHOP_PAGE, 'utf8');
    },
    verify: (dir) => {
      const page = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
      const products = (page.match(/class\s*=\s*["']product["']/g) || []).length;
      const styleTags = (page.match(/<style\b/gi) || []).length;
      const scriptTags = (page.match(/<script\b/gi) || []).length;
      const cartScript = /addEventListener/.test(page) && /add-to-cart/.test(page) && /cart-count/.test(page);
      const sanity = sanityErrorsIn(dir);
      return {
        ok: products === 6 && styleTags === 1 && scriptTags === 1 && cartScript && sanity.length === 0,
        notes: [`products=${products} styleTags=${styleTags} scriptTags=${scriptTags} cartScript=${cartScript}`, ...sanity],
      };
    },
  },
  {
    id: 'wizard-site',
    goal: SITE_REQUEST.prompt,
    options: wizardOptions(SITE_REQUEST),
    verify: (dir) => {
      const base = verifyStyledPage(dir, false);
      const themed = verifyThemed(dir);
      base.notes.push(`themed=${themed.themed} marker=${themed.marker}`);
      return { ok: base.ok && themed.themed, notes: base.notes };
    },
  },
  {
    id: 'wizard-mini',
    goal: MINI_REQUEST.prompt,
    options: wizardOptions(MINI_REQUEST),
    verify: (dir) => {
      const base = verifyStyledPage(dir, true);
      const page = fs.existsSync(path.join(dir, 'index.html')) ? fs.readFileSync(path.join(dir, 'index.html'), 'utf8') : '';
      const js = inlineScriptsParse(page);
      const themed = verifyThemed(dir);
      const extraFiles = fs.readdirSync(dir).filter((f) => !['index.html', 'theme', '_agent_log.txt'].includes(f));
      base.notes.push(js.note, `themed=${themed.themed} marker=${themed.marker} extraFiles=${extraFiles.join(',') || 'none'}`);
      return { ok: base.ok && js.ok && themed.themed && extraFiles.length === 0, notes: base.notes };
    },
  },
  {
    id: 'wizard-script',
    goal: SCRIPT_REQUEST.prompt,
    options: wizardOptions(SCRIPT_REQUEST),
    verify: (dir) => verifyRenameScript(dir),
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
    { previousContext, ...(s.options || {}) }
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
