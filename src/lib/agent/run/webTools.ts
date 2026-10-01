import { WebAccessService } from '../../web/WebAccessService';
import { wrapUntrustedWebResult } from '../UntrustedData';
import { et } from '../engineText';
import type { RunContext, StepVars, LoopFlow } from './context';

/** The "web_search" step of the agent loop. */
export async function handleWebSearch(ctx: RunContext, { assistantText, parsed, payload, readOnlySignature }: Pick<StepVars, 'assistantText' | 'parsed' | 'payload' | 'readOnlySignature'>): Promise<LoopFlow> {
  const query: string = payload.query;
  ctx.callbacks.onStep({
    id: `step_search_${Date.now()}`,
    timestamp: Date.now(),
    type: 'tool_call',
    toolName: 'web_search',
    toolArgs: { query },
    content: et('webSearching', { query }),
  });
  ctx.callbacks.onLog(`WEB SEARCH\nQuery: ${query}`);
  let observation: string;
  try {
    const results = await WebAccessService.search(query, { limit: 5, signal: ctx.engine.abortController?.signal });
    ctx.consecutiveErrors = 0;
    ctx.repeatStreak = 0;
    ctx.stepsWithoutProgress = 0;
    const formatted = results.length === 0
      ? 'No results.'
      : results.map((r) => `[${r.id}] ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet}\nSource: ${r.source}`).join('\n\n');
    observation = `${wrapUntrustedWebResult('search', query, formatted)}\nUse fetch_url to read a page, or continue with the task.`;
    ctx.callbacks.onStep({
      id: `step_search_res_${Date.now()}`,
      timestamp: Date.now(),
      type: 'tool_result',
      toolName: 'web_search',
      content: et('webSearchDone', { count: results.length }),
      status: 'success',
      metadata: { query, resultsCount: results.length },
    });
  } catch (err: any) {
    ctx.consecutiveErrors++;
    observation = `[ERROR]: web search failed: ${err?.message || 'unknown error'}`;
    ctx.callbacks.onLog(et('webErrorLog', { error: String(err?.message || err) }));
    ctx.callbacks.onStep({
      id: `step_search_fail_${Date.now()}`,
      timestamp: Date.now(),
      type: 'tool_result',
      toolName: 'web_search',
      content: et('webSearchFailed', { error: err?.message || et('unknownError') }),
      status: 'failed',
    });
  }
  const entry = ctx.pushExchange(assistantText, parsed.rawJson, observation, `[web_search "${query}" result shortened]`);
  if (readOnlySignature) ctx.seenActions.set(readOnlySignature, { step: ctx.stepCount, entry });
  return 'continue';
}

/** The "fetch_url" step of the agent loop. */
export async function handleFetchUrl(ctx: RunContext, { assistantText, parsed, payload, readOnlySignature }: Pick<StepVars, 'assistantText' | 'parsed' | 'payload' | 'readOnlySignature'>): Promise<LoopFlow> {
  const targetUrl: string = payload.url;
  ctx.callbacks.onStep({
    id: `step_fetch_${Date.now()}`,
    timestamp: Date.now(),
    type: 'tool_call',
    toolName: 'fetch_url',
    toolArgs: { url: targetUrl },
    content: et('webFetching', { url: targetUrl }),
  });
  ctx.callbacks.onLog(`WEB FETCH\nURL: ${targetUrl}`);
  let observation: string;
  try {
    const fetchResult = await WebAccessService.fetchUrl(targetUrl, {
      maxBytes: 256 * 1024,
      signal: ctx.engine.abortController?.signal,
    });
    ctx.consecutiveErrors = 0;
    ctx.repeatStreak = 0;
    ctx.stepsWithoutProgress = 0;
    const sizeKb = Math.round(fetchResult.sizeBytes / 1024);
    observation = wrapUntrustedWebResult(
      'fetch',
      fetchResult.title,
      `URL: ${fetchResult.url}\nTitle: ${fetchResult.title}\n\n${fetchResult.content.slice(0, 10000)}`
    );
    ctx.callbacks.onStep({
      id: `step_fetch_res_${Date.now()}`,
      timestamp: Date.now(),
      type: 'tool_result',
      toolName: 'fetch_url',
      content: et('webFetched', { title: fetchResult.title, size: sizeKb }),
      status: 'success',
      metadata: { url: fetchResult.url, status: fetchResult.status, sizeKb },
    });
  } catch (err: any) {
    ctx.consecutiveErrors++;
    observation = `[ERROR]: could not fetch the page: ${err?.message || 'unknown error'}`;
    ctx.callbacks.onLog(et('webErrorLog', { error: String(err?.message || err) }));
    ctx.callbacks.onStep({
      id: `step_fetch_fail_${Date.now()}`,
      timestamp: Date.now(),
      type: 'tool_result',
      toolName: 'fetch_url',
      content: et('webFetchFailed', { error: err?.message || et('unknownError') }),
      status: 'failed',
    });
  }
  const entry = ctx.pushExchange(assistantText, parsed.rawJson, observation, `[fetch_url "${targetUrl}" result shortened]`);
  if (readOnlySignature) ctx.seenActions.set(readOnlySignature, { step: ctx.stepCount, entry });
  return 'continue';
}
