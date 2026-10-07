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
  constructor(status: number, message: string) {
    super(message || `HTTP ${status}`);
    this.name = 'HttpStatusError';
    this.status = status;
  }
}

const NETWORK_RE = /fetch failed|network|ECONN(?:REFUSED|RESET|ABORTED)|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|socket hang up|getaddrinfo|certificate|TLS/i;
const QUOTA_RE = /insufficient_quota|quota|billing|credit balance|payment|exceeded your current|usage limit|subscription/i;
const CONTEXT_RE = /context(?:_length|[_ ]window)?[_ ]exceeded|maximum context|context length|prompt is too long|too many tokens|input is too long|reduce the length/i;
const FORMAT_RE = /output_config|output_format|response_format|json_schema|structured output|\bschema\b/i;
const THINK_RE = /thinking|reasoning_effort|reasoning effort|budget_tokens|\bthink\b/i;

/** Reads status, code and message from an SDK error, an HTTP error or anything thrown. */
function describe(err: unknown): { name: string; status?: number; code: string; message: string } {
  const e = (err || {}) as any;
  const body = e.error && typeof e.error === 'object' ? e.error : null;
  const inner = body?.error && typeof body.error === 'object' ? body.error : body;
  const status = typeof e.status === 'number' ? e.status : undefined;
  const code = String(e.code || inner?.code || inner?.type || e.type || '');
  const message = String(inner?.message || e.message || e || 'Unknown error');
  return { name: String(e.name || ''), status, code, message };
}

export function classifyCloudError(err: unknown): CloudError {
  if (err instanceof CloudFailure) {
    return { code: err.code, message: err.message, status: err.status, category: err.category };
  }
  const { name, status, code, message } = describe(err);
  const text = `${code} ${message}`;
  const result = (c: CloudErrorCode): CloudError => ({ code: c, message, ...(status ? { status } : {}) });

  if (name === 'AbortError' || name === 'APIUserAbortError' || /aborted|abort/i.test(name)) return result('aborted');
  if (name === 'APIConnectionError' || name === 'APIConnectionTimeoutError') return result('network');
  if (status === undefined) {
    if (NETWORK_RE.test(text)) return result('network');
    return result('unknown');
  }
  if (status === 401 || status === 403) return result(QUOTA_RE.test(text) ? 'quota' : 'auth');
  if (status === 402) return result('quota');
  if (status === 404) return result('not_found');
  if (status === 413) return result('context_length');
  if (status === 429) return result(QUOTA_RE.test(text) ? 'quota' : 'rate_limit');
  if (status === 408 || status === 529 || status >= 500) return result('overloaded');
  if (status === 400 || status === 422) {
    if (QUOTA_RE.test(text)) return result('quota');
    if (CONTEXT_RE.test(text)) return result('context_length');
    if (/model/i.test(text) && /not found|does not exist|unknown model|invalid model/i.test(text)) return result('not_found');
    if (THINK_RE.test(text)) return result('think_unsupported');
    if (FORMAT_RE.test(text)) return result('format_unsupported');
    return result('bad_request');
  }
  return result('unknown');
}
