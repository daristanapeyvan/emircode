/**
 * cloudStatus.ts — which providers can answer, from the main process's cloud status: a built-in
 * provider when it has a key, an OpenAI-compatible server as soon as it is added (local servers
 * often need no key).
 */
import type { CloudStatus } from '../../../electron/preload';
import { CLOUD_PROVIDERS, CloudProviderId, isCompatProvider, registerCompatEndpoints } from './modelRef';

export function providerReady(status: CloudStatus | null | undefined, provider: CloudProviderId): boolean {
  if (!status) return false;
  if (isCompatProvider(provider)) return (status.endpoints || []).some((e) => e.provider === provider);
  return !!status.providers?.[provider]?.configured;
}

/** Built-in providers with a key, then the added servers. Also tells modelRef the servers' names. */
export function readyProviders(status: CloudStatus | null | undefined): CloudProviderId[] {
  if (!status) return [];
  registerCompatEndpoints((status.endpoints || []).map(({ id, name, host, local }) => ({ id, name, host, local })));
  return [...CLOUD_PROVIDERS.filter((p) => status.providers?.[p]?.configured), ...(status.endpoints || []).map((e) => e.provider)];
}
