/** Errors of cloud models as one sentence in the interface language. */
import { format } from '../localization/i18n';
import type { en } from '../localization/translations/en';
import { isCloudRequestError } from './ModelGateway';
import { isOllamaCloudTag, providerName, parseModelRef } from './modelRef';

type CloudTexts = typeof en.cloud;

/** The explanation of a failed request to a cloud model, or null when the error is not one of those. */
export function cloudErrorText(err: unknown, modelRef: string, t: CloudTexts, providerLabel?: string): string | null {
  const { model } = parseModelRef(modelRef);
  if (isCloudRequestError(err)) {
    const params = {
      provider: providerLabel || providerName(err.provider),
      model,
      error: err.message,
      category: err.category ? ` (${err.category})` : '',
      resets: err.resetsAt ? format(t.resetsAt, { when: err.resetsAt }) : '',
    };
    const key: keyof CloudTexts | null =
      err.code === 'no_key'
        ? 'errNoKey'
        : err.code === 'auth'
          ? 'errAuth'
          : err.code === 'quota'
            ? 'errQuota'
            : err.code === 'usage_limit'
              ? err.provider === 'ollama-cloud'
                ? 'errOllamaUsageLimit'
                : 'errUsageLimit'
            : err.code === 'rate_limit'
              ? 'errRateLimit'
              : err.code === 'overloaded'
                ? 'errOverloaded'
                : err.code === 'not_found'
                  ? 'errNotFound'
                  : err.code === 'context_length'
                    ? 'errContext'
                    : err.code === 'refusal'
                      ? 'errRefusal'
                      : err.code === 'network'
                        ? 'errNetwork'
                        : err.code === 'invalid'
                          ? 'errInvalid'
                          : null;
    return format(String(t[key || 'errOther']), params);
  }
  // An Ollama Cloud model through the local Ollama, which is not signed in to ollama.com.
  const message = String((err as any)?.message || err || '');
  if (isOllamaCloudTag(model) && /usage limit|(?:hourly|weekly|daily|session) limit|reached your (?:\w+ )?limit|\b429\b/i.test(message)) {
    const when = message.match(/(?:resets?|try again)\s+(?:in|at|after|on)\s+([^.;\n]{1,60})/i)?.[1]?.trim();
    return format(t.errOllamaUsageLimit, { resets: when ? format(t.resetsAt, { when }) : '' });
  }
  if (isOllamaCloudTag(model) && /unauthori[sz]ed|\b401\b|sign ?in|signin/i.test(message)) return t.errOllamaSignin;
  return null;
}
