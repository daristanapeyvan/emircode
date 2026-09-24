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
import { agentEngine } from './src/lib/agent/AgentEngine';
import { ollamaClient } from './src/lib/ollama/OllamaClient';
import { useSettingsStore } from './src/stores/settingsStore';
import { DEFAULT_SETTINGS } from './src/types/settings';
import { deadMenuLinks } from './src/lib/agent/TaskValidator';
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

async function run(goal: string, seed: Record<string, string>, replies: Reply[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emir-engine-'));
  for (const [file, content] of Object.entries(seed)) fs.writeFileSync(path.join(dir, file), content, 'utf8');
  (globalThis as any).window = { electronAPI: makeElectronApi(dir) };
  script = [...replies];
  sent.length = 0;
  const steps: any[] = [];
  let status = '';
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
    },
    'autonomous',
    5,
    {}
  );
  const read = (file: string) => fs.readFileSync(path.join(dir, file), 'utf8');
  return { dir, steps, status, read };
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
