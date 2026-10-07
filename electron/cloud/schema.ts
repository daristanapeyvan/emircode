/**
 * The agent's answer schema for cloud providers. Ollama takes the agent's schema as it is: one
 * `anyOf` variant per tool, with string length limits. Claude's and OpenAI's structured outputs
 * accept a smaller part of JSON Schema (no length or number limits, `additionalProperties: false`
 * on every object), so the variants are merged into one object: `action` becomes an enum and the
 * tool fields become optional. ToolDispatcher still checks the fields of every action.
 */

/** Keywords Claude's structured outputs reject; OpenAI ignores them in non-strict mode. */
const UNSUPPORTED_KEYWORDS = [
  'minLength',
  'maxLength',
  'pattern',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
];

type Schema = Record<string, any>;

const isObject = (value: unknown): value is Schema => !!value && typeof value === 'object' && !Array.isArray(value);

/** A copy without the unsupported keywords and with `additionalProperties: false` on every object. */
export function sanitizeSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitizeSchema);
  if (!isObject(node)) return node;
  const out: Schema = {};
  for (const [key, value] of Object.entries(node)) {
    if (UNSUPPORTED_KEYWORDS.includes(key)) continue;
    if (key === 'properties' && isObject(value)) {
      out.properties = Object.fromEntries(Object.entries(value).map(([name, prop]) => [name, sanitizeSchema(prop)]));
    } else if (key === 'items' || key === 'anyOf' || key === 'allOf' || key === 'oneOf') {
      out[key] = sanitizeSchema(value);
    } else {
      out[key] = value;
    }
  }
  if (out.type === 'object' || isObject(out.properties)) {
    out.type = 'object';
    out.properties = out.properties || {};
    out.additionalProperties = false;
  }
  if (Array.isArray(out.oneOf)) {
    // oneOf is not supported; anyOf means the same for these schemas.
    out.anyOf = out.oneOf;
    delete out.oneOf;
  }
  return out;
}

/**
 * One object schema for an `anyOf` of object variants (the agent's actions): properties merged in
 * order ("thought" and "action" first), the `action` constants as one enum, and as required only
 * what every variant requires. Any other schema is only sanitized.
 */
export function flattenSchema(schema: unknown): Schema {
  if (!isObject(schema)) return { type: 'object', properties: {}, additionalProperties: false };
  const variants = Array.isArray(schema.anyOf) ? schema.anyOf.filter(isObject) : [];
  if (variants.length === 0 || !variants.every((v) => isObject(v.properties))) {
    return sanitizeSchema(schema) as Schema;
  }
  const properties: Schema = {};
  const actions: string[] = [];
  let required: string[] | null = null;
  for (const variant of variants) {
    for (const [name, prop] of Object.entries(variant.properties as Schema)) {
      if (name === 'action' && isObject(prop)) {
        const values = prop.const !== undefined ? [prop.const] : Array.isArray(prop.enum) ? prop.enum : [];
        for (const v of values) if (typeof v === 'string' && !actions.includes(v)) actions.push(v);
        if (!('action' in properties)) properties.action = null; // keeps its place in the order
        continue;
      }
      if (!(name in properties)) properties[name] = sanitizeSchema(prop);
    }
    const own: string[] = Array.isArray(variant.required) ? variant.required.filter((r: unknown): r is string => typeof r === 'string') : [];
    required = required === null ? own : required.filter((r) => own.includes(r));
  }
  if ('action' in properties) properties.action = actions.length ? { type: 'string', enum: actions } : { type: 'string' };
  return {
    type: 'object',
    properties,
    required: required || [],
    additionalProperties: false,
  };
}
