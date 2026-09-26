/**
 * test_agent_engine.ts
 * Integration tests of the whole agent loop with a SCRIPTED model: ollamaClient replies come from
 * a queue, and the workspace is a temp folder behind the fs-backed electronAPI mock. Covers what
 * unit tests cannot: an edit that would break a working page is not applied, a request that names
 * the menu links is grounded, verified and not split into fragments, and an explicit list becomes
 * a checklist.
 *
 * Run: node scripts/run-ts-test.mjs test_agent_engine.ts
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { agentEngine, RunGoalOptions } from './src/lib/agent/AgentEngine';
import { compileSitePrompt, createWizardData, defaultPages } from './src/lib/wizard/siteWizard';
import { compileMiniAppPrompt, getMiniApp } from './src/lib/wizard/miniApps';
import { compileScriptPrompt, getScript } from './src/lib/wizard/scripts';
import { ollamaClient } from './src/lib/ollama/OllamaClient';
import { useSettingsStore } from './src/stores/settingsStore';
import { DEFAULT_SETTINGS } from './src/types/settings';
import { deadMenuLinks } from './src/lib/agent/TaskValidator';
import { getTheme } from './src/lib/design/themes';
import { makeElectronApi } from './scripts/electron-api-mock';

let passed = 0;
const failures: string[] = [];
function check(condition: boolean, label: string, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`✅ ${label}`);
  } else {
    failures.push(label);
    console.log(`❌ ${label}`);
    if (detail !== undefined) console.log('   →', typeof detail === 'string' ? detail.slice(0, 600) : JSON.stringify(detail).slice(0, 600));
  }
}

// ---------------------------------------------------------------------------
// Scripted model
// ---------------------------------------------------------------------------
type Reply = Record<string, unknown>;
let script: Reply[] = [];
const sent: Array<{ system?: string; messages: Array<{ role: string; content: string }> }> = [];
(ollamaClient as any).chatStream = async (params: any, onChunk: (chunk: any) => void) => {
  sent.push({ system: params.system, messages: params.messages.map((m: any) => ({ role: m.role, content: m.content })) });
  const reply = script.shift() ?? { thought: 'Bitti.', action: 'finish', summary: 'Bitti.' };
  onChunk({ message: { role: 'assistant', content: JSON.stringify(reply) }, done: false });
  onChunk({
    message: { role: 'assistant', content: '' },
    done: true,
    done_reason: 'stop',
    eval_count: 20,
    prompt_eval_count: 200,
    eval_duration: 1e9,
    prompt_eval_duration: 1e9,
  });
};
(ollamaClient as any).showModel = async () => ({
  details: { parameter_size: '7.6B', family: 'qwen2' },
  model_info: { 'qwen2.context_length': 32768 },
  capabilities: ['completion', 'tools'],
});

const lastUserMessage = (call: number) => {
  const msgs = sent[call]?.messages || [];
  return [...msgs].reverse().find((m) => m.role === 'user')?.content || '';
};

async function run(goal: string, seed: Record<string, string>, replies: Reply[], options: RunGoalOptions = {}, patchApi?: (api: any) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emir-engine-'));
  for (const [file, content] of Object.entries(seed)) fs.writeFileSync(path.join(dir, file), content, 'utf8');
  const api = makeElectronApi(dir);
  patchApi?.(api);
  (globalThis as any).window = { electronAPI: api };
  script = [...replies];
  sent.length = 0;
  const steps: any[] = [];
  let status = '';
  let subtasks: any[] = [];
  await agentEngine.runGoal(
    goal,
    'scripted:7b',
    {
      onStep: (step) => steps.push(step),
      onStatusChange: (st) => {
        if (['finished', 'error', 'idle'].includes(st)) status = st;
      },
      onLog: () => {},
      onRequestChangesetApproval: async () => true,
      onRequestDeleteApproval: async () => true,
      onRequestCommandApproval: async () => true,
      onRequestClarification: async (q) => (q.options && q.options[0]) || 'tamam',
      onSubtasksUpdated: (list) => {
        subtasks = list.map((t) => ({ ...t }));
      },
    },
    'autonomous',
    5,
    options
  );
  const read = (file: string) => fs.readFileSync(path.join(dir, file), 'utf8');
  return { dir, steps, status, read, subtasks };
}

const SHOP = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dükkan</title>
  <style>
    .product { padding: 16px; }
  </style>
</head>
<body>
  <main>
    <div class="product"><h3>Süt</h3><button class="add">Ekle</button></div>
  </main>
  <script>
    document.querySelectorAll('.add').forEach((b) => {
      b.addEventListener('click', () => alert('eklendi'));
    });
  </script>
</body>
</html>
`;

const NAV = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nova</title>
  <style>
    nav a { margin: 0 8px; }
  </style>
</head>
<body>
  <header>
    <nav>
      <a href="#">Home</a>
      <a href="#">About</a>
      <a href="#">Services</a>
      <a href="#">Contact</a>
    </nav>
  </header>
  <section class="hero"><h1>Nova</h1></section>
  <script>
    console.log('ready');
  </script>
</body>
</html>
`;

async function main() {
  useSettingsStore.setState({
    settings: {
      ...DEFAULT_SETTINGS,
      securityProfile: 'autonomous',
      webAccess: { enabled: false, chatEnabled: false, codingEnabled: false },
    },
    hardware: {
      cpu: { model: 'test', cores: 6, logicalProcessors: 12 },
      ram: { totalBytes: 16e9, availableBytes: 8e9, totalGb: 16, availableGb: 8 },
    },
  } as any);

  // -------------------------------------------------------------------------
  console.log('\n--- 1. An edit that would break a working page is not applied ---');
  const product2 = '    <div class="product"><h3>Yoğurt</h3><button class="add">Ekle</button></div>';
  const gate = await run('bir ürün daha ekle: Yoğurt', { 'index.html': SHOP }, [
    {
      thought: 'Yoğurt ürününü ekliyorum.',
      action: 'replace_lines',
      path: 'index.html',
      start_line: 13,
      end_line: 16,
      // Re-typed window that lost the "<script>" line (the pattern from the in-app report)
      content: `    <div class="product"><h3>Süt</h3><button class="add">Ekle</button></div>\n${product2}\n  </main>\n    document.querySelectorAll('.add').forEach((b) => {`,
    },
    {
      thought: 'Satırı koruyarak ekliyorum.',
      action: 'edit_file',
      path: 'index.html',
      find: '    <div class="product"><h3>Süt</h3><button class="add">Ekle</button></div>',
      replace: `    <div class="product"><h3>Süt</h3><button class="add">Ekle</button></div>\n${product2}`,
    },
    { thought: 'Tamam.', action: 'finish', summary: 'Yoğurt eklendi.' },
  ]);
  const gatePage = gate.read('index.html');
  check(
    gate.steps.some((s) => s.type === 'system_notice' && /dosyayı bozacaktı/.test(String(s.content))),
    'The harmful replace_lines is refused with a notice'
  );
  check(/\[NOT APPLIED\]: this edit would break "index\.html"/.test(lastUserMessage(1)), 'The model is told its edit would break the page', lastUserMessage(1));
  check(/Your version would read at lines/.test(lastUserMessage(1)), 'The model sees the numbered lines of its own (broken) version', lastUserMessage(1));
  check(
    (gatePage.match(/<script\b/g) || []).length === 1 && gatePage.includes('Yoğurt') && gatePage.includes("document.querySelectorAll('.add')"),
    'The page keeps its single <script> and gets the product from the correct edit',
    gatePage
  );
  check(gate.status === 'finished', 'The run finishes normally after the corrected edit', gate.status);

  // -------------------------------------------------------------------------
  console.log('\n--- 2. A request naming the menu links: one task, grounded and verified ---');
  const fixedNav = NAV.replace('<a href="#">Home</a>', '<a href="#home">Home</a>')
    .replace('<a href="#">About</a>', '<a href="#about">About</a>')
    .replace('<a href="#">Services</a>', '<a href="#services">Services</a>')
    .replace('<a href="#">Contact</a>', '<a href="#contact">Contact</a>')
    .replace(
      '  <section class="hero"><h1>Nova</h1></section>',
      '  <section id="home" class="hero"><h1>Nova</h1></section>\n  <section id="about"><h2>About</h2><p>We build software.</p></section>\n  <section id="services"><h2>Services</h2><p>Web and cloud.</p></section>\n  <section id="contact"><h2>Contact</h2><p>hello@nova.test</p></section>'
    );
  const nav = await run('Home About Services Contact\n\nGet these working. You can change the page content using JavaScript.', { 'index.html': NAV }, [
    { thought: 'Bitti sanıyorum.', action: 'finish', summary: 'Tamam.' },
    { thought: 'Bağlantıları bölümlere bağlıyorum.', action: 'write_file', path: 'index.html', content: fixedNav },
    { thought: 'Bağlantılar çalışıyor.', action: 'finish', summary: 'Menü bağlantıları bölümlere gidiyor.' },
  ]);
  const firstTask = lastUserMessage(0);
  check(
    /REFERENCED ELEMENTS: "Home", "About", "Services", "Contact" in the TASK are the menu links of "index\.html" \(lines 14-17/.test(firstTask),
    'The task message says which page elements the request names',
    firstTask
  );
  check(!/CHECKLIST/.test(firstTask), 'The request is not split into a checklist', firstTask);
  check(!nav.steps.some((s) => /kontrol listesine alındı/.test(String(s.content))), 'No split notice is shown to the user');
  check(/çalışmayan bağlantılar/.test(lastUserMessage(1)) && /"Services" \(satır 16\)/.test(lastUserMessage(1)), 'finish is refused while the menu links lead nowhere, naming each link', lastUserMessage(1));
  check(nav.status === 'finished', 'The run finishes once the links work', nav.status);
  check((await deadMenuLinks('index.html', nav.read('index.html'), async () => null)).length === 0, 'The written page has working menu links');

  // -------------------------------------------------------------------------
  console.log('\n--- 3. An explicit numbered list becomes the checklist ---');
  await run('Şunları yap:\n1. footer ekle\n2. başlıkları mavi yap', { 'index.html': NAV }, [
    { thought: 'x', action: 'finish', summary: 'x' },
    { thought: 'x', action: 'finish', summary: 'x' },
  ]);
  const listTask = lastUserMessage(0);
  check(/CHECKLIST \(the items the user listed in the TASK above — parts of that one task/.test(listTask) && /1\. footer ekle\n2\. başlıkları mavi yap/.test(listTask), 'The numbered items are given to the model as parts of one task', listTask);

  // -------------------------------------------------------------------------
  console.log('\n--- 4. Design theme: a new site is themed after the agent finished ---');
  const year = new Date().getFullYear();
  const CAFE = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Kahve Durağı</title>
  <style>
    body { font-family: Arial, sans-serif; background-color: #f4f4f4; }
    header { background-color: #333; color: white; padding: 20px; }
    .hero { background-color: #4CAF50; color: white; padding: 40px; }
  </style>
</head>
<body>
  <header><h1>Kahve Durağı</h1></header>
  <section class="hero"><p>☕ Taze kahve</p></section>
  <footer><p>&copy; 2023 Kahve Durağı</p></footer>
</body>
</html>
`;
  const writeCafe = { thought: 'Sayfayı yazıyorum.', action: 'write_file', path: 'index.html', content: CAFE };
  const cafe = await run('Bir kafe için web sitesi yap', {}, [writeCafe, { thought: 'Bitti.', action: 'finish', summary: 'Kafe sitesi hazır.' }]);
  const cafePage = cafe.read('index.html');
  const cafeTheme = fs.existsSync(path.join(cafe.dir, 'theme', 'theme.css')) ? cafe.read('theme/theme.css') : '';
  const cafeMarker = cafeTheme.match(/emir-theme (\{[^}]*\})/);
  check(!!cafeMarker && getTheme(JSON.parse(cafeMarker[1]).id)?.category === 'yemek', 'theme/theme.css written with a food theme', cafeTheme.slice(0, 300));
  check(!/Classify this website request/.test(sent[0]?.messages[0]?.content || ''), 'A clear topic costs no extra model call');
  check(
    cafePage.includes('<link rel="stylesheet" href="theme/theme.css">') && cafePage.includes('var(--theme-inverse, #333)') && cafePage.includes('class="ti'),
    'The page is linked, recolored and gets an icon',
    cafePage
  );
  check(cafePage.includes(`&copy; ${year} Kahve Durağı`), 'The stale footer year is updated');
  check(cafe.steps.some((s) => s.title === 'Tasarım Teması' && /Tasarım teması: "/.test(String(s.content))), 'The timeline names the applied theme');
  check(cafe.steps.some((s) => s.type === 'final_answer' && /theme\/theme\.css/.test(String(s.content))), 'The summary lists the theme file');
  check(cafe.status === 'finished', 'The run still finishes normally', cafe.status);

  const unclear = await run('Ahmet için bir web sitesi oluştur', {}, [
    { category: 'yaratici' },
    { ...writeCafe, content: CAFE.replace('Kahve Durağı', 'Ahmet') },
    { thought: 'Bitti.', action: 'finish', summary: 'Site hazır.' },
  ]);
  const unclearMarker = unclear.read('theme/theme.css').match(/emir-theme (\{[^}]*\})/);
  check(/Classify this website request/.test(sent[0]?.messages[0]?.content || '') && !!sent[1]?.system, 'An unclear topic asks the model once, before its first step');
  check(!!unclearMarker && getTheme(JSON.parse(unclearMarker[1]).id)?.category === 'yaratici', "The model's answer picks the theme");

  useSettingsStore.setState((state: any) => ({
    settings: { ...state.settings, designTheme: { ...state.settings.designTheme, mode: 'off', baseCss: 'off' } },
  }));
  const off = await run('Bir kafe için web sitesi yap', {}, [writeCafe, { thought: 'Bitti.', action: 'finish', summary: 'Hazır.' }]);
  const offPage = off.read('index.html');
  check(!fs.existsSync(path.join(off.dir, 'theme')) && !offPage.includes('theme.css') && !offPage.includes('var(--theme'), 'Theme and base CSS off: no theme at all');
  check(offPage.includes(`&copy; ${year} Kahve Durağı`), 'The year fix still runs when the theme is off');

  // -------------------------------------------------------------------------
  console.log('\n--- 5. Site wizard: generated request, page checklist, chosen theme ---');
  useSettingsStore.setState((state: any) => ({
    settings: { ...state.settings, designTheme: { ...state.settings.designTheme, mode: 'topic', baseCss: 'auto' } },
  }));
  const wizardData = {
    ...createWizardData('detailed'),
    siteName: 'Kahve Durağı',
    siteType: 'Kafe',
    description: 'Mavi tonlarında renkli, samimi bir mahalle kafesi.',
    theme: 'dergi',
    multiPage: true,
    pages: defaultPages('yemek', true, 'tr').slice(0, 2),
  };
  const compiled = compileSitePrompt(wizardData);
  const wizardRun = await run(
    compiled.prompt,
    {},
    [
      writeCafe,
      { thought: 'Menü sayfası.', action: 'write_file', path: 'menu.html', content: CAFE.replace('Kahve Durağı</title>', 'Menü</title>') },
      { thought: 'Bitti.', action: 'finish', summary: 'Site hazır.' },
    ],
    { displayGoal: compiled.displayGoal, checklist: compiled.checklist, design: compiled.design }
  );
  const wizardMarker = wizardRun.read('theme/theme.css').match(/emir-theme (\{[^}]*\})/);
  check(!!wizardMarker && JSON.parse(wizardMarker[1]).id === 'dergi', 'The theme picked in the wizard is applied (own-color words in the text do not switch it off)');
  check(!/Classify this website request/.test(sent[0]?.messages[0]?.content || ''), 'No topic question: the wizard knows the topic');
  check(
    wizardRun.subtasks.length === 2 && wizardRun.subtasks[0].description.startsWith('index.html') && wizardRun.subtasks[1].description.startsWith('menu.html'),
    'The checklist is one item per page, as the wizard sent it',
    wizardRun.subtasks
  );
  check(
    wizardRun.read('menu.html').includes('href="theme/theme.css"') && wizardRun.read('index.html').includes('href="theme/theme.css"'),
    'Every page of the run joins the theme'
  );
  check(wizardRun.steps.some((s) => s.title === 'Tasarım Teması' && /sihirbazda seçildi/.test(String(s.content))), 'The timeline says the theme came from the wizard');
  const noTheme = await run(compiled.prompt, {}, [writeCafe, { thought: 'Bitti.', action: 'finish', summary: 'Hazır.' }], {
    displayGoal: compiled.displayGoal,
    checklist: [],
    design: { enabled: false },
  });
  check(!fs.existsSync(path.join(noTheme.dir, 'theme')) && noTheme.subtasks.length === 1, '"Tema kullanma": no theme; an empty checklist means one task');

  // -------------------------------------------------------------------------
  console.log('\n--- 6. Mini app and script wizards ---');
  const pomodoro = compileMiniAppPrompt(getMiniApp('pomodoro')!, {}, { title: '', language: 'tr', theme: 'auto', notes: '' });
  const POMODORO = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pomodoro Zamanlayıcı</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f4f4f4; color: #222; text-align: center; }
    .timer { font-size: 64px; margin: 40px 0; }
    button { background: #e74c3c; color: #fff; border: none; padding: 12px 24px; border-radius: 6px; }
  </style>
</head>
<body>
  <h1>Pomodoro Zamanlayıcı</h1>
  <div class="timer" id="time">25:00</div>
  <button id="start">Başlat</button>
  <script>
    let left = 25 * 60;
    document.getElementById('start').addEventListener('click', () => {
      setInterval(() => {
        left = Math.max(0, left - 1);
        const m = String(Math.floor(left / 60)).padStart(2, '0');
        const s = String(left % 60).padStart(2, '0');
        document.getElementById('time').textContent = m + ':' + s;
      }, 1000);
    });
  </script>
</body>
</html>
`;
  const miniRun = await run(
    pomodoro.prompt,
    {},
    [
      { thought: 'Tek dosya.', action: 'write_file', path: 'index.html', content: POMODORO },
      { thought: 'Bitti.', action: 'finish', summary: 'Zamanlayıcı hazır.' },
    ],
    { displayGoal: pomodoro.displayGoal, checklist: pomodoro.checklist, design: pomodoro.design, contracts: pomodoro.contracts }
  );
  const miniTask = sent[0]?.messages[0]?.content || '';
  const miniMarker = fs.existsSync(path.join(miniRun.dir, 'theme', 'theme.css')) ? miniRun.read('theme/theme.css').match(/emir-theme (\{[^}]*\})/) : null;
  check(miniRun.status === 'finished' && /ACCEPTANCE CHECKS/.test(miniTask) && /gömülü stil/.test(miniTask), 'Mini app: the single-file page is still checked (inline style and script)', miniTask.slice(0, 400));
  check(
    !!miniMarker && getTheme(JSON.parse(miniMarker[1]).id)?.category === 'genel' && miniRun.read('index.html').includes('href="theme/theme.css"') && miniRun.subtasks.length === 1,
    "Mini app: a theme of the tool's category is applied; one task, not split into its feature list"
  );

  const scriptReq = compileScriptPrompt(getScript('csv-ozet')!, { output: 'html' }, { language: 'python', fileName: '', test: false, notes: '', requestLanguage: 'tr' });
  const PY = `\"\"\"CSV özet raporu.\"\"\"
import argparse
import csv
import sys


def main():
    parser = argparse.ArgumentParser(description="CSV özet raporu")
    parser.add_argument("dosya")
    args = parser.parse_args()
    try:
        with open(args.dosya, encoding="utf-8") as f:
            rows = list(csv.reader(f, delimiter=";"))
    except OSError as err:
        print(f"Hata: {err}")
        sys.exit(1)
    print(len(rows))


if __name__ == "__main__":
    main()
`;
  const scriptRun = await run(
    scriptReq.prompt,
    {},
    [
      { thought: 'Betik.', action: 'write_file', path: 'csv_ozet.py', content: PY },
      { thought: 'Bitti.', action: 'finish', summary: 'Betik hazır.' },
    ],
    { displayGoal: scriptReq.displayGoal, checklist: scriptReq.checklist, design: scriptReq.design, contracts: scriptReq.contracts }
  );
  check(
    scriptRun.status === 'finished' && !/ACCEPTANCE CHECKS/.test(sent[0]?.messages[0]?.content || '') && !scriptRun.steps.some((s) => /Bitiş Reddedildi/.test(String(s.content))),
    'Script: a request that mentions HTML gets no web page checks and finishes at once'
  );
  check(!fs.existsSync(path.join(scriptRun.dir, 'theme')) && !fs.existsSync(path.join(scriptRun.dir, 'index.html')), 'Script: no theme and no index.html');

  const finishNow = { thought: 'Bitti.', action: 'finish', summary: 'Hazır.' };
  const seedOptions: RunGoalOptions = { checklist: [], design: { enabled: false }, contracts: false, seedFiles: [{ path: 'arac.py', content: 'print("iskelet")\n' }] };
  const seeded = await run('Betiği tamamla.', {}, [finishNow], seedOptions);
  const seededTask = sent[0]?.messages[0]?.content || '';
  check(
    seeded.read('arac.py') === 'print("iskelet")\n' && /PROJECT FILES[\s\S]*arac\.py/.test(seededTask) && !seededTask.includes('iskelet'),
    'Seed file: written before the first step, listed in the project files but not preloaded (a model shown it kept re-reading it)'
  );
  const kept = await run('Betiği tamamla.', { 'arac.py': 'print("benim")\n' }, [finishNow], seedOptions);
  check(kept.read('arac.py') === 'print("benim")\n', 'Seed file: an existing file is never overwritten');
  await run('Betiği yaz.', { 'modul.py': 'x = 1\n' }, [{ thought: 'Modüle bakayım.', action: 'read_file', path: 'modul.py' }, finishNow], {
    checklist: ['yeni.py — betiği yaz', 'yeni.py — dene'],
    contracts: false,
    design: { enabled: false },
  });
  check(
    /Next checklist item: 1\. yeni\.py — betiği yaz — "yeni\.py" does not exist yet: create it now with write_file/.test(lastUserMessage(1)),
    'A model re-reading a preloaded file is pointed to the next checklist item and the file it has to create',
    lastUserMessage(1).slice(0, 500)
  );
  const faked = await run(
    'Betiği yaz.',
    {},
    [{ thought: 'Kaydı ben yazayım.', action: 'write_file', path: 'ornek_veri/islem_kaydi.csv', content: 'zaman,islem\n' }, finishNow],
    { ...seedOptions, scriptOutputs: ['islem_kaydi.csv', '_yedek_*'] }
  );
  check(
    !fs.existsSync(path.join(faked.dir, 'ornek_veri', 'islem_kaydi.csv')) && /written by the script itself/.test(lastUserMessage(1)),
    'Script outputs: the model cannot write the log by hand; it is sent back to the script',
    lastUserMessage(1).slice(0, 300)
  );
  await run(
    'Betiği çalıştır.',
    { 'hello.js': "console.log('merhaba');\n" },
    [
      { thought: 'Çalıştırayım.', action: 'run_command', command: 'node hello.js' },
      { thought: 'Bir daha.', action: 'run_command', command: 'node hello.js' },
      finishNow,
    ],
    { checklist: ['hello.js — çalıştır', 'hello.js — sonucu yaz'], contracts: false, design: { enabled: false } }
  );
  check(
    !/SAME OUTPUT/.test(lastUserMessage(1)) && /\[SAME OUTPUT\][\s\S]*Next checklist item: 1\. hello\.js/.test(lastUserMessage(2)),
    'A command re-run with the same output and no change in between is no progress and points to the next checklist item',
    lastUserMessage(2).slice(0, 400)
  );
  const countScript = "const fs = require('fs');\nconst n = (fs.existsSync('count.txt') ? Number(fs.readFileSync('count.txt', 'utf8')) : 0) + 1;\nfs.writeFileSync('count.txt', String(n));\nconsole.log('run ' + n);\n";
  const runCount = { thought: 'Uygula.', action: 'run_command', command: 'node count.js' };
  await run('Betiği çalıştır.', { 'count.js': countScript }, [runCount, runCount, runCount, finishNow], {
    checklist: ['count.js — çalıştır', 'count.js — bitir'],
    contracts: false,
    design: { enabled: false },
  });
  check(
    !/ALREADY RUN/.test(lastUserMessage(2)) && /run 3[\s\S]*\[ALREADY RUN\]: you have run exactly this command 3 times[\s\S]*finish now/.test(lastUserMessage(3)),
    'A script that changes files, applied a third time with no change by the model, is no progress: the model is told to finish',
    lastUserMessage(3).slice(0, 400)
  );
  const runTool = { thought: 'Bir daha deneyeyim.', action: 'run_command', command: 'node tool.js' };
  const looped = await run(
    'Betiği yaz ve dene.',
    {},
    [{ thought: 'Betik.', action: 'write_file', path: 'tool.js', content: "console.log('tamam');\n" }, runTool, runTool, runTool, runTool, runTool, runTool, runTool],
    { checklist: ['tool.js — yaz', 'tool.js — dene'], contracts: false, design: { enabled: false } }
  );
  const loopedEnd = looped.steps.filter((s) => s.type === 'final_answer').pop();
  check(
    looped.status === 'finished' && /çıkış kodu 0/.test(String(loopedEnd?.content)) && script.length > 0,
    'No checks (a script): a model that wrote its program and keeps re-running it successfully ends as completed, with a note',
    { status: looped.status, end: String(loopedEnd?.content).slice(0, 300) }
  );
  // E2E: after one good run the model re-wrote the same script content until the loop brake.
  const TOOL = "console.log('tamam');\n";
  const rewrite = { thought: 'Betiği güncelliyorum.', action: 'write_file', path: 'tool.js', content: TOOL };
  const rewrote = await run(
    'Betiği yaz ve dene.',
    {},
    [{ thought: 'Betik.', action: 'write_file', path: 'tool.js', content: TOOL }, runTool, rewrite, rewrite, rewrite, rewrite, rewrite],
    { checklist: ['tool.js — yaz', 'tool.js — dene'], contracts: false, design: { enabled: false } }
  );
  check(
    rewrote.status === 'finished' && /son değişiklikten sonra hatasız çalıştı/.test(String(rewrote.steps.filter((s) => s.type === 'final_answer').pop()?.content)),
    'No checks: a program that ran with exit code 0 after its last change counts, whatever the model repeats afterwards',
    rewrote.status
  );
  const changedAfter = await run(
    'Betiği yaz ve dene.',
    {},
    [
      { thought: 'Betik.', action: 'write_file', path: 'tool.js', content: TOOL },
      runTool,
      { thought: 'Değiştiriyorum.', action: 'write_file', path: 'tool.js', content: "console.log('yeni');\n" },
      ...[0, 1, 2, 3, 4].map(() => ({ thought: 'Tekrar.', action: 'write_file', path: 'tool.js', content: "console.log('yeni');\n" })),
    ],
    { checklist: ['tool.js — yaz', 'tool.js — dene'], contracts: false, design: { enabled: false } }
  );
  check(
    changedAfter.status === 'error',
    'No checks: a change after the last successful run voids that evidence (the new version never ran)',
    changedAfter.status
  );
  const idle = await run('Betiği dene.', { 'hazir.js': "console.log('hazır');\n" }, [0, 1, 2, 3, 4, 5, 6].map(() => ({ thought: 'Deneyeyim.', action: 'run_command', command: 'node hazir.js' })), {
    checklist: ['hazir.js — dene'],
    contracts: false,
    design: { enabled: false },
  });
  check(
    idle.status === 'error' && idle.steps.some((s) => /DÖNGÜ TESPİT/.test(String(s.content))),
    'No checks: a model that wrote nothing and only repeats a command is still stopped as a loop',
    idle.status
  );
  const other = await run(
    'Betiği yaz.',
    { 'eski.js': "console.log('eski');\n" },
    [
      { thought: 'Betik.', action: 'write_file', path: 'yeni.js', content: "console.log('yeni');\n" },
      ...[0, 1, 2, 3, 4, 5].map(() => ({ thought: 'Eskisini deneyeyim.', action: 'run_command', command: 'node eski.js' })),
    ],
    { checklist: ['yeni.js — yaz'], contracts: false, design: { enabled: false } }
  );
  check(
    other.status === 'error' && other.steps.some((s) => /DÖNGÜ TESPİT/.test(String(s.content))),
    'No checks: repeating a command that does not run a file the model wrote is no evidence; still a loop',
    other.status
  );

  // In the app, qwen2.5-coder:7b wrote a Pomodoro page with an empty <script> ("JavaScript kodu buraya
  // gelecek") and then appended the same empty block on every step, 16 times: each append was a real change.
  const SKELETON = POMODORO.replace(/<script>[\s\S]*?<\/script>/, '<script>\n    // JavaScript kodu buraya gelecek\n  </script>');
  const scriptAt = SKELETON.slice(0, SKELETON.indexOf('<script>')).split('\n').length;
  const append = (k: number) => ({
    thought: 'Çift <script> etiketi hatası düzeltildi ve doğru konumda JavaScript kodu ekleniyor.',
    action: 'replace_lines',
    path: 'index.html',
    start_line: scriptAt + 3 * k,
    end_line: scriptAt + 3 * k + 2,
    content: '  <script>\n    // JavaScript kodu buraya gelecek\n  </script>\n  <script>\n    // JavaScript kodu buraya gelecek\n  </script>',
  });
  const appended = await run(
    pomodoro.prompt,
    {},
    [{ thought: 'İskelet.', action: 'write_file', path: 'index.html', content: SKELETON }, ...[0, 1, 2, 3, 4, 5, 6, 7].map(append)],
    { displayGoal: pomodoro.displayGoal, checklist: pomodoro.checklist, design: { enabled: false }, contracts: pomodoro.contracts }
  );
  check(
    /placeholder instead of real content/.test(lastUserMessage(1)) && /\(satır \d+\) boş[\s\S]*Yeni <script> bloğu eklemeyin/.test(lastUserMessage(1)),
    'An empty <script> is a file error, and the check says to write the code inside that block instead of adding one',
    lastUserMessage(1).slice(0, 900)
  );
  check(/\[COPIES ONLY\]: this change only added 3 lines that were already in "index\.html"/.test(lastUserMessage(2)), 'Appending a copy of a block the page already has is reported as adding nothing new', lastUserMessage(2).slice(0, 400));
  check(
    appended.status === 'error' && appended.steps.some((s) => /DÖNGÜ TESPİT/.test(String(s.content))) && script.length >= 4,
    'Three such copies in a row reach the loop brake (the app run went on for 35 steps)',
    { status: appended.status, left: script.length }
  );

  // In the app, qwen2.5-coder:7b filled the template's add_options() with the def indented by four
  // spaces (IndentationError) and then re-sent exactly the same edit three times.
  const TEMPLATE = "from guvenli_islem import run_tool\n\n\ndef add_options(parser):\n    # Eklenecek seçenekler: --kalip\n    pass\n\n\ndef plan(root, target, args):\n    return []\n\n\nif __name__ == '__main__':\n    run_tool(__doc__, add_options, plan)\n";
  const indented = await run('add_options() içine --kalip seçeneğini ekle.', { 'arac.py': TEMPLATE }, [
    {
      thought: 'add_options fonksiyonunu tamamlıyorum.',
      action: 'replace_lines',
      path: 'arac.py',
      start_line: 4,
      end_line: 6,
      content: "    def add_options(parser):\n        parser.add_argument('--kalip', default='{ad}')",
    },
    finishNow,
  ]);
  check(
    indented.read('arac.py').includes("\ndef add_options(parser):\n    parser.add_argument('--kalip', default='{ad}')\n") && /Auto-fixed: your lines were indented differently/.test(lastUserMessage(1)),
    'Python: a replace_lines block indented deeper than the lines it replaces is aligned when that removes the error',
    indented.read('arac.py')
  );
  const brokenEdit = {
    thought: 'add_options fonksiyonunu tamamlıyorum.',
    action: 'replace_lines',
    path: 'arac.py',
    start_line: 4,
    end_line: 6,
    content: "def add_options(parser):\n    parser.add_argument('--kalip', default='{ad}'",
  };
  await run('add_options() içine --kalip seçeneğini ekle.', { 'arac.py': TEMPLATE }, [brokenEdit, brokenEdit, finishNow]);
  check(
    /\[REPEATED\][\s\S]*still has this error[\s\S]*Do not send this edit again\. Rewrite the WHOLE file correctly with write_file[\s\S]*def plan\(root, target, args\)/.test(lastUserMessage(2)),
    'Re-sending an edit while the file it left broken is still broken shows the whole file and asks for a complete rewrite',
    lastUserMessage(2).slice(0, 700)
  );

  // The second app run: add_options() was filled over lines 4-10, which also held "def plan(...)";
  // the file stayed valid Python but run_tool(..., plan) had nothing left to call.
  const overReach = await run('add_options() içine --kalip seçeneğini ekle.', { 'arac.py': TEMPLATE }, [
    {
      thought: 'add_options fonksiyonunu tamamlıyorum.',
      action: 'replace_lines',
      path: 'arac.py',
      start_line: 4,
      end_line: 10,
      content: "def add_options(parser):\n    parser.add_argument('--kalip', default='{ad}')",
    },
    finishNow,
  ]);
  check(
    overReach.read('arac.py') === TEMPLATE &&
      /\[NOT APPLIED\]: this edit deletes the definition of plan \(line 9\), but "arac\.py" still uses it[\s\S]*choose a range that ends before line 9/.test(lastUserMessage(1)),
    'An edit that deletes a function the file still calls is refused with the line to stop before',
    lastUserMessage(1).slice(0, 600)
  );

  // v1.7.0 had no main-process handler for search_code: the first search ended the whole run ("Ajan hatası").
  const searched = await run(
    'index.html dosyasındaki başlığı düzelt.',
    { 'index.html': SHOP },
    [{ thought: 'Başlığı arayayım.', action: 'search_code', query: '<title>' }, finishNow],
    {},
    (api) => {
      api.searchWorkspaceCode = async () => {
        throw new Error("Error invoking remote method 'workspace:search': Error: No handler registered for 'workspace:search'");
      };
    }
  );
  check(
    searched.status === 'finished' &&
      !searched.steps.some((s) => /Ajan hatası/.test(String(s.content))) &&
      /\[ERROR\]: search failed: Error: No handler registered for 'workspace:search'\. Use list_dir and read_file instead\./.test(lastUserMessage(1)),
    'A failing code search is a tool error the model can work around, not the end of the run',
    { status: searched.status, observation: lastUserMessage(1).slice(0, 300) }
  );

  // The third app run: the rename script was applied to the sample folder five times, each time
  // called "a preview" ("deniz_001_001_001_001_001.JPG").
  const applyRun = { thought: 'Önizleme olarak çalıştırıyorum.', action: 'run_command', command: 'node tool.js ornek --uygula' };
  const applied = await run(
    'Betiği yaz ve ornek ile dene.',
    {},
    [
      { thought: 'Betik.', action: 'write_file', path: 'tool.js', content: "require('fs').appendFileSync('runs.txt', 'x');\nconsole.log('3 dosya yeniden adlandırıldı');\n" },
      applyRun,
      applyRun,
      { thought: 'Önizlemeyi kontrol edeyim.', action: 'run_command', command: 'node tool.js ornek' },
      finishNow,
    ],
    { checklist: ['tool.js — yaz', 'tool.js — dene'], contracts: false, design: { enabled: false }, applyFlag: '--uygula' }
  );
  check(
    /\[NOT RUN\]: "node tool\.js ornek --uygula" already ran successfully with --uygula[\s\S]*3 dosya yeniden adlandırıldı[\s\S]*finish now/.test(lastUserMessage(3)),
    'A script that changes files is not applied a second time without a change in between; the model gets its earlier result',
    lastUserMessage(3).slice(0, 500)
  );
  check(
    applied.read('runs.txt') === 'x' && /\[NOT RUN\]: "node tool\.js ornek" previews a folder that the same command with --uygula already changed/.test(lastUserMessage(4)),
    'Nor is its preview of the folder it already changed (it proposed renaming the renamed files, and the model started over)',
    lastUserMessage(4).slice(0, 400)
  );

  console.log('\n===========================================');
  if (failures.length > 0) {
    console.error(`❌ ${failures.length} FAILED, ${passed} passed`);
    for (const f of failures) console.error(`   - ${f}`);
    process.exit(1);
  }
  console.log(`🎉 ALL ${passed} AGENT ENGINE TESTS PASSED`);
  console.log('===========================================');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
