/**
 * params.ts — the parameter schema of the Mini App and Script wizards.
 *
 * A tool declares its fields (toggle, mode choice, multi choice, number, text, list) with labels
 * and the sentence each value adds to the request. The form is rendered from this schema and the
 * request is compiled from it, so a new tool is data only. Defaults of choices, texts and lists
 * may differ per language (sample lists, name patterns), so the app reads well in either language.
 */

export type Lang = 'tr' | 'en';
export interface Text {
  tr: string;
  en: string;
}

export const tx = (t: Text, lang: Lang) => (lang === 'en' ? t.en : t.tr);

/** A default that is the same in every language or differs per language. */
export type Localized = string | Text;
const resolve = (value: Localized, lang: Lang) => (typeof value === 'string' ? value : tx(value, lang));

export interface ParamOption {
  value: string;
  label: Text;
  /** Sentence added to the request when this option is chosen ("{value}" = the option label). */
  prompt?: Text;
}

interface FieldBase {
  key: string;
  label: Text;
  hint?: Text;
  /** Show the field only when another field has this value (toggle: true/false, choice: value). */
  showIf?: { key: string; equals: string | boolean };
}

export type ParamField =
  | (FieldBase & { type: 'toggle'; default: boolean; on?: Text; off?: Text })
  | (FieldBase & { type: 'choice'; default: Localized; options: ParamOption[] })
  | (FieldBase & { type: 'multi'; default: string[]; options: ParamOption[]; min?: number; prompt: Text })
  | (FieldBase & { type: 'number'; default: number; min: number; max: number; step?: number; unit?: Text; prompt: Text })
  | (FieldBase & { type: 'text'; default: Localized; placeholder?: Text; maxLength?: number; prompt?: Text })
  | (FieldBase & { type: 'list'; default: Localized; placeholder?: Text; prompt: Text });

export type ParamValue = boolean | string | number | string[];
export type ParamValues = Record<string, ParamValue>;

/** The default value of a field in the given language. */
export function defaultOf(field: ParamField, lang: Lang): ParamValue {
  switch (field.type) {
    case 'multi':
      return [...field.default];
    case 'choice':
    case 'text':
    case 'list':
      return resolve(field.default, lang);
    default:
      return field.default;
  }
}

export function defaultValues(fields: ParamField[], lang: Lang = 'tr'): ParamValues {
  const values: ParamValues = {};
  for (const f of fields) values[f.key] = defaultOf(f, lang);
  return values;
}

/** The value of a field, falling back to its default when missing or of the wrong type. */
export function valueOf(field: ParamField, values: ParamValues, lang: Lang = 'tr'): ParamValue {
  const v = values[field.key];
  switch (field.type) {
    case 'toggle':
      return typeof v === 'boolean' ? v : field.default;
    case 'choice':
      return typeof v === 'string' && field.options.some((o) => o.value === v) ? v : resolve(field.default, lang);
    case 'multi':
      return Array.isArray(v) ? v.filter((x) => field.options.some((o) => o.value === x)) : [...field.default];
    case 'number': {
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? Math.min(field.max, Math.max(field.min, n)) : field.default;
    }
    default:
      return typeof v === 'string' ? v : resolve(field.default, lang);
  }
}

export function isVisible(field: ParamField, fields: ParamField[], values: ParamValues, lang: Lang = 'tr'): boolean {
  if (!field.showIf) return true;
  const other = fields.find((f) => f.key === field.showIf!.key);
  if (!other) return true;
  return valueOf(other, values, lang) === field.showIf.equals;
}

const fill = (template: string, vars: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (m, key) => (key in vars ? vars[key] : m));

/** The request sentences of the visible fields, in schema order. */
export function describeValues(fields: ParamField[], values: ParamValues, lang: Lang): string[] {
  const lines: string[] = [];
  for (const field of fields) {
    if (!isVisible(field, fields, values, lang)) continue;
    const v = valueOf(field, values, lang);
    switch (field.type) {
      case 'toggle': {
        const text = v ? field.on : field.off;
        if (text) lines.push(tx(text, lang));
        break;
      }
      case 'choice': {
        const option = field.options.find((o) => o.value === v);
        if (option?.prompt) lines.push(fill(tx(option.prompt, lang), { value: tx(option.label, lang) }));
        break;
      }
      case 'multi': {
        const chosen = field.options.filter((o) => (v as string[]).includes(o.value));
        if (chosen.length > 0) {
          lines.push(fill(tx(field.prompt, lang), { items: chosen.map((o) => (o.prompt ? tx(o.prompt, lang) : tx(o.label, lang))).join(', ') }));
        }
        break;
      }
      case 'number':
        lines.push(fill(tx(field.prompt, lang), { value: String(v) }));
        break;
      case 'text': {
        const text = String(v).trim().replace(/\s+/g, ' ');
        if (text && field.prompt) lines.push(fill(tx(field.prompt, lang), { value: text }));
        break;
      }
      case 'list': {
        const items = String(v)
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
        if (items.length > 0) lines.push(fill(tx(field.prompt, lang), { items: items.map((i) => `  - ${i}`).join('\n'), count: String(items.length) }));
        break;
      }
    }
  }
  return lines;
}
