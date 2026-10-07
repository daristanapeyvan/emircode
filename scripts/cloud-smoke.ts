/**
 * cloud-smoke.ts — live check of every cloud provider that has a key in the environment.
 *
 * For each provider (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, MISTRAL_API_KEY,
 * OLLAMA_API_KEY, and an OpenAI-compatible server from EMIR_COMPAT_URL) it runs the main process's
 * own CloudService, without Electron, and checks:
 *   1. list    — the model list can be read,
 *   2. chat    — a short answer streams back ("Reply with OK"),
 *   3. action  — one agent step with the agent's answer schema parses as a valid action,
 *   4. think   — the same with thinking and an effort level,
 *   5. native  — (Claude, GPT) one agent step in the experimental native tool mode,
 *   6. masked  — a wrong key is refused as "auth" and never shows in the error text.
 * It prints a table with the tokens and the time of each step and exits with 1 when a step failed.
 * Keys never leave the process and are never written to disk.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=… OPENAI_API_KEY=… node scripts/run-ts-test.mjs scripts/cloud-smoke.ts [--only=anthropic,openai]
 * Pick a model per provider with EMIR_SMOKE_MODEL_<PROVIDER> (EMIR_SMOKE_MODEL_ANTHROPIC=claude-haiku-4-5,
 * EMIR_SMOKE_MODEL_OLLAMA_CLOUD=gpt-oss:20b, EMIR_SMOKE_MODEL_COMPAT=…); otherwise a small current model
 * of the list is chosen.
 */
import { createBridge } from './cloud-bridge';
import type { CloudService } from '../electron/cloud/index';
import type { CloudChatRequest, CloudChunk, CloudEvent, CloudModelInfo } from '../electron/cloud/types';
import { BuiltinCloudProviderId, CLOUD_PROVIDERS, CloudProviderId, isCompatProvider, providerName } from '../src/lib/providers/modelRef';
import { ENV_KEYS } from '../electron/cloud/keyStore';
import { buildActionSchema, buildAgentSystemPrompt } from '../src/lib/agent/AgentProtocol';
import { ToolDispatcher } from '../src/lib/agent/ToolDispatcher';

const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const toolset = { web: false, git: false, ask: false, commands: true, checklist: false, readFiles: 8 };
const SYSTEM = buildAgentSystemPrompt({ securityProfile: 'autonomous', toolset, webSynthesisStrategy: 'auto', modificationStrategy: 'smart_injection', compact: false, large: true });
const SCHEMA = buildActionSchema(toolset, false);
const TASK = 'TASK: Show me which files the project has.\n\nPROJECT FILES (2):\n- index.html\n- style.css';

/** Small, current models first: the smoke test checks the plumbing, not the quality. */
const PREFERRED: Record<BuiltinCloudProviderId, RegExp[]> = {
  anthropic: [/^claude-haiku-4-5/, /^claude-sonnet/, /.*/],
  openai: [/^gpt-5-mini$/, /^gpt-5-nano$/, /^gpt-4\.1-mini$/, /^gpt-5$/, /.*/],
  gemini: [/^gemini-2\.5-flash$/, /^gemini-2\.5-flash-lite$/, /flash/, /.*/],
  mistral: [/^mistral-small-latest$/, /^mistral-medium-latest$/, /-latest$/, /.*/],
  'ollama-cloud': [/^gpt-oss:20b/, /^gpt-oss/, /.*/],
};

interface Row {
  provider: string;
  model: string;
  step: string;
  ok: boolean;
  ms: number;
  tokens: string;
  note: string;
}
const rows: Row[] = [];

function pickModel(provider: CloudProviderId, models: CloudModelInfo[]): string | null {
  const envName = `EMIR_SMOKE_MODEL_${isCompatProvider(provider) ? 'COMPAT' : provider.replace(/-/g, '_').toUpperCase()}`;
  if (process.env[envName]) return process.env[envName]!;
  if (isCompatProvider(provider)) return models[0]?.id || null;
  for (const pattern of PREFERRED[provider as BuiltinCloudProviderId]) {
    const hit = models.find((m) => pattern.test(m.id));
    if (hit) return hit.id;
  }
  return null;
}

/** One streamed request through the service; resolves with the text, the thinking and the last chunk. */
function ask(service: CloudService, request: CloudChatRequest): Promise<{ text: string; thinking: string; done: CloudChunk | null; error: CloudEvent | null }> {
  return new Promise((resolve) => {
    let text = '';
    let thinking = '';
    let done: CloudChunk | null = null;
    const id = `smoke_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6)}`;
    const timer = setTimeout(() => {
      service.abort(id);
      resolve({ text, thinking, done, error: { requestId: id, type: 'error', error: { code: 'network', message: 'timed out after 180 s' } } });
    }, 180000);
    const started = service.chat(id, request, (event) => {
      if (event.type === 'chunk') {
        text += event.chunk.message?.content || '';
        thinking += event.chunk.message?.thinking || '';
        if (event.chunk.done) done = event.chunk;
      } else {
        clearTimeout(timer);
        resolve({ text, thinking, done, error: event.type === 'error' ? event : null });
      }
    });
    if (!started.ok) {
      clearTimeout(timer);
      resolve({ text, thinking, done, error: { requestId: id, type: 'error', error: started.error } });
    }
  });
}

const tokens = (done: CloudChunk | null) =>
  done ? `${done.prompt_eval_count ?? 0}${done.cached_prompt_count ? ` (${done.cached_prompt_count} cached)` : ''} → ${done.eval_count ?? 0}` : '';
const errorNote = (error: CloudEvent | null) => (error && error.type === 'error' ? `${error.error.code}: ${error.error.message.slice(0, 160)}` : '');

async function step(provider: string, model: string, name: string, run: () => Promise<{ ok: boolean; tokens?: string; note?: string }>) {
  const started = Date.now();
  let result: { ok: boolean; tokens?: string; note?: string };
  try {
    result = await run();
  } catch (err: any) {
    result = { ok: false, note: String(err?.message || err).slice(0, 160) };
  }
  rows.push({ provider, model, step: name, ok: result.ok, ms: Date.now() - started, tokens: result.tokens || '', note: result.note || '' });
  console.log(`${result.ok ? '✅' : '❌'} ${provider} ${model} ${name}${result.note ? ` — ${result.note}` : ''}`);
}

function parsedAction(text: string): { ok: boolean; note: string } {
  const parsed = ToolDispatcher.parseActionFromResponse(text);
  const problem = parsed.type === 'unknown' ? parsed.error || 'no action' : ToolDispatcher.validateAction(parsed);
  return { ok: !problem, note: problem ? `${problem} — ${text.slice(0, 120)}` : `${parsed.type}` };
}

async function smokeProvider(service: CloudService, provider: CloudProviderId) {
  const label = providerName(provider);
  let model = '';
  let models: CloudModelInfo[] = [];
  await step(label, '-', 'list', async () => {
    const res = await service.listModels(provider);
    if (!res.ok) return { ok: false, note: `${res.error.code}: ${res.error.message.slice(0, 160)}` };
    models = res.models;
    model = pickModel(provider, models) || '';
    return { ok: models.length > 0 && !!model, note: `${models.length} models, testing ${model || 'none'}` };
  });
  if (!model) return;
  const base = { provider, model, system: SYSTEM, options: { num_predict: 2048 } } as const;

  await step(label, model, 'chat', async () => {
    const r = await ask(service, { provider, model, messages: [{ role: 'user', content: 'Reply with exactly the word OK and nothing else.' }], options: { num_predict: 256 } });
    return { ok: !r.error && /\bOK\b/i.test(r.text), tokens: tokens(r.done), note: errorNote(r.error) || r.text.trim().slice(0, 40) };
  });
  await step(label, model, 'action', async () => {
    const r = await ask(service, { ...base, messages: [{ role: 'user', content: TASK }], format: SCHEMA });
    if (r.error) return { ok: false, note: errorNote(r.error) };
    return { ...parsedAction(r.text), tokens: tokens(r.done) };
  });
  await step(label, model, 'think', async () => {
    const r = await ask(service, { ...base, messages: [{ role: 'user', content: TASK }], format: SCHEMA, think: true, effort: 'low', summaries: true });
    if (r.error) return { ok: false, note: errorNote(r.error) };
    const action = parsedAction(r.text);
    return { ok: action.ok, tokens: tokens(r.done), note: `${action.note}${r.thinking ? ` · ${r.thinking.length} chars of thinking` : ' · no thinking shown'}` };
  });
  if (provider === 'anthropic' || provider === 'openai') {
    await step(label, model, 'native', async () => {
      const r = await ask(service, { ...base, messages: [{ role: 'user', content: TASK }], format: SCHEMA, nativeTools: true });
      if (r.error) return { ok: false, note: errorNote(r.error) };
      return { ...parsedAction(r.text), tokens: tokens(r.done) };
    });
  }
  if (!isCompatProvider(provider)) {
    await step(label, '-', 'masked', async () => {
      const wrong = `sk-wrong-${'x7Q2'.repeat(10)}-smoke`;
      const res = await service.setKey(provider, wrong);
      if (res.ok) return { ok: false, note: 'a wrong key was accepted' };
      const leaked = res.error.message.includes(wrong) || res.error.message.includes(wrong.slice(9, 30));
      return { ok: res.error.code === 'auth' && !leaked, note: `${res.error.code}${leaked ? ' — the key shows in the error' : ', key masked'}` };
    });
  }
}

async function main() {
  const { service, compatProvider } = await createBridge();
  const providers: CloudProviderId[] = CLOUD_PROVIDERS.filter((p) => !!String(process.env[ENV_KEYS[p]] || '').trim());
  if (compatProvider) providers.push(compatProvider);
  const selected = only.length ? providers.filter((p) => only.includes(p) || (isCompatProvider(p) && only.includes('compat'))) : providers;
  if (selected.length === 0) {
    console.log(`No provider to test: set one of ${Object.values(ENV_KEYS).join(', ')} or EMIR_COMPAT_URL.`);
    process.exit(2);
  }
  for (const provider of selected) await smokeProvider(service, provider);

  console.log('\n| Provider | Model | Step | Result | Time | Tokens (in → out) | Note |');
  console.log('| --- | --- | --- | --- | --- | --- | --- |');
  for (const r of rows) console.log(`| ${r.provider} | ${r.model} | ${r.step} | ${r.ok ? 'ok' : 'FAILED'} | ${(r.ms / 1000).toFixed(1)} s | ${r.tokens} | ${r.note.replace(/\|/g, '/')} |`);
  const failed = rows.filter((r) => !r.ok).length;
  console.log(failed ? `\n${failed} step(s) failed.` : '\nEvery step passed.');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
