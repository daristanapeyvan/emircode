export interface HighlightToken {
  type: 'keyword' | 'string' | 'number' | 'comment' | 'function' | 'type' | 'operator' | 'punctuation' | 'text';
  value: string;
}

const KEYWORDS: Record<string, Set<string>> = {
  js: new Set([
    'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
    'do', 'switch', 'case', 'default', 'break', 'continue', 'new', 'delete',
    'typeof', 'instanceof', 'void', 'this', 'class', 'extends', 'super', 'import',
    'export', 'from', 'as', 'default', 'async', 'await', 'yield', 'try', 'catch',
    'finally', 'throw', 'true', 'false', 'null', 'undefined', 'interface', 'type',
    'enum', 'implements', 'public', 'private', 'protected', 'readonly', 'static'
  ]),
  py: new Set([
    'def', 'return', 'if', 'elif', 'else', 'for', 'while', 'break', 'continue',
    'import', 'from', 'as', 'class', 'try', 'except', 'finally', 'raise', 'with',
    'pass', 'lambda', 'yield', 'global', 'nonlocal', 'assert', 'del', 'async',
    'await', 'True', 'False', 'None'
  ]),
  rs: new Set([
    'fn', 'let', 'mut', 'const', 'if', 'else', 'match', 'loop', 'while', 'for',
    'in', 'return', 'break', 'continue', 'struct', 'enum', 'trait', 'impl', 'pub',
    'use', 'mod', 'crate', 'self', 'super', 'type', 'where', 'unsafe', 'async',
    'await', 'true', 'false'
  ]),
};

export function tokenizeCode(code: string, language: string = 'ts'): HighlightToken[] {
  const langKey = language.toLowerCase().includes('py')
    ? 'py'
    : language.toLowerCase().includes('rs') || language.toLowerCase().includes('rust')
    ? 'rs'
    : 'js';

  const keywords = KEYWORDS[langKey] || KEYWORDS.js;
  const tokens: HighlightToken[] = [];
  let i = 0;
  const len = code.length;

  while (i < len) {
    const char = code[i];

    // Single line comment // or #
    if ((char === '/' && code[i + 1] === '/') || (langKey === 'py' && char === '#')) {
      let end = code.indexOf('\n', i);
      if (end === -1) end = len;
      tokens.push({ type: 'comment', value: code.slice(i, end) });
      i = end;
      continue;
    }

    // Multi-line comment /* ... */
    if (char === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      if (end === -1) {
        tokens.push({ type: 'comment', value: code.slice(i) });
        break;
      }
      tokens.push({ type: 'comment', value: code.slice(i, end + 2) });
      i = end + 2;
      continue;
    }

    // Strings "..." '...' `...`
    if (char === '"' || char === "'" || char === '`') {
      const quote = char;
      let j = i + 1;
      let escaped = false;
      while (j < len) {
        if (code[j] === '\\') {
          escaped = !escaped;
        } else if (code[j] === quote && !escaped) {
          j++;
          break;
        } else {
          escaped = false;
        }
        j++;
      }
      tokens.push({ type: 'string', value: code.slice(i, j) });
      i = j;
      continue;
    }

    // Numbers
    if (/[0-9]/.test(char) && (i === 0 || /[\s,;+\-*/%&|^~=!<>()\[\]{}]/.test(code[i - 1]))) {
      let j = i;
      while (j < len && /[0-9a-fA-FxX._]/.test(code[j])) j++;
      tokens.push({ type: 'number', value: code.slice(i, j) });
      i = j;
      continue;
    }

    // Identifiers & Keywords
    if (/[a-zA-Z_$]/.test(char)) {
      let j = i;
      while (j < len && /[a-zA-Z0-9_$]/.test(code[j])) j++;
      const word = code.slice(i, j);

      if (keywords.has(word)) {
        tokens.push({ type: 'keyword', value: word });
      } else if (j < len && code[j] === '(') {
        tokens.push({ type: 'function', value: word });
      } else if (/^[A-Z]/.test(word)) {
        tokens.push({ type: 'type', value: word });
      } else {
        tokens.push({ type: 'text', value: word });
      }
      i = j;
      continue;
    }

    // Operators
    if (/[+\-*/%&|^~=!<>]/.test(char)) {
      let j = i;
      while (j < len && /[+\-*/%&|^~=!<>]/.test(code[j])) j++;
      tokens.push({ type: 'operator', value: code.slice(i, j) });
      i = j;
      continue;
    }

    // Punctuation & whitespace
    tokens.push({ type: 'text', value: char });
    i++;
  }

  return tokens;
}

export function getTokenClassName(type: HighlightToken['type']): string {
  switch (type) {
    case 'keyword':
      return 'text-purple-400 font-semibold';
    case 'string':
      return 'text-emerald-300';
    case 'number':
      return 'text-amber-400';
    case 'comment':
      return 'text-zinc-500 italic';
    case 'function':
      return 'text-sky-400';
    case 'type':
      return 'text-teal-300';
    case 'operator':
      return 'text-pink-400';
    case 'punctuation':
      return 'text-zinc-400';
    default:
      return 'text-zinc-200';
  }
}
