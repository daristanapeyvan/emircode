/**
 * scriptSkeleton.ts — the tested code behind the Script wizard's safety promises.
 *
 * What small models did with the safety rules:
 * - as prose: a 7B model wrote the core of a rename tool and dropped the preview, the log and the
 *   extensions;
 * - as code inside the request: it spent its whole first reply copying 170 lines;
 * - as a seeded file to edit: it overwrote the start of main() with a line-range edit.
 * Writing a short new file is what they do well. So the app writes a helper module next to the
 * script (`scriptHelper`), and the model writes only the script itself from a short template
 * (`scriptTemplate`): the tool's options and plan(), which lists rename / move / write actions.
 * The module's execute() is the only code that touches files: preview by default, changes only
 * with the apply flag, never a delete, never an overwrite, never outside the folder, a backup
 * before a file's content changes and every action in the log. No escaped quotes anywhere:
 * models tend to break them when they copy code.
 */
import type { Lang } from './params';
import type { ScriptLanguage } from './scripts';

export interface SkeletonOptions {
  lang: Lang;
  language: ScriptLanguage;
  /** Script file name, e.g. "toplu_adlandir.py". */
  file: string;
  /** One-line description for the header and --help. */
  title: string;
  /** Arguments after the script name, e.g. '<klasör> [--kalip "..."] [--uygula]'. */
  usage: string;
  /** Changes files: plan() + execute() with preview, backups and the action log. */
  modifies: boolean;
  /** The tool's own flags (besides the path and the apply flag), e.g. ["--kalip", "--baslangic"]. */
  options?: string[];
  /** Offer a natural sort helper ("2" before "10"). */
  naturalSort?: boolean;
  names: { apply: string; backup: string; log: string };
}

/** File name of the helper module the script imports. */
export function helperFileName(lang: Lang, language: ScriptLanguage): string {
  return `${lang === 'en' ? 'safe_actions' : 'guvenli_islem'}.${language === 'node' ? 'js' : 'py'}`;
}

const helperModule = (o: SkeletonOptions) => helperFileName(o.lang, o.language).replace(/\.(py|js)$/, '');

/** "The folder and --uygula are ready. Add: --kalip, --baslangic" for the template. */
function optionsComment(o: SkeletonOptions): string {
  const tr = o.lang === 'tr';
  const ready = o.modifies ? (tr ? `Klasör/dosya yolu ve ${o.names.apply} hazır, tekrar ekleme.` : `The path and ${o.names.apply} are ready; do not add them again.`) : tr ? 'Klasör/dosya yolu hazır, tekrar ekleme.' : 'The path is ready; do not add it again.';
  const list = (o.options || []).join(', ');
  if (!list) return `${ready} ${tr ? 'Aracın başka seçeneği yok.' : 'The tool has no other options.'}`;
  return o.language === 'node'
    ? `${tr ? 'Okunacak seçenekler (optionValue ile)' : 'Options to read (with optionValue)'}: ${list}. ${ready}`
    : // Leading "Eklenecek" / "to be added": the file check reports an add_options() left at this comment and `pass`.
      `${tr ? 'Eklenecek seçenekler (parser.add_argument ile)' : 'Options to be added (with parser.add_argument)'}: ${list}. ${ready}`;
}

/** A string literal without escapes where possible (models break escaped quotes). */
function lit(s: string): string {
  if (!s.includes("'") && !s.includes('\\')) return `'${s}'`;
  if (!s.includes('"') && !s.includes('\\')) return `"${s}"`;
  return JSON.stringify(s);
}

function messages(o: SkeletonOptions) {
  const tr = o.lang === 'tr';
  return {
    error: tr ? 'Hata' : 'Error',
    notFound: tr ? 'bulunamadı' : 'does not exist',
    stopped: tr ? 'İşlem durduruldu.' : 'Stopped.',
    pathHelp: tr ? 'İşlenecek klasör veya dosya' : 'Folder or file to process',
    applyHelp: tr ? 'Değişiklikleri gerçekten yap (verilmezse yalnızca önizleme)' : 'Really make the changes (without it: preview only)',
    outside: tr ? 'atlandı (klasör dışında veya betiğin kendi dosyası)' : 'skipped (outside the folder or the script’s own file)',
    exists: tr ? 'atlandı (hedef zaten var)' : 'skipped (target exists)',
    twice: tr ? 'atlandı (aynı hedef iki kez)' : 'skipped (same target twice)',
    failed: tr ? 'başarısız' : 'failed',
    summary: tr ? 'Özet' : 'Summary',
    doneWord: tr ? 'yapıldı' : 'done',
    skippedWord: tr ? 'atlandı' : 'skipped',
    failedWord: tr ? 'hatalı' : 'failed',
    planned: tr ? 'planlanan değişiklik' : 'planned change(s)',
    nothing: tr
      ? 'Hiç değişiklik planlanmadı: plan() boş liste döndürdü ya da klasörde uygun dosya yok.'
      : 'No change planned: plan() returned an empty list or the folder has no matching file.',
    previewHint: tr ? `Bu bir önizlemeydi; değişiklikleri yapmak için ${o.names.apply} ekleyin.` : `This was a preview; add ${o.names.apply} to make the changes.`,
    logHeader: tr ? ['zaman', 'islem', 'kaynak', 'hedef', 'sonuc'] : ['time', 'action', 'source', 'target', 'result'],
    moduleDoc: tr ? 'Emir Code güvenlik yardımcıları. Değiştirmeyin.' : 'Emir Code safety helpers. Do not change this file.',
  };
}

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

function pythonHelper(o: SkeletonOptions): string {
  const tr = o.lang === 'tr';
  const m = messages(o);
  const backupPrefix = o.names.backup.replace(/YYYY.*$/, '');
  const L: string[] = [];
  L.push(
    `"""${m.moduleDoc}`,
    '',
    o.modifies
      ? tr
        ? `Dosyalara yalnızca execute() dokunur: önizleme varsayılandır, değişiklikler yalnızca ${o.names.apply} ile yapılır;\nhiçbir dosya silinmez veya üzerine yazılmaz, klasör dışına çıkılmaz, içeriği değişen dosya önce yedeklenir,\nher işlem ${o.names.log} dosyasına yazılır.`
        : `Only execute() touches files: preview by default, changes only with ${o.names.apply}; nothing is deleted or\noverwritten, nothing outside the folder is touched, a file is backed up before its content changes and every\naction is written to ${o.names.log}.`
      : tr
        ? 'Girdi dosyaları yalnızca okunur.'
        : 'Input files are only read.',
    '"""',
    'import argparse',
    ...(o.modifies ? ['import csv'] : []),
    'import locale',
    'import re',
    ...(o.modifies ? ['import shutil'] : []),
    'import sys',
    ...(o.modifies ? ['from datetime import datetime'] : []),
    'from pathlib import Path',
    ''
  );
  if (o.modifies) {
    L.push(
      `STAMP = datetime.now().strftime('%Y%m%d_%H%M%S')`,
      `LOG_NAME = ${lit(o.names.log)}`,
      `BACKUP_PREFIX = ${lit(backupPrefix)}`,
      `APPLY_FLAG = ${lit(o.names.apply)}`,
      ''
    );
  }
  L.push(
    '',
    'def fail(message):',
    `    """${tr ? 'Anlaşılır bir mesaj yazar ve 1 koduyla çıkar.' : 'Prints a clear message and exits with code 1.'}"""`,
    `    print(${lit(m.error + ': ')} + str(message), file=sys.stderr)`,
    '    sys.exit(1)',
    '',
    '',
    'def inside(root, path):',
    `    """${tr ? 'path, root klasörünün içindeyse True (.. ve kısayollarla dışarı çıkılamaz).' : 'True when path is inside root (no escape through .. or links).'}"""`,
    '    try:',
    '        Path(path).resolve().relative_to(Path(root).resolve())',
    '        return True',
    '    except ValueError:',
    '        return False',
    '',
    '',
    'def read_text(file):',
    `    """${tr ? 'Metni ve kodlamasını döndürür: UTF-8 (BOM da olabilir), olmazsa sistemin kodlaması.' : 'Returns the text and its encoding: UTF-8 (a BOM is fine), else the system encoding.'}"""`,
    '    data = Path(file).read_bytes()',
    '    try:',
    "        return data.decode('utf-8-sig'), 'utf-8-sig' if data[:3] == b'\\xef\\xbb\\xbf' else 'utf-8'",
    '    except UnicodeDecodeError:',
    '        encoding = locale.getpreferredencoding(False)',
    "        return data.decode(encoding, errors='replace'), encoding",
    '',
    '',
    'def natural_key(path):',
    `    """${tr ? 'Doğal sıra: "Tatil 2" < "Tatil 10", büyük/küçük harf fark etmez. Kullanım: sorted(dosyalar, key=natural_key)' : 'Natural order: "file 2" < "file 10", case-insensitive. Use: sorted(files, key=natural_key)'}"""`,
    "    return [int(part) if part.isdigit() else part.casefold() for part in re.split(r'(\\d+)', Path(path).name)]",
    ''
  );
  if (o.modifies) {
    L.push(
      '',
      'def rename(source, target):',
      `    """${tr ? 'Planlanan yeniden adlandırma (plan() içinde listeye eklenir).' : 'A planned rename (append it to the list in plan()).'}"""`,
      "    return {'kind': 'rename', 'source': Path(source), 'target': Path(target)}",
      '',
      '',
      'def move(source, target):',
      `    """${tr ? 'Planlanan taşıma; hedef klasör gerekirse oluşturulur.' : 'A planned move; the target folder is created when needed.'}"""`,
      "    return {'kind': 'move', 'source': Path(source), 'target': Path(target)}",
      '',
      '',
      "def write(file, text, encoding='utf-8'):",
      `    """${tr ? 'Planlanan yazma: var olan dosya önce yedeklenir, yoksa yeni dosya oluşur.' : 'A planned write: an existing file is backed up first, otherwise a new file is created.'}"""`,
      "    return {'kind': 'write', 'source': Path(file), 'target': Path(file), 'text': text, 'encoding': encoding}",
      '',
      '',
      'def own_file(root, path):',
      '    path = Path(path).resolve()',
      '    if path.name in (LOG_NAME, Path(__file__).name, Path(sys.argv[0]).name):',
      '        return True',
      '    try:',
      '        parts = path.relative_to(Path(root).resolve()).parts',
      '    except ValueError:',
      '        return False',
      '    return any(part.startswith(BACKUP_PREFIX) for part in parts)',
      '',
      '',
      'def backup(root, file):',
      '    target = Path(root) / (BACKUP_PREFIX + STAMP) / Path(file).relative_to(root)',
      '    target.parent.mkdir(parents=True, exist_ok=True)',
      '    shutil.copy2(file, target)',
      '',
      '',
      'def log_action(root, action, source, target, result):',
      '    log = Path(root) / LOG_NAME',
      '    new = not log.exists()',
      "    with open(log, 'a', newline='', encoding='utf-8-sig') as f:",
      '        writer = csv.writer(f)',
      '        if new:',
      `            writer.writerow([${m.logHeader.map(lit).join(', ')}])`,
      "        writer.writerow([datetime.now().isoformat(timespec='seconds'), action, str(source), str(target), result])",
      '',
      '',
      'def execute(root, actions, apply):',
      `    """${tr ? 'Önizleme (varsayılan) ya da uygulama. Silmez, üzerine yazmaz, klasör dışına çıkmaz; yedekler ve kaydeder.' : 'Preview (default) or apply. Never deletes, never overwrites, never leaves the folder; backs up and logs.'}"""`,
      '    root = Path(root).resolve()',
      '    if not actions:',
      `        print(${lit(m.nothing)})`,
      '    done = skipped = failed = 0',
      '    targets = set()',
      '    for action in actions:',
      "        kind = action['kind']",
      "        source = Path(action['source']).resolve()",
      "        target = Path(action['target']).resolve()",
      '        if not (inside(root, source) and inside(root, target)) or own_file(root, source) or own_file(root, target):',
      `            print('  ' + ${lit(m.outside)} + ': ' + str(source))`,
      '            skipped += 1',
      '            continue',
      "        shown = str(source.relative_to(root)) + ('' if kind == 'write' else ' → ' + str(target.relative_to(root)))",
      '        case_only = source != target and str(source).lower() == str(target).lower()',
      "        if kind != 'write' and ((target.exists() and not case_only) or str(target).lower() in targets):",
      `            print('  ' + (${lit(m.twice)} if str(target).lower() in targets else ${lit(m.exists)}) + ': ' + shown)`,
      '            skipped += 1',
      '            continue',
      '        targets.add(str(target).lower())',
      "        print('  ' + shown)",
      '        if not apply:',
      '            continue',
      '        try:',
      "            if kind == 'write':",
      '                if source.exists():',
      '                    backup(root, source)',
      '                source.parent.mkdir(parents=True, exist_ok=True)',
      "                with open(source, 'w', encoding=action['encoding'], newline='') as f:",
      "                    f.write(action['text'])",
      '            else:',
      '                target.parent.mkdir(parents=True, exist_ok=True)',
      '                if case_only:',
      "                    temporary = source.with_name(source.name + '.tmp-rename')",
      '                    source.rename(temporary)',
      '                    temporary.rename(target)',
      '                else:',
      '                    source.rename(target)',
      "            log_action(root, kind, source, target, 'ok')",
      '            done += 1',
      '        except OSError as error:',
      "            log_action(root, kind, source, target, 'error: ' + str(error))",
      `            print('  ' + ${lit(m.failed)} + ': ' + shown + ' (' + str(error) + ')')`,
      '            failed += 1',
      '    if apply:',
      `        print(${lit(m.summary + ': ')} + str(done) + ${lit(' ' + m.doneWord + ', ')} + str(skipped) + ${lit(' ' + m.skippedWord + ', ')} + str(failed) + ${lit(' ' + m.failedWord + '.')})`,
      '    else:',
      `        print(str(len(actions)) + ${lit(' ' + m.planned + '. ' + m.previewHint)})`,
      '    return failed == 0',
      ''
    );
  }
  L.push(
    '',
    `def run_tool(description, add_options, ${o.modifies ? 'plan' : 'work'}):`,
    `    """${
      o.modifies
        ? tr
          ? 'Komut satırını okur, yolu denetler; plan(root, target, args) listesini execute() ile önizler ya da uygular.'
          : 'Reads the command line, checks the path; previews or applies the list from plan(root, target, args) with execute().'
        : tr
          ? 'Komut satırını okur, yolu denetler ve work(root, target, args) fonksiyonunu çalıştırır.'
          : 'Reads the command line, checks the path and runs work(root, target, args).'
    }"""`,
    "    parser = argparse.ArgumentParser(description=description, formatter_class=argparse.RawDescriptionHelpFormatter, conflict_handler='resolve')",
    `    parser.add_argument('path', help=${lit(m.pathHelp)})`,
    ...(o.modifies ? [`    parser.add_argument(APPLY_FLAG, dest='apply', action='store_true', help=${lit(m.applyHelp)})`] : []),
    '    if add_options:',
    '        add_options(parser)',
    `    # ${tr ? 'add_options() klasörü bir kez daha tanımladıysa o ad da aynı yolu göstersin.' : 'A folder argument defined again in add_options() becomes another name for the path.'}`,
    "    extra = [a for a in parser._actions if not a.option_strings and a.dest != 'path']",
    '    for action in extra:',
    '        parser._actions.remove(action)',
    '        for group in parser._action_groups:',
    '            if action in group._group_actions:',
    '                group._group_actions.remove(action)',
    '    args = parser.parse_args()',
    '    for action in extra:',
    '        setattr(args, action.dest, args.path)',
    ...(o.modifies ? ["    args.apply = bool(getattr(args, 'apply', False) or getattr(args, APPLY_FLAG.lstrip('-').replace('-', '_'), False))"] : []),
    '    target = Path(args.path)',
    '    if not target.exists():',
    `        fail(str(target) + ${lit(' ' + m.notFound)})`,
    '    root = target if target.is_dir() else target.parent',
    '    try:',
    ...(o.modifies
      ? ['        ok = execute(root, plan(root, target, args) or [], args.apply)']
      : ['        work(root, target, args)', '        ok = True']),
    '    except KeyboardInterrupt:',
    `        fail(${lit(m.stopped)})`,
    '    except OSError as error:',
    '        fail(error)',
    '    if not ok:',
    '        sys.exit(1)'
  );
  return L.join('\n') + '\n';
}

function pythonTemplate(o: SkeletonOptions): string {
  const tr = o.lang === 'tr';
  const imports = o.modifies ? 'run_tool, rename, move, write, read_text, natural_key, fail' : 'run_tool, read_text, natural_key, fail';
  return [
    `"""${o.title}`,
    '',
    tr ? 'Kullanım:' : 'Usage:',
    `  python ${o.file} ${o.usage}`,
    '"""',
    `from ${helperModule(o)} import ${imports}`,
    '',
    '',
    'def add_options(parser):',
    `    # ${optionsComment(o)}`,
    '    pass',
    '',
    '',
    ...(o.modifies
      ? [
          'def plan(root, target, args):',
          '    actions = []',
          `    # ${tr ? 'YAPILACAK: aracın işi. Dosyalara dokunma; değişiklikleri rename(), move() veya write() ile listeye ekle.' : 'TODO: the tool itself. Do not touch files; append the changes with rename(), move() or write().'}`,
          '    return actions',
        ]
      : [
          'def work(root, target, args):',
          `    # ${tr ? 'YAPILACAK: aracın işi. Girdi dosyalarını yalnızca oku; sonucu yazdır, istenen çıktıyı yeni bir dosyaya yaz.' : 'TODO: the tool itself. Only read the input files; print the result, write any requested output to a new file.'}`,
          '    pass',
        ]),
    '',
    '',
    "if __name__ == '__main__':",
    `    run_tool(__doc__, add_options, ${o.modifies ? 'plan' : 'work'})`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Node.js
// ---------------------------------------------------------------------------

function nodeHelper(o: SkeletonOptions): string {
  const tr = o.lang === 'tr';
  const m = messages(o);
  const backupPrefix = o.names.backup.replace(/YYYY.*$/, '');
  const L: string[] = [];
  L.push(`// ${m.moduleDoc}`, "'use strict';", "const fs = require('fs');", "const path = require('path');", '');
  if (o.modifies) {
    L.push(
      "const STAMP = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);",
      `const LOG_NAME = ${lit(o.names.log)};`,
      `const BACKUP_PREFIX = ${lit(backupPrefix)};`,
      `const APPLY_FLAG = ${lit(o.names.apply)};`,
      ''
    );
  }
  L.push(
    `/** ${tr ? 'Anlaşılır bir mesaj yazar ve 1 koduyla çıkar.' : 'Prints a clear message and exits with code 1.'} */`,
    'function fail(message) {',
    `  console.error(${lit(m.error + ': ')} + message);`,
    '  process.exit(1);',
    '}',
    '',
    `/** ${tr ? 'Değer alan bir seçenek: optionValue(args, "--kalip", "varsayılan")' : 'An option with a value: optionValue(args, "--pattern", "default")'} */`,
    'function optionValue(args, name, fallback) {',
    '  const i = args.indexOf(name);',
    '  return i !== -1 && i + 1 < args.length ? args[i + 1] : fallback;',
    '}',
    '',
    'function real(p) {',
    '  try {',
    '    return fs.realpathSync(p);',
    '  } catch {',
    '    return path.resolve(p);',
    '  }',
    '}',
    '',
    `/** ${tr ? 'p, root klasörünün içindeyse true (.. ve kısayollarla dışarı çıkılamaz).' : 'True when p is inside root (no escape through .. or links).'} */`,
    'function inside(root, p) {',
    '  const rel = path.relative(real(root), real(p));',
    "  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));",
    '}',
    '',
    `/** ${tr ? 'Metin ve kodlama: UTF-8 (BOM da olabilir), geçersizse latin1. { text, encoding, bom } döndürür.' : 'Text and encoding: UTF-8 (a BOM is fine), else latin1. Returns { text, encoding, bom }.'} */`,
    'function readText(file) {',
    '  const data = fs.readFileSync(file);',
    '  const bom = data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf;',
    '  try {',
    "    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bom ? data.subarray(3) : data), encoding: 'utf8', bom };",
    '  } catch {',
    "    return { text: data.toString('latin1'), encoding: 'latin1', bom: false };",
    '  }',
    '}',
    '',
    `/** ${tr ? 'Doğal sıra: "Tatil 2" < "Tatil 10". Kullanım: dosyalar.sort(naturalCompare)' : 'Natural order: "file 2" < "file 10". Use: files.sort(naturalCompare)'} */`,
    "const naturalCompare = (a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true, sensitivity: 'base' });",
    ''
  );
  if (o.modifies) {
    L.push(
      `// ${tr ? 'Planlanan değişiklikler: plan() bunları listeler, dosyalara yalnızca execute() dokunur.' : 'Planned changes: plan() lists them, only execute() touches files.'}`,
      "const rename = (source, target) => ({ kind: 'rename', source, target });",
      "const move = (source, target) => ({ kind: 'move', source, target });",
      "const write = (file, text, info = { encoding: 'utf8', bom: false }) => ({ kind: 'write', source: file, target: file, text, info });",
      '',
      'function ownFile(root, p) {',
      '  const name = path.basename(p);',
      '  if (name === LOG_NAME || name === path.basename(__filename) || name === path.basename(process.argv[1] || \'\')) return true;',
      '  return path.relative(real(root), real(p)).split(path.sep).some((part) => part.startsWith(BACKUP_PREFIX));',
      '}',
      '',
      'function backup(root, file) {',
      '  const target = path.join(root, BACKUP_PREFIX + STAMP, path.relative(real(root), real(file)));',
      '  fs.mkdirSync(path.dirname(target), { recursive: true });',
      '  fs.copyFileSync(file, target);',
      '}',
      '',
      'function logAction(root, action, source, target, result) {',
      '  const log = path.join(root, LOG_NAME);',
      "  const cell = (v) => '\"' + String(v).split('\"').join('\"\"') + '\"';",
      `  if (!fs.existsSync(log)) fs.writeFileSync(log, '\\uFEFF' + ${lit(m.logHeader.join(','))} + '\\n');`,
      "  fs.appendFileSync(log, [new Date().toISOString(), action, source, target, result].map(cell).join(',') + '\\n');",
      '}',
      '',
      `/** ${tr ? 'Önizleme (varsayılan) ya da uygulama. Silmez, üzerine yazmaz, klasör dışına çıkmaz; yedekler ve kaydeder.' : 'Preview (default) or apply. Never deletes, never overwrites, never leaves the folder; backs up and logs.'} */`,
      'function execute(root, actions, apply) {',
      `  if (actions.length === 0) console.log(${lit(m.nothing)});`,
      '  let done = 0;',
      '  let skipped = 0;',
      '  let failed = 0;',
      '  const targets = new Set();',
      '  for (const action of actions) {',
      '    const source = path.resolve(action.source);',
      '    const target = path.resolve(action.target);',
      '    if (!inside(root, source) || !inside(root, target) || ownFile(root, source) || ownFile(root, target)) {',
      `      console.log('  ' + ${lit(m.outside)} + ': ' + source);`,
      '      skipped++;',
      '      continue;',
      '    }',
      "    const shown = path.relative(root, source) + (action.kind === 'write' ? '' : ' → ' + path.relative(root, target));",
      '    const caseOnly = source !== target && source.toLowerCase() === target.toLowerCase();',
      '    const key = target.toLowerCase();',
      "    if (action.kind !== 'write' && ((fs.existsSync(target) && !caseOnly) || targets.has(key))) {",
      `      console.log('  ' + (targets.has(key) ? ${lit(m.twice)} : ${lit(m.exists)}) + ': ' + shown);`,
      '      skipped++;',
      '      continue;',
      '    }',
      '    targets.add(key);',
      "    console.log('  ' + shown);",
      '    if (!apply) continue;',
      '    try {',
      "      if (action.kind === 'write') {",
      '        if (fs.existsSync(source)) backup(root, source);',
      '        fs.mkdirSync(path.dirname(source), { recursive: true });',
      "        fs.writeFileSync(source, Buffer.from((action.info.bom ? '\\uFEFF' : '') + action.text, action.info.encoding));",
      '      } else {',
      '        fs.mkdirSync(path.dirname(target), { recursive: true });',
      '        if (caseOnly) {',
      "          const temporary = source + '.tmp-rename';",
      '          fs.renameSync(source, temporary);',
      '          fs.renameSync(temporary, target);',
      '        } else {',
      '          fs.renameSync(source, target);',
      '        }',
      '      }',
      "      logAction(root, action.kind, source, target, 'ok');",
      '      done++;',
      '    } catch (error) {',
      "      logAction(root, action.kind, source, target, 'error: ' + error.message);",
      `      console.log('  ' + ${lit(m.failed)} + ': ' + shown + ' (' + error.message + ')');`,
      '      failed++;',
      '    }',
      '  }',
      '  if (apply) {',
      `    console.log(${lit(m.summary + ': ')} + done + ${lit(' ' + m.doneWord + ', ')} + skipped + ${lit(' ' + m.skippedWord + ', ')} + failed + ${lit(' ' + m.failedWord + '.')});`,
      '  } else {',
      `    console.log(actions.length + ${lit(' ' + m.planned + '. ' + m.previewHint)});`,
      '  }',
      '  return failed === 0;',
      '}',
      ''
    );
  }
  L.push(
    `/** ${
      o.modifies
        ? tr
          ? 'Komut satırını okur, yolu denetler; plan(root, target, options) listesini execute() ile önizler ya da uygular.'
          : 'Reads the command line, checks the path; previews or applies the list from plan(root, target, options) with execute().'
        : tr
          ? 'Komut satırını okur, yolu denetler ve work(root, target, options) fonksiyonunu çalıştırır.'
          : 'Reads the command line, checks the path and runs work(root, target, options).'
    } */`,
    `function runTool(help, readOptions, ${o.modifies ? 'plan' : 'work'}) {`,
    '  const args = process.argv.slice(2);',
    "  if (args.includes('--help') || args.includes('-h')) {",
    '    console.log(help);',
    '    return;',
    '  }',
    "  const target = args.find((a) => !a.startsWith('-'));",
    `  if (!target || !fs.existsSync(target)) fail((target || '-') + ${lit(' ' + m.notFound)});`,
    '  const root = fs.statSync(target).isDirectory() ? target : path.dirname(target);',
    '  try {',
    '    const options = readOptions ? readOptions(args) : {};',
    ...(o.modifies
      ? ['    if (!execute(root, plan(root, target, options) || [], args.includes(APPLY_FLAG))) process.exit(1);']
      : ['    work(root, target, options);']),
    '  } catch (error) {',
    '    fail(error && error.message ? error.message : String(error));',
    '  }',
    '}',
    '',
    `module.exports = { runTool, ${o.modifies ? 'rename, move, write, ' : ''}readText, naturalCompare, optionValue, fail, inside };`
  );
  return L.join('\n') + '\n';
}

function nodeTemplate(o: SkeletonOptions): string {
  const tr = o.lang === 'tr';
  const imports = o.modifies ? 'runTool, rename, move, write, readText, naturalCompare, optionValue, fail' : 'runTool, readText, naturalCompare, optionValue, fail';
  return [
    `// ${o.title}`,
    `// ${tr ? 'Kullanım' : 'Usage'}: node ${o.file} ${o.usage}`,
    "'use strict';",
    "const fs = require('fs');",
    "const path = require('path');",
    `const { ${imports} } = require(${lit('./' + helperModule(o))});`,
    '',
    `const HELP = [${lit(o.title)}, '', ${lit(`${tr ? 'Kullanım' : 'Usage'}: node ${o.file} ${o.usage}`)}].join('\\n');`,
    '',
    'function readOptions(args) {',
    `  // ${optionsComment(o)}`,
    '  return {};',
    '}',
    '',
    ...(o.modifies
      ? [
          'function plan(root, target, options) {',
          '  const actions = [];',
          `  // ${tr ? 'YAPILACAK: aracın işi. Dosyalara dokunma; değişiklikleri rename(), move() veya write() ile listeye ekle.' : 'TODO: the tool itself. Do not touch files; push the changes with rename(), move() or write().'}`,
          '  return actions;',
          '}',
        ]
      : [
          'function work(root, target, options) {',
          `  // ${tr ? 'YAPILACAK: aracın işi. Girdi dosyalarını yalnızca oku; sonucu yazdır, istenen çıktıyı yeni bir dosyaya yaz.' : 'TODO: the tool itself. Only read the input files; print the result, write any requested output to a new file.'}`,
          '}',
        ]),
    '',
    `runTool(HELP, readOptions, ${o.modifies ? 'plan' : 'work'});`,
  ].join('\n');
}

/** The helper module the app writes next to the script. */
export function scriptHelper(o: SkeletonOptions): string {
  return o.language === 'node' ? nodeHelper(o) : pythonHelper(o);
}

/** The short script structure the model completes. */
export function scriptTemplate(o: SkeletonOptions): string {
  return o.language === 'node' ? nodeTemplate(o) : pythonTemplate(o);
}
