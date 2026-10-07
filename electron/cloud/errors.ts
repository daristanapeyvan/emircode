/**
 * Errors of the cloud providers as codes. The renderer turns a code into a message in the
 * interface language; the agent reacts to the code (for example, it switches the answer schema
 * off after `format_unsupported`), never to the provider's text.
 */
import type { CloudError, CloudErrorCode } from './types';

/** An error with a code, thrown inside the main process and sent to the renderer as it is. */
export class CloudFailure extends Error {
  readonly code: CloudErrorCode;
  readonly status?: number;
  readonly category?: string;
  constructor(code: CloudErrorCode, message: string, extra: { status?: number; category?: string } = {}) {
    super(message);
    this.name = 'CloudFailure';
    this.code = code;
    this.status = extra.status;
    this.category = extra.category;
  }
}

/** An HTTP error of a provider that is not reached through an SDK (Ollama Cloud). */
export class HttpStatusError extends Error {
  readonly status: number;
  /** The Retry-After header, when the server sent one. */
  readonly retryAfter?: string;
  constructor(status: number, message: string, retryAfter?: string) {
    super(message || `HTTP ${status}`);
    this.name = 'HttpStatusError';
    this.status = status;
    if (retryAfter) this.retryAfter = retryAfter;
  }
}

/**
 * Key-shaped text: provider key prefixes (sk-, sk-ant-, sk-proj-, AIza, gsk_, xai-, hf_, nvapi-),
 * bearer tokens and long unbroken base64/hex runs. Some providers echo part of a wrong key in their
 * error, and that text reaches the interface and the logs.
 */
const SECRET_PATTERNS: RegExp[] = [
  /\b(?:sk|rk|pk)-(?:ant-|proj-|or-|svcacct-)?[A-Za-z0-9_\-*.]{8,}/g,
  /\bAIza[0-9A-Za-z_\-]{20,}/g,
  /\b(?:gsk|xai|hf|nvapi|ghp|github_pat|glpat)[_-][A-Za-z0-9_\-]{12,}/g,
  /\b(?:Bearer|Basic|Token)\s+[A-Za-z0-9._~+/\-=*]{8,}/gi,
  /\b(?:api[_-]?key|x-api-key|x-goog-api-key|authorization)(["'\s:=]+)[A-Za-z0-9._~+/\-=*]{8,}/gi,
];
/** A long unbroken run of key characters: hex, or mixed case with digits (not a model name such as "meta-llama-3-70b-instruct"). */
const LONG_RUN = /[A-Za-z0-9+/_\-]{32,}={0,2}/g;
const looksRandom = (run: string) =>
  (/^[0-9a-f]{32,}$/i.test(run) && /\d/.test(run) && /[a-f]/i.test(run)) || (/[a-z]/.test(run) && /[A-Z]/.test(run) && /\d/.test(run) && !run.includes('/'));

function maskSecret(value: string): string {
  const v = String(value || '');
  return v.length >= 12 ? `…${v.slice(-4)}` : '…';
}

/**
 * The text with every known key (the one in use, the saved ones) and everything key-shaped
 * replaced by "…" plus its last four characters.
 */
export function redactSecrets(text: string, secrets: Array<string | null | undefined> = []): string {
  let out = String(text ?? '');
  const known = secrets.filter((k): k is string => typeof k === 'string' && k.length >= 8).sort((a, b) => b.length - a.length);
  for (const key of known) out = out.split(key).join(maskSecret(key));
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match: string, sep?: string) => {
      if (typeof sep === 'string' && /api|auth/i.test(match)) {
        const head = match.slice(0, match.indexOf(sep) + sep.length);
        return `${head}${maskSecret(match.slice(head.length))}`;
      }
      const space = match.search(/\s/);
      if (space > 0 && /^(?:Bearer|Basic|Token)/i.test(match)) return `${match.slice(0, space + 1)}${maskSecret(match.slice(space + 1))}`;
      return match.startsWith('…') ? match : maskSecret(match);
    });
  }
  out = out.replace(LONG_RUN, (run) => (looksRandom(run) ? maskSecret(run) : run));
  return out;
}

const NETWORK_RE = /fetch failed|network|ECONN(?:REFUSED|RESET|ABORTED)|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|socket hang up|getaddrinfo|certificate|TLS/i;
const QUOTA_RE = /insufficient_quota|quota|billing|credit balance|payment|exceeded your current|usage limit|subscription/i;
/** Plan limits that reset by themselves (Ollama Cloud's hourly and weekly limits). */
const USAGE_LIMIT_RE = /usage limit|(?:hourly|daily|weekly|session|5-hour) (?:usage )?limit|limit (?:resets|will reset)|reached your (?:\w+ )?limit/i;
const RESET_RE = /(?:resets?|try again|available again)\s+(?:in|at|after|on)\s+([^.;\n]{1,60})/i;
const CONTEXT_RE = /context(?:_length|[_ ]window)?[_ ]exceeded|maximum context|context length|prompt is too long|too many tokens|input is too long|reduce the length/i;
const FORMAT_RE = /output_config|output_format|response_format|json_schema|structured output|\bschema\b/i;
const THINK_RE = /thinking|reasoning_effort|reasoning effort|reasoning\.effort|\beffort\b|budget_tokens|\bthink\b|reasoning\.summary|thinking_?level|thinking_?budget/i;

/** Reads status, code and message from an SDK error, an HTTP error or anything thrown. */
function describe(err: unknown): { name: string; status?: number; code: string; message: string; retryAfter?: string } {
  const e = (err || {}) as any;
  const body = e.error && typeof e.error === 'object' ? e.error : null;
  const inner = body?.error && typeof body.error === 'object' ? body.error : body;
  const status = typeof e.status === 'number' ? e.status : typeof e.code === 'number' ? e.code : undefined;
  const code = String((typeof e.code === 'string' && e.code) || inner?.code || inner?.status || inner?.type || e.type || '');
  const message = String(inner?.message || e.message || e || 'Unknown error');
  let retryAfter: string | undefined = typeof e.retryAfter === 'string' ? e.retryAfter : undefined;
  try {
    const header = typeof e.headers?.get === 'function' ? e.headers.get('retry-after') : e.headers?.['retry-after'];
    if (!retryAfter && header) retryAfter = String(header);
  } catch {
    // no headers
  }
  return { name: String(e.name || ''), status, code, message, retryAfter };
}

/** "in 2 hours", "at 14:00 UTC" from the provider's text, or seconds from Retry-After. */
function resetHint(message: string, retryAfter?: string): string | undefined {
  const fromText = message.match(RESET_RE)?.[1]?.trim();
  if (fromText) return fromText;
  if (retryAfter && /^\d+$/.test(retryAfter.trim())) {
    const seconds = Number(retryAfter.trim());
    if (seconds >= 3600) return `${Math.round(seconds / 360) / 10} h`;
    if (seconds >= 60) return `${Math.round(seconds / 60)} min`;
    return `${seconds} s`;
  }
  return retryAfter?.trim() || undefined;
}

/**
 * The error as a code, with the provider's text stripped of anything key-shaped. `secrets` are the
 * keys the main process knows (the one in use first), so even an unusual key format is masked.
 */
export function classifyCloudError(err: unknown, secrets: Array<string | null | undefined> = []): CloudError {
  const clean = (text: string) => redactSecrets(text, secrets);
  if (err instanceof CloudFailure) {
    return { code: err.code, message: clean(err.message), status: err.status, category: err.category };
  }
  const { name, status, code, message: raw, retryAfter } = describe(err);
  const message = clean(raw);
  const text = `${code} ${message}`;
  const result = (c: CloudErrorCode): CloudError => {
    const resetsAt = c === 'usage_limit' || c === 'rate_limit' ? resetHint(message, retryAfter) : undefined;
    return { code: c, message, ...(status ? { status } : {}), ...(resetsAt ? { resetsAt } : {}) };
  };

  if (name === 'AbortError' || name === 'APIUserAbortError' || /aborted|abort/i.test(name)) return result('aborted');
  if (name === 'APIConnectionError' || name === 'APIConnectionTimeoutError') return result('network');
  if (status === undefined) {
    if (NETWORK_RE.test(text)) return result('network');
    return result('unknown');
  }
  if (status === 401 || status === 403) return result(USAGE_LIMIT_RE.test(text) ? 'usage_limit' : QUOTA_RE.test(text) ? 'quota' : 'auth');
  if (status === 402) return result(USAGE_LIMIT_RE.test(text) ? 'usage_limit' : 'quota');
  if (status === 404) return result('not_found');
  if (status === 413) return result('context_length');
  if (status === 429) return result(USAGE_LIMIT_RE.test(text) ? 'usage_limit' : QUOTA_RE.test(text) ? 'quota' : /RESOURCE_EXHAUSTED/.test(code) && /quota/i.test(message) ? 'quota' : 'rate_limit');
  if (status === 408 || status === 529 || status >= 500) return result('overloaded');
  if (status === 400 || status === 422) {
    if (/API[_ ]KEY[_ ]INVALID|api key not valid|invalid api key/i.test(text)) return result('auth');
    if (USAGE_LIMIT_RE.test(text)) return result('usage_limit');
    if (QUOTA_RE.test(text)) return result('quota');
    if (CONTEXT_RE.test(text)) return result('context_length');
    if (/model/i.test(text) && /not found|does not exist|unknown model|invalid model/i.test(text)) return result('not_found');
    if (THINK_RE.test(text)) return result('think_unsupported');
    if (FORMAT_RE.test(text)) return result('format_unsupported');
    return result('bad_request');
  }
  return result('unknown');
}
