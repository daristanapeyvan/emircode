import { AgentCapabilities } from '../../types/agent';
import { WebAccessConfig } from '../../types/settings';
import { looksJsonEscaped } from './TaskValidator';

export type ParsedActionType =
  | 'read_directory'
  | 'read_file'
  | 'search_code'
  | 'read_git_status'
  | 'read_git_diff'
  | 'propose_create'
  | 'propose_edit'
  | 'propose_delete'
  | 'propose_command'
  | 'ask_question'
  | 'web_search'
  | 'fetch_url'
  | 'finish'
  | 'unknown';

export interface ParsedAction {
  type: ParsedActionType;
  payload: any;
  rawJson: any;
  error?: string;
}

export interface ParseActionContext {
  expectedArtifacts?: string[];
  activeTaskTarget?: string;
}

/** Model-facing action names (and common synonyms small models produce) -> internal action type. */
const ACTION_ALIASES: Record<string, ParsedActionType> = {
  read_directory: 'read_directory',
  list_dir: 'read_directory',
  list_directory: 'read_directory',
  list_files: 'read_directory',
  ls: 'read_directory',
  read_file: 'read_file',
  open_file: 'read_file',
  view_file: 'read_file',
  cat: 'read_file',
  search_code: 'search_code',
  grep: 'search_code',
  find_in_files: 'search_code',
  read_git_status: 'read_git_status',
  git_status: 'read_git_status',
  read_git_diff: 'read_git_diff',
  git_diff: 'read_git_diff',
  propose_create: 'propose_create',
  write_file: 'propose_create',
  create_file: 'propose_create',
  save_file: 'propose_create',
  write: 'propose_create',
  propose_edit: 'propose_edit',
  edit_file: 'propose_edit',
  replace_in_file: 'propose_edit',
  str_replace: 'propose_edit',
  patch_file: 'propose_edit',
  replace_lines: 'propose_edit',
  edit_lines: 'propose_edit',
  propose_delete: 'propose_delete',
  delete_file: 'propose_delete',
  remove_file: 'propose_delete',
  propose_command: 'propose_command',
  run_command: 'propose_command',
  execute_command: 'propose_command',
  run: 'propose_command',
  shell: 'propose_command',
  ask_question: 'ask_question',
  ask_user: 'ask_question',
  ask: 'ask_question',
  web_search: 'web_search',
  search_web: 'web_search',
  fetch_url: 'fetch_url',
  open_url: 'fetch_url',
  browse: 'fetch_url',
  finish: 'finish',
  done: 'finish',
  complete: 'finish',
  final_answer: 'finish',
};

/** Placeholder names that older prompts used as examples; small models copied them verbatim. */
const PLACEHOLDER_PATHS = new Set([
  'hedef_klasor',
  'hedef_dizin',
  'hedef_dosya.js',
  'hedef_dosya.html',
  'olusturulacak_dosya.js',
  'olusturulacak_dosya.html',
  'duzenlenecek_dosya.js',
  'duzenlenecek_dosya.html',
  'path/to/file',
  'path/to/file.ext',
]);

/** Files that legitimately have no extension. */
const EXTENSIONLESS_FILES = /^(?:makefile|dockerfile|containerfile|license|licence|readme|changelog|authors|contributing|notice|procfile|gemfile|rakefile|vagrantfile|jenkinsfile|caddyfile|brewfile|cname|codeowners|pipfile|justfile|gnumakefile|\..+)$/i;

function pickString(obj: any, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj?.[key];
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}

function pickInt(obj: any, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = Number(obj?.[key]);
    if (obj?.[key] !== undefined && obj?.[key] !== null && isFinite(value)) return Math.floor(value);
  }
  return undefined;
}

function cleanPath(raw: string | undefined): string {
  let p = String(raw ?? '').trim().replace(/^["'`]+|["'`]+$/g, '').replace(/\\/g, '/');
  p = p.replace(/^\.\/+/, '');
  if (p === '.' || p === './' || p === '/') return '';
  return p;
}

/** Splits `npm run test -- --watch=false` into binary + args, honouring simple quotes. */
export function splitCommandLine(command: string): { binary: string; args: string[] } {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(command)) !== null) {
    tokens.push(m[1] ?? m[2] ?? m[3]);
  }
  const [binary = '', ...args] = tokens;
  return { binary: binary.toLowerCase(), args };
}

/**
 * Finds the JSON object that ends at the brace matching `start`, while respecting strings.
 * Returns the raw slice plus a "repaired" copy where raw control characters inside strings
 * are escaped and trailing commas are dropped (the two most common small-model JSON errors).
 */
function scanJsonObject(text: string, start: number): { raw: string; repaired: string } | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let repaired = '';
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        repaired += ch;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        repaired += ch;
        continue;
      }
      if (ch === '"') {
        inString = false;
        repaired += ch;
        continue;
      }
      if (ch === '\n') repaired += '\\n';
      else if (ch === '\r') repaired += '\\r';
      else if (ch === '\t') repaired += '\\t';
      else repaired += ch;
      continue;
    }
    if (ch === '"') {
      inString = true;
      repaired += ch;
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        repaired += ch;
        return {
          raw: text.slice(start, i + 1),
          repaired: repaired.replace(/,\s*([}\]])/g, '$1'),
        };
      }
    }
    repaired += ch;
  }
  return null;
}

function tryParseObject(candidate: string): any | null {
  try {
    const value = JSON.parse(candidate);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/** Removes reasoning sections so JSON examples inside thoughts are never executed. */
export function stripReasoning(text: string): string {
  return (text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/i, '')
    .replace(/<thought>[\s\S]*?<\/thought>/gi, '');
}

/** Extracts the first JSON object that carries an "action" key. */
export function extractActionJson(text: string): any | null {
  const cleaned = stripReasoning(text).trim();
  if (!cleaned) return null;

  const direct = tryParseObject(cleaned);
  if (direct && direct.action !== undefined) return direct;

  let searchFrom = 0;
  let attempts = 0;
  while (attempts < 40) {
    const start = cleaned.indexOf('{', searchFrom);
    if (start === -1) break;
    attempts++;
    searchFrom = start + 1;
    // Only consider objects whose first key is a quoted string (skips CSS / code braces).
    if (!/^\{\s*"/.test(cleaned.slice(start, start + 40))) continue;
    const scanned = scanJsonObject(cleaned, start);
    if (!scanned) continue;
    const obj = tryParseObject(scanned.raw) || tryParseObject(scanned.repaired);
    if (obj && obj.action !== undefined) return obj;
  }
  return null;
}

export class ToolDispatcher {
  static parseActionFromResponse(text: string, context?: ParseActionContext): ParsedAction {
    const jsonContent = extractActionJson(text || '');
    if (jsonContent) {
      return ToolDispatcher.normalizeAction(jsonContent, context);
    }

    const visible = stripReasoning(text || '');

    // A malformed JSON action must never be written into a file as if it were source code.
    if (/"action"\s*:/.test(visible)) {
      return {
        type: 'unknown',
        payload: null,
        rawJson: null,
        error: 'Model yanıtındaki JSON eylemi ayrıştırılamadı (geçersiz JSON).',
      };
    }

    // Coder Model Raw Code Block Fallback (Strict Hierarchy)
    const codeBlockMatch = visible.match(/```([a-zA-Z0-9_\-]+)?\s*\n([\s\S]*?)\n```/);
    if (codeBlockMatch && (codeBlockMatch[1] || '').toLowerCase() !== 'json') {
      const code = codeBlockMatch[2];

      // Step 1: Explicit filepath in text or in code comment
      const explicitPathMatch =
        visible.match(/(?:\/\/|<!--|#|\/\*)\s*(?:file(?:path)?|dosya)\s*:\s*([^\s*>\n]+)/i) ||
        visible.match(/(?:file(?:path)?|dosya|path)\s*:\s*[`"']?([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]+)[`"']?/i);

      let determinedPath: string | null = null;
      if (explicitPathMatch && explicitPathMatch[1]) {
        determinedPath = explicitPathMatch[1].trim().replace(/^['"`]+|['"`]+$/g, '');
      }

      // Step 2: Active Task Expected Artifact (if exactly 1 unambiguous artifact expected)
      if (!determinedPath) {
        if (context?.activeTaskTarget) {
          determinedPath = context.activeTaskTarget;
        } else if (context?.expectedArtifacts && context.expectedArtifacts.length === 1) {
          determinedPath = context.expectedArtifacts[0];
        }
      }

      // Step 3: If no explicit or verified artifact target, DO NOT GUESS - STOP!
      if (determinedPath) {
        const cleanedPath = cleanPath(determinedPath);
        return {
          type: 'propose_create',
          payload: {
            path: cleanedPath,
            content: code,
            reason: 'Coder modeli doğrudan kod bloğu aktarımı (Doğrulanmış hedef dosya)',
          },
          rawJson: { action: 'propose_create', path: cleanedPath, content: code },
        };
      }
      return {
        type: 'unknown',
        payload: null,
        rawJson: null,
        error:
          'Ham kod bloğu algılandı ancak hedef dosya yolu belirlenemedi. Güvenlik gereği tahmin yapılmadı. Lütfen dosya yolunu açıkça belirtin (ör. `// filepath: src/index.html`).',
      };
    }

    // Raw HTML Document Fallback (without code fence). JSON-escaped HTML (a half-streamed
    // JSON string) is rejected: writing it to disk produced literal "\n" and \" in pages.
    const htmlDocMatch = visible.match(/(<!DOCTYPE\s+html[\s\S]*<\/html>|<html[\s\S]*<\/html>)/i);
    if (htmlDocMatch && !looksJsonEscaped(htmlDocMatch[0])) {
      const code = htmlDocMatch[0].trim();
      const determinedPath =
        context?.activeTaskTarget ||
        (context?.expectedArtifacts && context.expectedArtifacts[0]) ||
        'index.html';
      const cleanedPath = cleanPath(determinedPath);
      return {
        type: 'propose_create',
        payload: {
          path: cleanedPath,
          content: code,
          reason: 'Doğrudan HTML belgesi aktarımı',
        },
        rawJson: { action: 'propose_create', path: cleanedPath, content: code },
      };
    }

    return {
      type: 'unknown',
      payload: null,
      rawJson: null,
      error: 'Model yanıtında geçerli bir JSON eylemi bulunamadı.',
    };
  }

  /** Maps a parsed JSON object (any supported naming) onto the internal action payloads. */
  static normalizeAction(jsonContent: any, context?: ParseActionContext): ParsedAction {
    // CRITICAL SECURITY: Ignore any model self-approval claims!
    delete jsonContent.approved;
    delete jsonContent.token;
    delete jsonContent.authorized;

    const action = String(jsonContent.action || '').trim().toLowerCase();
    const type = ACTION_ALIASES[action];
    const fallbackTarget =
      context?.activeTaskTarget || (context?.expectedArtifacts && context.expectedArtifacts[0]) || '';

    const resolvePath = (keys: string[], allowEmpty = false): string => {
      let p = cleanPath(pickString(jsonContent, keys));
      if (PLACEHOLDER_PATHS.has(p.toLowerCase())) {
        p = allowEmpty ? '' : fallbackTarget;
      }
      return p;
    };

    switch (type) {
      case 'read_directory':
        return {
          type,
          payload: { path: resolvePath(['path', 'dir', 'directory', 'folder'], true) },
          rawJson: jsonContent,
        };

      case 'read_file':
        return {
          type,
          payload: {
            path: resolvePath(['path', 'file', 'file_path', 'filename']),
            startLine: pickInt(jsonContent, ['start_line', 'startLine', 'from_line']),
            endLine: pickInt(jsonContent, ['end_line', 'endLine', 'to_line']),
          },
          rawJson: jsonContent,
        };

      case 'search_code':
        return {
          type,
          payload: { query: String(pickString(jsonContent, ['query', 'pattern', 'text', 'search']) || '') },
          rawJson: jsonContent,
        };

      case 'read_git_status':
      case 'read_git_diff':
        return { type, payload: {}, rawJson: jsonContent };

      case 'propose_create':
        return {
          type,
          payload: {
            path: resolvePath(['path', 'file', 'file_path', 'filename']),
            content: String(pickString(jsonContent, ['content', 'code', 'text', 'body']) ?? ''),
            hasContent: pickString(jsonContent, ['content', 'code', 'text', 'body']) !== undefined,
            reason: String(pickString(jsonContent, ['reason', 'thought']) || 'Yeni dosya oluşturma'),
          },
          rawJson: jsonContent,
        };

      case 'propose_edit':
        if (action === 'replace_lines' || action === 'edit_lines') {
          const replacement = pickString(jsonContent, ['content', 'replace', 'new_chunk', 'text']);
          return {
            type,
            payload: {
              path: resolvePath(['path', 'file', 'file_path', 'filename']),
              startLine: pickInt(jsonContent, ['start_line', 'startLine', 'from_line']),
              endLine: pickInt(jsonContent, ['end_line', 'endLine', 'to_line']),
              original_chunk: '',
              new_chunk: String(replacement ?? ''),
              hasReplace: replacement !== undefined,
              lineRange: true,
              reason: String(pickString(jsonContent, ['reason', 'thought']) || 'Satır aralığı güncellemesi'),
            },
            rawJson: jsonContent,
          };
        }
        return {
          type,
          payload: {
            path: resolvePath(['path', 'file', 'file_path', 'filename']),
            original_chunk: String(
              pickString(jsonContent, ['find', 'original_chunk', 'old', 'old_str', 'old_text', 'search']) ?? ''
            ),
            new_chunk: String(
              pickString(jsonContent, ['replace', 'new_chunk', 'new', 'new_str', 'new_text', 'replacement']) ?? ''
            ),
            hasReplace:
              pickString(jsonContent, ['replace', 'new_chunk', 'new', 'new_str', 'new_text', 'replacement']) !==
              undefined,
            reason: String(pickString(jsonContent, ['reason', 'thought']) || 'Kod güncellemesi'),
          },
          rawJson: jsonContent,
        };

      case 'propose_delete':
        return {
          type,
          payload: {
            path: resolvePath(['path', 'file', 'file_path', 'filename']),
            reason: String(pickString(jsonContent, ['reason', 'thought']) || 'Dosya silme'),
          },
          rawJson: jsonContent,
        };

      case 'propose_command': {
        let binary = String(pickString(jsonContent, ['binary']) || '').trim().toLowerCase();
        let args: string[] = Array.isArray(jsonContent.args) ? jsonContent.args.map(String) : [];
        const commandLine = pickString(jsonContent, ['command', 'cmd']);
        if (!binary && commandLine) {
          const split = splitCommandLine(commandLine);
          binary = split.binary;
          args = split.args;
        }
        return {
          type,
          payload: {
            binary,
            args,
            reason: String(pickString(jsonContent, ['reason', 'thought']) || 'Test veya derleme çalıştırma'),
          },
          rawJson: jsonContent,
        };
      }

      case 'ask_question':
        return {
          type,
          payload: {
            question: String(pickString(jsonContent, ['question', 'message', 'text']) || ''),
            options: Array.isArray(jsonContent.options) ? jsonContent.options.map(String) : undefined,
          },
          rawJson: jsonContent,
        };

      case 'web_search':
        return {
          type,
          payload: { query: String(pickString(jsonContent, ['query', 'q', 'search']) || '').trim() },
          rawJson: jsonContent,
        };

      case 'fetch_url':
        return {
          type,
          payload: { url: String(pickString(jsonContent, ['url', 'link', 'href']) || '').trim() },
          rawJson: jsonContent,
        };

      case 'finish':
        return {
          type,
          payload: {
            summary: String(
              pickString(jsonContent, ['summary', 'answer', 'message', 'result', 'response']) || 'Görev tamamlandı.'
            ),
          },
          rawJson: jsonContent,
        };

      default:
        return {
          type: 'unknown',
          payload: jsonContent,
          rawJson: jsonContent,
          error: `Bilinmeyen eylem tipi: ${action || '(boş)'}`,
        };
    }
  }

  /**
   * Returns a model-facing error when a parsed action lacks a field it cannot work without,
   * or null when the action is executable.
   */
  static validateAction(parsed: ParsedAction): string | null {
    const p = parsed.payload || {};
    switch (parsed.type) {
      case 'read_file':
      case 'propose_delete':
        return p.path ? null : `"${parsed.type === 'read_file' ? 'read_file' : 'delete_file'}" needs a "path".`;
      case 'propose_create': {
        if (!p.path) return '"write_file" needs a "path".';
        if (p.path.endsWith('/')) return `"${p.path}" is a folder. Give a file path such as "${p.path}index.html".`;
        if (!p.hasContent) return `"write_file" needs the complete file text in "content".`;
        // Small models try to "create a folder" with write_file, which produces an empty file named
        // like the folder and then blocks every file inside it (EEXIST / ENOTDIR).
        const baseName = String(p.path).split('/').pop() || '';
        const thought = String(parsed.rawJson?.thought || '');
        const looksLikeFolder =
          !baseName.includes('.') &&
          !EXTENSIONLESS_FILES.test(baseName) &&
          (String(p.content).trim().length < 40 || /klasör|dizin|folder|directory|mkdir/i.test(thought));
        if (looksLikeFolder) {
          // No concrete example name: a 7B model copied "<folder>/index.js" literally and created a page nobody asked for.
          return `"${p.path}" looks like a folder, and folders cannot be created with write_file. Folders are created automatically: write each file the task needs with its full path ("${p.path}/" followed by the file name the task gives).`;
        }
        return null;
      }
      case 'propose_edit':
        if (p.lineRange) {
          if (!p.path) return '"replace_lines" needs a "path".';
          if (!p.startLine || p.startLine < 1) return '"replace_lines" needs "start_line" (1 or higher).';
          if (!p.endLine || p.endLine < p.startLine) return '"replace_lines" needs "end_line" greater than or equal to "start_line".';
          if (!p.hasReplace) return '"replace_lines" needs "content": the new text for those lines.';
          return null;
        }
        if (!p.path) return '"edit_file" needs a "path".';
        if (!p.original_chunk) return '"edit_file" needs "find": the exact existing text to replace.';
        if (!p.hasReplace) return '"edit_file" needs "replace": the new text.';
        return null;
      case 'search_code':
        return p.query ? null : '"search_code" needs a "query".';
      case 'web_search':
        return p.query ? null : '"web_search" needs a "query".';
      case 'fetch_url':
        return /^https?:\/\//i.test(p.url || '') ? null : '"fetch_url" needs a full "url" starting with https://';
      case 'propose_command':
        return p.binary ? null : '"run_command" needs a "command", e.g. "npm test".';
      case 'ask_question':
        return p.question ? null : '"ask_user" needs a "question".';
      default:
        return null;
    }
  }

  /**
   * Evaluates if Web Access is strictly authorized for the given mode and configuration.
   */
  static isWebAccessAllowed(
    mode: 'chat' | 'coding',
    config?: { enabled: boolean; chatEnabled: boolean; codingEnabled: boolean }
  ): boolean {
    if (!config || !config.enabled) return false;
    if (mode === 'chat') return !!config.chatEnabled;
    if (mode === 'coding') return !!config.codingEnabled;
    return false;
  }

  /**
   * Derives unified AgentCapabilities matrix based on mode, WebAccessConfig, and workspace Git state.
   */
  static getCapabilities(
    mode: 'chat' | 'coding',
    config?: WebAccessConfig,
    gitAvailable?: boolean
  ): AgentCapabilities {
    const isAllowed = this.isWebAccessAllowed(mode, config);
    return {
      webSearch: isAllowed,
      webFetch: isAllowed,
      git: !!gitAvailable,
    };
  }
}
