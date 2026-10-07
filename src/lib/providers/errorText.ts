/** Errors of cloud models as one sentence in the interface language. */
import { format } from '../localization/i18n';
import type { en } from '../localization/translations/en';
import { isCloudRequestError } from './ModelGateway';
import { PROVIDER_NAMES, isOllamaCloudTag, parseModelRef } from './modelRef';

type CloudTexts = typeof en.cloud;

/** The explanation of a failed request to a cloud model, or null when the error is not one of those. */
export function cloudErrorText(err: unknown, modelRef: string, t: CloudTexts): string | null {
  const { model } = parseModelRef(modelRef);
  if (isCloudRequestError(err)) {
    const params = {
      provider: PROVIDER_NAMES[err.provider],
      model,
      error: err.message,
      category: err.category ? ` (${err.category})` : '',
    };
    const key: keyof CloudTexts | null =
      err.code === 'no_key'
        ? 'errNoKey'
        : err.code === 'auth'
          ? 'errAuth'
          : err.code === 'quota'
            ? 'errQuota'
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
  if (isOllamaCloudTag(model) && /unauthori[sz]ed|\b401\b|sign ?in|signin/i.test(message)) return t.errOllamaSignin;
  return null;
}
