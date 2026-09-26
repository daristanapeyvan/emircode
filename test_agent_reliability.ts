/**
 * test_agent_reliability.ts
 * Regression tests for the agent reliability overhaul (v1.6.0):
 * structured tool parsing, edit application, content sanitizing, per-language file checks,
 * task contracts, model runtime profiles, context compaction and web intent detection.
 *
 * Run: node scripts/run-ts-test.mjs test_agent_reliability.ts
 */

import { ToolDispatcher, extractActionJson, splitCommandLine } from './src/lib/agent/ToolDispatcher';
import {
  applyChunkEdit,
  compressConversationContext,
  findBestMatchRegion,
  formatLedgerBlock,
  isSmallLanguageModel,
  buildSystemPrompt,
  buildCompactSystemPrompt,
  decomposeGoalIntoSubtasks,
  applyLineRangeEdit,
  numberedLines,
  stripLineNumberPrefixes,
  looksLikeStatusMessage,
  isProtectedTestFile,
  isEmptyWrite,
  looksLikeUsageText,
  findErrorLocation,
  copiedLinesAdded,
  alignReplacementIndent,
  ConversationEntry,
} from './src/lib/agent/AgentEngine';
import {
  buildAgentSystemPrompt,
  buildActionSchema,
  sanitizeFileContent,
  detectLazyPlaceholder,
  detectRepetitionLoop,
  compactActionForHistory,
  AgentToolset,
} from './src/lib/agent/AgentProtocol';
import {
  checkFileSanity,
  strictFormatError,
  jsonKeyLoss,
  definitionLoss,
  detectDestructiveRewrite,
  mergeJsonPreservingKeys,
  damageFromChange,
} from './src/lib/agent/FileSanity';
import { TaskCompiler, mentionsPhrase } from './src/lib/agent/TaskContract';
import { TaskValidator, looksJsonEscaped, extractMenuLinks, deadMenuLinks } from './src/lib/agent/TaskValidator';
import {
  parseParameterSize,
  parameterSizeFromName,
  resolveContextLength,
  resolveRequestProfile,
  buildRuntimeInfo,
  buildAgentSamplingOptions,
  defaultContextForHardware,
} from './src/lib/ollama/ModelRuntime';
import { detectWebSearchIntent, detectKnowledgeRefusal, extractSearchQuery } from './src/lib/web/WebIntentDetector';
import { AgentMemoryLedger } from './src/types/agent';

let passed = 0;
const failures: string[] = [];

function check(condition: boolean, message: string, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`✅ ${message}`);
  } else {
    failures.push(message);
    console.error(`❌ ${message}${detail !== undefined ? `\n   → ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  }
}

function section(title: string) {
  console.log(`\n--- ${title} ---`);
}

const STYLED_PAGE = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Kafe</title>
  <style>
    .card { background: #1e293b; padding: 1rem; border-radius: 8px; }
    @media (max-width: 640px) { .card { padding: .5rem; } }
  </style>
</head>
<body>
  <div class="card"><h1>Merhaba</h1><button id="b">Tıkla</button></div>
  <script>
    document.getElementById("b").addEventListener("click", () => {
      document.querySelector("h1").textContent = \`Selam \${new Date().getFullYear()}\`;
    });
  </script>
</body>
</html>`;

async function run() {
  // =====================================================================
  section('1. Tool parsing: streamed JSON actions are never corrupted');
  // =====================================================================
  const response =
    '<thought>Stilli sayfayı yazıyorum.</thought>\n```json\n' +
    JSON.stringify({ action: 'propose_create', path: 'index.html', content: STYLED_PAGE, reason: 'x' }, null, 1) +
    '\n```';
  let partialCorrupted = false;
  for (let i = 1; i < response.length; i += 9) {
    const partial = ToolDispatcher.parseActionFromResponse(response.slice(0, i), {
      expectedArtifacts: ['index.html'],
      activeTaskTarget: 'index.html',
    });
    if (partial.type === 'propose_create' && partial.payload.content !== STYLED_PAGE) partialCorrupted = true;
  }
  check(!partialCorrupted, 'No partial stream prefix is ever turned into a JSON-escaped file write');
  const full = ToolDispatcher.parseActionFromResponse(response, { activeTaskTarget: 'index.html' });
  check(full.type === 'propose_create' && full.payload.content === STYLED_PAGE, 'Complete response yields the exact file content (real newlines and quotes)');

  const structured = ToolDispatcher.parseActionFromResponse(
    JSON.stringify({ thought: 'yaz', action: 'write_file', path: 'src/app.py', content: 'print("hi")\n' })
  );
  check(structured.type === 'propose_create' && structured.payload.path === 'src/app.py', 'Structured-output alias write_file maps to propose_create');

  const trailingComma = '```json\n{ "action": "edit_file", "path": "src/utils.ts", "find": "a", "replace": "b", }\n```';
  const tc = ToolDispatcher.parseActionFromResponse(trailingComma, { activeTaskTarget: 'src/index.js' });
  check(tc.type === 'propose_edit' && tc.payload.path === 'src/utils.ts', 'Trailing-comma JSON is repaired instead of being written into src/index.js', tc);

  const rawNewline = '{"thought": "t", "action": "write_file", "path": "a.txt", "content": "line1\nline2"}';
  const rn = ToolDispatcher.parseActionFromResponse(rawNewline);
  check(rn.type === 'propose_create' && rn.payload.content === 'line1\nline2', 'Raw newline inside a JSON string is repaired');

  const broken = '```json\n{ "action": "write_file", "path": "x.js", "content": "a" "b" }\n```';
  const br = ToolDispatcher.parseActionFromResponse(broken, { activeTaskTarget: 'index.html' });
  check(br.type === 'unknown', 'Unrepairable JSON action is rejected, never written to disk as code', br.type);

  const thinkFirst = '<think>maybe {"action": "read_directory", "path": ""}</think>{"thought": "ok", "action": "finish", "summary": "bitti"}';
  check(ToolDispatcher.parseActionFromResponse(thinkFirst).type === 'finish', 'JSON examples inside <think> are ignored');

  const codeThenJson = 'Örnek:\n```css\nbody { color: red; }\n```\n```json\n{"action": "read_file", "path": "style.css"}\n```';
  check(ToolDispatcher.parseActionFromResponse(codeThenJson).type === 'read_file', 'A code block before the JSON action does not hijack parsing');

  const placeholder = ToolDispatcher.parseActionFromResponse('{"action": "read_directory", "path": "hedef_klasor"}');
  check(placeholder.type === 'read_directory' && placeholder.payload.path === '', 'Copied placeholder folder names map to the project root');

  const cmd = ToolDispatcher.parseActionFromResponse('{"thought":"t","action":"run_command","command":"npm run test -- --grep \\"price fmt\\""}');
  check(
    cmd.type === 'propose_command' && cmd.payload.binary === 'npm' && cmd.payload.args.join('|') === 'run|test|--|--grep|price fmt',
    'run_command string is split into binary + args with quotes respected',
    cmd.payload
  );
  check(splitCommandLine('Python main.py').binary === 'python', 'Command binary is normalised to lower case');

  const escapedHtmlOnly = '<!DOCTYPE html>\\n<html lang=\\"tr\\">\\n<body>\\n<p>x</p>\\n</body>\\n</html>';
  check(ToolDispatcher.parseActionFromResponse(escapedHtmlOnly).type === 'unknown', 'JSON-escaped HTML text is never accepted as a raw HTML document');

  check(extractActionJson('no json here') === null, 'extractActionJson returns null without an action object');

  // validateAction
  const v = (json: any) => ToolDispatcher.validateAction(ToolDispatcher.normalizeAction(json));
  check(v({ action: 'write_file', path: 'a.js' }) !== null, 'write_file without content is rejected');
  check(v({ action: 'write_file', path: 'a.js', content: '' }) === null, 'write_file with empty content is allowed (e.g. __init__.py)');
  check(v({ action: 'edit_file', path: 'a.js', replace: 'x' }) !== null, 'edit_file without find is rejected');
  check(v({ action: 'edit_file', path: 'a.js', find: 'x', replace: '' }) === null, 'edit_file with empty replace (deletion) is allowed');
  check(v({ action: 'fetch_url', url: 'example.com' }) !== null, 'fetch_url requires a full URL');
  check(v({ action: 'write_file', path: 'src/', content: 'x' }) !== null, 'write_file to a folder path is rejected');
  check(v({ thought: 'src klasörünü oluşturuyorum', action: 'write_file', path: 'src', content: '' }) !== null, 'Attempt to "create a folder" with write_file is rejected with guidance');
  check(v({ action: 'write_file', path: 'Dockerfile', content: 'FROM node:22\nCMD ["node", "index.js"]\n' }) === null, 'Extensionless files such as Dockerfile are still allowed');
  check(v({ action: 'write_file', path: '.gitignore', content: 'node_modules\n' }) === null, 'Dotfiles such as .gitignore are still allowed');

  // =====================================================================
  section('2. Edit engine (all file types)');
  // =====================================================================
  const js = 'function a() {\n  return 1;\n}\n\nfunction b() {\n  return 2;\n}\n';
  let e = applyChunkEdit(js, 'function b() {\n  return 2;\n}', 'function b() {\n  return 3;\n}');
  check(e.success && e.newContent.includes('return 3') && e.newContent.includes('return 1'), 'Exact unique snippet is replaced');

  e = applyChunkEdit(js, '  return', '  return 0 +');
  check(!e.success && e.method === 'ambiguous' && e.newContent === js, 'Ambiguous snippet fails without touching the file');

  e = applyChunkEdit(js, 'function missing() {}', 'x');
  check(!e.success && e.newContent === js, 'Missing snippet fails WITHOUT appending garbage to the file');

  const crlf = 'a\r\nb\r\nc\r\n';
  e = applyChunkEdit(crlf, 'b\nc', 'B\nC');
  check(e.success && e.newContent === 'a\r\nB\r\nC\r\n', 'CRLF files keep CRLF line endings after an LF edit');

  const py = 'def f():\n    x = 1\n\n    return x\n';
  e = applyChunkEdit(py, 'x = 1\nreturn x', 'x = 2\nreturn x');
  check(e.success && e.method === 'line_by_line_trimmed' && e.newContent.includes('    x = 2'), 'Indentation-insensitive match re-indents the replacement', e);

  e = applyChunkEdit('let s = "";\n', 'let s = "";', "let s = price.replace(/x/, '$&$$');");
  check(e.success && e.newContent.includes("'$&$$'"), '"$&" / "$$" in the replacement are inserted literally (no String.replace patterns)');

  const page = '<html><head><title>x</title></head><body><p>x</p></body></html>';
  e = applyChunkEdit(page, '<style>old</style>', '<style>\n  p { color: red; }\n</style>');
  check(e.success && e.method === 'smart_head_injection' && e.newContent.indexOf('<style>') < e.newContent.indexOf('</head>'), 'A new <style> block is injected into <head> when the find text is absent');
  e = applyChunkEdit(page, '<script>old</script>', '<script>\n  console.log(1);\n</script>');
  check(e.success && e.method === 'smart_body_injection' && e.newContent.indexOf('<script>') < e.newContent.indexOf('</body>'), 'A new <script> block is injected before </body>');

  const pyUsage = "import sys\nif len(sys.argv) < 2:\n    print('Kullanım: todo.py ekle <iş>\n          todo.py listele')\n    sys.exit(1)\n";
  e = applyLineRangeEdit(pyUsage, 3, 4, '    print("Kullanım: todo.py ekle <iş> | todo.py listele")');
  check(
    e.success && e.newContent === 'import sys\nif len(sys.argv) < 2:\n    print("Kullanım: todo.py ekle <iş> | todo.py listele")\n    sys.exit(1)\n',
    'replace_lines replaces exactly the given line range (the qwen2.5-coder Python failure)',
    e.newContent
  );
  e = applyLineRangeEdit('a\r\nb\r\nc\r\n', 2, 2, '  12| B');
  check(e.success && e.newContent === 'a\r\nB\r\nc\r\n', 'replace_lines keeps CRLF and strips copied "NN| " prefixes', JSON.stringify(e.newContent));
  check(!applyLineRangeEdit('a\nb\n', 9, 9, 'x').success, 'replace_lines outside the file fails without changes');
  check(numberedLines('x\ny\nz', 2, 3) === '   2| y\n   3| z', 'Numbered excerpt formats line numbers for edit hints');
  check(stripLineNumberPrefixes('  5| a\n  6| b') === 'a\nb' && stripLineNumberPrefixes('a: 1 | b') === 'a: 1 | b', 'Number prefixes are stripped only when every line has one');
  const rl = ToolDispatcher.normalizeAction({ action: 'replace_lines', path: 'todo.py', start_line: 3, end_line: 4, content: 'x' });
  check(rl.type === 'propose_edit' && rl.payload.lineRange && ToolDispatcher.validateAction(rl) === null, 'replace_lines is parsed and validated');
  check(ToolDispatcher.validateAction(ToolDispatcher.normalizeAction({ action: 'replace_lines', path: 'a', start_line: 5, end_line: 2, content: 'x' })) !== null, 'replace_lines with end_line < start_line is rejected');

  const region = findBestMatchRegion('a\nb\nfunction foo() {\n  return 1;\n}\nz', 'function foo() {\n  return 2;\n}');
  check(!!region && region.text.includes('function foo()'), 'findBestMatchRegion points at the closest existing code for failed edits');

  // =====================================================================
  section('2b. Command results & empty writes');
  // =====================================================================
  check(looksLikeUsageText('Kullanım: python todo.py <komut> [argüman]'), 'Turkish usage text is recognised');
  check(looksLikeUsageText('Kullan\uFFFDm: python todo.py <komut> [arg\uFFFDman]'), 'Usage text decoded with the wrong code page is still recognised (seen in E2E)');
  check(
    looksLikeUsageText('usage: todo.py [-h] {add,list} ...\ntodo.py: error: the following arguments are required: command'),
    'argparse usage errors are recognised'
  );
  check(
    !looksLikeUsageText('Traceback (most recent call last):\n  File "todo.py", line 3, in <module>\nNameError: name \'x\' is not defined'),
    'A traceback is not mistaken for usage text'
  );
  const pyLoc = findErrorLocation(
    'Traceback (most recent call last):\n  File "C:\\Users\\AGAHEM~1\\Temp\\proj\\todo.py", line 80, in <module>\n    main()\n  File "C:\\Users\\AGAHEM~1\\Temp\\proj\\lib\\store.py", line 12, in load\n    return json.load(f)\nValueError: bad',
    ['todo.py', 'lib/store.py']
  );
  check(pyLoc?.path === 'lib/store.py' && pyLoc?.line === 12, 'The innermost Python traceback frame is mapped to its project file', pyLoc);
  const nodeLoc = findErrorLocation('C:\\proj\\src\\index.js:14\n  foo(;\n      ^\nSyntaxError: Unexpected token', ['package.json', 'src/index.js']);
  check(nodeLoc?.path === 'src/index.js' && nodeLoc?.line === 14, 'A Node.js error location is mapped to its project file', nodeLoc);
  check(findErrorLocation('    at Module._compile (node:internal/modules/cjs/loader:1256:14)', ['src/index.js']) === null, 'Locations outside the project are ignored');
  const bugGoal = 'src/price.js dosyasındaki fiyat biçimlendirme hatasını düzelt ve npm test ile doğrula';
  check(
    isProtectedTestFile('test/price.test.js', bugGoal) && isProtectedTestFile('tests/test_todo.py', bugGoal) && isProtectedTestFile('pkg/util_test.go', bugGoal),
    'Existing tests are protected when the user asked to fix code (qwen2.5-coder rewrote a failing assertion in E2E)'
  );
  check(!isProtectedTestFile('src/price.js', bugGoal) && !isProtectedTestFile('src/latest.js', bugGoal), 'Source files are not treated as tests');
  check(
    !isProtectedTestFile('test/price.test.js', 'price testini düzelt') && !isProtectedTestFile('test/a.test.js', 'add tests for formatPrice'),
    'Tests can be changed when the user asks for it'
  );
  const shoppingGoal = 'notlar.txt adında bir dosya oluştur ve içine alışveriş listesi yaz: süt, ekmek, yumurta.';
  check(looksLikeStatusMessage('Alışveriş listesi hazırlandı. \n', shoppingGoal), 'A status sentence written as file content is detected (gemma2:2b overwrote the list it had written, in-app test)');
  check(looksLikeStatusMessage('File created successfully.'), 'English status sentences are detected');
  check(!looksLikeStatusMessage('süt\nekmek\nyumurta\n', shoppingGoal), 'The requested content itself is not a status message');
  check(!looksLikeStatusMessage('Proje hazırlandı.', 'rapor.txt dosyasına "Proje hazırlandı." yaz'), 'A sentence the user asked for literally is allowed');
  check(!looksLikeStatusMessage('The data is already.') && !looksLikeStatusMessage('Yarın saat yedi'), 'Words that merely end like a status word are not flagged');
  check(!looksLikeStatusMessage('console.log("done");\nprocess.exit(0);\nrun();'), 'Code is not mistaken for a status message');
  const emptyWrite = ToolDispatcher.parseActionFromResponse('{"thought": "x", "action": "write_file", "path": "index.html", "content": ""}');
  check(isEmptyWrite(emptyWrite), 'An empty write_file is detected (seen with gemma2:2b in E2E)', emptyWrite);
  check(
    isEmptyWrite(ToolDispatcher.parseActionFromResponse('{"thought": "x", "action": "write_file", "path": "app.py", "content": "  \\n "}')),
    'A whitespace-only write_file is detected'
  );
  check(
    !isEmptyWrite(ToolDispatcher.parseActionFromResponse('{"thought": "x", "action": "write_file", "path": "pkg/__init__.py", "content": ""}')),
    'Empty __init__.py files are allowed'
  );
  check(
    !isEmptyWrite(ToolDispatcher.parseActionFromResponse('{"thought": "x", "action": "write_file", "path": "a.txt", "content": "x"}')),
    'Non-empty writes are not flagged'
  );

  // =====================================================================
  section('3. Content sanitizer & lazy placeholder detection');
  // =====================================================================
  const fenced = sanitizeFileContent('app.py', '```python\nprint("x")\n```');
  check(fenced.content === 'print("x")' && fenced.notes.length === 1, 'Markdown fence around a whole file is removed');
  const md = sanitizeFileContent('README.md', '```bash\nnpm i\n```');
  check(md.content.startsWith('```'), 'Markdown files keep their code fences');
  const escapedPage =
    '<!DOCTYPE html>\\n<html lang=\\"en\\">\\n<head>\\n  <meta charset=\\"UTF-8\\">\\n  <style>\\n    .container { max-width: 600px; }\\n  </style>\\n</head>\\n<body>\\n  <div class=\\"container\\">Hi</div>\\n</body>\\n</html>';
  check(looksJsonEscaped(escapedPage), 'Real-world corrupted page (literal \\n, \\") is recognised');
  const repaired = sanitizeFileContent('index.html', escapedPage);
  check(
    repaired.content.includes('<div class="container">') && repaired.content.split('\n').length > 8 && !looksJsonEscaped(repaired.content),
    'Corrupted page is repaired into real lines and quotes'
  );
  const jsonFile = sanitizeFileContent('data.json', '{"a": "line\\nbreak"}');
  check(jsonFile.content === '{"a": "line\\nbreak"}', 'Legitimate escapes inside JSON data are left untouched');

  check(detectLazyPlaceholder('<style>a{}</style>\n<!-- ... rest of the page -->', '<html>' + 'x'.repeat(4000)) !== null, 'Lazy "... rest of the page" rewrite is detected');
  check(detectLazyPlaceholder('def f():\n    # kodun geri kalanı aynı\n', 'x'.repeat(500)) !== null, 'Turkish lazy placeholder is detected');
  check(detectLazyPlaceholder(STYLED_PAGE, null) === null, 'A complete page is not flagged as lazy');
  check(detectLazyPlaceholder('[[saved to disk: 10 lines]]', null) !== null, 'History elision marker can never be written as file content');

  // =====================================================================
  section('4. Degenerate repetition detection');
  // =====================================================================
  const loop = 'const items = [];\n' + '  .card { color: red; padding: 1rem; margin: 0 auto; display: flex; gap: 4px; }\n'.repeat(12);
  check(detectRepetitionLoop(loop), 'A block repeated over and over is detected');
  const realCss = Array.from({ length: 60 }, (_, i) => `.item-${i} { margin: ${i}px; color: #${(i * 4321).toString(16).padStart(6, '0')}; }`).join('\n');
  check(!detectRepetitionLoop(realCss), 'Long but varied CSS is not mistaken for a loop');
  check(detectRepetitionLoop('x'.repeat(800) + '='.repeat(300)), 'A run of the same character is detected');
  const gemmaLoop = '{"thought":"fix","action":"write_file","path":"package.json","content":"{\\n  \\"scripts\\": {\\n    ' + '\\": \\"node src/index.js\\"\\n'.repeat(16);
  check(detectRepetitionLoop(gemmaLoop), 'Short periodic loop seen with gemma2:2b (repeated JSON line) is detected');
  check(!detectRepetitionLoop(JSON.stringify({ thought: 'x', action: 'write_file', path: 'index.html', content: STYLED_PAGE })), 'A normal write_file reply is not flagged');

  // =====================================================================
  section('5. File sanity checks for every file type');
  // =====================================================================
  const errs = (path: string, content: string) => checkFileSanity(path, content).filter((i) => i.severity === 'error');
  check(errs('data.json', '{"a": 1, "b": [1, 2]}').length === 0, 'Valid JSON passes');
  const badJson = errs('package.json', '{\n  "name": "x",\n  "scripts": { "test": "node t.js", }\n}');
  check(badJson.length === 1 && /line/.test(badJson[0].message), 'Invalid JSON is reported with a line number', badJson);
  check(errs('tsconfig.json', '{\n  // comment\n  "compilerOptions": { "strict": true, },\n}').length === 0, 'tsconfig.json (JSONC with comments / trailing commas) passes');

  check(errs('src/app.ts', 'export function f<T>(a: T[]): T | undefined {\n  return a.find((x) => !!x);\n}\n').length === 0, 'Valid TypeScript passes');
  check(errs('src/app.js', 'function f() {\n  if (x) {\n    return 1;\n').length > 0, 'Truncated JavaScript (unclosed braces) is reported');
  check(errs('src/re.js', 'const r = /\\{[a-z}]+/g;\nconst t = `a ${ {x: 1}.x } b`;\nif (a / b > 1) { c(); }\n').length === 0, 'Regex literals and nested template expressions do not cause false positives');
  check(errs('src/App.jsx', "export default function App() {\n  return <p>Don't stop {count}</p>;\n}\n").length === 0, "JSX text with an apostrophe (Don't) passes");
  check(errs('lib.rs', "fn longest<'a>(x: &'a str, y: &'a str) -> &'a str {\n    if x.len() > y.len() { x } else { y }\n}\nconst C: char = '{';\n").length === 0, 'Rust lifetimes and char literals pass');
  check(errs('main.go', 'package main\n\nfunc main() {\n\ts := `raw { string`\n\t_ = s\n}\n').length === 0, 'Go raw strings with braces pass');
  check(errs('Main.java', 'class A {\n  String t = """\n    { not code\n    """;\n}\n').length === 0, 'Java text blocks pass');
  check(errs('prog.cs', '#region X\nclass P { static void Main() { var s = "}"; } }\n#endregion\n').length === 0, 'C# with preprocessor lines passes');
  check(errs('app.py', 'def f(x):\n    """Doc with ( and [ brackets."""\n    return {"a": [x, (1, 2)]}\n').length === 0, 'Valid Python with brackets in docstrings passes');
  check(errs('app.py', 'def f(x):\n    return max(x,\n').length > 0, 'Python with an unclosed parenthesis is reported');
  check(errs('app.py', 'def f():\n    a = 1\n\tb = 2\n').some((i) => /tabs and spaces/.test(i.message)), 'Python mixing tabs and spaces is reported');
  const multiLine = errs('todo.py', "import sys\nif len(sys.argv) < 2:\n    print('Kullanım: todo.py ekle <iş>\n          todo.py listele')\n");
  check(
    multiLine.some((i) => /line 3 is: print\('Kullanım/.test(i.message) && /triple quotes/.test(i.message)),
    'Unterminated Python string shows the broken line and a concrete fix (seen with qwen2.5-coder in E2E)',
    multiLine
  );
  const fstr = errs('todos.py', "for index, todo in enumerate(todos, 1):\n    status = 'x'\n    print(f'{index}. {todo['task']} - {status}')\n");
  check(fstr.length === 0, 'Python 3.12 f-strings that reuse the quote inside {…} are not reported as broken (false positive seen with qwen2.5-coder in E2E)', fstr);
  check(
    checkFileSanity('todos.py', "print(f'{todo['task']}')\n").some((i) => i.severity === 'warning' && /3\.12/.test(i.message)),
    'Same-quote f-strings get a compatibility warning for Python < 3.12 (not an error)'
  );
  check(
    errs('fmt.py', "w = 10\nx = 3.14159\nprint(f'{x:{w}.2f} {{literal}} {f\"{x!r}\"}')\nprint(f\"\"\"{x}\n{w}\"\"\")\n").length === 0,
    'f-strings with nested format specs, escaped braces, nested f-strings and triple quotes pass'
  );
  check(errs('bad.py', "print(f'abc {x}\nprint(1)\n").some((i) => /unterminated/.test(i.message)), 'An f-string left open on its line is still reported');
  check(
    errs('bad.py', "for t in todos:\n    print(f'{index}. {todo[\n\ndef main():\n    pass\n").some((i) => /unterminated|never closed/.test(i.message)),
    'An f-string cut off inside {…} is still reported'
  );
  const pyIndent = (src: string) => errs('todo.py', src).filter((i) => /IndentationError/.test(i.message));
  const e2eIndent = "import sys\n\ncommand = sys.argv[1]\nif command == 'list':\n    list_todos()\nelif command == 'delete':\nif len(sys.argv) < 3:\n    print('eksik')\n";
  const missingBlock = pyIndent(e2eIndent);
  check(
    missingBlock.length === 1 && /after line 6/.test(missingBlock[0].message) && /line 7/.test(missingBlock[0].message),
    'A Python header without an indented block is reported with both line numbers (seen with qwen2.5-coder in E2E)',
    missingBlock
  );
  check(pyIndent('def f():\n    a = 1\n        b = 2\n').some((i) => /unexpected indent at line 3/.test(i.message)), 'An unexpected Python indent is reported');
  check(pyIndent('if x:\n    a = 1\n  b = 2\n').some((i) => /line 3/.test(i.message) && /no enclosing block/.test(i.message)), 'A dedent to an unknown level is reported');
  const lostIndent = pyIndent(
    "class T(unittest.TestCase):\n    def test_add(self):\n        add_task('x')\n        with open('todos.json') as file:\n            import json\n\ntodos = json.load(file)\n            self.assertEqual(len(todos), 1)\n"
  );
  check(
    lostIndent.some((i) => /unexpected indent at line 8/.test(i.message) && /cause is probably line 7/.test(i.message)),
    'An unexpected indent names the line that lost its indentation as the likely cause (seen with qwen2.5-coder in E2E)',
    lostIndent
  );
  check(pyIndent('def f():\n    # comment only\n').some((i) => /file ends there/.test(i.message)), 'A block header at the end of the file is reported');
  const validPy = [
    '#!/usr/bin/env python3',
    '"""Module docstring:',
    '    indented text inside the docstring:',
    '"""',
    'import json, sys',
    '',
    'CONFIG = {',
    "    'a':",
    '        1,',
    '}',
    '',
    'def add(todos: list,',
    '        text: str) -> None:',
    '    """Adds an item."""',
    '    todos.append({"text": text, "done": False})  # comment:',
    '',
    'class Store: pass',
    '',
    'def main():',
    '    total = 1 + \\',
    '        2',
    '    if total:',
    '',
    '        # comment at another level',
    '  # odd comment',
    '        print(f"{total}: ok", sys.argv[1:])',
    '    else:',
    "        print('x:')",
    '    return total',
    '',
    "if __name__ == '__main__':",
    '    main()',
  ].join('\n');
  check(
    errs('todo.py', validPy).length === 0,
    'Valid Python (multi-line headers, docstrings, dict values, continuations, odd comments) passes the indentation check',
    errs('todo.py', validPy)
  );
  check(pyIndent('def f():\r\n    return 1\r\n').length === 0, 'Python with CRLF line endings passes the indentation check');
  check(errs('style.css', '.a { color: red;\n.b { color: blue; }\n').length > 0, 'CSS with an unclosed rule is reported');
  check(errs('style.scss', '// note: {\n.a { .b { color: red; } }\n').length === 0, 'SCSS line comments are understood');
  check(errs('ci.yml', 'jobs:\n\tbuild: x\n').length > 0, 'YAML tab indentation is reported');
  check(errs('index.html', STYLED_PAGE).length === 0, 'A complete styled page passes the HTML checks');
  check(errs('index.html', STYLED_PAGE.replace('</html>', '')).some((i) => /<\/html>/.test(i.message)), 'A page cut off before </html> is reported');
  check(errs('index.html', STYLED_PAGE + '\n' + STYLED_PAGE).some((i) => /more than one/.test(i.message)), 'A duplicated page is reported');
  const orphanStyle =
    '<!DOCTYPE html>\n<html>\n<head><title>x</title></head>\n<body>\n<p>Merhaba</p>\n</body>\n  flex-wrap: wrap;\n  justify-content: space-between;\n}\n\n.item {\n  width: 300px;\n}\n</style>\n</html>\n';
  const orphanMsg = errs('index.html', orphanStyle).map((i) => i.message).join(' | ');
  check(
    /CSS starting at line 7 is outside a <style> block/.test(orphanMsg) && /<\/style> is at line 14/.test(orphanMsg) && /right before line 7/.test(orphanMsg),
    'CSS left outside <style> is reported with the line to insert <style> at (seen with gemma2:2b in E2E)',
    orphanMsg
  );
  const unclosedStyle = '<!DOCTYPE html>\n<html>\n<head>\n<style>\n  body { color: red; }\n  h1 { margin: 0; }\n\n</head>\n<body><p>x</p></body>\n</html>\n';
  const unclosedMsg = errs('index.html', unclosedStyle).map((i) => i.message).join(' | ');
  check(/opened at line 4 is never closed/.test(unclosedMsg) && /after line 6/.test(unclosedMsg), 'An unclosed <style> names the line to close it after', unclosedMsg);
  const noBody = errs('index.html', '<!DOCTYPE html>\n<html>\n<body>\n<p>x</p>\n</html>\n').map((i) => i.message).join(' | ');
  check(/missing <\/body>.*before <\/html> \(line 5\)/.test(noBody), 'A missing </body> names the line to add it at', noBody);
  check(errs('index.html', STYLED_PAGE.replace('});\n  </script>', '\n  </script>')).some((i) => /inline <script>/.test(i.message)), 'Broken JavaScript inside an inline <script> is reported');
  check(errs('index.html', escapedPage).some((i) => /escape/.test(i.message)), 'JSON-escaped page content is reported');
  const markupScript = STYLED_PAGE.replace(/<script>[\s\S]*?<\/script>/, '<script> <h1>Merhaba Dünya!</h1></script>');
  check(errs('index.html', markupScript).some((i) => /HTML markup instead of JavaScript/.test(i.message)), 'HTML markup inside <script> is reported (seen with gemma2:2b in E2E)');
  check(errs('main.py', '```python\nprint(1)\n```').some((i) => /fence/.test(i.message)), 'A leftover markdown fence in a code file is reported');
  const emptySection = STYLED_PAGE.replace('<div class="card">', '<section id="team"><h2>Ekip</h2>\n    <!-- Team content goes here -->\n  </section>\n  <div class="card">');
  check(errs('index.html', emptySection).some((i) => /placeholder/.test(i.message)), 'A page section left empty with "content goes here" is reported');
  check(errs('index.html', STYLED_PAGE.replace('<style>', '<style>\n    /* Add your CSS here */')).length === 0, 'A leftover comment followed by real CSS is not reported');
  const trEmpty = STYLED_PAGE.replace('<div class="card">', '<section id="hizmetler">\n    <h2>Hizmetler</h2>\n    <!-- Hizmetler içeriği buraya gelecek -->\n  </section>\n  <div class="card">');
  check(errs('index.html', trEmpty).some((i) => /placeholder/.test(i.message)), 'Turkish "… içeriği buraya gelecek" empty section is reported (seen in the in-app test)');
  const todoEmpty = STYLED_PAGE.replace('<div class="card">', '<section><h2>Ekip</h2><!-- Ekip üyeleri eklenecek --></section>\n  <div class="card">');
  check(errs('index.html', todoEmpty).some((i) => /placeholder/.test(i.message)), 'Turkish "… eklenecek" empty section is reported');
  check(errs('app.js', 'function save() {\n  // add saving logic here\n}\n').some((i) => /placeholder/.test(i.message)), 'An empty function body with "add ... logic here" is reported');
  check(errs('app.py', 'def save():\n    # implement saving here\n    pass\n').some((i) => /placeholder/.test(i.message)), 'A Python stub with a placeholder comment and pass is reported');
  check(errs('app.py', 'def save(path):\n    # write the file here\n    open(path, "w").write("x")\n').length === 0, 'A comment followed by real Python code is not reported');
  check(errs('app.js', 'function load() {\n  const data = read();\n  // TODO: handle errors\n}\n').length === 0, 'A trailing TODO after real code is not treated as an empty body');
  check(
    errs('app.js', 'try {\n  run();\n} catch {\n  // TODO: log this?\n}\nif (ok) {\n  // TODO: normalize\n} else {\n  // see todo above\n}\n').length === 0,
    'Empty control-flow branches with a TODO comment are ordinary code (false positives found in node_modules)'
  );
  check(
    errs('data.min.js', 'const csv="a,b\\nc,d\\ne,f\\ng,h\\ni,j\\nk,l";export default csv;').length === 0,
    'A one-line data string with many \\n escapes is not mistaken for an escaped file (minified bundles)'
  );
  const filledSection = STYLED_PAGE.replace('<div class="card">', '<section><h2>Ekip</h2><p>Dr. Ayşe Yılmaz, 15 yıllık deneyimli ortodontist.</p>\n<!-- TODO: fotoğraflar -->\n</section>\n  <div class="card">');
  check(errs('index.html', filledSection).length === 0, 'A section with real text and a trailing TODO comment is not reported');
  const placeholderText = STYLED_PAGE.replace('<div class="card">', '<section id="sss"><h2>SSS</h2><p>SSS içeriği buraya gelecek. Örneğin sıkça sorulan sorular yer alabilir.</p></section>\n  <div class="card">');
  check(errs('index.html', placeholderText).some((i) => /placeholder/.test(i.message)), 'Visible placeholder text ("SSS içeriği buraya gelecek") is reported (seen in the in-app test)');
  check(errs('index.html', STYLED_PAGE.replace('<button id="b">', '<input placeholder="Adınızı buraya yazın"><button id="b">')).length === 0, 'Input placeholder attributes are not treated as placeholder content');
  check(strictFormatError('package.json', '{"scripts": {" " "start": "x"}}') !== null, 'Corrupted package.json is refused before writing');
  check(strictFormatError('package.json', '{"name": "a"}') === null && strictFormatError('app.js', '{') === null, 'Strict pre-write check only applies to JSON');
  const lost = jsonKeyLoss('package.json', '{"name":"a","version":"1","scripts":{"test":"t","build":"b"}}', '{"scripts":{"start":"s","build":"b"}}');
  check(lost.join(',') === 'name,version,scripts.test', 'Keys dropped by a config rewrite are reported', lost);
  const pkgBefore = '{\n    "name": "hello",\n    "version": "0.1.0",\n    "scripts": {\n        "test": "echo ok"\n    }\n}\n';
  const mergedPkg = mergeJsonPreservingKeys('package.json', pkgBefore, '{"scripts": {"start": "node src/index.js"}}');
  const mergedObj = mergedPkg ? JSON.parse(mergedPkg.content) : null;
  check(
    !!mergedPkg && mergedObj.name === 'hello' && mergedObj.scripts.test === 'echo ok' && mergedObj.scripts.start === 'node src/index.js' && mergedPkg.content.includes('\n    "name"') && mergedPkg.content.endsWith('}\n'),
    'A lossy package.json rewrite is merged additively (keys kept, 4-space indent and final newline preserved)',
    mergedPkg
  );
  check(mergeJsonPreservingKeys('tsconfig.json', '{ /* c */ "a": 1 }', '{"b": 2}') === null, 'JSONC files are never auto-merged (comments would be lost)');
  check(mergeJsonPreservingKeys('data.json', '[1,2]', '[3]') === null, 'Top-level arrays are not merged');
  const lostDefs = definitionLoss('app.py', 'import os\n\ndef load():\n    pass\n\nclass Store:\n    pass\n\ndef save():\n    pass\n', 'def load():\n    return 1\n');
  check(lostDefs.join(',') === 'Store,save', 'Python functions/classes dropped by a rewrite are reported', lostDefs);
  const lostJs = definitionLoss('src/a.ts', 'export function a() {}\nexport const b = 1;\nclass C {}\n', 'export function a() { return 2; }\n');
  check(lostJs.join(',') === 'b,C', 'JS/TS definitions dropped by a rewrite are reported', lostJs);
  check(
    detectDestructiveRewrite('index.html', STYLED_PAGE, '<script>\n  validate();\n</script>') !== null,
    'Replacing a full page with a <script> fragment is flagged as destructive'
  );
  const bigPy = Array.from({ length: 30 }, (_, i) => `def f${i}():\n    return ${i}\n`).join('\n');
  check(detectDestructiveRewrite('app.py', bigPy, 'def f0():\n    return 0\n') !== null, 'Replacing a 30-function module with one function is flagged');
  check(detectDestructiveRewrite('index.html', STYLED_PAGE, STYLED_PAGE.replace('Merhaba', 'Selam')) === null, 'A normal full rewrite is not flagged');
  // "Do no harm": the in-app qwen2.5-coder run replaced 9-line windows, lost the <script> line and
  // then patched the damage for 30 steps. Such an edit is now refused before it is applied.
  // Lines 13-15 are the card, "<script>" and the first script line; the model re-typed the window without "<script>".
  const scriptLost = applyLineRangeEdit(STYLED_PAGE, 13, 15, '  <div class="card"><h1>Merhaba</h1><button id="b">Tıkla</button></div>\n    document.getElementById("b").addEventListener("click", () => {');
  check(
    scriptLost.success && damageFromChange('index.html', STYLED_PAGE, scriptLost.newContent).some((i) => /<script>/.test(i.message)),
    'An edit that drops the <script> line of a working page is refused (would put the JavaScript outside <script>)'
  );
  check(damageFromChange('index.html', STYLED_PAGE, STYLED_PAGE.replace('Merhaba', 'Selam')).length === 0, 'A harmless edit of a working page is allowed');
  const brokenOnce = STYLED_PAGE.replace('</style>', '');
  check(damageFromChange('index.html', brokenOnce, STYLED_PAGE).length === 0, 'An edit that repairs a broken page is allowed');
  check(
    damageFromChange('index.html', brokenOnce, brokenOnce.replace('  <script>\n', '')).length > 0,
    'An edit that makes an already broken page worse is refused'
  );
  check(damageFromChange('app.py', 'def f():\n    return 1\n', 'def f():\nreturn 1\n').length > 0, 'Breaking the indentation of working Python is refused');
  check(damageFromChange('notes.txt', 'a', 'b').length === 0, 'Files without checks are never refused');

  section('5b. Goal decomposition');
  const coffee = decomposeGoalIntoSubtasks('Bir kahve dükkanı için tek sayfalık modern bir web sitesi oluştur: menü (en az 6 ürün, fiyatlarıyla), hakkımızda ve iletişim bölümleri olsun. Responsive olsun ve iletişim formu JavaScript ile doğrulansın.');
  check(coffee.length === 1, 'A single detailed request stays one task (no split at "ürün," or inside parentheses)', coffee.map((t) => t.description));
  const navGoal = decomposeGoalIntoSubtasks('Home About Services Contact\n\nGet these working. You can change the page content using JavaScript.');
  check(navGoal.length === 1, 'Lines and sentences of one request are not split into tasks ("Home About Services Contact" + "Get these working", phi4 in-app report)', navGoal.map((t) => t.description));
  check(
    decomposeGoalIntoSubtasks('alışveriş sitesi oluştur\nistediğim özellikler\nsepete ekle butonu\ndetaylı ürün açıklamaları (10 tane süt ürünü)').length === 1,
    'A request written over several lines stays one task (its lines are not separate tasks)'
  );
  check(decomposeGoalIntoSubtasks('README dosyasını güncelle, testleri çalıştır ve commit et').length === 1, 'Commas alone never split a request');
  const seq = decomposeGoalIntoSubtasks('Siteyi oluştur. Sonra README dosyasını yaz');
  check(seq.length === 2 && seq[1].description === 'README dosyasını yaz', 'Explicit sequencing ("… . Sonra …") splits a request', seq.map((t) => t.description));
  const lastly = decomposeGoalIntoSubtasks('README dosyasını güncelle, testleri çalıştır ve en son commit et');
  check(lastly.length === 2 && lastly[1].description === 'commit et', '"ve en son" marks a separate final step', lastly.map((t) => t.description));
  check(decomposeGoalIntoSubtasks('Formu oluştur, sonra bunu test et').length === 1, 'A step that points back ("bunu") stays with the previous one');
  check(decomposeGoalIntoSubtasks('Bildirim 5 saniye sonra kapansın').length === 1, '"5 saniye sonra" inside a clause is not a sequencing word');
  const listed = decomposeGoalIntoSubtasks('Şunları yap:\n1. footer ekle\n2. başlıkları mavi yap');
  check(listed.length === 2 && listed[0].description === 'footer ekle', 'A numbered list becomes the checklist (the lead-in line is not an item)', listed.map((t) => t.description));
  check(decomposeGoalIntoSubtasks('1) footer ekle 2) başlıkları mavi yap').length === 2, 'A one-line numbered list is split');
  check(decomposeGoalIntoSubtasks('- sepete ekle butonu\n- ürün açıklamaları').length === 2, 'A bulleted list becomes the checklist');
  check(decomposeGoalIntoSubtasks('bu fonksiyonu hızlandırmak için, önbellek kullan').length === 1, '"için," is not treated as an instruction boundary');
  const todo = decomposeGoalIntoSubtasks('Python ile komut satırından çalışan bir yapılacaklar listesi (todo) uygulaması yaz: ekle, listele, tamamla ve sil komutları olsun; veriler todos.json dosyasında saklansın.');
  check(todo.length === 1, 'A requirement after ";" stays part of the same task', todo.map((t) => t.description));

  // =====================================================================
  section('6. Task contracts & validation');
  // =====================================================================
  check(TaskCompiler.compile('src/utils.ts içindeki formatPrice hatasını düzelt').length === 0, 'Bug fix in an existing project gets no file-name contract (no forced src/index.js)');
  check(TaskCompiler.compile('python ile hesap makinesi yaz').length === 0, 'Python task gets no forced main.py contract');
  const followUp = TaskCompiler.compile('Sitede Script ve CSS Etiketleri Eksik Kalmış', { projectFiles: ['index.html'] });
  check(
    followUp.length === 1 &&
      followUp[0].criteria.some((c) => c.type === 'contains_style') &&
      followUp[0].criteria.some((c) => c.type === 'contains_script'),
    'Follow-up "script ve CSS eksik" on an existing page creates style + script checks'
  );
  const newSite = TaskCompiler.compile('berber için modern bir web sitesi oluştur');
  check(newSite.length === 1 && newSite[0].criteria.some((c) => c.type === 'contains_style'), 'New website always requires real CSS');
  check(!TaskCompiler.compile('stil olmasın, basit bir html sayfası oluştur')[0].criteria.some((c) => c.type === 'contains_style'), '"stil olmasın" disables the style requirement');
  check(newSite[0].criteria.some((c) => c.type === 'viewport_meta'), 'New pages must declare the viewport meta tag (responsive on phones)');
  const noViewport = await TaskValidator.validate(newSite[0], async (p) => (p === 'index.html' ? STYLED_PAGE.replace(/<meta name="viewport"[^>]*>/, '') : null));
  check(!noViewport.passed && noViewport.missingEvidence.some((m) => m.includes('viewport')), 'A page without the viewport meta tag is reported');
  const merged = TaskCompiler.mergeDirective(TaskCompiler.compile('basit bir web sayfası oluştur, stil olmasın'), 'şimdi css ile stil ekle', { projectFiles: ['index.html'] });
  check(merged[0].criteria.some((c) => c.type === 'contains_style'), 'Live steering "stil ekle" adds the style check to the running contract');

  const files: Record<string, string> = {
    'index.html': STYLED_PAGE.replace(/<style>[\s\S]*?<\/style>/, '<link rel="stylesheet" href="css/site.css">').replace(
      /<script>[\s\S]*?<\/script>/,
      '<script src="js/app.js"></script>'
    ),
    'css/site.css': '.card { color: red; }',
    'js/app.js': 'console.log("ready to go");',
  };
  const provider = async (p: string) => (p in files ? files[p] : null);
  const modularContract = TaskCompiler.compile('modüler dosyalarla stil ve javascript içeren bir web sitesi oluştur');
  let report = await TaskValidator.validate(modularContract[0], provider);
  check(report.passed, 'Modular page with existing linked CSS/JS passes (external files are resolved)', report.missingEvidence);
  delete files['js/app.js'];
  report = await TaskValidator.validate(modularContract[0], provider);
  check(!report.passed && report.missingEvidence.some((m) => m.includes('js/app.js')), 'Linking a JS file that was never created is reported by name');
  const inlineContract = TaskCompiler.compile('tek dosya olacak şekilde stil ve script içeren web sitesi oluştur');
  report = await TaskValidator.validate(inlineContract[0], async (p) => (p === 'index.html' ? STYLED_PAGE : null));
  check(report.passed, 'Single-file page with inline style/script passes inline-only checks', report.missingEvidence);
  report = await TaskValidator.validate(inlineContract[0], async (p) =>
    p === 'index.html' ? STYLED_PAGE.replace(/<script>[\s\S]*?<\/script>/, '<script> <h1>Merhaba Dünya!</h1></script>') : null
  );
  check(!report.passed && report.missingEvidence.some((m) => m.includes('HTML işaretlemesi')), 'A <script> that only contains HTML does not satisfy the JavaScript requirement');
  report = await TaskValidator.validate(inlineContract[0], async (p) => (p === 'index.html' ? escapedPage : null));
  check(!report.passed && report.missingEvidence.some((m) => m.includes('kaçış')), 'Escaped (corrupted) page fails validation with an explicit message');

  // Menu links ("Home About Services Contact — get these working", phi4 / qwen2.5-coder in-app report)
  const navPage = (links: string, extra = '') =>
    `<!DOCTYPE html>\n<html>\n<head><title>x</title></head>\n<body>\n<header>\n<nav>\n${links}\n</nav>\n</header>\n<section id="home">Home</section>\n<section id="about">About</section>\n${extra}\n</body>\n</html>\n`;
  const deadNav = navPage('<a href="#">Home</a>\n<a href="#">About</a>\n<a href="#">Services</a>\n<a href="#">Contact</a>');
  const menu = extractMenuLinks(deadNav);
  check(menu.length === 4 && menu[1].text === 'About' && menu[1].line === 8, 'Menu links are read from <nav> with their line numbers', menu);
  const noFiles = async () => null;
  check((await deadMenuLinks('index.html', deadNav, noFiles)).length === 4, 'href="#" menu links are reported as leading nowhere');
  const anchored = navPage('<a href="#home">Home</a>\n<a href="#about">About</a>\n<a href="#missing">Services</a>\n<a href="contact.html">Contact</a>');
  const anchoredDead = await deadMenuLinks('index.html', anchored, async (p) => (p === 'contact.html' ? '<html></html>' : null));
  check(anchoredDead.length === 1 && /#missing/.test(anchoredDead[0]), 'Links to existing ids and files work; a link to a missing id is reported', anchoredDead);
  const routed = navPage('<a href="#">Home</a>\n<a href="#">About</a>', "<script>document.querySelectorAll('nav a').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); show(a.textContent); }));</script>");
  check((await deadMenuLinks('index.html', routed, noFiles)).length === 0, 'Menu links handled by a JavaScript click router count as working');
  check((await deadMenuLinks('index.html', navPage('<a href="https://example.com">Blog</a>\n<a href="mailto:a@b.c">Mail</a>'), noFiles)).length === 0, 'External and mailto links count as working');
  const navContracts = TaskCompiler.compile('Home About Services Contact\n\nGet these working. You can change the page content using JavaScript.', {
    projectFiles: ['index.html'],
    menuTexts: ['Home', 'About', 'Services', 'Contact'],
  });
  check(navContracts.length === 1 && navContracts[0].criteria.some((c) => c.type === 'links_work'), 'Naming the menu links in a request adds the "links work" acceptance check');
  report = await TaskValidator.validate(navContracts[0], async (p) => (p === 'index.html' ? deadNav : null));
  check(!report.passed && report.missingEvidence.some((m) => /"Services" \(satır 9\)/.test(m)), 'The links check names every dead link with its line', report.missingEvidence);
  check(
    TaskCompiler.compile('navbar linkleri çalışsın', { projectFiles: ['index.html'] })[0]?.criteria.some((c) => c.type === 'links_work'),
    '"navbar linkleri çalışsın" adds the links check'
  );
  check(TaskCompiler.compile('menüye 2 yeni ürün ekle', { projectFiles: ['index.html'], menuTexts: ['Menü', 'İletişim'] }).length === 0, 'A restaurant "menü" request does not add a links check');
  check(TaskCompiler.compile('navbar linklerini kaldır', { projectFiles: ['index.html'] }).length === 0, 'Removing links does not require working links');
  check(mentionsPhrase('Home About Services', 'Home') && !mentionsPhrase('Homepage tasarımı', 'Home') && mentionsPhrase('İletişim sayfası', 'iletişim'), 'Menu texts are matched as whole words (Unicode, case-insensitive)');
  const unlinkedPage = STYLED_PAGE.replace(/<script>[\s\S]*?<\/script>/, '');
  const unlinkedFiles: Record<string, string> = { 'index.html': unlinkedPage, 'index.js': "document.getElementById('b').addEventListener('click', () => {});" };
  report = await TaskValidator.validate(modularContract[0], async (p) => unlinkedFiles[p] ?? null);
  const bodyLine = unlinkedPage.slice(0, unlinkedPage.lastIndexOf('</body>')).split('\n').length;
  check(
    !report.passed && report.missingEvidence.some((m) => m.includes('index.js') && m.includes('<script src="index.js"></script>') && m.includes(`satır ${bodyLine}`)),
    'A script file that exists but is not linked is named with the exact tag and line to add (seen with gemma2:2b in E2E)',
    report.missingEvidence
  );
  // "Add a <script> block" made qwen2.5-coder:7b (in the app) append a new empty block on every step: 16 of them.
  const emptyScripts = STYLED_PAGE.replace(
    /<script>[\s\S]*?<\/script>/,
    '<script>\n    // JavaScript kodu buraya gelecek\n  </script>\n  <script>\n    // JavaScript kodu buraya gelecek\n  </script>'
  );
  report = await TaskValidator.validate(inlineContract[0], async (p) => (p === 'index.html' ? emptyScripts : null));
  const firstScriptLine = emptyScripts.slice(0, emptyScripts.indexOf('<script>')).split('\n').length;
  check(
    !report.passed &&
      report.missingEvidence.some((m) => m.includes(`(satır ${firstScriptLine}) boş`) && m.includes('Yeni <script> bloğu eklemeyin') && m.includes(`(satır ${firstScriptLine + 3})`)),
    'A <script> holding only a comment is named by line: write the code inside it, add no new block, remove the extra empty ones',
    report.missingEvidence
  );
  const placeholderScript = checkFileSanity('index.html', emptyScripts);
  check(
    placeholderScript.some((i) => i.severity === 'error' && /placeholder/.test(i.message) && /buraya gelecek/.test(i.message)),
    'File check: a <script> block holding only a placeholder comment is an error',
    placeholderScript
  );
  check(
    !checkFileSanity('index.html', STYLED_PAGE.replace('<script>', '<script>\n    // TODO: sayacı buraya ekle')).some((i) => /placeholder/.test(i.message)),
    'File check: a leftover TODO comment above real code is not a placeholder'
  );
  check(
    copiedLinesAdded('<a>\n  <b>\n', '<a>\n<b>\n\n<b>\n<a>\n') === 2 && copiedLinesAdded('<a>\n', '<a>\n<c>\n') === 0 && copiedLinesAdded('<a>\n<b>\n', '<a>\n') === 0,
    'copiedLinesAdded: only lines the file already had count as copies; a new or a removed line does not'
  );
  const pyFile = 'import sys\n\n\ndef add_options(parser):\n    pass\n\n\nclass Tool:\n    def run(self):\n        pass\n';
  check(
    alignReplacementIndent(pyFile, 4, 5, "    def add_options(parser):\n        parser.add_argument('--kalip')") === "def add_options(parser):\n    parser.add_argument('--kalip')" &&
      alignReplacementIndent(pyFile, 10, 10, 'return 1') === '        return 1' &&
      alignReplacementIndent(pyFile, 10, 10, '        return 1') === null &&
      alignReplacementIndent(pyFile, 4, 5, '    def add_options(parser):\nx = 1') === null,
    'alignReplacementIndent: a block is shifted to the indentation of the lines it replaces, only as a whole',
    alignReplacementIndent(pyFile, 4, 5, "    def add_options(parser):\n        parser.add_argument('--kalip')")
  );

  // =====================================================================
  section('7. Model runtime profile');
  // =====================================================================
  check(parseParameterSize('7.6B') === 7.6 && parseParameterSize('567M') === 0.567, 'Parameter sizes are parsed from Ollama details');
  check(parameterSizeFromName('qwen3:30b-a3b') === 30 && parameterSizeFromName('gemma2:2b') === 2 && parameterSizeFromName('smollm2:135m') === 0.135, 'Parameter sizes are parsed from tags');
  check(!isSmallLanguageModel('gemma3:12b') && !isSmallLanguageModel('qwen2.5-coder:32b') && !isSmallLanguageModel('qwen2.5:72b'), '12b / 32b / 72b models are no longer misclassified as small');
  check(isSmallLanguageModel('qwen2.5-coder:1.5b') && isSmallLanguageModel('llama3.2:3b'), 'Genuinely small models are still detected');

  const cpuHardware = { cpu: { model: 'Ryzen 5 7530U', cores: 6, logicalProcessors: 12 }, ram: { totalBytes: 0, availableBytes: 0, totalGb: 14.8, availableGb: 6 } };
  check(defaultContextForHardware('auto', cpuHardware) === 12288, 'Auto context on a 15 GB CPU-only laptop is 12288 tokens');
  check(resolveContextLength({ profile: 'auto', hardware: cpuHardware, nativeContext: 8192 }) === 8192, 'Context is capped by the model limit (gemma2: 8192)');
  check(resolveContextLength({ configured: 2048, nativeContext: 32768 }) === 4096, 'Context never drops below 4096 unless the model is smaller');
  const qwen3 = buildRuntimeInfo('qwen3:8b', { capabilities: ['completion', 'tools', 'thinking'], details: { family: 'qwen3', parameter_size: '8.2B' }, model_info: { 'qwen3.context_length': 40960 } });
  const prof = resolveRequestProfile({ info: qwen3, agentOpt: { maxTokens: 8192, hardwareProfile: 'auto', contextLength: 0, agentThinking: false }, hardware: cpuHardware });
  check(prof.numCtx === 12288 && prof.numPredict === 6144, 'num_predict is capped at half of the context window', prof);
  check(prof.think === false, 'Thinking models get think:false unless enabled (no hidden multi-minute reasoning)');
  check((prof.sampling.temperature ?? 0) >= 0.5, 'qwen3 uses its recommended non-greedy temperature', prof.sampling);
  const gemma = buildRuntimeInfo('gemma2:2b', { capabilities: ['completion'], details: { family: 'gemma2', parameter_size: '2.6B' }, model_info: { 'gemma2.context_length': 8192 } });
  check(resolveRequestProfile({ info: gemma, agentOpt: {}, hardware: cpuHardware }).think === undefined, 'Models without thinking support never receive the think parameter');
  check(gemma.isSmall && !qwen3.isSmall, 'Small-model flag uses the real parameter count');
  check((buildAgentSamplingOptions(gemma, 1).temperature ?? 0) > (buildAgentSamplingOptions(gemma, 0).temperature ?? 0), 'Retry after a repetition loop raises temperature');

  // =====================================================================
  section('8. Prompt & schema');
  // =====================================================================
  const toolset: AgentToolset = { web: false, git: false, ask: false, commands: true, checklist: false };
  const promptA = buildAgentSystemPrompt({ securityProfile: 'autonomous', toolset, webSynthesisStrategy: 'auto', modificationStrategy: 'smart_injection', compact: false });
  const promptB = buildAgentSystemPrompt({ securityProfile: 'autonomous', toolset, webSynthesisStrategy: 'auto', modificationStrategy: 'smart_injection', compact: false });
  check(promptA === promptB, 'System prompt is byte-identical between steps (KV cache reuse)');
  check(!/hedef_klasor|olusturulacak_dosya|<h1>Eski<\/h1>|başlık güncellendi/.test(promptA), 'System prompt contains no copyable placeholder examples');
  check(promptA.length < 5000, `System prompt is compact (${promptA.length} chars)`);
  check(!promptA.includes('web_search') && !promptA.includes('ask_user'), 'Disabled tools are not advertised');
  check(buildSystemPrompt(false, 'strict', true).includes('web_search') && buildCompactSystemPrompt(false, 'strict', false).length < promptA.length + 200, 'Compatibility prompt builders still work');
  const schema = buildActionSchema({ ...toolset, web: true, ask: true, checklist: true }, false);
  const actions = schema.anyOf.map((v: any) => v.properties.action.const);
  check(actions.includes('web_search') && actions.includes('ask_user') && actions.includes('finish'), 'Schema variants follow the enabled tools', actions);
  const rlVariant = schema.anyOf.find((v: any) => v.properties.action.const === 'replace_lines');
  check(!!rlVariant && rlVariant.required.join(',') === 'thought,action,path,start_line,end_line,content', 'replace_lines variant requires the line range and content');
  const write = schema.anyOf.find((v: any) => v.properties.action.const === 'write_file');
  check(write.required.join(',') === 'thought,action,path,content' && !!write.properties.checklist_done, 'write_file variant requires path + content and offers checklist_done');
  check(write.properties.content.minLength === 1 && write.properties.path.minLength === 1, 'write_file path/content cannot be empty (grammar-enforced; gemma2:2b sent empty pages in E2E)');
  const editVariant = schema.anyOf.find((v: any) => v.properties.action.const === 'edit_file');
  check(editVariant.properties.find.minLength === 1 && !editVariant.properties.replace.minLength, 'edit_file needs a non-empty "find" but may replace it with nothing');
  check(buildActionSchema(toolset, true).anyOf.length < buildActionSchema(toolset, false).anyOf.length, 'Small models get fewer tools');

  // =====================================================================
  section('9. Context compaction & state line');
  // =====================================================================
  const convo: ConversationEntry[] = [{ role: 'user', content: 'TASK', meta: { kind: 'task' } }];
  for (let i = 0; i < 8; i++) {
    const raw = { thought: 't', action: 'write_file', path: `f${i}.js`, content: 'x'.repeat(2000) };
    convo.push({ role: 'assistant', content: JSON.stringify(raw), meta: { kind: 'action', raw } });
    convo.push({ role: 'user', content: 'y'.repeat(1500), meta: { kind: 'observation', summary: `[short ${i}]` } });
  }
  const compacted = compressConversationContext(convo, 2);
  check(compacted[0].content === 'TASK', 'The task message is never compacted');
  check(
    compacted[2].content === '[short 0]' && compacted[1].content.startsWith('(earlier step: write_file "f0.js"') && !compacted[1].content.includes('{'),
    'Old observations use their summary and old actions become prose that cannot be copied as file content',
    compacted[1].content
  );
  check(compacted[compacted.length - 1].content.length === 1500, 'Recent exchanges stay verbatim');
  check(compactActionForHistory({ action: 'write_file', content: 'short' }).includes('short'), 'Small action payloads are kept as-is');

  const ledger: AgentMemoryLedger = {
    goal: 'g', projectTree: [], knownFiles: {}, appliedChanges: ['Yeni dosya: "index.html"'], userDecisions: [], discoveredFacts: [],
    unavailableBinaries: [], invalidPaths: [], milestones: [],
    subtasks: [{ id: '1', description: 'a', status: 'completed' }, { id: '2', description: 'b', status: 'in_progress' }], currentPhase: 'modification',
  };
  const line = formatLedgerBlock(ledger, { step: 3, maxSteps: 35, acceptance: { passed: 4, total: 5 } });
  check(line.includes('index.html') && line.includes('checklist 1/2') && line.includes('4/5') && line.length < 300, 'State line is short and complete', line);

  // =====================================================================
  section('10. Chat web search intent & refusal fallback');
  // =====================================================================
  check(detectWebSearchIntent('şebnem ferah kimdir'), '"şebnem ferah kimdir" triggers a web search');
  check(detectWebSearchIntent('Who is Linus Torvalds?'), '"Who is ..." triggers a web search');
  check(detectWebSearchIntent('Tarkan hakkında bilgi ver'), '"... hakkında bilgi ver" triggers a web search');
  check(!detectWebSearchIntent('python ile fibonacci hesaplayan fonksiyon yaz'), 'Coding tasks do not trigger a web search');
  check(!detectWebSearchIntent('merhaba nasılsın iyi misin?'), 'Small talk does not trigger a web search');
  check(!detectWebSearchIntent('bu fonksiyondaki hata kimden kaynaklanıyor'), 'Programming questions are excluded from entity lookups');
  check(
    detectKnowledgeRefusal('Üzgünüm, ancak bu bilgiye erişimim sınırlı. Şebnem Ferah hakkında daha fazla bilgi edinmek için internette arama yapabilirsiniz veya uzman kaynaklarından yardım alabilirsiniz.'),
    'The exact refusal from the bug report is detected'
  );
  check(detectKnowledgeRefusal("I'm sorry, I don't have access to real-time information. Please check online."), 'English refusal is detected');
  check(!detectKnowledgeRefusal('Şebnem Ferah, 1972 doğumlu Türk rock müzisyenidir.'), 'A real answer is not treated as a refusal');
  check(!detectKnowledgeRefusal('x'.repeat(1200) + ' bilmiyorum'), 'Long answers are never re-run');
  check(extractSearchQuery('şebnem ferah kimdir?') === 'şebnem ferah kimdir', 'Search query keeps the name and the question word');

  console.log(`\n===========================================`);
  if (failures.length > 0) {
    console.error(`❌ ${failures.length} FAILED, ${passed} passed`);
    for (const f of failures) console.error(`   - ${f}`);
    process.exit(1);
  }
  console.log(`🎉 ALL ${passed} AGENT RELIABILITY TESTS PASSED`);
  console.log(`===========================================`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
