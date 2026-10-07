/**
 * test_cloud_features.ts
 * The cloud features of 2.1–2.3 without a cloud: keys masked in error texts, usage limits, effort
 * and reasoning settings, OpenAI's Responses API, Gemini, Mistral, OpenAI-compatible servers (a real
 * local HTTP server stands in for LM Studio), the experimental native tool mode, prices, the models
 * shown in the selector, and the agent's cost, task budget and settings on a scripted cloud model.
 *
 * Run: node scripts/run-ts-test.mjs test_cloud_features.ts
 */
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import {
  compatEndpointId,
  compatProviderId,
  isCloudProvider,
  isCompatProvider,
  modelLabel,
  parseModelRef,
  providerCompany,
  providerName,
  registerCompatEndpoints,
  runsInCloud,
  cloudOwner,
} from './src/lib/providers/modelRef';
import { classifyCloudError, redactSecrets, HttpStatusError } from './electron/cloud/errors';
import { AnthropicStreamTranslator, anthropicCapsFromModel, buildAnthropicParams, guessAnthropicCaps, pickEffort, runAnthropic } from './electron/cloud/anthropic';
import {
  OpenAIStreamTranslator,
  ResponsesStreamTranslator,
  buildOpenAIParams,
  buildResponsesParams,
  compatModelInfo,
  isMistralChatModel,
  mistralModelInfo,
  runOpenAI,
  usesResponsesApi,
} from './electron/cloud/openai';
import { GeminiStreamTranslator, buildGeminiParams, geminiModelInfo, isGeminiChatModel, runGemini, usesThinkingLevel } from './electron/cloud/gemini';
import { ActionToolCollector, actionTools, parseActionMessage, toAnthropicToolMessages, toOpenAIToolMessages } from './electron/cloud/nativeTools';
import { EndpointStore, checkEndpointUrl, endpointIdFor } from './electron/cloud/endpoints';
import { KeyStore, SecretBox } from './electron/cloud/keyStore';
import { CloudService, validateChatRequest } from './electron/cloud/index';
import type { CloudChatRequest, CloudChunk, CloudEvent } from './electron/cloud/types';
import { buildActionSchema } from './src/lib/agent/AgentProtocol';
import { CloudRequestError, buildCloudRequest } from './src/lib/providers/ModelGateway';
import { cloudErrorText } from './src/lib/providers/errorText';
import { builtinPrice, estimateCost, formatPrice, formatUsd, priceFor } from './src/lib/providers/pricing';
import { defaultVisibleIds, visibleIds } from './src/lib/providers/visibleModels';
import { providerReady, readyProviders } from './src/lib/providers/cloudStatus';
import { buildCloudRuntimeInfo, registerCloudModels } from './src/lib/ollama/ModelRuntime';
import { en } from './src/lib/localization/translations/en';
import { tr } from './src/lib/localization/translations/tr';
import { ollamaClient } from './src/lib/ollama/OllamaClient';
import { agentEngine } from './src/lib/agent/AgentEngine';
import { useSettingsStore } from './src/stores/settingsStore';
import { DEFAULT_SETTINGS } from './src/types/settings';
import { makeElectronApi } from './scripts/electron-api-mock';

let passed = 0;
let completed = false;
const failures: string[] = [];
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
const contentOf = (chunks: CloudChunk[]) => chunks.map((c) => c.message?.content || '').join('');
const thinkingOf = (chunks: CloudChunk[]) => chunks.map((c) => c.message?.thinking || '').join('');
const box = (available: boolean): SecretBox => ({
  available: () => available,
  encrypt: (text) => Buffer.from(`sealed:${Buffer.from(text).toString('hex').split('').reverse().join('')}`),
  decrypt: (data) => Buffer.from(data.toString().slice(7).split('').reverse().join(''), 'hex').toString(),
});
const toolset = { web: false, git: false, ask: false, commands: true, checklist: false, readFiles: 8 };
const agentSchema = buildActionSchema(toolset, false);
const baseRequest = (provider: any, model: string, extra: Partial<CloudChatRequest> = {}): CloudChatRequest => ({
  provider,
  model,
  system: 'You are the agent.',
  messages: [{ role: 'user', content: 'Do the task.' }],
  ...extra,
});

async function main() {
  // ---------------------------------------------------------------------------
  section('1. Keys never show in error texts');
  // ---------------------------------------------------------------------------
  const live = 'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-wxyz';
  const masked = redactSecrets(`invalid x-api-key: ${live} (key ${live.slice(0, 20)})`, [live]);
  check(!masked.includes(live) && masked.includes('…wxyz'), 'The key in use is replaced by its last four characters', masked);
  check(!redactSecrets('Incorrect API key provided: sk-proj-abc123DEF456ghi789JKL012mno345').includes('abc123DEF456'), 'OpenAI keys are masked by shape');
  check(!redactSecrets('API key not valid: AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q').includes('AIzaSyA1b2'), 'Google keys are masked by shape');
  check(!redactSecrets('Authorization: Bearer gsk_live_0123456789abcdefABCDEF').includes('0123456789abcdef'), 'Bearer tokens and Groq keys are masked');
  check(!redactSecrets('key=4f9a1c2b3d4e5f60718293a4b5c6d7e8f9a0b1c2').includes('4f9a1c2b3d4e5f6071'), 'Long hex secrets are masked');
  check(
    redactSecrets('The model meta-llama/llama-3.1-70b-instruct-turbo-with-a-long-name does not exist') === 'The model meta-llama/llama-3.1-70b-instruct-turbo-with-a-long-name does not exist',
    'Model names are left alone'
  );
  const classified = classifyCloudError({ status: 401, error: { error: { message: `bad key ${live}` } } }, [live]);
  check(classified.code === 'auth' && !classified.message.includes(live), 'classifyCloudError masks the provider text', classified);
  const unusual = 'zz-custom-provider-key-that-has-no-known-shape';
  check(!classifyCloudError(new Error(`rejected ${unusual}`), [unusual]).message.includes(unusual), 'A key of an unknown shape is masked because the service knows it');

  // ---------------------------------------------------------------------------
  section('2. Usage limits');
  // ---------------------------------------------------------------------------
  const ollamaLimit = classifyCloudError(new HttpStatusError(429, "you've reached your hourly usage limit, it resets in 2 hours. Upgrade for more."));
  check(ollamaLimit.code === 'usage_limit' && ollamaLimit.resetsAt === '2 hours', 'An hourly usage limit is a usage limit, with when it resets', ollamaLimit);
  const weekly = classifyCloudError(new HttpStatusError(429, 'weekly usage limit reached', '7200'));
  check(weekly.code === 'usage_limit' && weekly.resetsAt === '2 h', 'Retry-After gives the reset time when the text does not', weekly);
  check(classifyCloudError({ status: 429, error: { error: { message: 'Rate limit reached for requests' } } }).code === 'rate_limit', 'A plain rate limit stays a rate limit');
  check(classifyCloudError({ status: 429, error: { error: { message: 'You exceeded your current quota' } } }).code === 'quota', 'An exhausted quota stays a quota');
  const limitTextEn = cloudErrorText(new CloudRequestError('ollama-cloud', 'usage_limit', 'x', { resetsAt: 'in 3 hours' }), 'ollama-cloud::gpt-oss:120b', en.cloud) || '';
  const limitTextTr = cloudErrorText(new CloudRequestError('ollama-cloud', 'usage_limit', 'x'), 'ollama-cloud::gpt-oss:120b', tr.cloud) || '';
  check(/usage limit/.test(limitTextEn) && /resets in 3 hours/.test(limitTextEn) && /kullanım sınırı/.test(limitTextTr), 'Ollama Cloud usage limits are explained in both languages', [limitTextEn, limitTextTr]);
  const otherLimit = cloudErrorText(new CloudRequestError('anthropic', 'usage_limit', 'x'), 'anthropic::claude-opus-5-5', en.cloud) || '';
  check(/Claude: the usage limit of your plan/.test(otherLimit), 'Other providers get the general usage-limit text', otherLimit);
  const viaOllama = cloudErrorText(new Error("you've reached your weekly usage limit, try again in 4 days"), 'gpt-oss:120b-cloud', en.cloud) || '';
  check(/Ollama Cloud usage limit/.test(viaOllama) && /4 days/.test(viaOllama), 'A "-cloud" model through the local Ollama gets the same explanation', viaOllama);

  // ---------------------------------------------------------------------------
  section('3. Providers and model references');
  // ---------------------------------------------------------------------------
  check(isCloudProvider('gemini') && isCloudProvider('mistral') && isCloudProvider('openai-compatible:lm-studio') && !isCloudProvider('openai-compatible:Bad Id'), 'Gemini, Mistral and server ids are providers');
  check(parseModelRef('openai-compatible:openrouter::anthropic/claude-3.5-sonnet').model === 'anthropic/claude-3.5-sonnet', 'Server model ids keep their slashes');
  registerCompatEndpoints([
    { id: 'openrouter', name: 'OpenRouter', host: 'openrouter.ai', local: false },
    { id: 'lm-studio', name: 'LM Studio', host: 'localhost:1234', local: true },
  ]);
  check(providerName('openai-compatible:openrouter') === 'OpenRouter' && providerCompany('openai-compatible:openrouter') === 'openrouter.ai', 'A server is named by its name and its host');
  check(runsInCloud('openai-compatible:openrouter::x') && !runsInCloud('openai-compatible:lm-studio::qwen2.5-7b') && cloudOwner('openai-compatible:lm-studio::q') === null, 'A local server does not count as cloud');
  check(modelLabel('gemini::gemini-2.5-pro') === 'gemini-2.5-pro · Gemini' && providerCompany('mistral') === 'Mistral AI', 'Gemini and Mistral have names and companies');
  check(compatEndpointId(compatProviderId('vllm')) === 'vllm' && isCompatProvider('openai-compatible:vllm'), 'Server provider ids round-trip');
  const status: any = { providers: { anthropic: { configured: true }, openai: { configured: false } }, endpoints: [{ id: 'lm-studio', provider: 'openai-compatible:lm-studio', name: 'LM Studio', host: 'localhost:1234', local: true }], encryption: 'os' };
  check(readyProviders(status).join(',') === 'anthropic,openai-compatible:lm-studio' && providerReady(status, 'openai-compatible:lm-studio') && !providerReady(status, 'openai'), 'Providers with a key and every added server are ready');
  const valid = validateChatRequest({ provider: 'gemini', model: 'gemini-2.5-pro', messages: [{ role: 'user', content: 'hi' }], effort: 'xhigh', summaries: true, nativeTools: true });
  check(valid.ok && (valid as any).request.effort === 'xhigh' && (valid as any).request.summaries && (valid as any).request.nativeTools, 'Effort, summaries and native tools pass the request check');
  check(!(validateChatRequest({ provider: 'openai', model: 'gpt-5', messages: [{ role: 'user', content: 'hi' }], effort: 'turbo' }) as any).request.effort, 'Unknown effort levels are dropped');
  const gw = buildCloudRequest('anthropic', 'claude-opus-5-5', { model: 'anthropic::claude-opus-5-5', messages: [{ role: 'user', content: 'x' }], effort: 'high', summaries: true, nativeTools: true });
  check(gw.effort === 'high' && gw.summaries === true && gw.nativeTools === true, 'The gateway carries effort, summaries and native tools');

  // ---------------------------------------------------------------------------
  section('4. Claude: effort');
  // ---------------------------------------------------------------------------
  const capsWithEffort = anthropicCapsFromModel({
    id: 'claude-opus-5-5',
    max_input_tokens: 1000000,
    max_tokens: 128000,
    capabilities: {
      thinking: { supported: true, types: { adaptive: { supported: true }, enabled: { supported: false } } },
      structured_outputs: { supported: true },
      image_input: { supported: true },
      effort: { supported: true, low: { supported: true }, medium: { supported: true }, high: { supported: true }, xhigh: { supported: false }, max: { supported: true } },
    },
  });
  check(capsWithEffort.efforts?.join(',') === 'low,medium,high,max', 'The Models API tells which effort levels a model takes', capsWithEffort.efforts);
  check(pickEffort('xhigh', capsWithEffort.efforts) === 'high' && pickEffort('max', ['low', 'medium']) === 'medium' && pickEffort('low', []) === undefined && pickEffort('high', undefined) === 'high', 'An unsupported level becomes the nearest lower one; unknown support sends it as it is');
  const effortParams: any = buildAnthropicParams(baseRequest('anthropic', 'claude-opus-5-5', { effort: 'xhigh', format: agentSchema }), capsWithEffort);
  check(effortParams.output_config.effort === 'high' && effortParams.output_config.format.type === 'json_schema', 'Effort goes in output_config next to the answer schema', effortParams.output_config);
  check(!(buildAnthropicParams(baseRequest('anthropic', 'claude-opus-5-5', { effort: 'high' }), capsWithEffort, { effort: false }) as any).output_config, 'Without effort there is no output_config');
  const anthropicCalls: any[] = [];
  const effortClient: any = {
    beta: {
      messages: {
        create: async (params: any) => {
          anthropicCalls.push(params);
          if (params.output_config?.effort) throw Object.assign(new Error('output_config.effort: this model does not support effort'), { status: 400 });
          return iterate([
            { type: 'message_start', message: { model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 1 } } },
            { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
            { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
          ]);
        },
      },
    },
  };
  const effortChunks: CloudChunk[] = [];
  await runAnthropic(effortClient, baseRequest('anthropic', 'claude-haiku-4-5', { effort: 'low' }), guessAnthropicCaps('claude-haiku-4-5'), (c) => effortChunks.push(c), new AbortController().signal);
  check(anthropicCalls.length === 2 && !anthropicCalls[1].output_config && contentOf(effortChunks) === 'ok', 'A model that rejects effort gets the request again without it', anthropicCalls.map((c) => c.output_config));

  // ---------------------------------------------------------------------------
  section('5. OpenAI: Responses API and reasoning summaries');
  // ---------------------------------------------------------------------------
  const gpt5 = baseRequest('openai', 'gpt-5', { effort: 'high', summaries: true, format: agentSchema, options: { num_predict: 8000 }, messages: [{ role: 'user', content: 'see', images: [PNG] }, { role: 'assistant', content: '{"action":"x"}' }, { role: 'user', content: 'next' }] });
  check(usesResponsesApi(gpt5, 'openai') && !usesResponsesApi(baseRequest('openai', 'gpt-4.1'), 'openai') && !usesResponsesApi(gpt5, 'compat'), 'Reasoning models of OpenAI use the Responses API');
  const rp: any = buildResponsesParams(gpt5);
  check(rp.instructions === 'You are the agent.' && rp.store === false && rp.max_output_tokens === 8000, 'System prompt as instructions, nothing stored, the output limit', rp);
  check(rp.reasoning.effort === 'high' && rp.reasoning.summary === 'auto', 'Effort and summaries become reasoning settings', rp.reasoning);
  check(rp.text.format.type === 'json_schema' && rp.text.format.strict === false && rp.text.format.schema.additionalProperties === false, 'The answer schema becomes a text format');
  check(rp.input[0].content[1].type === 'input_image' && rp.input[0].content[1].image_url.startsWith('data:image/png;base64,') && rp.input[1].role === 'assistant', 'Images and the history are carried');
  check(!(buildResponsesParams(gpt5, { effort: false, summaries: false }) as any).reasoning, 'Reasoning settings can be left out for a retry');
  const rtr = new ResponsesStreamTranslator('gpt-5');
  const rchunks = [
    { type: 'response.created', response: { model: 'gpt-5-2026-01-01' } },
    { type: 'response.reasoning_summary_part.added' },
    { type: 'response.reasoning_summary_text.delta', delta: 'Reading the files.' },
    { type: 'response.reasoning_summary_part.added' },
    { type: 'response.reasoning_summary_text.delta', delta: 'Then editing.' },
    { type: 'response.output_text.delta', delta: '{"thought":"t",' },
    { type: 'response.output_text.delta', delta: '"action":"finish"}' },
    { type: 'response.completed', response: { usage: { input_tokens: 900, output_tokens: 120, input_tokens_details: { cached_tokens: 512 } } } },
  ].flatMap((e) => rtr.handle(e));
  const rdone = rtr.finish();
  check(thinkingOf(rchunks) === 'Reading the files.\n\nThen editing.' && contentOf(rchunks) === '{"thought":"t","action":"finish"}', 'Summaries arrive as thinking, the answer as content', [thinkingOf(rchunks), contentOf(rchunks)]);
  check(rdone.prompt_eval_count === 900 && rdone.cached_prompt_count === 512 && rdone.eval_count === 120 && rdone.done_reason === 'stop', 'Usage of the Responses API is counted', rdone);
  const cut = new ResponsesStreamTranslator('gpt-5');
  cut.handle({ type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } });
  check(cut.finish().done_reason === 'length', 'max_output_tokens means "length"');
  const refused = new ResponsesStreamTranslator('gpt-5');
  refused.handle({ type: 'response.refusal.delta', delta: 'I cannot help with that.' });
  let refusalCode = '';
  try {
    refused.finish();
  } catch (err: any) {
    refusalCode = err.code;
  }
  check(refusalCode === 'refusal', 'A refusal of the Responses API is a refusal');
  const responsesCalls: any[] = [];
  const responsesClient: any = {
    responses: {
      create: async (params: any) => {
        responsesCalls.push(params);
        if (params.reasoning?.summary) throw Object.assign(new Error('reasoning.summary: your organization must be verified'), { status: 400 });
        return iterate([{ type: 'response.output_text.delta', delta: 'hi' }, { type: 'response.completed', response: { usage: { input_tokens: 1, output_tokens: 1 } } }]);
      },
    },
  };
  const retried: CloudChunk[] = [];
  await runOpenAI(responsesClient, baseRequest('openai', 'gpt-5', { summaries: true, effort: 'low' }), (c) => retried.push(c), new AbortController().signal);
  check(responsesCalls.length === 2 && !responsesCalls[1].reasoning && contentOf(retried) === 'hi', 'Rejected reasoning settings are dropped for one retry', responsesCalls.map((c) => c.reasoning));
  const chatEffort: any = buildOpenAIParams(baseRequest('openai', 'o4-mini', { effort: 'low' }));
  check(chatEffort.reasoning_effort === 'low' && chatEffort.max_completion_tokens === undefined, 'Chat Completions takes the effort as reasoning_effort');

  // ---------------------------------------------------------------------------
  section('6. Gemini');
  // ---------------------------------------------------------------------------
  const gp = buildGeminiParams(
    baseRequest('gemini', 'gemini-3-pro-preview', {
      effort: 'medium',
      think: true,
      format: agentSchema,
      options: { num_predict: 4096, temperature: 0.2 },
      messages: [
        { role: 'user', content: 'look', images: [PNG] },
        { role: 'assistant', content: 'ok' },
        { role: 'user', content: 'go' },
      ],
    })
  );
  check(gp.config.systemInstruction === 'You are the agent.' && gp.config.maxOutputTokens === 4096 && gp.config.temperature === undefined, 'System instruction and output limit; no sampling', gp.config);
  check(gp.contents[0].parts[0].inlineData.mimeType === 'image/png' && gp.contents[1].role === 'model' && gp.contents[2].parts[0].text === 'go', 'Images become inline data, the assistant is "model"');
  check(gp.config.responseMimeType === 'application/json' && gp.config.responseJsonSchema.additionalProperties === false && !('anyOf' in gp.config.responseJsonSchema), 'The answer schema goes merged as responseJsonSchema');
  check(gp.config.thinkingConfig.thinkingLevel === 'MEDIUM' && gp.config.thinkingConfig.includeThoughts === true, 'Gemini 3: effort is a thinking level, thoughts are shown', gp.config.thinkingConfig);
  const g25 = buildGeminiParams(baseRequest('gemini', 'gemini-2.5-flash', { effort: 'high' }));
  check(g25.config.thinkingConfig.thinkingBudget === 16384 && !g25.config.thinkingConfig.includeThoughts && usesThinkingLevel('gemini-3-flash') && !usesThinkingLevel('gemini-2.5-pro'), 'Gemini 2.5: effort is a thinking budget');
  check(!buildGeminiParams(baseRequest('gemini', 'gemini-2.5-pro')).config.thinkingConfig, 'Without effort or thinking the model decides');
  const gtr = new GeminiStreamTranslator('gemini-2.5-pro');
  const gchunks = [
    { candidates: [{ content: { parts: [{ text: 'Thinking about it.', thought: true }] } }] },
    { candidates: [{ content: { parts: [{ text: '{"action":' }] } }] },
    { candidates: [{ content: { parts: [{ text: '"finish"}' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 700, candidatesTokenCount: 20, thoughtsTokenCount: 30, cachedContentTokenCount: 256 } },
  ].flatMap((c) => gtr.handle(c));
  const gdone = gtr.finish();
  check(thinkingOf(gchunks) === 'Thinking about it.' && contentOf(gchunks) === '{"action":"finish"}', 'Thought parts become thinking, the rest content');
  check(gdone.prompt_eval_count === 700 && gdone.cached_prompt_count === 256 && gdone.eval_count === 50 && gdone.done_reason === 'stop', 'Usage counts thoughts as output', gdone);
  const gmax = new GeminiStreamTranslator('g');
  gmax.handle({ candidates: [{ finishReason: 'MAX_TOKENS' }] });
  check(gmax.finish().done_reason === 'length', 'MAX_TOKENS means "length"');
  const gsafety = new GeminiStreamTranslator('g');
  gsafety.handle({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } });
  let gRefusal: any = null;
  try {
    gsafety.finish();
  } catch (err) {
    gRefusal = err;
  }
  check(gRefusal?.code === 'refusal' && gRefusal.category === 'prohibited_content', 'A blocked prompt is a refusal with its reason');
  check(
    isGeminiChatModel({ name: 'models/gemini-2.5-pro', supportedActions: ['generateContent'] }) &&
      !isGeminiChatModel({ name: 'models/text-embedding-004', supportedActions: ['embedContent'] }) &&
      !isGeminiChatModel({ name: 'models/gemini-2.5-flash-preview-tts', supportedActions: ['generateContent'] }),
    'Only chat models of Gemini are listed'
  );
  const ginfo = geminiModelInfo({ name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', inputTokenLimit: 1048576, outputTokenLimit: 65536, thinking: true });
  check(ginfo.id === 'gemini-2.5-pro' && ginfo.contextWindow === 1048576 && ginfo.thinking === 'effort' && ginfo.vision, 'Gemini model info from the Models API');
  const geminiCalls: any[] = [];
  const geminiClient: any = {
    models: {
      generateContentStream: async ({ config }: any) => {
        geminiCalls.push(config);
        if (config.thinkingConfig) throw Object.assign(new Error('thinking_level is not supported for this model'), { status: 400 });
        return iterate([{ candidates: [{ content: { parts: [{ text: 'fine' }] }, finishReason: 'STOP' }] }]);
      },
    },
  };
  const gOut: CloudChunk[] = [];
  await runGemini(geminiClient, baseRequest('gemini', 'gemini-2.0-flash', { effort: 'low' }), (c) => gOut.push(c), new AbortController().signal);
  check(geminiCalls.length === 2 && !geminiCalls[1].thinkingConfig && contentOf(gOut) === 'fine' && !!geminiCalls[0].abortSignal, 'Rejected thinking settings are dropped for one retry; the request can be stopped');
  check(classifyCloudError(Object.assign(new Error('{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}'), { status: 400 })).code === 'auth', 'Gemini\'s invalid key error is an auth error');

  // ---------------------------------------------------------------------------
  section('7. Mistral');
  // ---------------------------------------------------------------------------
  const mp: any = buildOpenAIParams(baseRequest('mistral', 'mistral-large-latest', { format: agentSchema, options: { num_predict: 2000, temperature: 0.4 }, effort: 'high' }), 'mistral');
  check(mp.max_tokens === 2000 && mp.max_completion_tokens === undefined && mp.stream_options === undefined && mp.temperature === undefined && mp.reasoning_effort === undefined, 'Mistral gets max_tokens, no OpenAI-only fields', mp);
  check(mp.response_format.type === 'json_schema' && mp.response_format.json_schema.strict === false, 'The answer schema goes as response_format');
  const mtr = new OpenAIStreamTranslator('magistral-medium-latest');
  const mchunks = [
    { choices: [{ delta: { content: [{ type: 'thinking', thinking: [{ type: 'text', text: 'Hmm.' }] }] } }] },
    { choices: [{ delta: { content: [{ type: 'text', text: 'Answer' }] }, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 7 } },
  ].flatMap((c) => mtr.handle(c));
  check(thinkingOf(mchunks) === 'Hmm.' && contentOf(mchunks) === 'Answer' && mtr.finish().at(-1)!.eval_count === 7, "Magistral's thinking chunks become thinking");
  check(isMistralChatModel({ id: 'mistral-large-latest', capabilities: { completion_chat: true } }) && !isMistralChatModel({ id: 'mistral-embed' }) && !isMistralChatModel({ id: 'old', deprecation: '2025-01-01' }), 'Only current chat models of Mistral are listed');
  check(mistralModelInfo({ id: 'pixtral-large-latest', max_context_length: 131072, capabilities: { vision: true } }).vision && mistralModelInfo({ id: 'magistral-small-latest' }).thinking === 'effort', 'Mistral model info: context, vision, reasoning');

  // ---------------------------------------------------------------------------
  section('8. OpenAI-compatible servers: address rules and key binding');
  // ---------------------------------------------------------------------------
  const url = (u: string, local = false) => checkEndpointUrl(u, local);
  check((url('https://openrouter.ai/api/v1/') as any).baseURL === 'https://openrouter.ai/api/v1' && (url('https://openrouter.ai/api/v1') as any).local === false, 'https addresses are normalized');
  check((url('http://localhost:1234/v1') as any).local === true && (url('http://127.0.0.1:8080') as any).ok && (url('http://[::1]:8000/v1') as any).local, 'http is fine for this computer');
  check((url('http://api.example.com/v1') as any).error === 'https_required', 'http to a remote address is refused');
  check((url('http://192.168.1.20:1234/v1') as any).error === 'https_required' && (url('http://192.168.1.20:1234/v1', true) as any).local === true, 'A private address takes http only when marked as local network');
  check((url('https://api.example.com/v1', true) as any).error === 'not_private', 'A public address cannot be marked as local');
  check((url('https://user:pw@example.com/v1') as any).error === 'credentials' && (url('https://example.com/v1?key=x') as any).error === 'query' && (url('ftp://x') as any).error === 'invalid', 'Credentials, queries and other schemes are refused');
  check(endpointIdFor('LM Studio!', []) === 'lm-studio' && endpointIdFor('LM Studio', ['lm-studio']) === 'lm-studio-2' && endpointIdFor('Ğüşıöç', []) === 'gusioc', 'Server ids are readable and unique');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'emir-compat-'));
  const keysFile = path.join(tmp, 'keys.json');
  const ks = new KeyStore(keysFile, box(true), {});
  ks.set('openai-compatible:openrouter', 'sk-or-v1-secretsecretsecret', 'https://openrouter.ai/api/v1');
  check(ks.get('openai-compatible:openrouter', 'https://openrouter.ai/api/v1') === 'sk-or-v1-secretsecretsecret', 'A server key is returned for its own address');
  check(ks.get('openai-compatible:openrouter', 'https://evil.example/v1') === null && ks.get('openai-compatible:openrouter') === null, 'and for no other address');
  check(new KeyStore(keysFile, box(true), {}).get('openai-compatible:openrouter', 'https://openrouter.ai/api/v1') !== null && !fs.readFileSync(keysFile, 'utf8').includes('openrouter.ai'), 'The address is saved encrypted together with the key');
  check(new KeyStore(keysFile, box(true), {}).knownKeys().includes('sk-or-v1-secretsecretsecret'), 'Known keys include server keys (for masking)');
  const sessionKs = new KeyStore(path.join(tmp, 'session.json'), box(false), {});
  sessionKs.set('openai-compatible:x', 'session-key-123456', 'http://localhost:1/v1');
  check(sessionKs.get('openai-compatible:x', 'http://localhost:1/v1') === 'session-key-123456' && sessionKs.get('openai-compatible:x', 'http://localhost:2/v1') === null, 'Session keys are bound too');
  let unbound = '';
  try {
    ks.set('openai-compatible:y', 'some-key-123456');
  } catch (err: any) {
    unbound = err.message;
  }
  check(/address/.test(unbound), 'A server key cannot be saved without its address');

  // ---------------------------------------------------------------------------
  section('9. OpenAI-compatible servers: a real local server');
  // ---------------------------------------------------------------------------
  const seen: Array<{ method: string; url: string; auth: string; body?: any }> = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      seen.push({ method: req.method || '', url: req.url || '', auth: String(req.headers.authorization || ''), body: body ? JSON.parse(body) : undefined });
      if (req.url === '/moved/v1/models') {
        res.writeHead(302, { Location: 'http://127.0.0.1:9/elsewhere' });
        res.end();
        return;
      }
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: [{ id: 'qwen2.5-coder-7b-instruct', object: 'model', max_context_length: 32768 }, { id: 'text-embedding-nomic', object: 'model' }] }));
        return;
      }
      if (req.url === '/v1/chat/completions') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
        send({ id: 'c1', object: 'chat.completion.chunk', model: 'qwen2.5-coder-7b-instruct', choices: [{ index: 0, delta: { role: 'assistant', content: 'Hel' } }] });
        send({ id: 'c1', object: 'chat.completion.chunk', model: 'qwen2.5-coder-7b-instruct', choices: [{ index: 0, delta: { content: 'lo' }, finish_reason: 'stop' }] });
        send({ id: 'c1', object: 'chat.completion.chunk', model: 'qwen2.5-coder-7b-instruct', choices: [], usage: { prompt_tokens: 12, completion_tokens: 2 } });
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const endpointsFile = path.join(tmp, 'endpoints.json');
  const service = new CloudService(new KeyStore(path.join(tmp, 'service-keys.json'), box(true), {}), new EndpointStore(endpointsFile));
  const bad = await service.addEndpoint({ name: 'Remote', baseURL: 'http://api.example.com/v1' });
  check(!bad.ok && (bad as any).error.message === 'address:https_required', 'The service refuses http to a remote server before any request');
  const moved = await service.addEndpoint({ name: 'Moved', baseURL: `http://127.0.0.1:${port}/moved/v1` });
  check(!moved.ok && service.status().endpoints.length === 0, 'A server that redirects is not added (redirects are not followed)', (moved as any).error);
  const added = await service.addEndpoint({ name: 'LM Studio', baseURL: `http://127.0.0.1:${port}/v1` });
  check(added.ok && (added as any).endpoint.id === 'lm-studio' && (added as any).endpoint.local === true && (added as any).models.length === 1, 'A local server is added after listing its chat models', added);
  check((added as any).models[0].contextWindow === 32768 && (added as any).models[0].provider === 'openai-compatible:lm-studio', 'The context window the server reports is kept');
  check(seen.find((s) => s.url === '/v1/models')?.auth === 'Bearer no-key-needed', 'Without a key a placeholder is sent, never another provider\'s key');
  const events: CloudEvent[] = [];
  service.chat('compat_1', { provider: 'openai-compatible:lm-studio', model: 'qwen2.5-coder-7b-instruct', system: 'S', messages: [{ role: 'user', content: 'hi' }], options: { num_predict: 100, temperature: 0.3 }, nativeTools: true, format: agentSchema }, (e) => events.push(e));
  for (let i = 0; i < 100 && !events.some((e) => e.type !== 'chunk'); i++) await new Promise((r) => setTimeout(r, 10));
  const chatReq = seen.find((s) => s.url === '/v1/chat/completions')?.body;
  check(events.at(-1)?.type === 'end' && contentOf(events.filter((e) => e.type === 'chunk').map((e: any) => e.chunk)) === 'Hello', 'A chat with the server streams back', events);
  check(chatReq?.max_tokens === 100 && chatReq?.temperature === 0.3 && !chatReq?.tools && chatReq?.response_format?.type === 'json_schema', 'The server gets max_tokens, the temperature and the schema, never native tools', chatReq);
  const keyed = await service.setKey('openai-compatible:lm-studio', 'lmstudio-key-0123456789');
  check(keyed.ok && seen.at(-1)?.auth === 'Bearer lmstudio-key-0123456789' && (keyed as any).status.endpoints[0].configured, 'A key for the server is checked against the server and saved');
  // Someone edits the server list on disk to point the saved key at another address.
  const onDisk = JSON.parse(fs.readFileSync(endpointsFile, 'utf8'));
  onDisk.endpoints[0].baseURL = 'http://127.0.0.1:9/v1';
  fs.writeFileSync(endpointsFile, JSON.stringify(onDisk));
  const reopened = new CloudService(new KeyStore(path.join(tmp, 'service-keys.json'), box(true), {}), new EndpointStore(endpointsFile));
  check(reopened.status().endpoints[0].configured === false, 'After the address changed on disk the key is no longer used');
  check(JSON.stringify(service.status()).indexOf('lmstudio-key-0123456789') === -1, 'The status never carries the server key');
  const removed = service.removeEndpoint('lm-studio');
  check(removed.endpoints.length === 0 && !(await service.listModels('openai-compatible:lm-studio')).ok, 'Removing the server forgets it and its key');
  server.close();

  // ---------------------------------------------------------------------------
  section('10. Native tool mode (experimental)');
  // ---------------------------------------------------------------------------
  const tools = actionTools(agentSchema)!;
  const names = tools.map((t) => t.name);
  check(names.includes('write_file') && names.includes('read_files') && names.includes('finish') && tools.every((t) => !('action' in t.schema.properties) && t.schema.properties.thought), 'One tool per action, "thought" kept, "action" dropped', names);
  check(tools.every((t) => t.schema.additionalProperties === false && !JSON.stringify(t.schema).includes('minLength')), 'Tool schemas are sanitized');
  check(actionTools({ type: 'object' }) === null && actionTools('json') === null, 'A format that is not the action schema gives no tools');
  check(parseActionMessage('{"thought":"t","action":"write_file","path":"a"}', names)?.name === 'write_file' && parseActionMessage('{"action":"noop"}', names) === null && parseActionMessage('(earlier step: …)', names) === null, 'Only real actions of the history become tool calls');
  const history = [
    { role: 'user', content: 'TASK' },
    { role: 'assistant', content: '{"thought":"look","action":"list_dir","path":""}' },
    { role: 'user', content: 'Contents: a.js' },
    { role: 'assistant', content: '{"thought":"Continuing the task.","action":"noop"}' },
    { role: 'user', content: '[EARLIER STEPS removed]' },
  ];
  const oaHistory: any[] = toOpenAIToolMessages(history, names);
  check(oaHistory[1].tool_calls[0].function.name === 'list_dir' && JSON.parse(oaHistory[1].tool_calls[0].function.arguments).path === '' && oaHistory[2].role === 'tool' && oaHistory[2].tool_call_id === oaHistory[1].tool_calls[0].id && oaHistory[2].content === 'Contents: a.js', 'OpenAI history: tool call, then its tool message');
  check(oaHistory[3].role === 'assistant' && typeof oaHistory[3].content === 'string' && oaHistory.length === 5, 'Other messages stay as they are');
  const anHistory: any[] = toAnthropicToolMessages(history, names);
  check(anHistory[1].content[0].type === 'tool_use' && anHistory[2].content[0].type === 'tool_result' && anHistory[2].content[0].tool_use_id === anHistory[1].content[0].id, 'Claude history: tool_use, then tool_result');
  const nativeClaude: any = buildAnthropicParams(baseRequest('anthropic', 'claude-opus-5-5', { nativeTools: true, think: true, format: agentSchema, messages: history as any }), capsWithEffort);
  check(nativeClaude.tools.length === tools.length && nativeClaude.tool_choice.type === 'any' && !nativeClaude.thinking && !nativeClaude.output_config?.format, 'Claude in native mode: tools, a forced tool call, no thinking, no schema', { choice: nativeClaude.tool_choice, thinking: nativeClaude.thinking });
  check(nativeClaude.messages.some((m: any) => Array.isArray(m.content) && m.content[0]?.type === 'tool_result'), 'and the history as tool results');
  const ntr = new AnthropicStreamTranslator('claude-opus-5-5', Date.now, { nativeTools: true });
  const nchunks = [
    { type: 'message_start', message: { usage: { input_tokens: 100, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'I will write it.' } },
    { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'write_file', input: {} } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"path":"a.js",' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"content":"x"}' } },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 30 } },
  ].flatMap((e) => ntr.handle(e));
  const nfinal = ntr.finish();
  const action = JSON.parse(contentOf([...nchunks, ...nfinal]));
  check(contentOf(nchunks) === '' && action.action === 'write_file' && action.thought === 'I will write it.' && action.path === 'a.js' && action.content === 'x', 'A Claude tool call comes back as the agent\'s JSON action', action);
  const nativeGpt: any = buildOpenAIParams(baseRequest('openai', 'gpt-5', { nativeTools: true, format: agentSchema, messages: history as any }));
  check(nativeGpt.tools.length === tools.length && nativeGpt.tool_choice === 'required' && nativeGpt.parallel_tool_calls === false && !nativeGpt.response_format, 'GPT in native mode: function tools, a required call, no response format');
  check(!usesResponsesApi(baseRequest('openai', 'gpt-5', { nativeTools: true, format: agentSchema }), 'openai'), 'Native mode keeps reasoning models on Chat Completions');
  const otr = new OpenAIStreamTranslator('gpt-5', Date.now, { nativeTools: true });
  const ochunks = [
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'finish', arguments: '' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"thought":"done","summary":"All good."}' } }] }, finish_reason: 'tool_calls' }] },
  ].flatMap((c) => otr.handle(c));
  const ofinal = JSON.parse(contentOf([...ochunks, ...otr.finish()]));
  check(ofinal.action === 'finish' && ofinal.summary === 'All good.' && ofinal.thought === 'done', 'A GPT tool call comes back as the agent\'s JSON action', ofinal);
  const cutCall = new ActionToolCollector();
  cutCall.start('write_file');
  cutCall.addArguments('{"path":"a.js","content":"unfinished');
  check(cutCall.actionText()!.startsWith('{"action":"write_file","path":"a.js"'), 'A tool call cut off by the output limit is handed on for the agent\'s repair');
  check(!(buildOpenAIParams(baseRequest('mistral', 'mistral-large-latest', { nativeTools: true, format: agentSchema }), 'mistral') as any).tools, 'Other providers ignore native mode');

  // ---------------------------------------------------------------------------
  section('11. Prices and the models in the selector');
  // ---------------------------------------------------------------------------
  // The main-process service above keeps its own server list; the renderer's comes from the status.
  registerCompatEndpoints([
    { id: 'openrouter', name: 'OpenRouter', host: 'openrouter.ai', local: false },
    { id: 'lm-studio', name: 'LM Studio', host: 'localhost:1234', local: true },
  ]);
  check(builtinPrice('anthropic::claude-opus-4-5-20251101')?.input === 5 && builtinPrice('anthropic::claude-opus-4-1')?.output === 75 && builtinPrice('openai::gpt-5-mini')?.output === 2, 'Built-in prices match by model family');
  check(builtinPrice('openai::gpt-5-mini')?.input !== builtinPrice('openai::gpt-5')?.input && builtinPrice('gemini::gemini-2.5-flash-lite')?.input === 0.1, 'Specific names win over their family');
  check(priceFor('anthropic::claude-opus-5-5', {}).source === 'unknown' && priceFor('anthropic::claude-opus-5-5', { 'anthropic::claude-opus-5-5': { input: 4, output: 20 } }).source === 'user', 'Unknown prices can be set by the user');
  check(priceFor('ollama-cloud::gpt-oss:120b', {}).source === 'plan' && priceFor('gpt-oss:120b-cloud', {}).source === 'plan' && priceFor('qwen3:8b', {}).source === 'free' && priceFor('openai-compatible:lm-studio::q', {}).source === 'free', 'Ollama Cloud is a plan, local models are free');
  const cost = estimateCost({ prompt: 1_000_000, cached: 800_000, output: 100_000 }, { input: 3, cachedInput: 0.3, output: 15 });
  check(Math.abs(cost - (0.6 + 0.24 + 1.5)) < 1e-9, 'Cost: uncached input, cached input and output', cost);
  check(formatUsd(0.0042) === '$0.0042' && formatUsd(0.184) === '$0.184' && formatUsd(0.12) === '$0.12' && formatUsd(2.5) === '$2.50' && formatUsd(12.4) === '$12.40', 'Amounts are readable', [formatUsd(0.0042), formatUsd(0.184), formatUsd(0.12), formatUsd(2.5), formatUsd(12.4)]);
  check(formatPrice(5) === '$5' && formatPrice(1.25) === '$1.25' && formatPrice(0.075) === '$0.075' && formatPrice(1.1) === '$1.10' && formatPrice(0.5) === '$0.50', 'Prices per million tokens are readable', [formatPrice(5), formatPrice(1.25), formatPrice(0.075), formatPrice(1.1), formatPrice(0.5)]);
  const models: any[] = [
    ...['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5', 'claude-opus-4-1'].map((id, i) => ({ provider: 'anthropic', id, label: id, createdAt: 100 - i })),
    ...['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-4.1', 'gpt-4o', 'o3', 'o4-mini'].map((id, i) => ({ provider: 'openai', id, label: id, createdAt: 100 - i })),
    ...['mistral-large-latest', 'mistral-small-latest', 'mistral-large-2411'].map((id) => ({ provider: 'mistral', id, label: id })),
    ...['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash-exp', 'gemini-3-pro-preview'].map((id) => ({ provider: 'gemini', id, label: id })),
  ];
  check(defaultVisibleIds('anthropic', models).join(',') === 'claude-opus-5-5,claude-sonnet-5-5,claude-haiku-4-5', 'Claude: the three newest by default');
  check(defaultVisibleIds('openai', models).length === 5 && defaultVisibleIds('mistral', models).join(',') === 'mistral-large-latest,mistral-small-latest', 'GPT: the five newest; Mistral: its "-latest" aliases');
  check(
    defaultVisibleIds('gemini', models).join(',') === 'gemini-3-pro-preview,gemini-2.5-pro,gemini-2.5-flash' && !defaultVisibleIds('gemini', models).includes('gemini-2.0-flash-exp'),
    'Gemini: the newest models, no experiments',
    defaultVisibleIds('gemini', models)
  );
  check(visibleIds('openai', models, { openai: ['o3'] }).size === 1 && visibleIds('openai', models, { openai: [] }).size === 0, 'The user\'s choice wins, an empty choice hides all');
  const many = Array.from({ length: 30 }, (_, i) => ({ provider: 'openai-compatible:openrouter', id: `m${i}`, label: '' })) as any[];
  check(defaultVisibleIds('openai-compatible:openrouter', many).length === 0 && defaultVisibleIds('openai-compatible:openrouter', many.slice(0, 5)).length === 5, 'A server with many models shows none until chosen, a small one shows all');

  // ---------------------------------------------------------------------------
  section('12. Runtime profile of a local server model');
  // ---------------------------------------------------------------------------
  const localInfo = buildCloudRuntimeInfo('openai-compatible:lm-studio::qwen2.5-coder-7b-instruct', compatModelInfo('openai-compatible:lm-studio', { id: 'qwen2.5-coder-7b-instruct', max_context_length: 32768 }));
  check(!localInfo.remote && localInfo.tier === 'medium' && localInfo.parameterSizeB === 7, 'A model on a local server is a local model sized by its name', localInfo);
  const remoteInfo = buildCloudRuntimeInfo('openai-compatible:openrouter::qwen/qwen3-coder', compatModelInfo('openai-compatible:openrouter', { id: 'qwen/qwen3-coder', context_length: 262144 }));
  check(remoteInfo.remote && remoteInfo.tier === 'large' && remoteInfo.nativeContext === 262144, 'A model on a remote server is a cloud model with the reported window');

  // ---------------------------------------------------------------------------
  section('13. The agent on a cloud model: effort, native tools, cost and budget');
  // ---------------------------------------------------------------------------
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emir-budget-'));
  const api: any = makeElectronApi(dir);
  const requests: any[] = [];
  let listener: ((e: CloudEvent) => void) | null = null;
  let step = 0;
  api.onCloudEvent = (cb: (e: CloudEvent) => void) => ((listener = cb), () => (listener = null));
  api.cloudAbort = async () => true;
  api.cloudDescribe = async () => ({ ok: true, info: { provider: 'openai', id: 'gpt-5', label: 'gpt-5', contextWindow: 400000, maxOutput: 128000, thinking: 'effort' } });
  api.cloudChat = async (requestId: string, request: any) => {
    requests.push(request);
    step++;
    const reply =
      step === 1
        ? { thought: 'Write it.', action: 'write_file', path: 'a.txt', content: 'one\n' }
        : { thought: 'More.', action: 'write_file', path: `b${step}.txt`, content: `${step}\n` };
    setTimeout(() => {
      listener?.({ requestId, type: 'chunk', chunk: { model: 'gpt-5', created_at: '', message: { role: 'assistant', content: JSON.stringify(reply) }, done: false } });
      // 200K prompt tokens (100K cached) and 20K output per step: about $0.34 at GPT-5's price.
      listener?.({ requestId, type: 'chunk', chunk: { model: 'gpt-5', created_at: '', message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 200000, cached_prompt_count: 100000, eval_count: 20000 } as any });
      listener?.({ requestId, type: 'end' });
    }, 2);
    return { ok: true };
  };
  (globalThis as any).window = { electronAPI: api };
  (ollamaClient as any).chatStream = async () => {
    throw new Error('the local Ollama must not be called for a cloud model');
  };
  registerCloudModels([{ provider: 'openai', id: 'gpt-5', label: 'gpt-5', contextWindow: 400000, maxOutput: 128000, thinking: 'effort' }]);
  useSettingsStore.setState((state: any) => ({
    settings: { ...state.settings, language: 'en', cloud: { ...DEFAULT_SETTINGS.cloud, agentEffort: 'high', nativeTools: true, taskBudgetUsd: 0.5 } },
  }));
  const steps: any[] = [];
  const logs: string[] = [];
  let finalStatus = '';
  await agentEngine.runGoal(
    'Write a.txt and then keep adding files.',
    'openai::gpt-5',
    {
      onStep: (s) => steps.push(s),
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
  check(requests.length > 0 && requests.every((r) => r.effort === 'high' && r.nativeTools === true), 'Every step carries the agent\'s effort and native tools', requests.map((r) => [r.effort, r.nativeTools]));
  check(requests.length === 2, 'The task stops at the step after the budget was reached', requests.length);
  const budgetNotice = steps.find((s) => /task budget is used up/.test(String(s.content)));
  check(!!budgetNotice && /\$0\.5/.test(budgetNotice.content), 'The budget stop is explained with the amounts', steps.map((s) => s.content).slice(-3));
  check(fs.existsSync(path.join(dir, 'a.txt')), 'The changes made before the stop are kept');
  const finalCard = steps.find((s) => s.type === 'final_answer');
  check(
    (!!finalCard && finalCard.metadata?.usage?.prompt === 400000 && typeof finalCard.metadata?.cost === 'number') || /Used: 400,000 tokens in/.test(String(budgetNotice?.content || '')),
    'The tokens and the estimated cost of the task are reported',
    finalCard?.metadata || budgetNotice?.content
  );
  check(logs.some((l) => /Task budget: \$0\.5/.test(l)) && logs.some((l) => /Experimental: the agent's actions go to the model as its own tools/.test(l)), 'The log names the budget and the native tool mode', logs.slice(0, 6));
  check(['error', 'finished'].includes(finalStatus), 'The run ends', finalStatus);

  completed = true;
  console.log('\n===========================================');
  if (failures.length > 0) {
    console.error(`❌ ${failures.length} FAILED, ${passed} passed`);
    for (const f of failures) console.error(`   - ${f}`);
    process.exit(1);
  }
  console.log(`🎉 ALL ${passed} CLOUD FEATURE TESTS PASSED`);
  console.log('===========================================');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
