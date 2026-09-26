/**
 * library.ts — the Ollama model library as the Models window shows it. The list of models and the
 * tags of each model come from ollama.com; a tag is verified against registry.ollama.ai (the source
 * `ollama pull` uses). This module only parses and classifies; the requests go through the main
 * process (electron/main.ts, models:*), which reaches nothing but those two hosts.
 */
import { CURATED_DISCOVER_MODELS } from './ModelService';

export type Lang = 'tr' | 'en';
type Text = { tr: string; en: string };

export type Capability = 'tools' | 'thinking' | 'vision' | 'embedding' | 'audio';
const CAPABILITIES: Capability[] = ['tools', 'thinking', 'vision', 'embedding', 'audio'];

/** A model of the library ("qwen3") with the sizes it comes in. */
export interface LibraryModel {
  name: string;
  description: string;
  capabilities: Capability[];
  /** Sizes that run on this computer, as listed ("0.6b", "8b", "e2b", "8x7b"); cloud-only offers are left out. */
  sizes: string[];
  /** Also offered as an ollama.com cloud model. */
  cloud: boolean;
  pulls: number;
  pullsLabel: string;
  tagCount: number;
  updated: string;
}

/** One tag of a model ("qwen3:8b-q8_0"). */
export interface ModelVariant {
  tag: string;
  /** The part after the colon: "8b-q8_0". */
  name: string;
  /** Size group: "8b"; tags without a size ("latest", "v1.5") go to OTHER_GROUP. */
  group: string;
  /** What follows the size: "q8_0", "a3b-instruct-2507-q4_K_M"; "" for the size's default tag. */
  suffix: string;
  /** Quantization read from the tag ("q4_K_M", "q8_0", "fp16"), or null. */
  quant: string | null;
  bytes: number | null;
  sizeLabel: string;
  /** Context window as listed ("40K"). */
  context: string;
  /** Input types as listed ("Text", "Text, Image"). */
  input: string;
  /** Short digest as listed (12 hex); equals the start of the sha256 of the registry manifest. */
  digest: string;
}

/** A downloadable choice: one digest, with the other tags that point to it. */
export interface VariantOption {
  variant: ModelVariant;
  /** Other tags with the same content (the default "8b" and its explicit "8b-q4_K_M"). */
  aliases: string[];
  /** The size's default download (what "ollama pull model:8b" gets). */
  isDefault: boolean;
  /** The quantization of this choice, also when only an alias names it. */
  quant: string | null;
  /** The build without the quantization: "instruct" for "7b-instruct-q8_0", "" for "8b-q8_0". */
  family: string;
}

export interface SizeGroup {
  size: string;
  /** Parameters in billions, null for OTHER_GROUP. */
  billions: number | null;
  options: VariantOption[];
  /** "model:latest" points to this size's default. */
  latest: boolean;
  /** The build of the default download ("instruct", "it", ""): its quantizations are the main choices. */
  family: string;
}

export const OTHER_GROUP = 'other';

const SIZE_RE = /^(?:\d+(?:\.\d+)?[mbt]|e\d+(?:\.\d+)?b|\d+x\d+(?:\.\d+)?b)$/i;
const QUANT_RE = /(?:^|-)((?:i?q\d(?:_\d)?(?:_[a-z]+)*)|fp16|fp32|bf16|mxfp4|int4|int8|qat)$/i;
/** Quantizations offered up front; the rest (q2, q3, legacy q4_0/q5_1, _S/_L) stay under "other versions". */
const COMMON_QUANT_RE = /^(?:q4_k_m|q5_k_m|q6_k|q8_0|fp16|bf16|mxfp4|qat)$/i;
export const isCommonQuant = (quant: string | null) => !!quant && COMMON_QUANT_RE.test(quant);

/** "instruct-q8_0" → "instruct", "q8_0" → "", "a3b-instruct-2507" → "a3b-instruct-2507". */
function familyOf(suffix: string, quant: string | null): string {
  if (!quant) return suffix;
  return suffix.toLowerCase().endsWith(quant.toLowerCase()) ? suffix.slice(0, suffix.length - quant.length).replace(/-$/, '') : suffix;
}
export const MODEL_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;
export const MODEL_TAG_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·' };
export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

const plainText = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** "0.6b" → 0.6, "270m" → 0.27, "e2b" → 2, "8x7b" → 56, "1t" → 1000; null for anything else. */
export function sizeToBillions(size: string): number | null {
  const s = size.trim().toLowerCase();
  if (!SIZE_RE.test(s)) return null;
  const moe = s.match(/^(\d+)x(\d+(?:\.\d+)?)b$/);
  if (moe) return Number(moe[1]) * Number(moe[2]);
  const n = parseFloat(s.replace(/^e/, ''));
  return s.endsWith('m') ? n / 1000 : s.endsWith('t') ? n * 1000 : n;
}

/** "38M" → 38000000, "655.2K" → 655200. */
export function parseCount(label: string): number {
  const m = label.trim().match(/^([\d.,]+)\s*([KMB])?$/i);
  if (!m) return 0;
  const n = parseFloat(m[1].replace(/,/g, ''));
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase() as 'K' | 'M' | 'B'] ?? 1;
  return Math.round(n * mult);
}

/** "5.2GB" → 5200000000 (decimal units, as ollama.com shows them). */
export function parseByteLabel(label: string): number | null {
  const m = label.match(/(\d+(?:\.\d+)?)\s*([KMGT])B\b/i);
  if (!m) return null;
  const mult = { K: 1e3, M: 1e6, G: 1e9, T: 1e12 }[m[2].toUpperCase() as 'K' | 'M' | 'G' | 'T'];
  return Math.round(parseFloat(m[1]) * mult);
}

/**
 * The list page (https://ollama.com/library): one <li> per model with its name, description,
 * capability labels, size labels, pull count, tag count and update time.
 */
export function parseLibraryHtml(html: string): LibraryModel[] {
  const models: LibraryModel[] = [];
  const seen = new Set<string>();
  const blocks = html.split(/<a\s+href="\/library\//).slice(1);
  for (const block of blocks) {
    const name = block.slice(0, block.indexOf('"'));
    if (!MODEL_NAME_RE.test(name) || seen.has(name)) continue;
    const body = block.split(/<\/li>/)[0];
    const labels = Array.from(body.matchAll(/<span\b[^>]*class="[^"]*inline-flex[^"]*"[^>]*>([\s\S]*?)<\/span>/g)).map((m) => plainText(m[1]));
    const capabilities = CAPABILITIES.filter((c) => labels.includes(c));
    const sizes = labels.filter((l) => SIZE_RE.test(l));
    const cloud = labels.includes('cloud');
    const descMatch = Array.from(body.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)).find((m) => !/my-4|space-x/.test(m[1]));
    const pulls = body.match(/<span[^>]*>\s*([\d.,]+\s*[KMB]?)\s*<\/span>\s*<span[^>]*>(?:&nbsp;|\s)*Pulls/i);
    const tags = body.match(/<span[^>]*>\s*(\d+)\s*<\/span>\s*<span[^>]*>(?:&nbsp;|\s)*Tags/i);
    const updated = body.match(/title="([^"]+)"[^>]*>[\s\S]{0,400}?Updated/);
    if (sizes.length === 0 && !cloud && capabilities.length === 0 && !descMatch) continue;
    seen.add(name);
    models.push({
      name,
      description: descMatch ? plainText(descMatch[2]) : '',
      capabilities,
      sizes,
      cloud,
      pullsLabel: pulls ? pulls[1].trim() : '',
      pulls: pulls ? parseCount(pulls[1]) : 0,
      tagCount: tags ? Number(tags[1]) : 0,
      updated: updated ? decodeEntities(updated[1]) : '',
    });
  }
  return models;
}

/** Group of a tag name: "8b-q8_0" → "8b"; "latest", "v1.5" → OTHER_GROUP. */
function groupOf(name: string): { group: string; suffix: string } {
  const [first, ...rest] = name.split('-');
  return SIZE_RE.test(first) ? { group: first.toLowerCase(), suffix: rest.join('-') } : { group: OTHER_GROUP, suffix: name };
}

export function quantOf(name: string): string | null {
  const m = name.match(QUANT_RE);
  return m ? m[1] : null;
}

/**
 * The tags page (https://ollama.com/library/<model>/tags): every tag with its digest, file size,
 * context window and input types. Each tag appears twice (phone and desktop layout); the text
 * between one tag and the next carries all fields in either layout.
 */
export function parseTagsHtml(model: string, html: string): ModelVariant[] {
  const escaped = model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`href="/library/${escaped}:([^"]+)"`, 'g');
  const firsts: Array<{ name: string; index: number }> = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(re)) {
    const name = decodeEntities(m[1]);
    if (seen.has(name) || !MODEL_TAG_RE.test(name)) continue;
    seen.add(name);
    firsts.push({ name, index: m.index ?? 0 });
  }
  return firsts.map(({ name, index }, i) => {
    const text = plainText(html.slice(index, i + 1 < firsts.length ? firsts[i + 1].index : undefined));
    const size = text.match(/(\d+(?:\.\d+)?\s*[KMGT]B)\b/i);
    const context = text.match(/(\d+(?:\.\d+)?[KM]?)\s+context window/i) || text.match(/\b(\d+(?:\.\d+)?[KM])\b(?!B)/);
    const input = text.match(/([A-Za-z][A-Za-z, ]*?)\s+input\b/i);
    const { group, suffix } = groupOf(name);
    return {
      tag: `${model}:${name}`,
      name,
      group,
      suffix,
      quant: quantOf(name),
      bytes: size ? parseByteLabel(size[1]) : null,
      sizeLabel: size ? size[1].replace(/\s+/g, '') : '',
      context: context ? context[1] : '',
      input: input ? input[1].trim() : '',
      digest: (text.match(/\b([0-9a-f]{12})\b/) || ['', ''])[1],
    };
  });
}

/** True when two digests (full sha256 or the 12-character short form) name the same content. */
export function sameDigest(a?: string | null, b?: string | null): boolean {
  const x = (a || '').toLowerCase().replace(/^sha256:/, '');
  const y = (b || '').toLowerCase().replace(/^sha256:/, '');
  const n = Math.min(x.length, y.length);
  return n >= 12 && x.slice(0, n) === y.slice(0, n);
}

/**
 * Sizes with their download choices. Tags with the same digest are one choice (the default "8b"
 * is the same file as "8b-q4_K_M"); the default comes first, then the choices by file size.
 */
export function groupVariants(model: string, variants: ModelVariant[]): SizeGroup[] {
  const latest = variants.find((v) => v.name === 'latest');
  const groups = new Map<string, ModelVariant[]>();
  for (const v of variants) {
    if (v.name === 'latest') continue;
    groups.set(v.group, [...(groups.get(v.group) || []), v]);
  }
  const result: SizeGroup[] = [];
  for (const [size, list] of groups) {
    const byDigest = new Map<string, ModelVariant[]>();
    for (const v of list) {
      const key = v.digest || v.tag;
      byDigest.set(key, [...(byDigest.get(key) || []), v]);
    }
    const defaultTag = size === OTHER_GROUP ? null : `${model}:${size}`;
    const options: VariantOption[] = Array.from(byDigest.values()).map((same) => {
      const isDefault = !!defaultTag && same.some((v) => v.tag === defaultTag);
      // Download the canonical tag: the default, else the shortest name.
      const main = (isDefault ? same.find((v) => v.tag === defaultTag) : undefined) || [...same].sort((a, b) => a.name.length - b.name.length)[0];
      // The longest name tells the build: the default "7b" is also "7b-instruct-q4_K_M".
      const longest = [...same].sort((a, b) => b.name.length - a.name.length)[0];
      return {
        variant: main,
        aliases: same.filter((v) => v !== main).map((v) => v.tag),
        isDefault,
        quant: main.quant || same.map((v) => v.quant).find(Boolean) || null,
        family: familyOf(longest.suffix, longest.quant),
      };
    });
    options.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || (a.variant.bytes ?? Infinity) - (b.variant.bytes ?? Infinity));
    const def = options.find((o) => o.isDefault);
    result.push({
      size,
      billions: size === OTHER_GROUP ? null : sizeToBillions(size),
      options,
      latest: !!latest && !!def && sameDigest(latest.digest, def.variant.digest),
      family: def ? def.family : '',
    });
  }
  // A model without sized tags (embedding models): "latest" is its only choice.
  if (result.length === 0 && latest) {
    result.push({
      size: OTHER_GROUP,
      billions: null,
      options: [{ variant: latest, aliases: [], isDefault: true, quant: latest.quant, family: '' }],
      latest: true,
      family: '',
    });
  }
  return result.sort((a, b) => (a.billions ?? Infinity) - (b.billions ?? Infinity));
}

// ---------------------------------------------------------------------------
// Quantization, memory and this computer
// ---------------------------------------------------------------------------

export type QuantTier = 'tiny' | 'small' | 'balanced' | 'better' | 'near-lossless' | 'full';

/** Rough quality/size class of a quantization. */
export function quantTier(quant: string | null): QuantTier | null {
  if (!quant) return null;
  const q = quant.toLowerCase();
  if (/^(fp16|bf16|fp32)$/.test(q)) return 'full';
  if (/^(q8|int8)/.test(q)) return 'near-lossless';
  if (/^q[56]/.test(q)) return 'better';
  if (/^(q4|int4|mxfp4|iq4|qat)/.test(q)) return 'balanced';
  if (/^(q3|iq3)/.test(q)) return 'small';
  if (/^(q2|iq[12])/.test(q)) return 'tiny';
  return null;
}

/** Memory a model of this file size needs to run: the weights plus room for the context and the runtime. */
export function memoryNeedGb(bytes: number): number {
  return (bytes / 1e9) * 1.2 + 1;
}

export type HardwareFit = 'comfortable' | 'tight' | 'too-large' | 'unknown';

export function hardwareFit(bytes: number | null, hw: { ramGb: number; vramGb?: number }): HardwareFit {
  if (!bytes || !hw.ramGb) return 'unknown';
  const need = memoryNeedGb(bytes);
  if (hw.vramGb && need <= hw.vramGb) return 'comfortable';
  if (need <= hw.ramGb * 0.6) return 'comfortable';
  if (need <= hw.ramGb * 0.85) return 'tight';
  return 'too-large';
}

/** The size to preselect: the largest one whose default runs comfortably here, else the smallest. */
export function pickSize(groups: SizeGroup[], hw: { ramGb: number; vramGb?: number }): string | null {
  const sized = groups.filter((g) => g.billions !== null && g.options.some((o) => o.isDefault));
  const comfortable = sized.filter((g) => hardwareFit(g.options.find((o) => o.isDefault)!.variant.bytes, hw) === 'comfortable');
  if (comfortable.length) return comfortable[comfortable.length - 1].size;
  return (sized[0] || groups[0])?.size ?? null;
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export type CategoryId = 'recommended' | 'coding' | 'agent' | 'reasoning' | 'vision' | 'small' | 'chat' | 'embedding' | 'all';

export interface LibraryCategory {
  id: CategoryId;
  icon: string;
  title: Text;
}

export const LIBRARY_CATEGORIES: LibraryCategory[] = [
  { id: 'recommended', icon: 'star', title: { tr: 'Önerilen', en: 'Recommended' } },
  { id: 'coding', icon: 'code', title: { tr: 'Kodlama', en: 'Coding' } },
  { id: 'agent', icon: 'wrench', title: { tr: 'Ajan ve araç kullanımı', en: 'Agents & tools' } },
  { id: 'reasoning', icon: 'brain', title: { tr: 'Akıl yürütme', en: 'Reasoning' } },
  { id: 'vision', icon: 'eye', title: { tr: 'Görüntü ve ses', en: 'Vision & audio' } },
  { id: 'small', icon: 'feather', title: { tr: 'Hafif (4B ve altı)', en: 'Lightweight (4B or less)' } },
  { id: 'chat', icon: 'message', title: { tr: 'Sohbet ve genel', en: 'Chat & general' } },
  { id: 'embedding', icon: 'layers', title: { tr: 'Gömme (arama)', en: 'Embedding (search)' } },
  { id: 'all', icon: 'grid', title: { tr: 'Tümü', en: 'All' } },
];

/** Models measured with Emir Code's own agent benchmark, with what they are good for here. */
export const RECOMMENDED_MODELS: Array<{ name: string; note: Text }> = [
  { name: 'qwen2.5-coder', note: { tr: 'Ajan için en dengeli seçim (testlerimizde önerilen varsayılan).', en: 'Best balance for the agent (the default our tests recommend).' } },
  { name: 'qwen3', note: { tr: 'En titiz; akıl yürütme modu var, işlemcide 2–3 kat yavaş.', en: 'Most thorough; has a reasoning mode, 2–3× slower on a CPU.' } },
  { name: 'deepseek-r1', note: { tr: 'Adım adım düşünen akıl yürütme modeli.', en: 'Step-by-step reasoning model.' } },
  { name: 'llama3.1', note: { tr: 'Genel amaçlı, araç kullanabilen sağlam bir model.', en: 'Solid general model with tool use.' } },
  { name: 'gemma3', note: { tr: 'Görüntü anlayan, küçük boyutları da olan model.', en: 'Understands images; also comes in small sizes.' } },
  { name: 'phi4', note: { tr: '14B; güçlü bilgisayarlarda iyi akıl yürütür.', en: '14B; reasons well on stronger computers.' } },
  { name: 'gemma2', note: { tr: 'Sohbet ve küçük düzenlemeler için hafif seçenek.', en: 'Light option for chat and small edits.' } },
  { name: 'mistral', note: { tr: 'Hızlı, 7B genel sohbet modeli.', en: 'Fast 7B general chat model.' } },
];

// Coding: the name says so, or the description calls it a coding model (general models that merely
// mention "code" among their strengths stay general).
const CODING_NAME_RE = /code|coder|codestral|devstral|starcoder|sql/i;
const CODING_DESC_RE = /\b(?:coding|code[- ](?:generation|completion|specific|model|models|llm|tasks?|editing)|programming|software engineering)\b/i;
const REASONING_RE = /\breason(?:ing|s)?\b|\bmath(?:ematics|ematical)?\b|-r1\b/i;

/** Models that can run on this computer (not only as an ollama.com cloud model). */
export const isLocal = (m: LibraryModel) => m.sizes.length > 0 || m.capabilities.includes('embedding') || !m.cloud;

export function categoriesOf(m: LibraryModel): CategoryId[] {
  const text = `${m.name} ${m.description}`;
  const embedding = m.capabilities.includes('embedding');
  const coding = !embedding && (CODING_NAME_RE.test(m.name) || CODING_DESC_RE.test(m.description));
  const ids: CategoryId[] = [];
  if (RECOMMENDED_MODELS.some((r) => r.name === m.name)) ids.push('recommended');
  if (coding) ids.push('coding');
  if (m.capabilities.includes('tools')) ids.push('agent');
  if (m.capabilities.includes('thinking') || (!embedding && REASONING_RE.test(text))) ids.push('reasoning');
  if (m.capabilities.includes('vision') || m.capabilities.includes('audio')) ids.push('vision');
  if (!embedding && m.sizes.some((s) => (sizeToBillions(s) ?? Infinity) <= 4)) ids.push('small');
  if (!embedding && !coding) ids.push('chat');
  if (embedding) ids.push('embedding');
  ids.push('all');
  return ids;
}

const fold = (s: string) => s.toLocaleLowerCase('tr').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');

/** The models of a category (recommended ones in their own order, the rest by popularity), or the search results. */
export function modelsFor(models: LibraryModel[], category: CategoryId, query = ''): LibraryModel[] {
  const local = models.filter(isLocal);
  const q = fold(query.trim());
  if (q) {
    return local
      .filter((m) => fold(`${m.name} ${m.description}`).includes(q))
      .sort((a, b) => Number(fold(b.name).startsWith(q)) - Number(fold(a.name).startsWith(q)) || b.pulls - a.pulls);
  }
  const list = local.filter((m) => categoriesOf(m).includes(category));
  if (category === 'recommended') {
    const order = RECOMMENDED_MODELS.map((r) => r.name);
    return list.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  }
  return list.sort((a, b) => b.pulls - a.pulls);
}

/** Splits "qwen3:8b" / "user/model:tag" into the model and the tag ("latest" when missing). */
export function splitTag(fullTag: string): { model: string; tag: string } {
  const i = fullTag.lastIndexOf(':');
  return i > 0 ? { model: fullTag.slice(0, i), tag: fullTag.slice(i + 1) } : { model: fullTag, tag: 'latest' };
}

/** A few known models for when ollama.com cannot be reached (no tags: the tested sizes only, one card per model). */
export function builtinLibrary(): LibraryModel[] {
  const caps: Record<string, Capability[]> = { tools: ['tools'], reasoning: ['thinking'], vision: ['vision'] };
  const byName = new Map<string, LibraryModel>();
  for (const m of CURATED_DISCOVER_MODELS) {
    const { model, tag } = splitTag(m.id);
    const known = byName.get(model);
    const capabilities = m.capabilities.flatMap((c) => caps[c] || []);
    if (known) {
      known.sizes.push(tag);
      known.capabilities = Array.from(new Set([...known.capabilities, ...capabilities]));
      known.tagCount = known.sizes.length;
      continue;
    }
    byName.set(model, {
      name: model,
      description: m.description,
      capabilities: Array.from(new Set(capabilities)),
      sizes: [tag],
      cloud: false,
      pulls: 0,
      pullsLabel: '',
      tagCount: 1,
      updated: '',
    });
  }
  return [...byName.values()];
}

/** The tested tags known offline for a built-in model. */
export function builtinVariants(model: string): ModelVariant[] {
  return CURATED_DISCOVER_MODELS.filter((m) => splitTag(m.id).model === model).map((item) => {
    const { tag } = splitTag(item.id);
    return {
      tag: item.id,
      name: tag,
      group: groupOf(tag).group,
      suffix: '',
      quant: null,
      bytes: parseByteLabel(item.approxSize.replace(/\s+/g, '')),
      sizeLabel: item.approxSize.replace(/\s+/g, ''),
      context: '',
      input: '',
      digest: '',
    };
  });
}
