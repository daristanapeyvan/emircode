/**
 * FileSanity.ts
 * Dependency-free structural checks that run after every agent write, for any file type.
 *
 * They target the failure modes small local models produce most often, independent of the
 * language: files cut off when the output limit is reached, unbalanced brackets, text written
 * with JSON escapes (literal \n and \"), a markdown fence around the whole file, invalid JSON,
 * tabs in YAML and unclosed HTML sections. Findings are fed back to the model as the result of
 * its write, so it can repair them like a developer reading compiler errors.
 */
import { looksJsonEscaped } from './TaskValidator';

export interface SanityIssue {
  severity: 'error' | 'warning';
  message: string;
}

type Family = 'json' | 'jsonc' | 'clike' | 'css' | 'python' | 'html' | 'yaml' | 'other';

const JS_EXT = new Set(['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts']);
const CLIKE_EXT = new Set([
  ...JS_EXT,
  'java', 'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'cs', 'go', 'rs', 'php', 'kt', 'kts',
  'swift', 'dart', 'scala', 'groovy',
]);
const CSS_EXT = new Set(['css', 'scss', 'less']);
const PY_EXT = new Set(['py', 'pyw', 'pyi']);
const HTML_EXT = new Set(['html', 'htm', 'xhtml', 'vue', 'svelte']);
const YAML_EXT = new Set(['yml', 'yaml']);
const JSONC_FILE = /(?:^|\/)(?:tsconfig[^/]*|jsconfig[^/]*|\.eslintrc|settings|launch|tasks|extensions|devcontainer|\.babelrc)\.json$/i;

function extOf(path: string): string {
  const base = path.replace(/\\/g, '/').split('/').pop() || '';
  const idx = base.lastIndexOf('.');
  return idx > 0 ? base.slice(idx + 1).toLowerCase() : '';
}

function familyOf(path: string): Family {
  const ext = extOf(path);
  if (ext === 'json') return JSONC_FILE.test(path.replace(/\\/g, '/')) ? 'jsonc' : 'json';
  if (ext === 'jsonc') return 'jsonc';
  if (CLIKE_EXT.has(ext)) return 'clike';
  if (CSS_EXT.has(ext)) return 'css';
  if (PY_EXT.has(ext)) return 'python';
  if (HTML_EXT.has(ext)) return 'html';
  if (YAML_EXT.has(ext)) return 'yaml';
  return 'other';
}

interface BracketReport {
  unclosed: Array<{ ch: string; line: number }>;
  unexpected: Array<{ ch: string; line: number }>;
  unterminated: Array<{ what: string; line: number }>;
}

const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
const REGEX_PRECEDERS = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
const REGEX_KEYWORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await']);

interface ClikeOptions {
  jsRegex: boolean;
  templates: boolean;
  backtickRaw: boolean;
  hashComments: boolean;
  rustLifetimes: boolean;
  lineComments: boolean;
  jsxText?: boolean;
}

function countNewlines(text: string, from: number, to: number): number {
  let n = 0;
  for (let i = from; i < to; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** Bracket balance for C-family / JS / CSS sources, aware of strings, comments, templates and regex literals. */
function scanClike(src: string, opts: ClikeOptions, lineOffset = 0): BracketReport {
  const report: BracketReport = { unclosed: [], unexpected: [], unterminated: [] };
  const stack: Array<{ ch: string; line: number }> = [];
  const modes: Array<'code' | 'template'> = ['code'];
  let line = 1 + lineOffset;
  let lastSignificant = '';
  let lastWord = '';
  let word = '';
  const n = src.length;
  let i = 0;

  const flushWord = () => {
    if (word) {
      lastWord = word;
      word = '';
    }
  };

  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];
    const mode = modes[modes.length - 1];

    if (mode === 'template') {
      if (ch === '\\') {
        if (src[i + 1] === '\n') line++;
        i += 2;
        continue;
      }
      if (ch === '\n') line++;
      if (ch === '`') {
        modes.pop();
        lastSignificant = 'a';
        i++;
        continue;
      }
      if (ch === '$' && next === '{') {
        stack.push({ ch: '${', line });
        modes.push('code');
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    if (ch === '\n') {
      flushWord();
      line++;
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      flushWord();
      i++;
      continue;
    }

    if (opts.lineComments && ch === '/' && next === '/') {
      const end = src.indexOf('\n', i);
      i = end === -1 ? n : end;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end === -1) {
        report.unterminated.push({ what: 'block comment /* */', line });
        break;
      }
      line += countNewlines(src, i, end);
      i = end + 2;
      continue;
    }
    if (opts.hashComments && ch === '#') {
      const end = src.indexOf('\n', i);
      i = end === -1 ? n : end;
      continue;
    }

    if (ch === '"' && src[i + 1] === '"' && src[i + 2] === '"') {
      // Text blocks / raw strings: Kotlin, Swift, Scala, Java 15+, C# 11
      const end = src.indexOf('"""', i + 3);
      if (end === -1) {
        report.unterminated.push({ what: 'triple-quoted string """', line });
        break;
      }
      line += countNewlines(src, i, end);
      lastSignificant = 'a';
      i = end + 3;
      continue;
    }

    if (ch === '"' || ch === "'") {
      if (ch === "'" && opts.rustLifetimes) {
        // 'a' / '\n' are char literals; 'static or 'a (no closing quote) are lifetimes
        const isChar = src[i + 1] === '\\' || src[i + 2] === "'";
        if (!isChar) {
          i++;
          continue;
        }
      }
      let j = i + 1;
      let closed = false;
      while (j < n) {
        const c = src[j];
        if (c === '\\') {
          j += 2;
          continue;
        }
        if (c === ch) {
          closed = true;
          break;
        }
        if (c === '\n') break;
        j++;
      }
      if (!closed) {
        // JSX text such as <p>Don't</p> legitimately contains lone apostrophes.
        if (!(opts.jsxText && ch === "'")) {
          report.unterminated.push({ what: `string starting with ${ch}`, line });
        }
        i = j + 1;
        if (src[j] === '\n') line++;
        continue;
      }
      flushWord();
      lastSignificant = 'a';
      i = j + 1;
      continue;
    }

    if (ch === '`' && (opts.templates || opts.backtickRaw)) {
      if (opts.templates) {
        modes.push('template');
        i++;
        continue;
      }
      const end = src.indexOf('`', i + 1);
      if (end === -1) {
        report.unterminated.push({ what: 'backtick string', line });
        break;
      }
      line += countNewlines(src, i, end);
      lastSignificant = 'a';
      i = end + 1;
      continue;
    }

    if (opts.jsRegex && ch === '/') {
      flushWord();
      const regexAllowed = REGEX_PRECEDERS.has(lastSignificant) || REGEX_KEYWORDS.has(lastWord);
      if (regexAllowed) {
        let j = i + 1;
        let inClass = false;
        let ok = false;
        while (j < n) {
          const c = src[j];
          if (c === '\\') {
            j += 2;
            continue;
          }
          if (c === '\n') break;
          if (c === '[') inClass = true;
          else if (c === ']') inClass = false;
          else if (c === '/' && !inClass) {
            ok = true;
            break;
          }
          j++;
        }
        if (ok) {
          j++;
          while (j < n && /[a-z]/i.test(src[j])) j++;
          lastSignificant = 'a';
          i = j;
          continue;
        }
      }
    }

    if (ch === '(' || ch === '[' || ch === '{') {
      flushWord();
      stack.push({ ch, line });
    } else if (ch === ')' || ch === ']' || ch === '}') {
      flushWord();
      const top = stack[stack.length - 1];
      if (ch === '}' && top && top.ch === '${') {
        stack.pop();
        modes.pop(); // back into the template literal
        i++;
        continue;
      }
      if (top && top.ch === CLOSERS[ch]) {
        stack.pop();
      } else {
        report.unexpected.push({ ch, line });
        // Recover: drop a mismatched opener so one mistake does not cascade.
        if (top && top.ch !== '${') stack.pop();
      }
    }

    if (/[A-Za-z0-9_$]/.test(ch)) {
      word += ch;
      lastSignificant = 'a';
    } else {
      flushWord();
      lastSignificant = ch;
    }
    i++;
  }

  if (modes[modes.length - 1] === 'template') {
    report.unterminated.push({ what: 'template literal `...`', line });
  }
  for (const open of stack) {
    report.unclosed.push({ ch: open.ch === '${' ? '${' : open.ch, line: open.line });
  }
  return report;
}

interface PyString {
  /** Index just past the closing quote; for an unterminated string the line end (or file end). */
  end: number;
  closed: boolean;
  quote: string;
  triple: boolean;
  /** An f-string that reuses its own quote inside {…}: valid from Python 3.12 on (PEP 701). */
  nestedSameQuote: boolean;
}

/**
 * Reads the string literal starting at `i` (optional r/b/u/f prefixes, triple quotes). f-strings
 * are parsed with their {…} replacement fields, which may contain nested strings — even with the
 * same quote, e.g. f'{todo['task']}' — and nested braces such as f'{x:{width}}'.
 */
function readPyString(src: string, i: number): PyString | null {
  const n = src.length;
  if (i > 0 && /[A-Za-z0-9_]/.test(src[i - 1])) return null;
  let j = i;
  while (j < n && j - i < 2 && /[rRbBuUfFtT]/.test(src[j])) j++;
  const q = src[j];
  if (q !== '"' && q !== "'") return null;
  // f-strings and Python 3.14 t-strings (PEP 750) have {…} replacement fields.
  const isF = /[ft]/i.test(src.slice(i, j));
  const triple = src.substr(j, 3) === q + q + q;
  const close = triple ? q + q + q : q;
  let nestedSameQuote = false;
  let depth = 0;
  let k = j + close.length;
  while (k < n) {
    const c = src[k];
    if (depth === 0) {
      if (c === '\\') {
        // A backslash hides the next character from the tokenizer — except a brace, which
        // still opens a replacement field (fr'\{{' is a backslash plus an escaped brace).
        k += isF && (src[k + 1] === '{' || src[k + 1] === '}') ? 1 : 2;
        continue;
      }
      if (src.startsWith(close, k)) return { end: k + close.length, closed: true, quote: q, triple, nestedSameQuote };
      if (c === '\n' && !triple) return { end: k, closed: false, quote: q, triple, nestedSameQuote };
      if (isF && c === '{') {
        if (src[k + 1] === '{') {
          k += 2;
          continue;
        }
        depth = 1;
      }
      k++;
      continue;
    }
    // Inside a replacement field: an expression with its own brackets and strings.
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else {
      const inner = readPyString(src, k);
      if (inner) {
        if (!inner.closed) return { end: inner.end, closed: false, quote: q, triple, nestedSameQuote };
        if (inner.quote === q) nestedSameQuote = true;
        k = inner.end;
        continue;
      }
    }
    k++;
  }
  return { end: n, closed: false, quote: q, triple, nestedSameQuote };
}

/** Bracket balance for Python, aware of comments, (triple-)quoted strings with prefixes and f-strings. */
function scanPython(source: string): BracketReport & { sameQuoteFString?: number } {
  // CRLF would break backslash-newline continuations inside strings ("...\<CR><LF>").
  const src = source.replace(/\r\n?/g, '\n');
  const report: BracketReport & { sameQuoteFString?: number } = { unclosed: [], unexpected: [], unterminated: [] };
  const stack: Array<{ ch: string; line: number }> = [];
  let line = 1;
  const n = src.length;
  let i = 0;
  while (i < n) {
    const ch = src[i];
    if (ch === '\n') {
      line++;
      i++;
      continue;
    }
    if (ch === '#') {
      const end = src.indexOf('\n', i);
      i = end === -1 ? n : end;
      continue;
    }
    const str = readPyString(src, i);
    if (str) {
      if (!str.closed) {
        report.unterminated.push({ what: str.triple ? `triple-quoted string ${str.quote.repeat(3)}` : `string starting with ${str.quote}`, line });
        if (str.triple) break;
      }
      if (str.nestedSameQuote && report.sameQuoteFString === undefined) report.sameQuoteFString = line;
      line += countNewlines(src, i, str.end);
      i = str.end;
      continue;
    }

    if (ch === '(' || ch === '[' || ch === '{') {
      stack.push({ ch, line });
    } else if (ch === ')' || ch === ']' || ch === '}') {
      const top = stack[stack.length - 1];
      if (top && top.ch === CLOSERS[ch]) stack.pop();
      else {
        report.unexpected.push({ ch, line });
        if (top) stack.pop();
      }
    }
    i++;
  }
  for (const open of stack) report.unclosed.push(open);
  return report;
}

/**
 * Python block structure, following the tokenizer's INDENT/DEDENT rules: a header ending with ":"
 * must be followed by a more indented line, other lines may not indent further, and a dedent must
 * return to an enclosing level. Reports the first problem, like Python does. Only meaningful when
 * strings and brackets are balanced (callers check that first).
 */
function pythonIndentIssue(src: string): SanityIssue | null {
  const text = src.replace(/\r\n?/g, '\n');
  const n = text.length;
  const logical: Array<{ line: number; indent: number; colon: boolean }> = [];
  let current: { line: number; indent: number; colon: boolean } | null = null;
  let i = 0;
  let line = 1;
  let depth = 0;
  let continued = false;
  let last = '';

  while (i < n) {
    // Start of a physical line: a new logical line unless inside brackets or after a backslash.
    if (depth === 0 && !continued) {
      let col = 0;
      let k = i;
      while (k < n && (text[k] === ' ' || text[k] === '\t' || text[k] === '\f')) {
        col = text[k] === '\t' ? col + 8 - (col % 8) : text[k] === '\f' ? 0 : col + 1;
        k++;
      }
      if (k < n && text[k] !== '\n' && text[k] !== '#') {
        current = { line, indent: col, colon: false };
        logical.push(current);
        last = '';
      } else {
        current = null; // blank or comment-only lines do not count
      }
    }
    continued = false;

    while (i < n && text[i] !== '\n') {
      const ch = text[i];
      if (ch === '#') {
        while (i < n && text[i] !== '\n') i++;
        break;
      }
      if (ch === '\\' && text[i + 1] === '\n') {
        continued = true;
        i++;
        break;
      }
      const str = readPyString(text, i);
      if (str) {
        if (!str.closed) return null; // reported by the string scanner
        line += countNewlines(text, i, str.end);
        i = str.end;
        last = str.quote;
        continue;
      }
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
      if (ch !== ' ' && ch !== '\t' && ch !== '\f') last = ch;
      i++;
    }
    if (current && depth === 0 && !continued) current.colon = last === ':';
    if (i < n) {
      i++; // the newline
      line++;
    }
  }

  const lines = text.split('\n');
  const show = (ln: number) => (lines[ln - 1] || '').trim().slice(0, 100);
  const stack = [0];
  let prev: { line: number; indent: number; colon: boolean } | null = null;
  let beforePrev: { line: number; indent: number; colon: boolean } | null = null;
  for (const l of logical) {
    const top = stack[stack.length - 1];
    if (prev?.colon) {
      if (l.indent <= top) {
        return {
          severity: 'error',
          message: `expected an indented block after line ${prev.line} ("${show(prev.line)}"): line ${l.line} ("${show(l.line)}") must be indented more than line ${prev.line} (IndentationError)`,
        };
      }
      stack.push(l.indent);
    } else if (l.indent > top) {
      // Usually the previous line fell out of its block (it lost its indentation) and this
      // line is still at the block's level; point at that line, not only at this one.
      const culprit =
        prev && beforePrev && prev.indent < beforePrev.indent && l.indent <= beforePrev.indent
          ? ` — the cause is probably line ${prev.line} ("${show(prev.line)}"), which lost its indentation: indent line ${prev.line} like the lines around it`
          : ' — only the lines of a block after a header ending with ":" may be indented further';
      return {
        severity: 'error',
        message: `unexpected indent at line ${l.line} ("${show(l.line)}")${culprit} (IndentationError)`,
      };
    } else if (l.indent < top) {
      while (stack.length > 1 && stack[stack.length - 1] > l.indent) stack.pop();
      if (stack[stack.length - 1] !== l.indent) {
        return {
          severity: 'error',
          message: `line ${l.line} ("${show(l.line)}") is indented to a level that matches no enclosing block (IndentationError: unindent does not match any outer indentation level)`,
        };
      }
    }
    beforePrev = prev;
    prev = l;
  }
  if (prev?.colon) {
    return {
      severity: 'error',
      message: `expected an indented block after line ${prev.line} ("${show(prev.line)}") but the file ends there (IndentationError)`,
    };
  }
  return null;
}

function lineText(content: string | undefined, line: number): string {
  if (!content) return '';
  const text = (content.split('\n')[line - 1] || '').trim();
  return text ? ` (line ${line} is: ${text.slice(0, 120)})` : '';
}

function bracketIssues(report: BracketReport, where = '', content?: string, family?: Family): SanityIssue[] {
  const issues: SanityIssue[] = [];
  const prefix = where ? `${where}: ` : '';
  if (report.unterminated.length > 0) {
    const u = report.unterminated[0];
    // Concrete, language-specific advice: 7B models often do not see why a string is wrong.
    const hint = /string/.test(u.what)
      ? family === 'python'
        ? ' — a Python string cannot continue onto the next line: close it on the same line, use \\n, or use triple quotes ("""...""") for multi-line text'
        : ' — close the string on the same line, use \\n, or use a template literal (`...`) for multi-line text'
      : '';
    issues.push({ severity: 'error', message: `${prefix}unterminated ${u.what} starting at line ${u.line}${lineText(content, u.line)}${hint}` });
  }
  if (report.unexpected.length > 0) {
    const first = report.unexpected[0];
    const list = report.unexpected.slice(0, 3).map((u) => `'${u.ch}' at line ${u.line}`).join(', ');
    issues.push({ severity: 'error', message: `${prefix}unexpected closing bracket ${list}${lineText(content, first.line)}` });
  }
  if (report.unclosed.length > 0) {
    const list = report.unclosed.slice(-3).map((u) => `'${u.ch}' opened at line ${u.line}`).join(', ');
    issues.push({
      severity: 'error',
      message: `${prefix}${report.unclosed.length} bracket(s) never closed (${list}) — the file is probably incomplete or cut off`,
    });
  }
  return issues;
}

function positionToLine(text: string, pos: number): number {
  return countNewlines(text, 0, Math.max(0, Math.min(pos, text.length))) + 1;
}

function stripJsonComments(src: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += src[i + 1] ?? '';
        i++;
      } else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const chunk = end === -1 ? src.slice(i) : src.slice(i, end + 2);
      out += chunk.replace(/[^\n]/g, ' ');
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    out += ch;
  }
  return out.replace(/,(\s*[}\]])/g, ' $1');
}

function checkJson(content: string, jsonc: boolean): SanityIssue[] {
  if (!content.trim()) return [{ severity: 'error', message: 'JSON file is empty' }];
  const text = jsonc ? stripJsonComments(content) : content;
  try {
    JSON.parse(text);
    return [];
  } catch (err: any) {
    const msg = String(err?.message || 'invalid JSON');
    const posMatch = msg.match(/position (\d+)/i);
    if (!posMatch) return [{ severity: 'error', message: `invalid JSON: ${msg}` }];
    // Show the offending line: small models fix a JSON error far more reliably when they see it
    // (typically an unescaped quote such as "echo "Error"" or a missing comma).
    const pos = parseInt(posMatch[1], 10);
    const line = positionToLine(text, pos);
    const column = pos - (text.lastIndexOf('\n', pos - 1) + 1) + 1;
    const lineText = (text.split('\n')[line - 1] || '').trim().slice(0, 140);
    const reason = msg.replace(/\s*(?:in JSON\s*)?at position \d+.*$/i, '').trim();
    return [
      {
        severity: 'error',
        message: `invalid JSON at line ${line}, column ${column}: ${reason}. Line ${line} is: ${lineText} — quotes inside strings must be written as \\" and items separated by commas`,
      },
    ];
  }
}

function lastCodeLine(content: string, commentPrefix: RegExp): { text: string; line: number } | null {
  const lines = content.replace(/\s+$/, '').split('\n');
  for (let idx = lines.length - 1; idx >= 0; idx--) {
    const t = lines[idx].trim();
    if (!t || commentPrefix.test(t)) continue;
    return { text: t, line: idx + 1 };
  }
  return null;
}

function truncationWarning(content: string, family: Family): SanityIssue | null {
  const last = lastCodeLine(content, family === 'python' ? /^#/ : /^(\/\/|\/\*|\*)/);
  if (!last) return null;
  const endsOpen =
    family === 'python'
      ? /(?:[,(\[{=+\-*/\\]|\band|\bor|\bnot)$/.test(last.text)
      : /(?:[,(\[{=+\-*/&|?:]|=>)$/.test(last.text) && !/^(?:case\b|default\b)/.test(last.text);
  if (!endsOpen) return null;
  return {
    severity: 'warning',
    message: `the file ends abruptly at line ${last.line} ("${last.text.slice(0, 60)}") — it may be cut off`,
  };
}

/** First <tag> without a closing tag, or first </tag> without an opening one (index into content). */
function unmatchedTag(content: string, tag: 'script' | 'style'): { kind: 'open' | 'close'; index: number } | null {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  const open: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (!m[1]) open.push(m.index);
    else if (open.length === 0) return { kind: 'close', index: m.index };
    else open.pop();
  }
  return open.length > 0 ? { kind: 'open', index: open[0] } : null;
}

/** A line of CSS or JavaScript (or a blank line) rather than HTML markup. */
const isCodeLine = (line: string | undefined) => line !== undefined && !/^\s*<\/?[a-zA-Z!]/.test(line);

function checkHtml(content: string): SanityIssue[] {
  const issues: SanityIssue[] = [];
  const lower = content.toLowerCase();
  const count = (re: RegExp) => (lower.match(re) || []).length;
  const lines = content.split('\n');
  const lineAt = (index: number) => countNewlines(content, 0, index) + 1;
  const htmlClose = lower.lastIndexOf('</html>');

  if (count(/<html[\s>]/g) > 1 || count(/<!doctype/g) > 1) {
    const starts = [...lower.matchAll(/<!doctype|<html[\s>]/g)].map((d) => d.index ?? 0);
    const second = starts.find((s) => s > (starts[0] ?? 0) + 20) ?? starts[1] ?? 0;
    issues.push({ severity: 'error', message: `the file contains more than one HTML document (the second copy starts at line ${lineAt(second)}) — keep one complete page` });
  }
  if (/<html[\s>]/.test(lower) && htmlClose === -1) {
    issues.push({ severity: 'error', message: `missing </html> — the page is incomplete or was cut off (the file ends at line ${lines.length})` });
  }
  if (lower.includes('<body') && !lower.includes('</body>')) {
    issues.push({
      severity: 'error',
      message:
        htmlClose !== -1
          ? `missing </body> — add it on its own line right before </html> (line ${lineAt(htmlClose)})`
          : `missing </body> — add it at the end of the page (after line ${lines.length})`,
    });
  }
  // Report where a <style>/<script> pair is broken, so the model can fix that exact line.
  for (const tag of ['style', 'script'] as const) {
    const bad = unmatchedTag(content, tag);
    if (!bad) continue;
    const at = lineAt(bad.index);
    const what = tag === 'style' ? 'CSS' : 'JavaScript';
    if (bad.kind === 'close') {
      let first = at;
      while (first > 1 && isCodeLine(lines[first - 2])) first--;
      while (first < at && !lines[first - 1].trim()) first++;
      issues.push({
        severity: 'error',
        message:
          first < at
            ? `the ${what} starting at line ${first} is outside a <${tag}> block: its closing </${tag}> is at line ${at} but there is no opening <${tag}> — insert a "<${tag}>" line right before line ${first} (line ${first} itself stays unchanged)`
            : `</${tag}> at line ${at} has no opening <${tag}> — add "<${tag}>" before the ${what} it closes, or remove this line`,
      });
    } else {
      let last = at;
      while (last < lines.length && isCodeLine(lines[last])) last++;
      while (last > at && !lines[last - 1].trim()) last--;
      issues.push({
        severity: 'error',
        message: `the <${tag}> block opened at line ${at} is never closed — add a "</${tag}>" line after line ${last}, the end of the ${what} (line ${last} itself stays unchanged)`,
      });
    }
  }

  // Check inline <script> and <style> bodies with the language scanners.
  const blockRe = /<(script|style)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(content)) !== null) {
    const kind = m[1].toLowerCase();
    const attrs = m[2] || '';
    const body = m[3] || '';
    if (!body.trim()) continue;
    if (kind === 'script') {
      if (/\bsrc\s*=/.test(attrs)) continue;
      const typeMatch = attrs.match(/type\s*=\s*["']([^"']+)["']/i);
      if (typeMatch && !/javascript|module|babel|jsx/i.test(typeMatch[1])) continue;
    }
    const bodyStart = m.index + m[0].indexOf('>') + 1;
    const lineOffset = countNewlines(content, 0, bodyStart);
    if (kind === 'script' && /^\s*<\/?[a-zA-Z!]/.test(body)) {
      issues.push({
        severity: 'error',
        message: `inline <script> at line ${lineOffset + 1} contains HTML markup instead of JavaScript — put markup in <body> and only JavaScript code inside <script>`,
      });
      continue;
    }
    const report =
      kind === 'script'
        ? scanClike(body, { jsRegex: true, templates: true, backtickRaw: false, hashComments: false, rustLifetimes: false, lineComments: true }, lineOffset)
        : scanClike(body, { jsRegex: false, templates: false, backtickRaw: false, hashComments: false, rustLifetimes: false, lineComments: false }, lineOffset);
    issues.push(...bracketIssues(report, kind === 'script' ? 'inline <script>' : 'inline <style>', content, 'clike'));
  }
  return issues;
}

/** True when the block opening at `brace` belongs to if/else/for/while/switch/try/catch/finally/do. */
function isControlFlowBlock(content: string, brace: number): boolean {
  let k = brace - 1;
  while (k >= 0 && /\s/.test(content[k])) k--;
  if (/\b(?:else|try|finally|do|catch)$/.test(content.slice(Math.max(0, k - 9), k + 1))) return true;
  if (content[k] !== ')') return false;
  let depth = 0;
  for (; k >= 0; k--) {
    if (content[k] === ')') depth++;
    else if (content[k] === '(' && --depth === 0) break;
  }
  return /\b(?:if|for|foreach|while|switch|catch|with)\s*$/.test(content.slice(Math.max(0, k - 12), k));
}

/**
 * Sections / bodies that were left empty with a placeholder comment, e.g.
 * `<h2>Ekip</h2><!-- Team content goes here --></section>` or `function f() { // add logic here }`.
 * A leftover comment followed by real content is harmless and not reported.
 */
function emptyPlaceholderIssues(family: Family, content: string): SanityIssue[] {
  const placeholder =
    '(?:[^\\n]{0,60}?\\b(?:goes|go|will\\s+go)\\s+here' +
    '|\\s*(?:add|put|insert|write|implement)\\b[^\\n]{0,50}?\\b(?:here|logic)' +
    '|[^\\n]{0,60}?\\b(?:to\\s+be\\s+added|coming\\s+soon|TODO|TBD)\\b' +
    '|[^\\n]{0,60}?(?:buraya|burada)\\b[^\\n]{0,50}?(?:gelecek|eklenecek|yazılacak|konulacak|eklenir|ekleyin|yazın)' +
    '|[^\\n]{0,60}?\\b(?:eklenecek|yazılacak|doldurulacak)\\b)';
  const found: string[] = [];
  const record = (index: number, text: string) => {
    if (found.length < 5) {
      found.push(`line ${countNewlines(content, 0, index) + 1}: "${text.replace(/\s+/g, ' ').trim().slice(0, 80)}"`);
    }
  };

  if (family === 'html') {
    // A placeholder comment right before a closing tag whose element has no visible content
    // except headings (the comment itself is the "content").
    const re = new RegExp(`<!--${placeholder}[^>]*-->\\s*</([a-zA-Z][\\w-]*)\\s*>`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const tag = m[1].toLowerCase();
      const before = content.slice(0, m.index);
      const openIdx = before.toLowerCase().lastIndexOf(`<${tag}`);
      if (openIdx === -1) continue;
      const openEnd = before.indexOf('>', openIdx);
      const inner = before
        .slice(openEnd + 1)
        .replace(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<[^>]+>/g, '')
        .trim();
      if (inner.length < 20) record(m.index, m[0]);
    }

    // A <script> block that holds nothing but a placeholder comment ("// JavaScript kodu buraya gelecek").
    const scriptRe = new RegExp(`<script(?![^>]*\\bsrc=)[^>]*>\\s*(?://${placeholder}[^\\n]*|/\\*${placeholder}[\\s\\S]*?\\*/)\\s*</script>`, 'gi');
    let s: RegExpExecArray | null;
    while ((s = scriptRe.exec(content)) !== null) record(s.index, s[0]);

    // Visible placeholder text instead of content ("SSS içeriği buraya gelecek", "coming soon").
    // Blanking keeps character offsets so reported line numbers stay correct.
    const blank = (s: string) => s.replace(/[^\n]/g, ' ');
    const visible = content
      .replace(/<script[\s\S]*?<\/script>/gi, blank)
      .replace(/<style[\s\S]*?<\/style>/gi, blank)
      .replace(/<!--[\s\S]*?-->/g, blank)
      .replace(/<[^>]*>/g, blank);
    const textRe = /(?:içeri[ğk]i?\s+buraya\s+(?:gelecek|eklenecek|yazılacak)|buraya\s+(?:gelecek|eklenecek)|\b(?:content|text|description|details)\s+goes\s+here\b|\bcoming\s+soon\b)/gi;
    let t: RegExpExecArray | null;
    while ((t = textRe.exec(visible)) !== null) {
      record(t.index, visible.slice(Math.max(0, t.index - 30), t.index + t[0].length + 10));
    }
  }
  if (family === 'clike' || family === 'css') {
    // The placeholder comment is the only thing inside a function, method or CSS rule body.
    // Control-flow branches such as `catch { // TODO: log this }` are ordinary code.
    const re = new RegExp(`\\{\\s*(?://|/\\*)${placeholder}[^\\n]*\\n\\s*\\}`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      if (family === 'clike' && isControlFlowBlock(content, m.index)) continue;
      record(m.index, m[0]);
    }
  }
  if (family === 'python') {
    // def/class/if body consisting of a placeholder comment and `pass` / `...`
    const re = new RegExp(`:[ \\t]*\\n[ \\t]*#${placeholder}[^\\n]*\\n[ \\t]*(?:pass|\\.\\.\\.)[ \\t]*$`, 'gim');
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) record(m.index, m[0]);
  }
  return found.length > 0
    ? [{ severity: 'error', message: `placeholder instead of real content — write the actual content there (${found.join('; ')})` }]
    : [];
}

export function checkFileSanity(path: string, content: string): SanityIssue[] {
  const issues: SanityIssue[] = [];
  const family = familyOf(path);
  const ext = extOf(path);

  if (content === undefined || content === null) return issues;
  issues.push(...emptyPlaceholderIssues(family, content));

  if (looksJsonEscaped(content) && family !== 'json' && family !== 'jsonc') {
    issues.push({
      severity: 'error',
      message: 'the file is written with literal \\n / \\" escape sequences instead of real line breaks and quotes',
    });
  }
  if (ext !== 'md' && ext !== 'markdown' && ext !== 'mdx' && /^\s*```/.test(content)) {
    issues.push({ severity: 'error', message: 'the file starts with a markdown code fence (```); files must contain only their own code' });
  }

  switch (family) {
    case 'json':
    case 'jsonc':
      issues.push(...checkJson(content, family === 'jsonc'));
      break;
    case 'clike': {
      const isJs = JS_EXT.has(ext);
      const report = scanClike(content, {
        jsRegex: isJs,
        templates: isJs,
        backtickRaw: ext === 'go' || ext === 'kt' || ext === 'kts',
        hashComments: ext === 'php' || ext === 'c' || ext === 'h' || ext === 'cc' || ext === 'cpp' || ext === 'cxx' || ext === 'hpp' || ext === 'hh' || ext === 'cs',
        rustLifetimes: ext === 'rs',
        lineComments: true,
        jsxText: ext === 'jsx' || ext === 'tsx',
      });
      issues.push(...bracketIssues(report, '', content, family));
      const trunc = truncationWarning(content, family);
      if (trunc) issues.push(trunc);
      break;
    }
    case 'css': {
      const report = scanClike(content, {
        jsRegex: false,
        templates: false,
        backtickRaw: false,
        hashComments: false,
        rustLifetimes: false,
        lineComments: ext !== 'css',
      });
      issues.push(...bracketIssues(report, '', content, family));
      break;
    }
    case 'python': {
      const pyReport = scanPython(content);
      const structural = bracketIssues(pyReport, '', content, family);
      issues.push(...structural);
      if (pyReport.sameQuoteFString !== undefined) {
        issues.push({
          severity: 'warning',
          message: `line ${pyReport.sameQuoteFString}: an f-string reuses its own quote inside {…} — valid only on Python 3.12+; use the other quote type inside the braces (f"{d['key']}") so it also runs on older Python`,
        });
      }
      const indented = content.split('\n').filter((l) => /^[ \t]+\S/.test(l));
      const usesTabs = indented.some((l) => l.startsWith('\t'));
      const usesSpaces = indented.some((l) => l.startsWith(' '));
      if (usesTabs && usesSpaces) {
        issues.push({ severity: 'error', message: 'indentation mixes tabs and spaces (Python raises TabError)' });
      } else if (structural.length === 0) {
        const indentIssue = pythonIndentIssue(content);
        if (indentIssue) issues.push(indentIssue);
      }
      const trunc = truncationWarning(content, family);
      if (trunc) issues.push(trunc);
      break;
    }
    case 'html':
      issues.push(...checkHtml(content));
      break;
    case 'yaml': {
      const lines = content.split('\n');
      const tabLine = lines.findIndex((l) => /^\t/.test(l));
      if (tabLine !== -1) {
        issues.push({ severity: 'error', message: `YAML does not allow tab indentation (line ${tabLine + 1})` });
      }
      break;
    }
    default:
      break;
  }

  return issues;
}

/**
 * The damage a change would do: all errors of the new version when the current version has none,
 * or when an already broken file would get more errors. Empty when the change keeps the file at
 * least as healthy as it was. Refusing such changes stops a small model from breaking a working
 * page and then patching the breakage line by line (a qwen2.5-coder run scattered dozens of
 * <style>/<script> tags this way).
 */
export function damageFromChange(path: string, before: string, after: string): SanityIssue[] {
  const errorsOf = (content: string) => checkFileSanity(path, content).filter((i) => i.severity === 'error');
  const afterErrors = errorsOf(after);
  if (afterErrors.length === 0) return [];
  const beforeErrors = errorsOf(before);
  return beforeErrors.length === 0 || afterErrors.length > beforeErrors.length ? afterErrors : [];
}

/**
 * Errors for formats that can be validated exactly (JSON). Returns null when the content is
 * valid or the format is not strictly checkable. Used to refuse writes that would corrupt a
 * config file such as package.json.
 */
export function strictFormatError(path: string, content: string): string | null {
  const family = familyOf(path);
  if (family !== 'json' && family !== 'jsonc') return null;
  const issues = checkJson(content, family === 'jsonc');
  return issues.length > 0 ? issues[0].message : null;
}

/**
 * Keys (two levels deep) present in the old JSON document but missing from the new one,
 * e.g. ["name", "scripts.test"]. Small models often drop fields when rewriting config files.
 */
export function jsonKeyLoss(path: string, oldContent: string, newContent: string): string[] {
  const family = familyOf(path);
  if (family !== 'json' && family !== 'jsonc') return [];
  const parse = (text: string) => {
    try {
      return JSON.parse(family === 'jsonc' ? stripJsonComments(text) : text);
    } catch {
      return null;
    }
  };
  const before = parse(oldContent);
  const after = parse(newContent);
  const isObj = (v: any) => v && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(before) || !isObj(after)) return [];
  const lost: string[] = [];
  for (const key of Object.keys(before)) {
    if (!(key in after)) {
      lost.push(key);
    } else if (isObj(before[key]) && isObj(after[key])) {
      for (const sub of Object.keys(before[key])) {
        if (!(sub in after[key])) lost.push(`${key}.${sub}`);
      }
    }
  }
  return lost;
}

/**
 * Additive merge for JSON documents: keys that exist in `oldContent` but are missing from
 * `newContent` are kept, values from `newContent` win, key order of the original is preserved
 * and its indentation reused. Returns null when a merge is not possible (not plain objects,
 * JSONC with comments, invalid JSON) or nothing was dropped.
 */
export function mergeJsonPreservingKeys(
  path: string,
  oldContent: string,
  newContent: string
): { content: string; kept: string[] } | null {
  if (familyOf(path) !== 'json') return null;
  let before: any;
  let after: any;
  try {
    before = JSON.parse(oldContent);
    after = JSON.parse(newContent);
  } catch {
    return null;
  }
  const isObj = (v: any) => v && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(before) || !isObj(after)) return null;

  const kept: string[] = [];
  const merge = (base: any, update: any, prefix: string): any => {
    const out: Record<string, any> = {};
    for (const key of Object.keys(base)) {
      if (key in update) {
        out[key] = isObj(base[key]) && isObj(update[key]) ? merge(base[key], update[key], `${prefix}${key}.`) : update[key];
      } else {
        out[key] = base[key];
        kept.push(`${prefix}${key}`);
      }
    }
    for (const key of Object.keys(update)) {
      if (!(key in base)) out[key] = update[key];
    }
    return out;
  };
  const merged = merge(before, after, '');
  if (kept.length === 0) return null;
  const indentMatch = oldContent.match(/\n([ \t]+)"/);
  const indent = indentMatch ? (indentMatch[1].includes('\t') ? '\t' : indentMatch[1].length) : 2;
  const eol = oldContent.includes('\r\n') ? '\r\n' : '\n';
  let text = JSON.stringify(merged, null, indent);
  if (eol === '\r\n') text = text.replace(/\n/g, '\r\n');
  if (/\r?\n$/.test(oldContent)) text += eol;
  return { content: text, kept };
}

/**
 * Returns a reason when a whole-file rewrite would throw away most of an existing file,
 * e.g. an 81-line page replaced by the 4-line <script> the model meant to add.
 */
export function detectDestructiveRewrite(path: string, oldContent: string, newContent: string): string | null {
  const oldLines = oldContent.split('\n').filter((l) => l.trim()).length;
  const newLines = newContent.split('\n').filter((l) => l.trim()).length;
  if (familyOf(path) === 'html') {
    const oldIsDocument = /<html[\s>]/i.test(oldContent) && /<\/html>/i.test(oldContent);
    const newIsDocument = /<html[\s>]/i.test(newContent);
    if (oldIsDocument && !newIsDocument) {
      return `it would replace the complete HTML page (${oldLines} lines) with a fragment of ${newLines} lines`;
    }
  }
  if (oldLines >= 12 && newLines < oldLines * 0.4) {
    return `it would replace ${oldLines} lines with only ${newLines} lines`;
  }
  return null;
}

const DEFINITION_PATTERNS: Array<{ exts: Set<string>; re: RegExp }> = [
  { exts: PY_EXT, re: /^[ \t]*(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/gm },
  {
    exts: JS_EXT,
    re: /^[ \t]*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)|^[ \t]*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm,
  },
  { exts: new Set(['go']), re: /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/gm },
  { exts: new Set(['rs']), re: /^[ \t]*(?:pub(?:\([^)]*\))?\s+)?(?:fn|struct|enum|trait|impl)\s+([A-Za-z_]\w*)/gm },
  { exts: new Set(['php']), re: /^[ \t]*(?:(?:public|private|protected|static|abstract|final)\s+)*(?:function|class|interface|trait)\s+([A-Za-z_]\w*)/gm },
];

/** Top-level definitions (functions, classes, constants) present before a rewrite but gone after it. */
export function definitionLoss(path: string, oldContent: string, newContent: string): string[] {
  const ext = extOf(path);
  const entry = DEFINITION_PATTERNS.find((p) => p.exts.has(ext));
  if (!entry) return [];
  const collect = (text: string) => {
    const names = new Set<string>();
    const re = new RegExp(entry.re.source, entry.re.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const name = m[1] || m[2];
      if (name) names.add(name);
    }
    return names;
  };
  const after = collect(newContent);
  return Array.from(collect(oldContent)).filter((name) => !after.has(name));
}

export function formatSanityIssues(issues: SanityIssue[]): string {
  return issues.map((i) => `- [${i.severity}] ${i.message}`).join('\n');
}
