/**
 * test_tool_wizard.ts
 * The "Mini Uygulama" and "Betik" wizards: the parameter schema helpers, the validity of both
 * catalogs, the request of every tool with its default settings (Turkish and English), the bulk
 * rename result, how a wizard's request travels through the composer and the wizard store.
 *
 * Run: node scripts/run-ts-test.mjs test_tool_wizard.ts
 */
import * as fs from 'node:fs';
import { ParamField, defaultValues, valueOf, isVisible, describeValues } from './src/lib/wizard/params';
import { MINI_APPS, MINI_APP_CATEGORIES, compileMiniAppPrompt, getMiniApp } from './src/lib/wizard/miniApps';
import { SCRIPTS, SCRIPT_CATEGORIES, SCRIPT_NAMES, compileScriptPrompt, getScript, renamePreview, renameTestExpectation, scriptBaseName, scriptFileName } from './src/lib/wizard/scripts';
import { scriptHelper, scriptTemplate, helperFileName } from './src/lib/wizard/scriptSkeleton';
import { spawnSync } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import { checklistForText, composerRunOptions, WizardDraft } from './src/lib/wizard/composer';
import { DESIGN_CATEGORIES } from './src/lib/design/themes';
import { planDesignTheme } from './src/lib/design/DesignTheme';
import { TaskCompiler } from './src/lib/agent/TaskContract';
import { checkFileSanity } from './src/lib/agent/FileSanity';
import { useToolWizardStore } from './src/stores/toolWizardStore';

let passed = 0;
const failures: string[] = [];
function check(condition: boolean, message: string, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`✅ ${message}`);
  } else {
    failures.push(message);
    console.error(`❌ ${message}${detail !== undefined ? `\n   → ${typeof detail === 'string' ? detail.slice(0, 900) : JSON.stringify(detail).slice(0, 900)}` : ''}`);
  }
}
const section = (title: string) => console.log(`\n--- ${title} ---`);
const t = (tr: string, en = tr) => ({ tr, en });

// ---------------------------------------------------------------------------
section('1. Parameter schema');
const fields: ParamField[] = [
  { key: 'on', type: 'toggle', label: t('Aç'), default: true, on: t('Açık.'), off: t('Kapalı.') },
  { key: 'mode', type: 'choice', label: t('Mod'), default: 'a', options: [{ value: 'a', label: t('A') }, { value: 'b', label: t('Be'), prompt: t('Mod {value}.') }] },
  { key: 'extra', type: 'number', label: t('Ek'), default: 5, min: 1, max: 9, prompt: t('Ek {value}.'), showIf: { key: 'mode', equals: 'b' } },
  { key: 'set', type: 'multi', label: t('Küme'), default: ['x'], min: 1, prompt: t('Küme: {items}.'), options: [{ value: 'x', label: t('İks') }, { value: 'y', label: t('Ye'), prompt: t('ye harfi') }] },
  { key: 'name', type: 'text', label: t('Ad'), default: '', prompt: t('Ad: {value}.') },
  { key: 'list', type: 'list', label: t('Liste'), default: t('bir\n\n iki ', 'one\ntwo'), prompt: t('{count} öğe:\n{items}') },
];
const defaults = defaultValues(fields);
check(defaults.on === true && defaults.extra === 5 && Array.isArray(defaults.set) && defaults.set !== fields[3].default, 'Defaults are copied (arrays too)');
check(defaultValues(fields, 'en').list === 'one\ntwo' && valueOf(fields[5], {}, 'en') === 'one\ntwo' && defaults.list === 'bir\n\n iki ', 'Per-language defaults (sample lists) follow the language');
check(
  valueOf(fields[1], { mode: 'zzz' }) === 'a' && valueOf(fields[2], { extra: 99 }) === 9 && valueOf(fields[2], { extra: 'x' }) === 5 && valueOf(fields[0], { on: 'yes' }) === true,
  'Invalid, out-of-range or mistyped values fall back to the default / the nearest limit'
);
check(!isVisible(fields[2], fields, defaults) && isVisible(fields[2], fields, { ...defaults, mode: 'b' }), 'showIf hides a field until the other field has the value');
check(
  JSON.stringify(describeValues(fields, defaults, 'tr')) === JSON.stringify(['Açık.', 'Küme: İks.', '2 öğe:\n  - bir\n  - iki']),
  'Request sentences: toggle text, multi items, list lines; empty text and hidden fields add nothing',
  describeValues(fields, defaults, 'tr')
);
check(
  describeValues(fields, { ...defaults, on: false, mode: 'b', set: ['y', 'x'], name: '  Ali  Veli ' }, 'tr').join('|') === 'Kapalı.|Mod Be.|Ek 5.|Küme: İks, ye harfi.|Ad: Ali Veli.|2 öğe:\n  - bir\n  - iki',
  'Choice sentence with {value}, visible number, multi in schema order, whitespace folded'
);

// ---------------------------------------------------------------------------
section('2. Catalogs');
const iconSource = fs.readFileSync('src/components/agent/wizard/ToolIcons.tsx', 'utf8');
const iconIds = new Set(Array.from(iconSource.matchAll(/^\s+'?([a-z0-9-]+)'?: [A-Z]\w+,$/gm), (m) => m[1]));
const allTools = [...MINI_APPS, ...SCRIPTS];
const ids = allTools.map((x) => x.id);
check(new Set(ids).size === ids.length && MINI_APPS.length >= 18 && SCRIPTS.length >= 12, `Unique tool ids (${MINI_APPS.length} mini apps, ${SCRIPTS.length} scripts)`);
check(
  MINI_APPS.every((a) => MINI_APP_CATEGORIES.some((c) => c.id === a.category)) && SCRIPTS.every((s) => SCRIPT_CATEGORIES.some((c) => c.id === s.category)),
  'Every tool is in an existing category'
);
check([...MINI_APP_CATEGORIES, ...SCRIPT_CATEGORIES].every((c) => allTools.some((x) => x.category === c.id)), 'No empty category');
const missingIcons = [...allTools.map((x) => x.icon), ...MINI_APP_CATEGORIES.map((c) => c.icon), ...SCRIPT_CATEGORIES.map((c) => c.icon)].filter((i) => !iconIds.has(i));
check(missingIcons.length === 0, 'Every tool and category icon has an SVG component', missingIcons);
check(MINI_APPS.every((a) => DESIGN_CATEGORIES.some((c) => c.id === a.designCategory)), 'Every mini app has a valid design category');

const fieldProblems: string[] = [];
for (const tool of allTools) {
  const keys = tool.fields.map((f) => f.key);
  if (new Set(keys).size !== keys.length) fieldProblems.push(`${tool.id}: duplicate keys`);
  for (const f of tool.fields) {
    const where = `${tool.id}.${f.key}`;
    if (!f.label.tr || !f.label.en) fieldProblems.push(`${where}: label`);
    if (f.showIf && !tool.fields.some((o) => o.key === f.showIf!.key)) fieldProblems.push(`${where}: showIf target`);
    if (f.type === 'choice' && !(['tr', 'en'] as const).every((l) => f.options.some((o) => o.value === defaultValues([f], l)[f.key]))) fieldProblems.push(`${where}: default`);
    if (f.type === 'multi' && (!f.default.every((d) => f.options.some((o) => o.value === d)) || f.default.length < (f.min ?? 0) || !f.prompt.tr.includes('{items}'))) fieldProblems.push(`${where}: multi`);
    if (f.type === 'number' && (f.default < f.min || f.default > f.max || !f.prompt.tr.includes('{value}') || !f.prompt.en.includes('{value}'))) fieldProblems.push(`${where}: number`);
    if (f.type === 'list' && !f.prompt.tr.includes('{items}')) fieldProblems.push(`${where}: list`);
    if (f.type === 'toggle' && !f.on && !f.off) fieldProblems.push(`${where}: toggle adds nothing`);
  }
}
check(fieldProblems.length === 0, 'Every field: unique key, both labels, valid default in both languages, working showIf and prompt placeholders', fieldProblems);

// ---------------------------------------------------------------------------
section('3. Mini app requests');
const leftovers = (text: string) => /undefined|null|\[object|\{(?:value|items|count)\}/.test(text);
/** Nothing in a request may assume the user lives in one country. */
const localOnly = (text: string) => /KKDF|BSMV|\+90|Türkiye|Turkish (?:lira|phone)|cp1254|Windows-1254/i.test(text);
const miniProblems: string[] = [];
for (const app of MINI_APPS) {
  for (const language of ['tr', 'en'] as const) {
    const out = compileMiniAppPrompt(app, {}, { title: '', language, theme: 'auto' });
    if (leftovers(out.prompt)) miniProblems.push(`${app.id}/${language}: leftover`);
    if (localOnly(out.prompt)) miniProblems.push(`${app.id}/${language}: country-specific`);
    if (!out.prompt.includes('index.html')) miniProblems.push(`${app.id}/${language}: file`);
    if (out.design.enabled !== true || out.design.category !== app.designCategory || out.contracts !== true || out.checklist.length !== 0) miniProblems.push(`${app.id}/${language}: options`);
    const contract = TaskCompiler.compile(out.prompt)[0];
    const style = contract?.criteria.find((c) => c.type === 'contains_style');
    if (!contract || contract.criteria[0].target !== 'index.html' || !style?.params?.inlineOnly) miniProblems.push(`${app.id}/${language}: contract`);
  }
}
check(miniProblems.length === 0, 'Every mini app (TR + EN, defaults): complete, country-neutral request; one inline index.html checked by the web contract; the tool’s theme category', miniProblems);

const expenses = getMiniApp('harcama-takibi')!;
const enExpenses = compileMiniAppPrompt(expenses, {}, { title: '', language: 'en', theme: 'auto' }).prompt;
check(enExpenses.includes('Groceries') && !enExpenses.includes('Market') && enExpenses.includes('Intl.NumberFormat'), 'English app: English sample categories and the currency from the browser locale');

const calc = compileMiniAppPrompt(getMiniApp('hesap-makinesi')!, { mode: 'scientific' }, { title: 'Hesapçı', language: 'tr', theme: 'none', notes: 'Tuşlar **yuvarlak** olsun.' });
check(
  calc.prompt.startsWith('"Hesapçı" adında') && /eval\(\)/.test(calc.prompt) && calc.prompt.includes('Bilimsel mod') && calc.prompt.includes('"""\nTuşlar **yuvarlak** olsun.\n"""') && calc.design.enabled === false,
  'Calculator: own title, no-eval rule, the chosen mode, notes quoted, "no theme" turns the design off'
);
const named = compileMiniAppPrompt(getMiniApp('pomodoro')!, {}, { title: '', language: 'tr', theme: 'auto' });
check(
  named.prompt.split('\n')[0] === '"Pomodoro Zamanlayıcı" adında tek dosyalık bir web uygulaması oluştur: Odak ve mola döngüleri, sesli uyarı ve günlük istatistik.' &&
    named.displayGoal === 'Mini Uygulama: Pomodoro Zamanlayıcı · tema: otomatik',
  'An app named after its tool does not repeat the name'
);
const pass = compileMiniAppPrompt(getMiniApp('sifre-uretici')!, { length: 200 }, { title: '', language: 'tr', theme: 'gece' });
check(
  pass.prompt.includes('crypto.getRandomValues') && pass.prompt.includes('Varsayılan uzunluk 64') && pass.design.themeId === 'gece' && pass.design.category === 'genel',
  'Password generator: secure randomness rule, out-of-range length clamped, a specific theme is passed on'
);
const plan = planDesignTheme({ goal: pass.prompt, projectFiles: [], config: undefined, modelSizeB: 7, existingThemeCss: null, override: pass.design });
check(!!plan && plan.themeId === 'gece' && plan.categorySource === 'wizard', 'A "tek dosya" request still gets the theme chosen in the wizard');
const ownQuiz = compileMiniAppPrompt(getMiniApp('bilgi-yarismasi')!, { source: 'own', questions: 'Başkent? | Ankara | İzmir | Bursa | Van' }, { title: '', language: 'tr', theme: 'auto' });
check(ownQuiz.prompt.includes('Başkent? | Ankara') && !ownQuiz.prompt.includes('Soru sayısı'), 'Quiz with own questions: the questions are listed, the topic fields are hidden');

// ---------------------------------------------------------------------------
section('4. Script requests');
const scriptProblems: string[] = [];
for (const def of SCRIPTS) {
  for (const requestLanguage of ['tr', 'en'] as const) {
    const names =
      requestLanguage === 'tr'
        ? { apply: '--uygula', backup: '_yedek_', log: 'islem_kaydi.csv', sample: 'ornek_veri', scope: 'Yalnızca verilen klasörün içinde', keep: 'Hiçbir dosyayı silme', read: 'Girdi dosyalarını asla değiştirme', exit: 'çıkış kodu 1' }
        : { apply: '--apply', backup: '_backup_', log: 'actions_log.csv', sample: 'sample_data', scope: 'Stay inside the given folder', keep: 'Never delete any file', read: 'Never change, move or delete the input files', exit: 'exit with code 1' };
    for (const language of ['python', 'node'] as const) {
      const out = compileScriptPrompt(def, {}, { language, fileName: '', test: true, requestLanguage });
      const file = scriptFileName(def, { language, fileName: '' }, requestLanguage);
      const p = out.prompt;
      const where = `${def.id}/${requestLanguage}/${language}`;
      // Code (the template, inline hints) may say "null" or "undefined"; only the prose is checked.
      if (leftovers(p.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, ''))) scriptProblems.push(`${where}: leftover`);
      if (localOnly(p)) scriptProblems.push(`${where}: country-specific`);
      if (!p.includes(`"${file}"`) || !p.includes(names.scope)) scriptProblems.push(`${where}: file/scope`);
      if (def.modifies && !(p.includes(names.apply) && p.includes(names.backup) && p.includes(names.log) && p.includes(names.keep))) scriptProblems.push(`${where}: safety`);
      if (!def.modifies && !p.includes(names.read)) scriptProblems.push(`${where}: read-only`);
      if (requestLanguage === 'en' && /--uygula|islem_kaydi|ornek_veri|_yedek_/.test(p)) scriptProblems.push(`${where}: Turkish names in English`);
      const seed = out.seedFiles?.[0];
      const helper = helperFileName(requestLanguage, file.endsWith('.py') ? 'python' : 'node');
      if (!seed || seed.path !== helper || !/utf-8/i.test(seed.content) || (def.modifies && !seed.content.includes(names.log)) || !p.includes(helper) || !p.includes(file.endsWith('.py') ? 'run_tool(' : 'runTool('))
        scriptProblems.push(`${where}: safety module (seed file) and script structure`);
      if (!p.includes(file.endsWith('.py') ? 'read_text' : 'readText') || !p.includes(names.exit)) scriptProblems.push(`${where}: encoding/exit`);
      if (!p.includes(file.endsWith('.py') ? 'argparse' : 'optionValue')) scriptProblems.push(`${where}: arguments`);
      if (!p.includes(names.sample) || out.checklist.length !== 2 || !out.checklist.every((c) => c.startsWith(file))) scriptProblems.push(`${where}: test plan`);
      if (out.design.enabled !== false || out.contracts !== false) scriptProblems.push(`${where}: options`);
    }
  }
  if (compileScriptPrompt(def, {}, { language: 'python', fileName: '', test: false, requestLanguage: 'tr' }).checklist.length !== 0) scriptProblems.push(`${def.id}: no test, no checklist`);
}
check(scriptProblems.length === 0, 'Every script (TR + EN, Python + Node): file, scope, safety, encoding, arguments, test plan, flags in the request language, no theme and no web checks', scriptProblems);
check(
  TaskCompiler.compile(compileScriptPrompt(getScript('csv-ozet')!, { output: 'html' }, { language: 'python', fileName: '', test: false, requestLanguage: 'tr' }).prompt).length > 0,
  'Control: a script request alone would trigger the web page checks (hence contracts: false)'
);
const backup = getScript('klasor-yedekle')!;
check(
  scriptFileName(backup, { language: 'node', fileName: '' }) === 'klasor_yedekle.py' && scriptFileName(backup, { language: 'node', fileName: '' }, 'en') === 'backup_folder.py',
  'The ZIP backup falls back to Python (Node has no built-in ZIP writer); default names follow the language'
);
check(
  scriptBaseName(' Toplu Adlandır.py ', 'x') === 'toplu_adlandir' && scriptBaseName('???', 'yedek') === 'yedek' && scriptBaseName('İŞ listesi', 'x') === 'is_listesi' && scriptBaseName('Café Straße', 'x') === 'cafe_strasse',
  'File names: accents simplified in any language, extension dropped, unusable names fall back'
);
check(!getScript('kodlama-duzelt') && !!getScript('dosyalarda-ara'), 'The Turkish-only encoding fixer is replaced by a search tool');

// ---------------------------------------------------------------------------
section('5. Bulk rename result');
const names = (values: Record<string, any>, lang: 'tr' | 'en' = 'tr') => renamePreview(values, lang).map((r) => (r.note ? `(${r.note})` : r.after));
check(
  names({}).join(' | ') === 'Tatil 2_004.jpg | Tatil 10_005.jpg | deniz kenarı_001.JPG | Rapor (son)_003.pdf | notlar_002.txt',
  'Default pattern: natural name order (2 before 10), 3-digit counter, extensions kept',
  names({})
);
check(
  names({}, 'en').join(' | ') === 'Holiday 2_002.jpg | Holiday 10_003.jpg | beach café_001.JPG | Report (final)_005.pdf | notes_004.txt',
  'English: English sample files and the {name}_{n:03} pattern',
  names({}, 'en')
);
check(
  names({ pattern: 'tatil_{sayac}', extensions: 'JPG', start: 10, order: 'date' }).join(' | ') === 'tatil_11.jpg | tatil_12.jpg | tatil_10.JPG | (filtered) | (filtered)',
  'Extension filter (case-insensitive), start value and date order',
  names({ pattern: 'tatil_{sayac}', extensions: 'JPG', start: 10, order: 'date' })
);
check(
  names({ pattern: 'ayni' }).join(' | ') === '(conflict) | (conflict) | (conflict) | ayni.pdf | ayni.txt',
  'Files that would get the same name (jpg/JPG alike) are all skipped, never overwritten',
  names({ pattern: 'ayni' })
);
check(
  names({ pattern: '{ad}', case: 'lower', ascii: true }).join(' | ') === 'tatil_2.jpg | tatil_10.jpg | deniz_kenari.jpg | rapor_(son).pdf | (same)',
  'Lower case, accents and spaces simplified, unchanged names marked',
  names({ pattern: '{ad}', case: 'lower', ascii: true })
);
check(
  names({ pattern: '{date}_{name}' })[3] === '2026-06-30_Rapor (son).pdf' && names({ pattern: 'a:b*c_{n}' })[0] === 'abc_4.jpg' && names({ pattern: '{name}', ascii: true }, 'en')[2] === 'beach_cafe.JPG',
  'English variable names work too; characters invalid on Windows are removed; é → e'
);

// ---------------------------------------------------------------------------
section('6. Composer hand-over');
const siteList = ['index.html — Ana Sayfa: Hero', 'menu.html — Menü: Menü', 'iletisim.html — İletişim: İletişim'];
check(JSON.stringify(checklistForText(siteList, 'index.html ve menu.html ve iletisim.html')) === JSON.stringify(siteList), 'All pages still in the text: the checklist is kept');
check(JSON.stringify(checklistForText(siteList, 'index.html ve iletisim.html')) === JSON.stringify([siteList[0], siteList[2]]), 'A page removed from the text leaves the checklist');
check(checklistForText(siteList, 'yalnızca index.html')!.length === 0 && checklistForText(undefined, 'x') === undefined, 'One page left = one task; no checklist stays none');
const draft: WizardDraft = { kind: 'script', toolId: 'csv-ozet', label: 'Betik', prompt: 'p', options: { displayGoal: 'Betik', checklist: [], design: { enabled: false }, contracts: false }, nonce: 1 };
const sentOptions = composerRunOptions(draft, 'düzenlenmiş metin');
check(!!sentOptions && sentOptions.contracts === false && sentOptions.design?.enabled === false && sentOptions.displayGoal === 'Betik', 'The run options travel with the edited text');
check(composerRunOptions(null, 'elle yazılan istek') === undefined && composerRunOptions(draft, '   ') === undefined, 'A typed request or an empty box sends no wizard options');

// ---------------------------------------------------------------------------
section('7. Wizard store');
const store = useToolWizardStore.getState();
store.openWizard('mini', 'pomodoro');
store.setValue('mini', 'pomodoro', 'focus', 50);
let state = useToolWizardStore.getState();
check(state.open === 'mini' && state.toolId === 'pomodoro' && state.mini.categoryId === 'verimlilik' && state.mini.language === null, 'Opening a tool shows its own page; the catalog follows its category; the app language follows Emir Code');
store.showCatalog();
store.selectCategory('mini', 'hesaplama');
state = useToolWizardStore.getState();
check(state.toolId === null && state.mini.categoryId === 'hesaplama' && state.mini.values.pomodoro.focus === 50, 'Back in the catalog nothing stays selected when the category changes; the settings are kept');
store.openWizard('script', 'toplu-adlandir');
store.updateScript({ language: 'node' });
store.resetValues('mini', 'pomodoro');
state = useToolWizardStore.getState();
check(state.open === 'script' && state.script.categoryId === 'dosya' && state.script.language === 'node' && !state.mini.values.pomodoro, 'Each wizard keeps its own settings; "Varsayılanlar" resets only that tool');
store.openWizard('mini', 'no-such-tool');
check(useToolWizardStore.getState().toolId === null, 'An unknown tool opens the catalog');

// ---------------------------------------------------------------------------
section('8. Safety module of scripts');
const hasPython = spawnSync('python', ['--version'], { encoding: 'utf8' }).status === 0;
const skeletonProblems: string[] = [];
const box = fs.mkdtempSync(path.join(os.tmpdir(), 'emir-skeleton-'));
const env = { ...process.env, PYTHONIOENCODING: 'utf-8' };

/** A script as a model would write it from the template: .txt → .md, one edit, one new report, one escape attempt. */
const pyScript = (module: string) =>
  [
    '"""Deneme."""',
    `from ${module} import run_tool, rename, write, read_text, natural_key`,
    '',
    'def plan(root, target, args):',
    '    actions = []',
    '    for file in sorted(root.iterdir(), key=natural_key):',
    "        if file.is_file() and file.suffix == '.txt':",
    "            actions.append(rename(file, file.with_suffix('.md')))",
    "    edit = root / 'edit.cfg'",
    '    if edit.exists():',
    '        text, encoding = read_text(edit)',
    "        actions.append(write(edit, text.replace('eski', 'yeni'), encoding))",
    "    actions.append(write(root / 'rapor' / 'yeni.csv', 'x;y'))",
    "    actions.append(rename(root / 'a.txt', root / '..' / 'escape.txt'))",
    '    return actions',
    '',
    "if __name__ == '__main__':",
    '    run_tool(__doc__, None, plan)',
  ].join('\n');
const jsScript = (module: string) =>
  [
    `const { runTool, rename, write, readText, naturalCompare } = require('./${module}');`,
    "const fs = require('fs');",
    "const path = require('path');",
    'function plan(root, target, options) {',
    '  const actions = [];',
    '  for (const name of fs.readdirSync(root).sort(naturalCompare)) {',
    '    const file = path.join(root, name);',
    "    if (fs.statSync(file).isFile() && name.endsWith('.txt')) actions.push(rename(file, file.slice(0, -4) + '.md'));",
    '  }',
    "  const edit = path.join(root, 'edit.cfg');",
    '  if (fs.existsSync(edit)) {',
    '    const info = readText(edit);',
    "    actions.push(write(edit, info.text.replace('eski', 'yeni'), info));",
    '  }',
    "  actions.push(write(path.join(root, 'rapor', 'yeni.csv'), 'x;y'));",
    "  actions.push(rename(path.join(root, 'a.txt'), path.join(root, '..', 'escape.txt')));",
    '  return actions;',
    '}',
    "runTool('Deneme', null, plan);",
  ].join('\n');

for (const lang of ['tr', 'en'] as const) {
  const names = SCRIPT_NAMES[lang];
  for (const language of ['python', 'node'] as const) {
    if (language === 'python' && !hasPython) continue;
    const bin = language === 'python' ? 'python' : 'node';
    const ext = language === 'python' ? 'py' : 'js';
    for (const modifies of [true, false]) {
      const where = `${lang}/${language}/${modifies ? 'modifies' : 'read-only'}`;
      const dir = path.join(box, `${lang}_${language}_${modifies ? 'm' : 'r'}`);
      fs.mkdirSync(dir);
      const opts = { lang, language, file: `arac.${ext}`, title: 'Deneme — örnek', usage: '<klasör> [--secenek "x"]', modifies, names };
      const helper = helperFileName(lang, language);
      fs.writeFileSync(path.join(dir, helper), scriptHelper(opts), 'utf8');
      // The template the model starts from runs as it is.
      const template = path.join(dir, `arac.${ext}`);
      fs.writeFileSync(template, scriptTemplate(opts), 'utf8');
      const work = path.join(dir, 'work');
      fs.mkdirSync(work);
      const help = spawnSync(bin, [template, '--help'], { encoding: 'utf8', env });
      const missing = spawnSync(bin, [template, path.join(box, 'nope')], { encoding: 'utf8', env });
      const empty = spawnSync(bin, [template, work], { encoding: 'utf8', env });
      if (help.status !== 0 || !help.stdout.includes('Deneme')) skeletonProblems.push(`${where}: template --help exit ${help.status} ${help.stderr}`);
      if (missing.status !== 1 || !/Hata:|Error:/.test(missing.stderr)) skeletonProblems.push(`${where}: missing path exit ${missing.status} ${missing.stderr}`);
      if (empty.status !== 0 || (modifies && !empty.stdout.includes(names.apply))) skeletonProblems.push(`${where}: template run exit ${empty.status} ${empty.stdout} ${empty.stderr}`);
      if (fs.readdirSync(work).length) skeletonProblems.push(`${where}: template wrote into the folder`);
      if (!modifies) continue;

      const script = path.join(dir, `plan.${ext}`);
      fs.writeFileSync(script, language === 'python' ? pyScript(helper.replace(/\.py$/, '')) : jsScript(helper.replace(/\.js$/, '')), 'utf8');
      const seed: Record<string, string> = { 'a.txt': 'A', 'b.txt': 'B', 'c.txt': 'C', 'c.md': 'C existing', 'edit.cfg': 'eski değer\r\n' };
      for (const [n, c] of Object.entries(seed)) fs.writeFileSync(path.join(work, n), c, 'utf8');
      const listing = () => fs.readdirSync(work).sort().join(',');
      const before = listing();
      const preview = spawnSync(bin, [script, work], { encoding: 'utf8', env });
      if (preview.status !== 0 || listing() !== before) skeletonProblems.push(`${where}: preview changed files or failed (${preview.status}) ${preview.stderr}`);
      if (!preview.stdout.includes(names.apply) || !/a\.txt → a\.md/.test(preview.stdout)) skeletonProblems.push(`${where}: preview output ${preview.stdout}`);
      const apply = spawnSync(bin, [script, work, names.apply], { encoding: 'utf8', env });
      const read = (n: string) => (fs.existsSync(path.join(work, n)) ? fs.readFileSync(path.join(work, n), 'utf8') : null);
      const backups = fs.readdirSync(work).filter((n) => n.startsWith(names.backup.replace(/YYYY.*$/, '')));
      const backupEdit = backups.length === 1 ? fs.readFileSync(path.join(work, backups[0], 'edit.cfg'), 'utf8') : null;
      const log = read(names.log) || '';
      const ok =
        apply.status === 0 &&
        read('a.md') === 'A' && read('b.md') === 'B' && read('a.txt') === null &&
        read('c.txt') === 'C' && read('c.md') === 'C existing' &&
        read('edit.cfg') === 'yeni değer\r\n' && backupEdit === 'eski değer\r\n' &&
        read(path.join('rapor', 'yeni.csv')) === 'x;y' &&
        !fs.existsSync(path.join(dir, 'escape.txt')) &&
        log.split('\n').filter(Boolean).length === 5;
      if (!ok) skeletonProblems.push(`${where}: apply result ${listing()} exit=${apply.status} log=${JSON.stringify(log)} out=${apply.stdout} err=${apply.stderr}`);

      if (language === 'python') {
        // What a 7B model wrote: the folder and the apply flag defined again in add_options().
        const dup = path.join(dir, 'dup.py');
        fs.writeFileSync(
          dup,
          [
            '"""Deneme."""',
            'from pathlib import Path',
            `from ${helper.replace(/\.py$/, '')} import run_tool, rename, natural_key`,
            'def add_options(parser):',
            "    parser.add_argument('klasör', type=str, help='x')",
            `    parser.add_argument('${names.apply}', action='store_true', help='y')`,
            "    parser.add_argument('--baslangic', type=int, default=1)",
            'def plan(root, target, args):',
            "    return [rename(f, f.with_name(f.stem + '_' + str(args.baslangic) + f.suffix)) for f in sorted(Path(args.klasör).iterdir(), key=natural_key) if f.suffix == '.md']",
            "if __name__ == '__main__':",
            '    run_tool(__doc__, add_options, plan)',
          ].join('\n'),
          'utf8'
        );
        const dupPreview = spawnSync(bin, [dup, work], { encoding: 'utf8', env });
        const keptAfterPreview = read('a.md') === 'A' && read('a_1.md') === null;
        const dupApply = spawnSync(bin, [dup, work, names.apply], { encoding: 'utf8', env });
        if (dupPreview.status !== 0 || !keptAfterPreview || dupApply.status !== 0 || read('a_1.md') !== 'A')
          skeletonProblems.push(`${where}: duplicate path/apply options ${dupPreview.status}/${dupApply.status} ${dupPreview.stderr} ${dupApply.stderr} ${listing()}`);
      }
    }
  }
}
fs.rmSync(box, { recursive: true, force: true });
check(
  skeletonProblems.length === 0,
  `Safety module (${hasPython ? 'Python + Node' : 'Node; Python not installed'}): the template runs; preview changes nothing; apply renames, never overwrites or leaves the folder, backs up edited files (line endings kept), creates new files and logs every action`,
  skeletonProblems
);
const renameOut = compileScriptPrompt(getScript('toplu-adlandir')!, {}, { language: 'python', fileName: '', test: true, requestLanguage: 'tr' });
const renameReq = renameOut.prompt;
const renameSeed = renameOut.seedFiles?.[0];
check(
  renameSeed?.path === 'guvenli_islem.py' && renameSeed.content.includes('def execute(') && renameSeed.content.includes("'--uygula'") &&
    renameReq.includes('def plan(root, target, args):') && renameReq.includes('from guvenli_islem import') && renameReq.includes('asla elle oluşturma') && renameReq.length < 7000,
  'The rename run gets the safety module as a file; the request shows the short script structure and says "never fake the result"',
  renameReq.length
);
check(
  renameTestExpectation({}, 'tr') === 'Tatil 2.jpg → Tatil 2_003.jpg, Tatil 10.jpg → Tatil 10_004.jpg, deniz.JPG → deniz_001.JPG, notlar.txt → notlar_002.txt' &&
    renameReq.includes('Bu ayarlarla beklenen adlar: Tatil 2.jpg → Tatil 2_003.jpg') &&
    renameTestExpectation({ order: 'date' }, 'tr') === null &&
    renameTestExpectation({ pattern: '{tarih}_{ad}' }, 'tr') === null,
  'The rename test states the exact expected names when they do not depend on file dates',
  renameTestExpectation({}, 'tr')
);
const readOnly = compileScriptPrompt(getScript('csv-ozet')!, {}, { language: 'python', fileName: '', test: true, requestLanguage: 'en' });
const renameEn = compileScriptPrompt(getScript('toplu-adlandir')!, {}, { language: 'node', fileName: '', test: true, requestLanguage: 'en' });
check(
  renameOut.applyFlag === '--uygula' && renameEn.applyFlag === '--apply' && readOnly.applyFlag === undefined,
  'A script that changes files tells the run its apply flag (the same apply command is not run twice); a read-only one has none',
  { tr: renameOut.applyFlag, en: renameEn.applyFlag, readOnly: readOnly.applyFlag }
);
// A template whose add_options() was left at its comment and `pass` is reported by the file check
// (the script would fail on args.kalip), in both languages; a tool without options is not.
const unfilled = (['tr', 'en'] as const).map((lang) => {
  const opts = { lang, language: 'python' as const, file: 'arac.py', title: 'Deneme', usage: '<klasör>', modifies: true, names: SCRIPT_NAMES[lang] };
  const flagged = (options: string[]) => checkFileSanity('arac.py', scriptTemplate({ ...opts, options })).some((i) => i.severity === 'error' && /placeholder/.test(i.message));
  return { lang, withOptions: flagged(['--kalip']), withoutOptions: flagged([]) };
});
check(
  unfilled.every((u) => u.withOptions && !u.withoutOptions),
  'An add_options() left empty while the tool has options is a file error (Turkish and English); without options it is fine',
  unfilled
);

console.log('\n===========================================');
if (failures.length > 0) {
  console.error(`❌ ${failures.length} FAILED, ${passed} passed`);
  for (const f of failures) console.error(`   - ${f}`);
  process.exit(1);
}
console.log(`🎉 ALL ${passed} TOOL WIZARD TESTS PASSED`);
console.log('===========================================');
process.exit(0);
