/**
 * cloud-bridge.ts — the main process's cloud service for scripts that run without Electron
 * (scripts/agent-e2e.ts, scripts/cloud-smoke.ts).
 *
 * Keys come from the environment only (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY,
 * MISTRAL_API_KEY, OLLAMA_API_KEY) and are never written to disk. An OpenAI-compatible server can be
 * added with EMIR_COMPAT_URL (+ EMIR_COMPAT_NAME, EMIR_COMPAT_KEY, EMIR_COMPAT_LOCAL=1); it is named
 * "openai-compatible:<id>" like in the app.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CloudService, EndpointStore, KeyStore } from '../electron/cloud/index';
import type { SecretBox } from '../electron/cloud/keyStore';
import type { CloudEvent, CloudModelInfo } from '../electron/cloud/types';
import { CloudProviderId, parseModelRef, registerCompatEndpoints } from '../src/lib/providers/modelRef';
import { registerCloudModels } from '../src/lib/ollama/ModelRuntime';

/** No system key store: nothing is persisted, environment keys are used as they are. */
const NO_BOX: SecretBox = {
  available: () => false,
  encrypt: () => {
    throw new Error('not available');
  },
  decrypt: () => {
    throw new Error('not available');
  },
};

export interface Bridge {
  service: CloudService;
  /** The OpenAI-compatible server from EMIR_COMPAT_URL, when one was added. */
  compatProvider: CloudProviderId | null;
}

export async function createBridge(env: NodeJS.ProcessEnv = process.env): Promise<Bridge> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emir-cloud-bridge-'));
  const service = new CloudService(new KeyStore(path.join(dir, 'keys.json'), NO_BOX, env), new EndpointStore(path.join(dir, 'endpoints.json')));
  let compatProvider: CloudProviderId | null = null;
  if (env.EMIR_COMPAT_URL) {
    const added = await service.addEndpoint({
      name: env.EMIR_COMPAT_NAME || 'Server',
      baseURL: env.EMIR_COMPAT_URL,
      key: env.EMIR_COMPAT_KEY || undefined,
      localServer: env.EMIR_COMPAT_LOCAL === '1',
    });
    if (!added.ok) throw new Error(`EMIR_COMPAT_URL: ${added.error.code} ${added.error.message}`);
    compatProvider = added.endpoint.provider;
  }
  const status = service.status();
  registerCompatEndpoints(status.endpoints.map(({ id, name, host, local }) => ({ id, name, host, local })));
  return { service, compatProvider };
}

/**
 * Adds the cloud functions of window.electronAPI to a mock API, served by the service directly, so
 * the real ModelGateway and AgentEngine run unchanged.
 */
export function attachBridge(api: any, service: CloudService, onEvent?: (event: CloudEvent) => void): void {
  const listeners = new Set<(event: CloudEvent) => void>();
  api.cloudStatus = async () => service.status();
  api.cloudListModels = (provider: CloudProviderId) => service.listModels(provider);
  api.cloudDescribe = (provider: CloudProviderId, model: string) => service.describe(provider, model);
  api.cloudAbort = async (requestId: string) => service.abort(requestId);
  api.onCloudEvent = (cb: (event: CloudEvent) => void) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  };
  api.cloudChat = async (requestId: string, request: unknown) =>
    service.chat(requestId, request, (event) => {
      onEvent?.(event);
      for (const cb of listeners) cb(event);
    });
}

/** Lists the model's provider once so the agent knows its context window, output limit and vision. */
export async function registerModel(service: CloudService, ref: string): Promise<CloudModelInfo | null> {
  const { provider, model } = parseModelRef(ref);
  if (provider === 'ollama') return null;
  const listed = await service.listModels(provider);
  if (!listed.ok) throw new Error(`${provider}: ${listed.error.code} ${listed.error.message}`);
  registerCloudModels(listed.models);
  return listed.models.find((m) => m.id === model) || null;
}
