/**
 * cssRewrite.ts — maps the colors and fonts a model wrote to the roles of the design theme.
 *
 * "#333" is ink when it colors text, the inverse band when it fills a navbar, and a strong
 * border when it outlines something; white text inside that navbar becomes on-inverse, text on
 * an accent button becomes on-accent. The role comes from the property, the rule's own
 * background and the backgrounds of ancestor selectors (".topnav a" inherits ".topnav").
 *
 * Every replacement keeps the original as the fallback — var(--theme-ink, #333) — so the page
 * looks exactly as the model wrote it if theme.css is ever removed.
 */
import { NAMED_COLORS, Rgba, parseColor, toOklch, hueDistance } from './color';
import { tokenizeHtml, walkHtml, joinTokens } from './html';

export interface RewriteOptions {
  mode: 'light' | 'dark';
  /** Map color literals to theme roles. */
  colors: boolean;
  /** Replace generic font stacks (Arial, Segoe UI, Poppins ...) with the theme fonts. */
  fonts: boolean;
  /**
   * Layout fixes (default on): a sticky/fixed element without z-index gets one — otherwise any
   * later element with opacity/transform paints over a sticky navbar — and anchor jumps leave
   * room for a sticky top bar.
   */
  layout?: boolean;
}

const STICKY = /(?:^|;)\s*position\s*:\s*(?:sticky|fixed)\b/i;
const HAS_Z_INDEX = /(?:^|;)\s*z-index\s*:/i;
const AT_TOP = /(?:^|;)\s*top\s*:\s*0(?:px|rem|em)?\s*(?:;|$|!)/i;

type Role =
  | 'bg' | 'surface' | 'surface-2' | 'border' | 'field-border' | 'ink' | 'ink-soft'
  | 'inverse' | 'on-inverse' | 'on-inverse-soft'
  | 'accent' | 'accent-strong' | 'accent-soft' | 'accent-ink' | 'on-accent' | 'accent-2' | 'on-accent-2';

type Ctx = 'bg' | 'fg' | 'border' | 'generic';
type Band = 'light' | 'dark' | 'accent' | 'accent2' | null;

interface ColorInfo {
  L: number;
  C: number;
  h: number;
  alpha: number;
  neutral: boolean;
}

interface Flags {
  hover: boolean;
  body: boolean;
}

const NEUTRAL_CHROMA = 0.05;

function info(c: Rgba): ColorInfo {
  const o = toOklch(c);
  return { L: o.L, C: o.C, h: o.h, alpha: c.a, neutral: o.C < NEUTRAL_CHROMA };
}

// ---------------------------------------------------------------------------
// Small CSS scanning helpers (strings, comments and nested parentheses aware)
// ---------------------------------------------------------------------------

/** Index just past the ")" that closes the "(" at `open`. */
function closeParen(s: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return s.length;
}

/** Splits at `sep` outside strings, parentheses and brackets. */
function splitTop(s: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === sep && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

interface DeclBlock {
  prelude: string;
  bodyStart: number;
  bodyEnd: number;
}

/** Leaf `{ ... }` blocks of a stylesheet (rules inside @media are included). */
function declarationBlocks(css: string): DeclBlock[] {
  const blocks: DeclBlock[] = [];
  const stack: Array<{ prelude: string; open: number; hasChild: boolean }> = [];
  let preludeStart = 0;
  let quote: string | null = null;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? css.length : end + 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '{') {
      stack.push({ prelude: css.slice(preludeStart, i).replace(/\/\*[\s\S]*?\*\//g, '').trim(), open: i, hasChild: false });
      preludeStart = i + 1;
    } else if (ch === '}') {
      const top = stack.pop();
      if (top) {
        if (!top.hasChild) blocks.push({ prelude: top.prelude, bodyStart: top.open + 1, bodyEnd: i });
        if (stack.length) stack[stack.length - 1].hasChild = true;
      }
      preludeStart = i + 1;
    } else if (ch === ';' && stack.length === 0) {
      preludeStart = i + 1;
    }
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/** "nav.topnav > a:hover" -> ["nav.topnav", "a"] (pseudo-classes and attributes dropped). */
function compounds(selector: string): string[] {
  const cleaned = selector
    .replace(/\([^()]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/::?[\w-]+/g, '')
    .trim()
    .toLowerCase();
  return cleaned.split(/\s*[>+~]\s*|\s+/).filter(Boolean);
}

const HOVER_SELECTOR = /:(?:hover|focus|focus-visible|focus-within|active)\b/i;
const HEADING_KEY = /^(?:h[1-6])(?:[.#]|$)|\.(?:logo|brand|navbar-brand|site-title|title|heading|headline|display|hero-title)\b/;

function isBodySelector(selector: string): boolean {
  const parts = compounds(selector);
  return parts.length === 1 && /^(?:html|body)$/.test(parts[0]);
}

// ---------------------------------------------------------------------------
// Declarations
// ---------------------------------------------------------------------------

function contextOf(prop: string): Ctx | null {
  const p = prop.trim().toLowerCase();
  if (p.startsWith('--')) {
    if (/bg|background|surface|card|section|panel|hero|header-color|nav-color|footer-color/.test(p)) return 'bg';
    if (/text|fg|foreground|font|ink|heading|title/.test(p)) return 'fg';
    if (/border|line|divider|outline/.test(p)) return 'border';
    return 'generic';
  }
  if (p === 'color' || p === 'caret-color' || p === 'text-decoration-color' || p === '-webkit-text-fill-color') return 'fg';
  if (p === 'background' || p === 'background-color' || p === 'background-image') return 'bg';
  if (p.startsWith('border') || p.startsWith('outline') || p === 'column-rule' || p === 'column-rule-color' || p === 'accent-color') return 'border';
  if (p === 'box-shadow' || p === 'text-shadow' || p === 'fill' || p === 'stroke') return 'generic';
  return null;
}

interface ColorToken {
  start: number;
  end: number;
  text: string;
  color: Rgba;
}

/** Color literals of a declaration value (url(), var(), strings and color-mix() skipped). */
function colorTokens(value: string): ColorToken[] {
  const out: ColorToken[] = [];
  let i = 0;
  while (i < value.length) {
    const rest = value.slice(i);
    const skipFn = rest.match(/^(?:url|var|env|color-mix|image-set|attr)\(/i);
    if (skipFn) {
      i = closeParen(value, i + skipFn[0].length - 1);
      continue;
    }
    const ch = value[i];
    if (ch === '"' || ch === "'") {
      const end = value.indexOf(ch, i + 1);
      i = end === -1 ? value.length : end + 1;
      continue;
    }
    const fn = rest.match(/^(?:rgba?|hsla?)\(/i);
    if (fn) {
      const end = closeParen(value, i + fn[0].length - 1);
      const text = value.slice(i, end);
      const color = parseColor(text);
      if (color) out.push({ start: i, end, text, color });
      i = end;
      continue;
    }
    if (ch === '#') {
      const m = rest.match(/^#[0-9a-fA-F]+/);
      if (m) {
        const color = parseColor(m[0]);
        if (color) out.push({ start: i, end: i + m[0].length, text: m[0], color });
        i += m[0].length;
        continue;
      }
    }
    if (/[a-zA-Z]/.test(ch) && (i === 0 || /[\s,(/]/.test(value[i - 1]))) {
      const m = rest.match(/^[a-zA-Z-]+/)!;
      const word = m[0];
      const followedOk = i + word.length >= value.length || /[\s,)/!;]/.test(value[i + word.length]);
      if (followedOk && NAMED_COLORS[word.toLowerCase()]) {
        out.push({ start: i, end: i + word.length, text: word, color: parseColor(word)! });
      }
      i += word.length;
      continue;
    }
    i++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

const GENERIC_FONTS = new Set(
  (
    'arial|helvetica|helvetica neue|verdana|tahoma|geneva|segoe ui|trebuchet ms|lucida grande|lucida sans unicode|' +
    'lucida sans|times new roman|times|georgia|palatino|palatino linotype|book antiqua|garamond|cambria|calibri|candara|' +
    'sans-serif|serif|system-ui|-apple-system|blinkmacsystemfont|ui-sans-serif|ui-serif|roboto|open sans|lato|montserrat|' +
    'poppins|inter|noto sans|ubuntu|cantarell|fira sans|droid sans|oxygen|oxygen-sans|source sans pro|raleway|nunito|' +
    'playfair display|merriweather|apple color emoji|segoe ui emoji|segoe ui symbol|noto color emoji|avenir|avenir next|' +
    'franklin gothic medium|arial narrow|impact|comic sans ms|sf pro display|sf pro text|century gothic|' +
    'monospace|courier|courier new|consolas|monaco|menlo|lucida console|ui-monospace|source code pro|fira code'
  ).split('|')
);
const MONO_FONTS = /monospace|courier|consolas|monaco|menlo|lucida console|source code pro|fira code/;

function familiesAreGeneric(list: string): boolean {
  const names = splitTop(list, ',').map((f) => f.trim().replace(/^["']|["']$/g, '').toLowerCase());
  return names.length > 0 && names.every((n) => n && GENERIC_FONTS.has(n));
}

function fontRole(list: string, selectors: string[]): 'heading' | 'body' | 'mono' {
  if (MONO_FONTS.test(list.toLowerCase())) return 'mono';
  const allHeadings =
    selectors.length > 0 &&
    selectors.every((s) => {
      const parts = compounds(s);
      return parts.length > 0 && HEADING_KEY.test(parts[parts.length - 1]);
    });
  return allHeadings ? 'heading' : 'body';
}

const FONT_SHORTHAND =
  /^(.*?(?:\d*\.?\d+(?:px|em|rem|%|pt|vw|vh|ch)|xx-small|x-small|small|medium|large|x-large|xx-large|smaller|larger)(?:\s*\/\s*[\w.%]+)?\s+)(.+)$/i;

// ---------------------------------------------------------------------------
// The rewriter
// ---------------------------------------------------------------------------

export class ThemeRewriter {
  private bands = new Map<string, Band>();
  private hueBins = new Map<number, { weight: number; sum: number }>();
  private dominantHue: number | null = null;
  /** Rules seen in pass 1; their backgrounds are classified once the main hue is known. */
  private collected: Array<{ prelude: string; body: string }> = [];
  /** Custom properties defined by the page (--primary-color: #667eea), to classify var() backgrounds. */
  private vars = new Map<string, string>();
  /** The page has a bar stuck to the top: anchor targets need scroll padding. */
  private stickyTop = false;
  private scrollPaddingDone = false;
  private bandsReady = false;
  replacements = 0;

  constructor(private options: RewriteOptions) {}

  // ---------------- pass 1: learn backgrounds and the main accent hue ----------------

  collectCss(css: string): void {
    for (const block of declarationBlocks(css)) {
      this.collectBlock(block.prelude, css.slice(block.bodyStart, block.bodyEnd));
    }
  }

  collectHtml(html: string): void {
    for (const token of tokenizeHtml(html)) {
      if (token.type === 'raw' && token.name === 'style') this.collectCss(token.value);
      else if (token.type === 'tag' && !token.closing) {
        const style = styleAttribute(token.value);
        if (style) this.collectBlock('', style.value);
      }
    }
  }

  private collectBlock(prelude: string, body: string): void {
    const selectors = prelude ? splitTop(prelude, ',').map((s) => s.trim()).filter(Boolean) : [];
    for (const decl of splitTop(body, ';')) {
      const colon = decl.indexOf(':');
      if (colon === -1) continue;
      const prop = decl.slice(0, colon).trim();
      if (prop.startsWith('--')) this.vars.set(prop.toLowerCase(), decl.slice(colon + 1).trim());
      const ctx = contextOf(prop);
      if (!ctx) continue;
      for (const tok of colorTokens(decl.slice(colon + 1))) {
        const c = info(tok.color);
        if (!c.neutral && c.alpha > 0.99 && c.L >= 0.3 && c.L < 0.88) {
          const bin = Math.round(c.h / 30) % 12;
          const entry = this.hueBins.get(bin) || { weight: 0, sum: 0 };
          const w = ctx === 'bg' ? 2 : 1;
          entry.weight += w;
          entry.sum += c.h * w;
          this.hueBins.set(bin, entry);
        }
      }
    }
    if (selectors.length > 0) this.collected.push({ prelude, body });
    if (STICKY.test(body) && AT_TOP.test(body)) this.stickyTop = true;
    if (/scroll-padding/i.test(body)) this.scrollPaddingDone = true;
    this.dominantHue = null;
    this.bandsReady = false;
  }

  /** Background band of every selector seen in pass 1 (".topnav" -> dark, ".hero" -> accent). */
  private ensureBands(): void {
    if (this.bandsReady) return;
    this.bands.clear();
    for (const { prelude, body } of this.collected) {
      const band = this.ownBand(body);
      if (!band) continue;
      for (const sel of splitTop(prelude, ',').map((s) => s.trim()).filter(Boolean)) {
        if (HOVER_SELECTOR.test(sel)) continue;
        const parts = compounds(sel);
        const key = parts[parts.length - 1];
        if (key && !this.bands.has(key)) this.bands.set(key, band);
      }
    }
    this.bandsReady = true;
  }

  private hueRole(c: ColorInfo): 'accent' | 'accent-2' {
    if (this.dominantHue === null) {
      let best: { weight: number; sum: number } | null = null;
      for (const entry of this.hueBins.values()) if (!best || entry.weight > best.weight) best = entry;
      this.dominantHue = best ? best.sum / best.weight : -1;
    }
    if (this.dominantHue < 0) return 'accent';
    return hueDistance(c.h, this.dominantHue) > 50 ? 'accent-2' : 'accent';
  }

  /** The band a rule's own background puts its text on. */
  private ownBand(body: string): Band {
    for (const decl of splitTop(body, ';')) {
      const colon = decl.indexOf(':');
      if (colon === -1) continue;
      const prop = decl.slice(0, colon).trim().toLowerCase();
      if (prop !== 'background' && prop !== 'background-color' && prop !== 'background-image') continue;
      const value = decl.slice(colon + 1);
      let tokens = colorTokens(value).filter((t) => t.color.a > 0.5);
      if (tokens.length === 0) tokens = colorTokens(this.resolveVar(value)).filter((t) => t.color.a > 0.5);
      if (tokens.length === 0) continue;
      const c = info(tokens[0].color);
      if (c.neutral) return c.L < 0.55 ? 'dark' : 'light';
      if (c.L < 0.3) return 'dark';
      if (c.L >= 0.88) return 'light';
      return this.hueRole(c) === 'accent-2' ? 'accent2' : 'accent';
    }
    return null;
  }

  /** "var(--primary-color)" -> the value the page gave that property (a few levels deep). */
  private resolveVar(value: string, depth = 0): string {
    const m = value.match(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/i);
    if (!m || depth > 3) return '';
    const defined = this.vars.get(m[1].toLowerCase());
    if (defined === undefined) return m[2] || '';
    return /var\(/i.test(defined) ? this.resolveVar(defined, depth + 1) : defined;
  }

  private bandFor(selectors: string[], body: string): Band {
    const own = this.ownBand(body);
    if (own) return own;
    for (const sel of selectors) {
      const parts = compounds(sel);
      for (let i = parts.length - 1; i >= 0; i--) {
        const band = this.bands.get(parts[i]);
        if (band) return band;
      }
    }
    return null;
  }

  // ---------------- mapping ----------------

  private role(c: ColorInfo, ctx: Ctx, band: Band, flags: Flags): Role | null {
    const dark = this.options.mode === 'dark';
    const L = c.L;
    if (c.neutral) {
      if (ctx === 'bg') {
        if (flags.body) return dark || L >= 0.6 ? 'bg' : 'inverse';
        if (dark) return L >= 0.9 ? 'surface' : L >= 0.55 ? 'surface-2' : 'inverse';
        return L >= 0.975 ? 'surface' : L >= 0.8 ? 'surface-2' : L >= 0.55 ? 'ink-soft' : 'inverse';
      }
      if (ctx === 'fg') {
        if (band === 'accent') return 'on-accent';
        if (band === 'accent2') return 'on-accent-2';
        if (dark) return L >= 0.42 && L < 0.85 ? 'ink-soft' : 'ink';
        if (band === 'dark') return L >= 0.85 || L < 0.45 ? 'on-inverse' : 'on-inverse-soft';
        return L >= 0.9 ? 'on-inverse' : L >= 0.42 ? 'ink-soft' : 'ink';
      }
      if (ctx === 'border') return L >= 0.75 ? 'border' : dark || L >= 0.45 ? 'field-border' : 'ink';
      // generic (custom properties, shadows, fills)
      if (L >= 0.975) return 'surface';
      if (L >= 0.88) return 'bg';
      if (L >= 0.75) return dark ? 'surface-2' : 'border';
      return L >= 0.42 ? 'ink-soft' : 'ink';
    }
    const accent = this.hueRole(c);
    if (ctx === 'bg') {
      if (flags.body) return dark || L >= 0.75 ? 'bg' : 'inverse';
      if (flags.hover) return accent === 'accent-2' ? 'accent-2' : 'accent-strong';
      if (L >= 0.88) return 'accent-soft';
      if (L < 0.3) return 'inverse';
      return accent;
    }
    if (ctx === 'fg') {
      if (band === 'accent') return 'on-accent';
      if (band === 'accent2') return 'on-accent-2';
      if (band === 'dark' && !dark) return 'accent-soft';
      return 'accent-ink';
    }
    if (ctx === 'border') return L >= 0.88 ? 'accent-soft' : accent;
    if (L >= 0.88) return 'accent-soft';
    if (L < 0.3) return dark ? accent : 'accent-strong';
    return accent;
  }

  /**
   * "color: var(--primary-color)": the page's own variable is used as text here, so it gets the
   * role of that use (accent-ink) instead of the role of its definition (accent), which is too
   * light for text in themes with bright accents. The page's variable stays as the fallback.
   */
  private rewriteVarReference(prop: string, value: string, ctx: Ctx, band: Band, flags: Flags): string {
    const m = value.match(/^(\s*)(var\(\s*(--[\w-]+)\s*(?:,[^()]*(?:\([^()]*\)[^()]*)*)?\))(\s*(?:!important)?\s*)$/i);
    if (!m || m[3].toLowerCase().startsWith('--theme-')) return value;
    const color = parseColor(this.resolveVar(m[2]).trim());
    if (!color || color.a < 0.99) return value;
    const role = this.role(info(color), ctx, band, flags);
    if (!role || prop.trim().toLowerCase() === `--theme-${role}`) return value;
    this.replacements++;
    return `${m[1]}var(--theme-${role}, ${m[2]})${m[4]}`;
  }

  private rewriteValue(prop: string, value: string, ctx: Ctx, band: Band, flags: Flags): string {
    const tokens = colorTokens(value);
    if (tokens.length === 0) return this.rewriteVarReference(prop, value, ctx, band, flags);
    const gradient = /gradient\(/i.test(value);
    const roles: Array<Role | null> = tokens.map((t) => {
      const c = info(t.color);
      if (c.alpha < 0.01) return null;
      return this.role(c, ctx, band, flags);
    });
    // Two stops of the same accent in a gradient: keep some depth instead of a flat fill.
    if (gradient) {
      const accentIdx = roles.map((r, i) => (r === 'accent' ? i : -1)).filter((i) => i >= 0);
      if (accentIdx.length >= 2) roles[accentIdx[accentIdx.length - 1]] = 'accent-strong';
    }
    let out = value;
    for (let i = tokens.length - 1; i >= 0; i--) {
      const role = roles[i];
      const tok = tokens[i];
      if (!role) continue;
      // A custom property must never point at itself (var(--theme-accent) inside --theme-accent).
      if (prop.trim().toLowerCase() === `--theme-${role}`) continue;
      const c = info(tok.color);
      let replacement: string;
      if (c.alpha < 0.99) {
        if (c.neutral) continue; // black/white overlays and shadows work with any theme
        replacement = `color-mix(in srgb, var(--theme-${role}, ${tok.text}) ${Math.round(c.alpha * 100)}%, transparent)`;
      } else {
        replacement = `var(--theme-${role}, ${tok.text})`;
      }
      out = out.slice(0, tok.start) + replacement + out.slice(tok.end);
      this.replacements++;
    }
    return out;
  }

  private rewriteFont(prop: string, value: string, selectors: string[]): string {
    const important = value.match(/\s*!important\s*$/i);
    const core = important ? value.slice(0, important.index) : value;
    const trimmed = core.trim();
    if (!trimmed || /var\(|inherit|initial|unset|revert/i.test(trimmed)) return value;
    const lead = core.match(/^\s*/)![0];
    const tail = core.match(/\s*$/)![0];
    if (prop === 'font-family') {
      if (!familiesAreGeneric(trimmed)) return value;
      this.replacements++;
      return `${lead}var(--theme-font-${fontRole(trimmed, selectors)}, ${trimmed})${tail}${important ? important[0] : ''}`;
    }
    const m = trimmed.match(FONT_SHORTHAND);
    if (!m || !familiesAreGeneric(m[2])) return value;
    this.replacements++;
    return `${lead}${m[1]}var(--theme-font-${fontRole(m[2], selectors)}, ${m[2]})${tail}${important ? important[0] : ''}`;
  }

  /**
   * An element that paints a band (dark bar, accent card, white panel) re-points the theme's text
   * colors for everything inside it, through normal CSS inheritance: gray text in a colored
   * pricing card or a heading in a dark footer stays readable whatever rule colors it.
   */
  private bandDeclarations(band: Band): string[] {
    const reset = [
      '--theme-ink: var(--theme-ink-base);',
      '--theme-ink-soft: var(--theme-ink-soft-base);',
      '--theme-accent-ink: var(--theme-accent-ink-base);',
    ];
    if (band === 'light' || (band === 'dark' && this.options.mode === 'dark')) return reset;
    if (band === 'dark') {
      return [
        '--theme-ink: var(--theme-on-inverse);',
        '--theme-ink-soft: var(--theme-on-inverse-soft);',
        '--theme-accent-ink: var(--theme-accent-soft);',
      ];
    }
    const on = band === 'accent2' ? 'on-accent-2' : 'on-accent';
    return [`--theme-ink: var(--theme-${on});`, `--theme-ink-soft: var(--theme-${on});`, `--theme-accent-ink: var(--theme-${on});`];
  }

  /** Rewrites one declaration list (a rule body or a style="" attribute). */
  private rewriteBody(selectors: string[], body: string, inheritedBand: Band = null): string {
    const band = this.bandFor(selectors, body) || inheritedBand;
    const flags: Flags = {
      hover: selectors.length > 0 && selectors.every((s) => HOVER_SELECTOR.test(s)),
      body: selectors.length > 0 && selectors.every(isBodySelector),
    };
    let next = this.rewriteDeclarations(selectors, body, band, flags);
    if (this.options.layout !== false && STICKY.test(body) && !HAS_Z_INDEX.test(body)) {
      next = appendDeclarations(next, ['z-index: 100;']);
      this.replacements++;
    }
    const own = this.options.colors && !flags.hover && !flags.body ? this.ownBand(body) : null;
    if (!own || /--theme-ink\s*:/.test(next)) return next;
    return appendDeclarations(next, this.bandDeclarations(own));
  }

  private rewriteDeclarations(selectors: string[], body: string, band: Band, flags: Flags): string {
    const decls = splitTop(body, ';');
    let changed = false;
    const rewritten = decls.map((decl) => {
      const colon = decl.indexOf(':');
      if (colon === -1) return decl;
      const prop = decl.slice(0, colon);
      const name = prop.trim().toLowerCase();
      const value = decl.slice(colon + 1);
      let next = value;
      if (this.options.fonts && (name === 'font-family' || name === 'font')) {
        next = this.rewriteFont(name, value, selectors);
      } else if (this.options.colors) {
        const ctx = contextOf(name);
        if (ctx) next = this.rewriteValue(name, value, ctx, band, flags);
      }
      if (next !== value) changed = true;
      return `${prop}:${next}`;
    });
    return changed ? rewritten.join(';') : body;
  }

  // ---------------- pass 2: rewrite ----------------

  rewriteCss(css: string): string {
    this.ensureBands();
    const blocks = declarationBlocks(css);
    let out = css;
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      if (/^@(?:font-face|page|counter-style|property)\b/i.test(b.prelude)) continue;
      const selectors = /^(?:from|to|\d+%)/i.test(b.prelude) ? [] : splitTop(b.prelude, ',').map((s) => s.trim()).filter(Boolean);
      const body = css.slice(b.bodyStart, b.bodyEnd);
      const next = this.rewriteBody(selectors, body);
      if (next !== body) out = out.slice(0, b.bodyStart) + next + out.slice(b.bodyEnd);
    }
    // Clicking "#iletisim" should not hide the section heading under the sticky bar.
    if (this.options.layout !== false && this.stickyTop && !this.scrollPaddingDone && out.trim()) {
      this.scrollPaddingDone = true;
      this.replacements++;
      const trailing = out.match(/\s*$/)![0];
      const indent = (out.match(/\n([ \t]*)\S[^\n]*\{/) || ['', ''])[1];
      out = `${out.slice(0, out.length - trailing.length)}\n${indent}html { scroll-padding-top: 5rem; }${trailing || '\n'}`;
    }
    return out;
  }

  /** Rewrites <style> blocks and style="" attributes (inline styles inherit ancestor bands). */
  rewriteHtml(html: string): string {
    this.ensureBands();
    const tokens = tokenizeHtml(html);
    const bandStack: Array<{ name: string; band: Band }> = [];
    let changed = false;
    walkHtml(tokens, (token, open) => {
      if (token.type === 'raw' && token.name === 'style') {
        const next = this.rewriteCss(token.value);
        if (next !== token.value) {
          token.value = next;
          changed = true;
        }
        return;
      }
      if (token.type !== 'tag' || !token.name) return;
      while (bandStack.length && !open.includes(bandStack[bandStack.length - 1].name)) bandStack.pop();
      if (token.closing) return;
      const inherited = bandStack.length ? bandStack[bandStack.length - 1].band : null;
      const style = styleAttribute(token.value);
      let band: Band = this.bandForElement(token.value, token.name) || inherited;
      if (style) {
        band = this.ownBand(style.value) || band;
        const next = this.rewriteBody([], style.value, band);
        if (next !== style.value) {
          token.value = token.value.slice(0, style.start) + next + token.value.slice(style.end);
          changed = true;
        }
      }
      if (band && band !== inherited && !token.selfClosing) bandStack.push({ name: token.name, band });
    });
    return changed ? joinTokens(tokens) : html;
  }

  /** Band of an element from the stylesheet rules that target its tag, id or classes. */
  private bandForElement(tag: string, name: string): Band {
    const keys = [name];
    const id = tag.match(/\sid\s*=\s*["']([^"']+)["']/i);
    if (id) keys.push(`#${id[1].toLowerCase()}`, `${name}#${id[1].toLowerCase()}`);
    const cls = tag.match(/\sclass\s*=\s*["']([^"']+)["']/i);
    if (cls) {
      for (const c of cls[1].toLowerCase().split(/\s+/).filter(Boolean)) keys.push(`.${c}`, `${name}.${c}`);
    }
    for (const key of keys.reverse()) {
      const band = this.bands.get(key);
      if (band) return band;
    }
    return null;
  }
}

/** Appends declarations to a rule body, matching its one-line or multi-line layout. */
function appendDeclarations(body: string, decls: string[]): string {
  const trailing = body.match(/\s*$/)![0];
  let core = body.slice(0, body.length - trailing.length);
  if (core.trim() && !core.trim().endsWith(';')) core += ';';
  if (/\n/.test(core)) {
    const indent = (core.match(/\n([ \t]*)\S/) || ['', '  '])[1];
    return `${core}\n${indent}${decls.join(`\n${indent}`)}${trailing}`;
  }
  return `${core}${core.trim() ? ' ' : ''}${decls.join(' ')}${trailing}`;
}

/** The value of a tag's style="" attribute and its position inside the tag. */
function styleAttribute(tag: string): { value: string; start: number; end: number } | null {
  const m = tag.match(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i);
  if (!m || m.index === undefined) return null;
  const quoteOffset = m[0].indexOf(m[1]);
  const start = m.index + quoteOffset + 1;
  const value = m[2] !== undefined ? m[2] : m[3];
  return { value, start, end: start + value.length };
}
