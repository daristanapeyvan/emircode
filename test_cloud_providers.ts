/**
 * test_cloud_providers.ts
 * Cloud models (Ollama Cloud, Claude, GPT) without a network: model references, the answer schema
 * for structured outputs, the request each provider gets, the translation of their streams into
 * Ollama chunks, error codes, the key store, the main-process service, the renderer's gateway, the
 * runtime profile of cloud models and a whole agent task on a scripted cloud model.
 *
 * Run: node scripts/run-ts-test.mjs test_cloud_providers.ts
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  CLOUD_MODEL_ID_RE,
  cloudOwner,
  formatModelRef,
  isCloudRef,
  isOllamaCloudTag,
  modelLabel,
  modelShortName,
  parseModelRef,
  runsInCloud,
} from './src/lib/providers/modelRef';
import { flattenSchema, sanitizeSchema } from './electron/cloud/schema';
import { CloudFailure, HttpStatusError, classifyCloudError } from './electron/cloud/errors';
import { imageMediaType, splitConversation, StreamClock } from './electron/cloud/messages';
import {
  AnthropicStreamTranslator,
  FALLBACK_BETA,
  anthropicCapsFromModel,
  anthropicModelInfo,
  buildAnthropicParams,
  guessAnthropicCaps,
  runAnthropic,
} from './electron/cloud/anthropic';
import { OpenAIStreamTranslator, buildOpenAIParams, guessOpenAIModel, isChatModel, isReasoningModel, runOpenAI } from './electron/cloud/openai';
import { buildOllamaCloudBody, listOllamaCloudModels, runOllamaCloud } from './electron/cloud/ollamaCloud';
import { KeyStore, SecretBox, maskKey, validKeyFormat } from './electron/cloud/keyStore';
import { CloudService, validateChatRequest } from './electron/cloud/index';
import type { CloudChatRequest, CloudChunk, CloudEvent } from './electron/cloud/types';
import { buildActionSchema } from './src/lib/agent/AgentProtocol';
import { CATEGORY_SCHEMA } from './src/lib/design/categorize';
import { CloudRequestError, buildCloudRequest, modelGateway } from './src/lib/providers/ModelGateway';
import { cloudErrorText } from './src/lib/providers/errorText';
import { en } from './src/lib/localization/translations/en';
import { tr } from './src/lib/localization/translations/tr';
import {
  CLOUD_DEFAULT_CONTEXT,
  buildCloudRuntimeInfo,
  buildRuntimeInfo,
  getModelRuntimeInfo,
  registerCloudModels,
  resolveCloudContextLength,
  resolveRequestProfile,
  resolveThinkParam,
} from './src/lib/ollama/ModelRuntime';
import { ollamaClient } from './src/lib/ollama/OllamaClient';
import { agentEngine } from './src/lib/agent/AgentEngine';
import { makeElectronApi } from './scripts/electron-api-mock';

let passed = 0;
let completed = false;
const failures: string[] = [];
// A promise that never settles empties the event loop and would end the run silently with code 0.
process.on('beforeExit', () => {
  if (completed) return;
  console.error('❌ The tests stopped before the end (a request never finished)');
  process.exit(1);
});
function check(condition: boolean, label: string, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`✅ ${label}`);
  } else {
    failures.push(label);
    console.log(`❌ ${label}`);
    if (detail !== undefined) console.log('   →', typeof detail === 'string' ? detail.slice(0, 800) : JSON.stringify(detail).slice(0, 800));
  }
}
const section = (title: string) => console.log(`\n--- ${title} ---`);

async function* iterate<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk';
const JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD';
const contentOf = (chunks: CloudChunk[]) => chunks.map((c) => c.message?.content || '').join('');
const thinkingOf = (chunks: CloudChunk[]) => chunks.map((c) => c.message?.thinking || '').join('');
const allKeys = (node: unknown, out = new Set<string>()): Set<string> => {
  if (Array.isArray(node)) node.forEach((n) => allKeys(n, out));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      out.add(k);
      allKeys(v, out);
    }
  }
  return out;
};
const objectsWithoutClosedProps = (node: any): number => {
  if (Array.isArray(node)) return node.reduce((n, x) => n + objectsWithoutClosedProps(x), 0);
  if (!node || typeof node !== 'object') return 0;
  let n = node.type === 'object' && node.additionalProperties !== false ? 1 : 0;
  for (const v of Object.values(node)) n += objectsWithoutClosedProps(v);
  return n;
};

async function main() {
  // ---------------------------------------------------------------------------
  section('1. Model references');
  // ---------------------------------------------------------------------------
  check(parseModelRef('qwen2.5-coder:7b').provider === 'ollama' && parseModelRef('qwen2.5-coder:7b').model === 'qwen2.5-coder:7b', 'A saved plain name stays a local Ollama model');
  check(parseModelRef('hf.co/user/model:q4').provider === 'ollama', 'Names with slashes stay local too');
  check(
    parseModelRef('anthropic::claude-opus-5-5').provider === 'anthropic' &&
      parseModelRef('ollama-cloud::gpt-oss:120b').model === 'gpt-oss:120b' &&
      parseModelRef('openai::gpt-5').provider === 'openai',
    'provider::model names a cloud model, the model id may contain colons'
  );
  check(parseModelRef('evil::x').provider === 'ollama' && parseModelRef('::x').provider === 'ollama', 'An unknown provider prefix is not a cloud model');
  check(formatModelRef('anthropic', 'claude-sonnet-5-5') === 'anthropic::claude-sonnet-5-5' && formatModelRef('ollama', 'qwen3:8b') === 'qwen3:8b', 'References round-trip');
  check(isCloudRef('openai::gpt-5') && !isCloudRef('qwen3:8b') && !isCloudRef('gpt-oss:120b-cloud'), 'isCloudRef: only models reached with an API key');
  check(isOllamaCloudTag('gpt-oss:120b-cloud') && isOllamaCloudTag('glm-4.6:cloud') && !isOllamaCloudTag('qwen3:8b') && !isOllamaCloudTag('cloud:7b'), '"-cloud" tags of the local Ollama are recognised');
  check(runsInCloud('gpt-oss:120b-cloud') && runsInCloud('anthropic::claude-opus-5-5') && !runsInCloud('qwen3:8b'), 'runsInCloud covers both ways to Ollama Cloud');
  check(cloudOwner('gpt-oss:20b-cloud') === 'ollama-cloud' && cloudOwner('openai::gpt-5') === 'openai' && cloudOwner('qwen3:8b') === null, 'The owner of a cloud model is named');
  check(modelLabel('anthropic::claude-opus-5-5') === 'claude-opus-5-5 · Claude' && modelLabel('qwen3:8b') === 'qwen3:8b' && modelShortName('openai::gpt-5') === 'gpt-5', 'Labels are readable');
  check(CLOUD_MODEL_ID_RE.test('claude-opus-5-5') && CLOUD_MODEL_ID_RE.test('gpt-oss:120b') && !CLOUD_MODEL_ID_RE.test('a b') && !CLOUD_MODEL_ID_RE.test('-x'), 'Model ids are checked');

  // ---------------------------------------------------------------------------
  section('2. The answer schema for Claude and GPT');
  // ---------------------------------------------------------------------------
  const toolset = { web: true, git: true, ask: true, commands: true, checklist: true };
  const actionSchema = buildActionSchema(toolset, false);
  const flat = flattenSchema(actionSchema);
  const keys = Object.keys(flat.properties);
  check(flat.type === 'object' && keys[0] === 'thought' && keys[1] === 'action', 'The variants become one object, "thought" first and "action" second', keys);
  const actions: string[] = flat.properties.action.enum;
  check(
    ['list_dir', 'read_file', 'write_file', 'edit_file', 'replace_lines', 'search_code', 'delete_file', 'run_command', 'git_status', 'git_diff', 'web_search', 'fetch_url', 'ask_user', 'finish'].every((a) => actions.includes(a)),
    'Every tool is in the action enum',
    actions
  );
  check(JSON.stringify(flat.required) === JSON.stringify(['thought', 'action']), 'Only what every action needs is required; ToolDispatcher checks the rest', flat.required);
  const flatKeys = allKeys(flat);
  check(!flatKeys.has('minLength') && !flatKeys.has('maxLength') && !flatKeys.has('anyOf'), 'Unsupported keywords are removed');
  check(objectsWithoutClosedProps(flat) === 0 && flat.properties.checklist_done?.type === 'array', 'Every object is closed (additionalProperties: false), checklist_done stays');
  const category = sanitizeSchema(CATEGORY_SCHEMA) as any;
  check(category.additionalProperties === false && Array.isArray(category.properties.category.enum) && category.required[0] === 'category', 'A plain object schema is only cleaned');
  check(JSON.stringify(flattenSchema(actionSchema)) === JSON.stringify(flat), 'The same schema gives the same result (stable for caching)');

  // ---------------------------------------------------------------------------
  section('3. Messages');
  // ---------------------------------------------------------------------------
  check(imageMediaType(PNG) === 'image/png' && imageMediaType(JPEG) === 'image/jpeg' && imageMediaType('R0lGODlh') === 'image/gif' && imageMediaType('UklGRiQ') === 'image/webp', 'Image types are read from the data');
  const split = splitConversation({
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    system: 'Base rules',
    messages: [
      { role: 'assistant', content: 'leading assistant' },
      { role: 'system', content: 'Extra rule' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: '' },
      { role: 'tool', content: 'tool output' },
      { role: 'assistant', content: 'trailing' },
    ],
  });
  check(split.system === 'Base rules\n\nExtra rule', 'System messages join the system prompt', split.system);
  check(
    split.messages.length === 2 && split.messages[0].role === 'user' && split.messages[1].role === 'user' && split.messages[1].content === 'tool output',
    'The conversation starts and ends with the user; empty messages are dropped; tool results count as user messages',
    split.messages
  );
  let fakeNow = 1000;
  const clock = new StreamClock(() => fakeNow);
  fakeNow = 1600;
  clock.mark();
  fakeNow = 2600;
  const d = clock.durations();
  check(d.prompt_eval_duration === 600e6 && d.eval_duration === 1000e6 && d.total_duration === 1600e6 && d.load_duration === 0, 'Durations are measured like Ollama reports them (ns)', d);

  // ---------------------------------------------------------------------------
  section('4. Claude: request');
  // ---------------------------------------------------------------------------
  const opus = guessAnthropicCaps('claude-opus-5-5');
  const haiku = guessAnthropicCaps('claude-haiku-4-5');
  check(opus.adaptiveThinking && !opus.budgetThinking && opus.structuredOutput && opus.contextWindow === 1_000_000, 'Current Claude models: adaptive thinking, structured output, 1M context', opus);
  check(!haiku.adaptiveThinking && haiku.budgetThinking && haiku.structuredOutput && haiku.contextWindow === 200_000, 'Claude Haiku 4.5: thinking with a budget, 200K context', haiku);
  const apiModel = {
    id: 'claude-sonnet-5-5',
    display_name: 'Claude Sonnet 5.5',
    created_at: '2026-08-01T00:00:00Z',
    max_input_tokens: 1000000,
    max_tokens: 128000,
    capabilities: { image_input: { supported: true }, structured_outputs: { supported: true }, thinking: { supported: true, types: { adaptive: { supported: true }, enabled: { supported: false } } } },
  };
  const sonnetCaps = anthropicCapsFromModel(apiModel);
  const sonnetInfo = anthropicModelInfo(apiModel);
  check(sonnetCaps.adaptiveThinking && !sonnetCaps.budgetThinking && sonnetCaps.maxOutput === 128000, 'Capabilities come from the Models API entry', sonnetCaps);
  check(sonnetInfo.label === 'Claude Sonnet 5.5' && sonnetInfo.contextWindow === 1000000 && sonnetInfo.thinking === 'adaptive' && sonnetInfo.vision === true, 'The model list shows the display name and the context window', sonnetInfo);

  const agentRequest: CloudChatRequest = {
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    system: 'You are Emir Code.',
    messages: [
      { role: 'user', content: 'Create index.html', images: [PNG] },
      { role: 'assistant', content: '{"thought":"x","action":"list_dir","path":"."}' },
      { role: 'user', content: '[list_dir] index.html' },
    ],
    options: { temperature: 0.6, top_p: 0.85, top_k: 20, num_ctx: 65536, num_predict: 9000 },
    format: actionSchema,
    think: true,
  };
  const ap = buildAnthropicParams(agentRequest, opus, { fallbacks: true }) as any;
  check(ap.model === 'claude-opus-5-5' && ap.stream === true && ap.max_tokens === 9000 && ap.system === 'You are Emir Code.', 'Model, output limit and system prompt', { model: ap.model, max: ap.max_tokens });
  check(ap.temperature === undefined && ap.top_p === undefined && ap.top_k === undefined, 'No sampling parameters (current Claude models reject them)');
  check(ap.cache_control?.type === 'ephemeral', 'The prompt is cached between agent steps');
  check(ap.thinking?.type === 'adaptive' && ap.thinking?.display === 'summarized', '"Think before each step" becomes adaptive thinking with a readable summary', ap.thinking);
  check(ap.output_config?.format?.type === 'json_schema' && ap.output_config.format.schema.properties.action.enum.includes('finish'), 'The answer schema goes as structured output');
  check(ap.fallbacks === 'default' && JSON.stringify(ap.betas) === JSON.stringify([FALLBACK_BETA]), 'Models with safety classifiers get the server-side fallback');
  const firstContent = ap.messages[0].content;
  check(
    Array.isArray(firstContent) && firstContent[0].type === 'image' && firstContent[0].source.media_type === 'image/png' && firstContent[1].type === 'text',
    'Images become image blocks before the text',
    firstContent
  );
  const hp = buildAnthropicParams({ ...agentRequest, model: 'claude-haiku-4-5', think: true, options: { num_predict: 8192 } }, haiku, { fallbacks: true }) as any;
  check(hp.thinking?.type === 'enabled' && hp.thinking.budget_tokens === 4096 && hp.fallbacks === undefined && hp.betas === undefined, 'Haiku gets a thinking budget below max_tokens and no fallback field', hp.thinking);
  const off = buildAnthropicParams({ ...agentRequest, think: false, format: undefined, options: {} }, opus) as any;
  check(off.thinking === undefined && off.output_config === undefined && off.max_tokens === 16384 && off.fallbacks === undefined, 'Without thinking and schema: the model\'s defaults, 16K output');
  const noStructured = buildAnthropicParams(agentRequest, { ...opus, structuredOutput: false }) as any;
  check(noStructured.output_config === undefined, 'A model without structured outputs gets the schema only through the prompt');
  let threw = '';
  try {
    buildAnthropicParams({ ...agentRequest, messages: [{ role: 'assistant', content: 'x' }] }, opus);
  } catch (err: any) {
    threw = err?.code;
  }
  check(threw === 'invalid', 'A conversation without a user message is refused before sending');

  // ---------------------------------------------------------------------------
  section('5. Claude: stream');
  // ---------------------------------------------------------------------------
  const tr1 = new AnthropicStreamTranslator('claude-opus-5-5');
  const events = [
    { type: 'message_start', message: { model: 'claude-opus-5-5', usage: { input_tokens: 120, cache_read_input_tokens: 3000, cache_creation_input_tokens: 400, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Plan: list the folder.' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '' } },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '{"thought":"ok",' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '"action":"finish","summary":"done"}' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 42 } },
    { type: 'message_stop' },
  ];
  const chunks1 = events.flatMap((e) => tr1.handle(e));
  const done1 = tr1.finish().at(-1)!;
  check(contentOf(chunks1) === '{"thought":"ok","action":"finish","summary":"done"}' && thinkingOf(chunks1) === 'Plan: list the folder.', 'Text and thinking arrive as Ollama content and thinking');
  check(done1.done && done1.done_reason === 'stop' && done1.prompt_eval_count === 3520 && done1.cached_prompt_count === 3000 && done1.eval_count === 42, 'The last chunk counts the whole prompt (cached parts included) and the output', done1);
  const tr2 = new AnthropicStreamTranslator('claude-opus-5-5');
  tr2.handle({ type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 9000 } });
  check(tr2.finish().at(-1)!.done_reason === 'length', 'max_tokens means "length", so the agent raises its output limit');
  const tr3 = new AnthropicStreamTranslator('claude-opus-5-5');
  tr3.handle({ type: 'message_delta', delta: { stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' } } });
  let refusal: any = null;
  try {
    tr3.finish();
  } catch (err) {
    refusal = classifyCloudError(err);
  }
  check(refusal?.code === 'refusal' && refusal?.category === 'cyber', 'A refusal becomes an error with its category', refusal);

  const calls: any[] = [];
  const fakeAnthropic: any = {
    beta: {
      messages: {
        create: async (params: any) => {
          calls.push(params);
          if (calls.length === 1) throw Object.assign(new Error('fallbacks: this model does not accept fallbacks'), { status: 400 });
          return iterate(events);
        },
      },
    },
  };
  const emitted: CloudChunk[] = [];
  await runAnthropic(fakeAnthropic, agentRequest, opus, (c) => emitted.push(c), new AbortController().signal);
  check(calls.length === 2 && calls[0].fallbacks === 'default' && calls[1].fallbacks === undefined && calls[1].betas === undefined, 'A rejected fallback field is dropped and the request sent once more', calls.map((c) => c.fallbacks));
  check(emitted[emitted.length - 1].done === true && contentOf(emitted).includes('"finish"'), 'runAnthropic streams the answer and ends with the done chunk');

  // ---------------------------------------------------------------------------
  section('6. GPT: request and stream');
  // ---------------------------------------------------------------------------
  check(isReasoningModel('gpt-5') && isReasoningModel('o4-mini') && !isReasoningModel('gpt-4.1') && !isReasoningModel('gpt-5-chat-latest'), 'Reasoning models are recognised');
  check(
    isChatModel('gpt-5') && isChatModel('gpt-4.1-mini') && isChatModel('o3') && !isChatModel('text-embedding-3-large') && !isChatModel('gpt-4o-2024-08-06') && !isChatModel('gpt-4o-mini-tts') && !isChatModel('dall-e-3') && !isChatModel('gpt-4o-realtime-preview'),
    'The model list keeps chat models and drops embeddings, speech, images and dated snapshots'
  );
  check(guessOpenAIModel('gpt-5').contextWindow === 400_000 && guessOpenAIModel('gpt-4.1').contextWindow === 1_047_576 && guessOpenAIModel('gpt-4o').vision === true, 'Context windows and vision of GPT models');
  const op = buildOpenAIParams({ ...agentRequest, provider: 'openai', model: 'gpt-5' }) as any;
  check(op.messages[0].role === 'system' && op.messages[0].content === 'You are Emir Code.' && op.stream === true && op.stream_options?.include_usage === true, 'System message first, streaming with usage');
  check(op.temperature === undefined && op.top_p === undefined && op.max_completion_tokens === 9000, 'No sampling parameters; the output limit is max_completion_tokens');
  check(op.response_format?.type === 'json_schema' && op.response_format.json_schema.strict === false && op.response_format.json_schema.schema.type === 'object', 'The answer schema goes as a non-strict JSON schema');
  check(op.reasoning_effort === 'medium', 'Thinking becomes a reasoning effort on reasoning models');
  const userParts = op.messages[1].content;
  check(Array.isArray(userParts) && userParts[1].type === 'image_url' && userParts[1].image_url.url.startsWith('data:image/png;base64,'), 'Images become data URLs');
  const op41 = buildOpenAIParams({ ...agentRequest, provider: 'openai', model: 'gpt-4.1', format: 'json', think: true }) as any;
  check(op41.reasoning_effort === undefined && op41.response_format?.type === 'json_object', 'Non-reasoning models get no reasoning effort; "json" is JSON mode');

  const otr = new OpenAIStreamTranslator('gpt-5');
  const ochunks = [
    { model: 'gpt-5-2026', choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] },
    { choices: [{ index: 0, delta: { content: 'Hel' } }] },
    { choices: [{ index: 0, delta: { content: 'lo' }, finish_reason: 'stop' }] },
    { choices: [], usage: { prompt_tokens: 2000, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 1024 } } },
  ].flatMap((c) => otr.handle(c));
  const odone = otr.finish().at(-1)!;
  check(contentOf(ochunks) === 'Hello' && odone.prompt_eval_count === 2000 && odone.cached_prompt_count === 1024 && odone.eval_count === 5 && odone.done_reason === 'stop', 'Chat Completions chunks become Ollama chunks with the usage', odone);
  const lengthTr = new OpenAIStreamTranslator('gpt-5');
  lengthTr.handle({ choices: [{ index: 0, delta: {}, finish_reason: 'length' }] });
  check(lengthTr.finish().at(-1)!.done_reason === 'length', 'finish_reason "length" is passed on');
  const filtered = new OpenAIStreamTranslator('gpt-5');
  filtered.handle({ choices: [{ index: 0, delta: {}, finish_reason: 'content_filter' }] });
  let filterErr: any = null;
  try {
    filtered.finish();
  } catch (err) {
    filterErr = classifyCloudError(err);
  }
  check(filterErr?.code === 'refusal', 'The content filter is a refusal');
  const oEmitted: CloudChunk[] = [];
  let oParams: any = null;
  await runOpenAI(
    { chat: { completions: { create: async (p: any) => ((oParams = p), iterate([{ choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] }])) } } } as any,
    { provider: 'openai', model: 'gpt-4.1', messages: [{ role: 'user', content: 'hi' }] },
    (c) => oEmitted.push(c),
    new AbortController().signal
  );
  check(oParams?.model === 'gpt-4.1' && contentOf(oEmitted) === 'ok' && oEmitted[oEmitted.length - 1].done, 'runOpenAI streams the answer');

  // ---------------------------------------------------------------------------
  section('7. Ollama Cloud with an API key');
  // ---------------------------------------------------------------------------
  const body = buildOllamaCloudBody({ ...agentRequest, provider: 'ollama-cloud', model: 'gpt-oss:120b' }) as any;
  check(
    body.model === 'gpt-oss:120b' && body.messages[0].role === 'system' && body.stream === true && body.options.temperature === 0.6 && body.think === true && body.format === actionSchema,
    'The Ollama request goes as it is (sampling, think, format), the system prompt first'
  );
  const requests: Array<{ url: string; init: any }> = [];
  const ndjson = (lines: unknown[]) =>
    new Response(new Blob([lines.map((l) => JSON.stringify(l)).join('\n')]).stream(), { status: 200 });
  const fakeFetch: any = async (url: string, init: any) => {
    requests.push({ url, init });
    if (url.endsWith('/api/tags')) return new Response(JSON.stringify({ models: [{ name: 'qwen3-coder:480b', model: 'qwen3-coder:480b', details: { parameter_size: '480B', family: 'qwen3moe' } }] }), { status: 200 });
    return ndjson([
      { model: 'gpt-oss:120b', message: { role: 'assistant', content: 'Hi', thinking: 'hm' }, done: false },
      { model: 'gpt-oss:120b', message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 50, eval_count: 2 },
    ]);
  };
  const ocChunks: CloudChunk[] = [];
  await runOllamaCloud('ollama_key_123456', { provider: 'ollama-cloud', model: 'gpt-oss:120b', messages: [{ role: 'user', content: 'hi' }] }, (c) => ocChunks.push(c), new AbortController().signal, fakeFetch);
  check(requests[0].url === 'https://ollama.com/api/chat' && requests[0].init.headers.Authorization === 'Bearer ollama_key_123456' && requests[0].init.redirect === 'manual', 'Only https://ollama.com is called, with the key and no redirects');
  check(contentOf(ocChunks) === 'Hi' && thinkingOf(ocChunks) === 'hm' && ocChunks[1].done && ocChunks[1].prompt_eval_count === 50, 'The NDJSON stream arrives as it is');
  const ocModels = await listOllamaCloudModels('ollama_key_123456', undefined, fakeFetch);
  check(ocModels.length === 1 && ocModels[0].id === 'qwen3-coder:480b' && ocModels[0].parameterSize === '480B' && ocModels[0].provider === 'ollama-cloud', 'The cloud model list comes from ollama.com/api/tags');
  let redirectErr: any = null;
  try {
    await runOllamaCloud('k_12345678', { provider: 'ollama-cloud', model: 'x', messages: [{ role: 'user', content: 'hi' }] }, () => {}, new AbortController().signal, (async () => new Response(null, { status: 302, headers: { Location: 'https://evil.example' } })) as any);
  } catch (err) {
    redirectErr = err;
  }
  check(redirectErr instanceof HttpStatusError && redirectErr.status === 302, 'A redirect is an error: the key never goes to another host');
  let authErr: any = null;
  try {
    await runOllamaCloud('k_12345678', { provider: 'ollama-cloud', model: 'x', messages: [{ role: 'user', content: 'hi' }] }, () => {}, new AbortController().signal, (async () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })) as any);
  } catch (err) {
    authErr = classifyCloudError(err);
  }
  check(authErr?.code === 'auth' && authErr?.message === 'unauthorized', 'HTTP 401 from ollama.com is an auth error with its message', authErr);
  let midErr: any = null;
  try {
    await runOllamaCloud('k_12345678', { provider: 'ollama-cloud', model: 'x', messages: [{ role: 'user', content: 'hi' }] }, () => {}, new AbortController().signal, (async () => ndjson([{ error: 'model runner crashed' }])) as any);
  } catch (err) {
    midErr = err;
  }
  check(midErr?.message === 'model runner crashed', 'An error inside the stream ends the request');

  // ---------------------------------------------------------------------------
  section('8. Error codes');
  // ---------------------------------------------------------------------------
  const code = (err: unknown) => classifyCloudError(err).code;
  check(code({ status: 401, message: 'invalid x-api-key' }) === 'auth' && code({ status: 403, message: 'permission' }) === 'auth', '401/403 → auth');
  check(code({ status: 429, error: { error: { type: 'rate_limit_error', message: 'slow down' } } }) === 'rate_limit', '429 → rate_limit');
  check(code({ status: 429, code: 'insufficient_quota', message: 'You exceeded your current quota' }) === 'quota', '429 with insufficient_quota → quota');
  check(code({ status: 400, message: 'Your credit balance is too low to access the Anthropic API.' }) === 'quota', 'Anthropic\'s low credit balance → quota');
  check(code({ status: 400, message: 'prompt is too long: 250000 tokens > 200000 maximum' }) === 'context_length', 'A prompt that is too long → context_length');
  check(code({ status: 400, message: 'output_config.format.schema: unsupported keyword' }) === 'format_unsupported', 'A rejected schema → format_unsupported');
  check(code({ status: 400, message: "Unsupported value: 'reasoning_effort' is not supported with this model." }) === 'think_unsupported', 'A rejected reasoning setting → think_unsupported');
  check(code({ status: 400, message: 'messages: text content blocks must be non-empty' }) === 'bad_request', 'Other 400s → bad_request');
  check(code({ status: 404, message: 'model: claude-x' }) === 'not_found' && code({ status: 529, message: 'Overloaded' }) === 'overloaded' && code({ status: 503 }) === 'overloaded', '404 → not_found, 529/5xx → overloaded');
  check(code({ name: 'APIConnectionError', message: 'Connection error.' }) === 'network' && code(new TypeError('fetch failed')) === 'network', 'Connection errors → network');
  check(code({ name: 'APIUserAbortError', message: 'Request was aborted.' }) === 'aborted', 'A stopped request → aborted');
  check(code(new CloudFailure('no_key', 'x')) === 'no_key', 'Own failures keep their code');

  // ---------------------------------------------------------------------------
  section('9. The key store');
  // ---------------------------------------------------------------------------
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'emir-keys-'));
  const box = (available: boolean): SecretBox => ({
    available: () => available,
    encrypt: (text) => Buffer.from(`sealed:${Buffer.from(text).toString('hex').split('').reverse().join('')}`),
    decrypt: (data) => Buffer.from(data.toString().slice(7).split('').reverse().join(''), 'hex').toString(),
  });
  const file = path.join(tmp, 'cloud_keys.json');
  const key = 'sk-ant-api03-SECRETSECRETSECRET-abcd';
  const store = new KeyStore(file, box(true), {});
  check(store.set('anthropic', key).persisted && store.get('anthropic') === key, 'A key is saved and read back');
  const onDisk = fs.readFileSync(file, 'utf-8');
  check(!onDisk.includes(key) && !onDisk.includes('SECRET') && onDisk.includes('"anthropic"'), 'The file holds only the encrypted key');
  if (process.platform !== 'win32') check((fs.statSync(file).mode & 0o077) === 0, 'Only the user can read the file');
  const status = store.status();
  check(status.providers.anthropic.configured && status.providers.anthropic.source === 'saved' && status.providers.anthropic.hint === '…abcd' && !JSON.stringify(status).includes('SECRET'), 'The status names the source and the last characters only', status.providers.anthropic);
  check(new KeyStore(file, box(true), {}).get('anthropic') === key, 'A new start reads the saved key');
  check(new KeyStore(file, box(false), {}).get('anthropic') === null, 'Without the system key store a saved key cannot be read');
  const sessionStore = new KeyStore(path.join(tmp, 'session.json'), box(false), {});
  check(!sessionStore.set('openai', 'sk-proj-SESSIONKEY1234').persisted && sessionStore.get('openai') === 'sk-proj-SESSIONKEY1234' && !fs.existsSync(path.join(tmp, 'session.json')), 'Without a system key store the key lives in memory only');
  check(sessionStore.status().encryption === 'none' && sessionStore.status().providers.openai.source === 'session', 'The status says so');
  const envStore = new KeyStore(path.join(tmp, 'env.json'), box(true), { OLLAMA_API_KEY: 'ollama-env-key-9876' });
  check(envStore.get('ollama-cloud') === 'ollama-env-key-9876' && envStore.status().providers['ollama-cloud'].source === 'env', 'A key in the environment is used when none is saved');
  store.remove('anthropic');
  check(store.get('anthropic') === null && !fs.readFileSync(file, 'utf-8').includes('anthropic'), 'Removing forgets the key');
  check(validKeyFormat('sk-1234567890') && !validKeyFormat('short') && !validKeyFormat('with space key') && maskKey('abc') === '…', 'Key format and masking');

  // ---------------------------------------------------------------------------
  section('10. The main-process service');
  // ---------------------------------------------------------------------------
  const valid = validateChatRequest({ provider: 'openai', model: 'gpt-5', messages: [{ role: 'user', content: 'hi' }], options: { temperature: 0.5, evil: 'x', num_ctx: '9' }, think: 'high', format: [1] });
  check(valid.ok && (valid as any).request.options.temperature === 0.5 && !('evil' in (valid as any).request.options) && !('num_ctx' in (valid as any).request.options) && (valid as any).request.think === 'high' && (valid as any).request.format === undefined, 'Requests are copied field by field; unknown and wrong values are dropped');
  check(!validateChatRequest({ provider: 'cohere', model: 'x', messages: [{ role: 'user', content: 'hi' }] }).ok, 'Unknown providers are refused');
  check(!validateChatRequest({ provider: 'openai', model: 'bad model', messages: [{ role: 'user', content: 'hi' }] }).ok, 'Invalid model names are refused');
  check(!validateChatRequest({ provider: 'openai', model: 'gpt-5', messages: [{ role: 'root', content: 'hi' }] }).ok, 'Invalid roles are refused');
  check(!validateChatRequest({ provider: 'openai', model: 'gpt-5', messages: [{ role: 'user', content: 'x'.repeat(49 * 1024 * 1024) }] }).ok, 'Oversized requests are refused');
  const service = new CloudService(new KeyStore(path.join(tmp, 'service.json'), box(true), {}));
  const serviceEvents: CloudEvent[] = [];
  const started = service.chat('req_1', { provider: 'anthropic', model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'hi' }] }, (e) => serviceEvents.push(e));
  await new Promise((r) => setTimeout(r, 20));
  check(started.ok && serviceEvents.length === 1 && serviceEvents[0].type === 'error' && (serviceEvents[0] as any).error.code === 'no_key', 'Without a key the request ends with no_key', serviceEvents);
  check(!service.chat('bad id!', {}, () => {}).ok, 'Request ids are checked');
  const badKey = await service.setKey('anthropic', 'short');
  check(!badKey.ok && (badKey as any).error.code === 'invalid', 'A key that is not one is refused before any request');
  check(!(await service.listModels('nope')).ok, 'Model lists of unknown providers are refused');
  check(JSON.stringify(service.status()).indexOf('sk-') === -1, 'The status never carries a key');

  // ---------------------------------------------------------------------------
  section('11. The renderer\'s gateway');
  // ---------------------------------------------------------------------------
  let listener: ((e: CloudEvent) => void) | null = null;
  const aborted: string[] = [];
  let lastRequest: any = null;
  let mode: 'ok' | 'error' | 'hang' | 'refuse' = 'ok';
  const cloudApi = {
    onCloudEvent: (cb: (e: CloudEvent) => void) => ((listener = cb), () => (listener = null)),
    cloudAbort: async (id: string) => (aborted.push(id), true),
    cloudChat: async (requestId: string, request: any) => {
      lastRequest = request;
      if (mode === 'refuse') return { ok: false, error: { code: 'invalid', message: 'Invalid model name.' } };
      setTimeout(() => {
        if (mode === 'hang') return;
        if (mode === 'error') {
          listener?.({ requestId, type: 'error', error: { code: 'rate_limit', message: 'slow down', status: 429 } });
          return;
        }
        listener?.({ requestId, type: 'chunk', chunk: { model: 'm', created_at: '', message: { role: 'assistant', content: 'Hel' }, done: false } });
        listener?.({ requestId: 'someone_else', type: 'chunk', chunk: { model: 'm', created_at: '', message: { role: 'assistant', content: 'XX' }, done: false } });
        listener?.({ requestId, type: 'chunk', chunk: { model: 'm', created_at: '', message: { role: 'assistant', content: 'lo' }, done: true, done_reason: 'stop' } });
        listener?.({ requestId, type: 'end' });
      }, 5);
      return { ok: true };
    },
  };
  (globalThis as any).window = { electronAPI: cloudApi };
  const got: string[] = [];
  await modelGateway.chatStream(
    { model: 'anthropic::claude-opus-5-5', system: 'S', messages: [{ role: 'user', content: 'hi', images: [PNG] }], options: { num_ctx: 65536, stop: ['x'] }, keep_alive: '30m', think: true },
    (c) => got.push(c.message?.content || '')
  );
  check(got.join('') === 'Hello', 'Chunks of the request (and only those) reach the caller', got);
  check(lastRequest.provider === 'anthropic' && lastRequest.model === 'claude-opus-5-5' && lastRequest.system === 'S' && lastRequest.messages[0].images[0] === PNG && lastRequest.think === true && !('stop' in lastRequest.options) && !('keep_alive' in lastRequest), 'The cloud request carries provider, model, system, images and think', lastRequest);
  mode = 'error';
  let gwErr: any = null;
  try {
    await modelGateway.chatStream({ model: 'openai::gpt-5', messages: [{ role: 'user', content: 'hi' }] }, () => {});
  } catch (err) {
    gwErr = err;
  }
  check(gwErr instanceof CloudRequestError && gwErr.code === 'rate_limit' && gwErr.provider === 'openai' && gwErr.status === 429, 'A provider error arrives as CloudRequestError with its code');
  mode = 'refuse';
  let refuseErr: any = null;
  try {
    await modelGateway.chatStream({ model: 'openai::gpt-5', messages: [{ role: 'user', content: 'hi' }] }, () => {});
  } catch (err) {
    refuseErr = err;
  }
  check(refuseErr?.code === 'invalid', 'A request the main process refuses fails at once');
  mode = 'hang';
  const controller = new AbortController();
  const pending = modelGateway.chatStream({ model: 'ollama-cloud::gpt-oss:120b', messages: [{ role: 'user', content: 'hi' }] }, () => {}, controller.signal);
  setTimeout(() => controller.abort(), 10);
  let abortErr: any = null;
  try {
    await pending;
  } catch (err) {
    abortErr = err;
  }
  check(abortErr?.name === 'AbortError' && aborted.length === 1, 'Stopping rejects with AbortError and stops the request in the main process');
  let localCalled = '';
  const originalChat = ollamaClient.chatStream;
  (ollamaClient as any).chatStream = async (params: any) => {
    localCalled = params.model;
  };
  await modelGateway.chatStream({ model: 'qwen3:8b', messages: [{ role: 'user', content: 'hi' }] }, () => {});
  (ollamaClient as any).chatStream = originalChat;
  check(localCalled === 'qwen3:8b', 'Local models still go to Ollama');
  const built = buildCloudRequest('openai', 'gpt-5', { model: 'openai::gpt-5', messages: [{ role: 'user', content: 'x' }], format: 'json' });
  check(built.format === 'json' && built.options === undefined && built.system === undefined, 'Empty fields are left out of the request');

  // ---------------------------------------------------------------------------
  section('12. Error texts in both languages');
  // ---------------------------------------------------------------------------
  const authText = cloudErrorText(new CloudRequestError('anthropic', 'auth', 'invalid x-api-key'), 'anthropic::claude-opus-5-5', en.cloud);
  check(!!authText && authText.includes('Claude') && authText.includes('Settings › Cloud models'), 'An auth error names the provider and where to fix it', authText);
  const refusalText = cloudErrorText(new CloudRequestError('anthropic', 'refusal', 'declined', { category: 'cyber' }), 'anthropic::claude-opus-5-5', tr.cloud);
  check(!!refusalText && refusalText.includes('(cyber)') && refusalText.includes('reddetti'), 'A refusal names the category (Turkish)', refusalText);
  check(cloudErrorText(new Error('unauthorized'), 'gpt-oss:120b-cloud', en.cloud) === en.cloud.errOllamaSignin, 'A "-cloud" model of an Ollama that is not signed in explains "ollama signin"');
  check(cloudErrorText(new Error('connection refused'), 'qwen3:8b', en.cloud) === null, 'Local errors are left to the existing messages');

  // ---------------------------------------------------------------------------
  section('13. Runtime profile of cloud models');
  // ---------------------------------------------------------------------------
  registerCloudModels([
    { provider: 'anthropic', id: 'claude-opus-5-5', label: 'Claude Opus 5.5', contextWindow: 1_000_000, maxOutput: 128_000, vision: true, thinking: 'adaptive', structuredOutput: true },
    { provider: 'openai', id: 'gpt-4o-mini', label: 'gpt-4o-mini', contextWindow: 128_000, maxOutput: 16_384, vision: true, thinking: false, structuredOutput: true },
  ]);
  const claudeInfo = await getModelRuntimeInfo('anthropic::claude-opus-5-5');
  check(claudeInfo.provider === 'anthropic' && claudeInfo.remote && !claudeInfo.isSmall && claudeInfo.nativeContext === 1_000_000 && claudeInfo.supportsVision && claudeInfo.supportsThinking, 'Claude: remote, not small, 1M context, vision and thinking', claudeInfo);
  const claudeProfile = resolveRequestProfile({ info: claudeInfo, agentOpt: { contextLength: 8192, maxTokens: 3072, agentThinking: false }, hardware: { ram: { totalGb: 8 } } as any });
  check(claudeProfile.numCtx === CLOUD_DEFAULT_CONTEXT && claudeProfile.numPredict === 16384, 'The context of cloud models ignores this computer (64K automatic, 16K output)', claudeProfile);
  check(resolveRequestProfile({ info: claudeInfo, cloudContextLength: 200000 }).numCtx === 200000, 'Settings › Cloud models sets the window');
  check(resolveCloudContextLength(1_000_000, 128_000) === 128_000 && resolveCloudContextLength(0, 32_768) === 32_768 && resolveCloudContextLength(0, null) === CLOUD_DEFAULT_CONTEXT, 'The window never exceeds the model');
  check(resolveThinkParam(claudeInfo, true) === true && resolveThinkParam(claudeInfo, false) === false, 'Think is passed on to Claude as on/off');
  const gptInfo = await getModelRuntimeInfo('openai::gpt-4o-mini');
  check(!gptInfo.supportsThinking && resolveThinkParam(gptInfo, true) === undefined && resolveRequestProfile({ info: gptInfo }).numPredict === 16384, 'A GPT model without reasoning gets no think parameter');
  const cloudTag = buildRuntimeInfo('gpt-oss:120b-cloud', { details: { parameter_size: '116.8B', family: 'gptoss' }, capabilities: ['completion', 'tools', 'thinking'], remote_host: 'https://ollama.com:443' } as any);
  check(cloudTag.remote && cloudTag.provider === 'ollama' && !cloudTag.isSmall && resolveRequestProfile({ info: cloudTag }).numCtx === CLOUD_DEFAULT_CONTEXT, 'A "-cloud" model of the local Ollama is remote too: its window follows the cloud setting');
  const smallCloud = buildRuntimeInfo('gemma3:1b-cloud', { details: { parameter_size: '1B' } } as any);
  check(!smallCloud.isSmall, 'Cloud models never get the reduced small-model tool set');
  const unknown = buildCloudRuntimeInfo('openai::gpt-x', null);
  check(unknown.remote && unknown.supportsTools && unknown.nativeContext === null, 'An unknown cloud model still gets a usable profile');

  // ---------------------------------------------------------------------------
  section('14. A whole agent task on a scripted cloud model');
  // ---------------------------------------------------------------------------
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emir-cloud-agent-'));
  const api: any = makeElectronApi(dir);
  const sentRequests: any[] = [];
  const replies = [
    { thought: 'Create the script.', action: 'write_file', path: 'hello.py', content: 'print("hello")\n' },
    { thought: 'Done.', action: 'finish', summary: 'hello.py prints hello.' },
  ];
  let failFirstWithSchema = true;
  let agentListener: ((e: CloudEvent) => void) | null = null;
  api.onCloudEvent = (cb: (e: CloudEvent) => void) => ((agentListener = cb), () => (agentListener = null));
  api.cloudAbort = async () => true;
  api.cloudDescribe = async () => ({ ok: true, info: { provider: 'anthropic', id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', contextWindow: 1_000_000, thinking: 'adaptive', vision: true } });
  api.cloudChat = async (requestId: string, request: any) => {
    sentRequests.push(request);
    setTimeout(() => {
      if (failFirstWithSchema) {
        failFirstWithSchema = false;
        agentListener?.({ requestId, type: 'error', error: { code: 'format_unsupported', message: 'output_config.format: unsupported', status: 400 } });
        return;
      }
      const reply = replies.shift() ?? { thought: 'Done.', action: 'finish', summary: 'Done.' };
      agentListener?.({ requestId, type: 'chunk', chunk: { model: 'claude-sonnet-5-5', created_at: '', message: { role: 'assistant', content: JSON.stringify(reply) }, done: false } });
      agentListener?.({ requestId, type: 'chunk', chunk: { model: 'claude-sonnet-5-5', created_at: '', message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 1500, eval_count: 30, eval_duration: 1e9, prompt_eval_duration: 5e8 } });
      agentListener?.({ requestId, type: 'end' });
    }, 2);
    return { ok: true };
  };
  (globalThis as any).window = { electronAPI: api };
  (ollamaClient as any).chatStream = async () => {
    throw new Error('the local Ollama must not be called for a cloud model');
  };
  const logs: string[] = [];
  let finalStatus = '';
  await agentEngine.runGoal(
    'Write hello.py that prints hello.',
    'anthropic::claude-sonnet-5-5',
    {
      onStep: () => {},
      onStatusChange: (st) => {
        if (['finished', 'error', 'idle'].includes(st)) finalStatus = st;
      },
      onLog: (line) => logs.push(line),
      onRequestChangesetApproval: async () => true,
      onRequestDeleteApproval: async () => true,
      onRequestCommandApproval: async () => true,
      onRequestClarification: async () => 'ok',
    },
    'autonomous',
    5
  );
  check(finalStatus === 'finished' && fs.readFileSync(path.join(dir, 'hello.py'), 'utf8') === 'print("hello")\n', 'The task finishes and the file is written', { finalStatus, logs: logs.slice(-5) });
  check(sentRequests.every((r) => r.provider === 'anthropic' && r.model === 'claude-sonnet-5-5'), 'Every step went to the cloud provider, none to the local Ollama');
  check(typeof sentRequests[0].format === 'object' && sentRequests[1].format === undefined, 'After format_unsupported the agent continues without the schema', sentRequests.map((r) => typeof r.format));
  check(sentRequests[1].options.num_ctx === CLOUD_DEFAULT_CONTEXT && sentRequests[1].options.num_predict >= 1024, 'The cloud context window is used for the budget', sentRequests[1].options);
  check(logs.some((l) => l.includes('Claude') && l.includes('Anthropic')), 'The log says where the model runs', logs.slice(0, 4));

  completed = true;
  console.log('\n===========================================');
  if (failures.length > 0) {
    console.error(`❌ ${failures.length} FAILED, ${passed} passed`);
    for (const f of failures) console.error(`   - ${f}`);
    process.exit(1);
  }
  console.log(`🎉 ALL ${passed} CLOUD PROVIDER TESTS PASSED`);
  console.log('===========================================');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
