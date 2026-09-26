/**
 * html.ts — a small, loss-free HTML tokenizer plus the page fixes that do not need the model:
 * theme link / viewport injection, stale copyright years and emoji -> SVG icons.
 * Joining the tokens of a page gives back exactly the original text, so pages without
 * anything to fix are never touched.
 */
import { EMOJI_TO_ICON, ICON_PATHS } from './icons';

export interface HtmlToken {
  type: 'text' | 'tag' | 'comment' | 'doctype' | 'raw';
  value: string;
  /** Lower-case element name for tags and raw content. */
  name?: string;
  closing?: boolean;
  selfClosing?: boolean;
}

const RAW_ELEMENTS = new Set(['script', 'style', 'textarea', 'title', 'xmp']);
export const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** End of a tag that starts at `start` ("<"), respecting quoted attribute values. */
function tagEnd(html: string, start: number): number {
  let quote: string | null = null;
  for (let i = start + 1; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i;
    }
  }
  return -1;
}

export function tokenizeHtml(html: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  let i = 0;
  let textStart = 0;
  const flushText = (end: number) => {
    if (end > textStart) tokens.push({ type: 'text', value: html.slice(textStart, end) });
  };
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      const stop = end === -1 ? html.length : end + 3;
      flushText(lt);
      tokens.push({ type: 'comment', value: html.slice(lt, stop) });
      i = textStart = stop;
      continue;
    }
    const next = html[lt + 1] || '';
    if (next === '!' || next === '?') {
      const end = tagEnd(html, lt);
      const stop = end === -1 ? html.length : end + 1;
      flushText(lt);
      tokens.push({ type: 'doctype', value: html.slice(lt, stop) });
      i = textStart = stop;
      continue;
    }
    const closing = next === '/';
    const nameMatch = html.slice(lt + (closing ? 2 : 1)).match(/^[a-zA-Z][\w:-]*/);
    if (!nameMatch) {
      i = lt + 1;
      continue;
    }
    const end = tagEnd(html, lt);
    if (end === -1) break;
    const name = nameMatch[0].toLowerCase();
    const value = html.slice(lt, end + 1);
    flushText(lt);
    tokens.push({ type: 'tag', value, name, closing, selfClosing: /\/\s*>$/.test(value) });
    i = textStart = end + 1;
    if (!closing && RAW_ELEMENTS.has(name)) {
      const closeRe = new RegExp(`</${name}\\s*>`, 'i');
      const rest = html.slice(i);
      const m = closeRe.exec(rest);
      const contentEnd = m ? i + m.index : html.length;
      if (contentEnd > i) tokens.push({ type: 'raw', value: html.slice(i, contentEnd), name });
      i = textStart = contentEnd;
      if (m) {
        tokens.push({ type: 'tag', value: m[0], name, closing: true });
        i = textStart = contentEnd + m[0].length;
      }
    }
  }
  flushText(html.length);
  return tokens;
}

export const joinTokens = (tokens: HtmlToken[]) => tokens.map((t) => t.value).join('');

/** Walks the tokens keeping the stack of open elements; `visit` may replace a token's value. */
export function walkHtml(tokens: HtmlToken[], visit: (token: HtmlToken, open: string[]) => void): void {
  const open: string[] = [];
  for (const token of tokens) {
    if (token.type === 'tag' && token.name) {
      if (token.closing) {
        const idx = open.lastIndexOf(token.name);
        if (idx !== -1) open.length = idx;
      }
      visit(token, open);
      if (!token.closing && !token.selfClosing && !VOID_ELEMENTS.has(token.name)) open.push(token.name);
      continue;
    }
    visit(token, open);
  }
}

// ---------------------------------------------------------------------------
// <head> fixes
// ---------------------------------------------------------------------------

/** Relative URL from an HTML file to a project-root path ("pages/a.html" -> "../theme/theme.css"). */
export function relativeHref(fromFile: string, target: string): string {
  const depth = fromFile.replace(/\\/g, '/').replace(/^\.\//, '').split('/').length - 1;
  return `${'../'.repeat(depth)}${target}`;
}

function headRange(html: string): { open: number; openEnd: number; close: number } | null {
  const open = html.search(/<head(?:\s[^>]*)?>/i);
  if (open === -1) return null;
  const openEnd = html.indexOf('>', open) + 1;
  const close = html.slice(openEnd).search(/<\/head\s*>/i);
  if (close === -1) return null;
  return { open, openEnd, close: openEnd + close };
}

function lineIndent(html: string, index: number): string {
  const lineStart = html.lastIndexOf('\n', index - 1) + 1;
  const m = html.slice(lineStart, index).match(/^[ \t]*/);
  return m ? m[0] : '';
}

/**
 * Links the theme stylesheet before the page's own styles, so that the page always wins.
 * No-op when the page already links it or has no <head>.
 */
export function injectThemeLink(html: string, href: string): string {
  const head = headRange(html);
  if (!head) return html;
  const headHtml = html.slice(head.openEnd, head.close);
  if (/<link\b[^>]*href\s*=\s*["'][^"']*theme\/theme\.css["']/i.test(headHtml)) return html;
  const firstStyle = headHtml.search(/<link\b[^>]*rel\s*=\s*["']?stylesheet|<style\b/i);
  const at = firstStyle === -1 ? head.close : head.openEnd + firstStyle;
  const indent = firstStyle === -1 ? lineIndent(html, head.close) + '  ' : lineIndent(html, at);
  const tag = `<link rel="stylesheet" href="${href}">`;
  if (firstStyle === -1) {
    const before = html.slice(0, at).replace(/[ \t]*$/, '');
    return `${before}${before.endsWith('\n') ? '' : '\n'}${indent}${tag}\n${lineIndent(html, head.close)}${html.slice(at).replace(/^[ \t]*/, '')}`;
  }
  return `${html.slice(0, at)}${tag}\n${indent}${html.slice(at)}`;
}

/** Adds <meta name="viewport"> when missing (pages without it are not responsive on phones). */
export function ensureViewport(html: string): string {
  const head = headRange(html);
  if (!head) return html;
  const headHtml = html.slice(head.openEnd, head.close);
  if (/<meta\b[^>]*name\s*=\s*["']?viewport/i.test(headHtml)) return html;
  const charset = headHtml.match(/<meta\b[^>]*charset[^>]*>/i);
  const at = charset ? head.openEnd + (charset.index || 0) + charset[0].length : head.openEnd;
  const indent = charset ? lineIndent(html, head.openEnd + (charset.index || 0)) : lineIndent(html, head.open) + '  ';
  return `${html.slice(0, at)}\n${indent}<meta name="viewport" content="width=device-width, initial-scale=1">${html.slice(at)}`;
}

// ---------------------------------------------------------------------------
// Text fixes
// ---------------------------------------------------------------------------

const TEXT_SKIP = new Set(['head', 'option', 'select', 'pre', 'code', 'svg', 'math', 'kbd', 'samp', 'template', 'noscript']);

function mapText(html: string, fn: (text: string, open: string[]) => string): string {
  const tokens = tokenizeHtml(html);
  let changed = false;
  walkHtml(tokens, (token, open) => {
    if (token.type !== 'text' || open.some((n) => TEXT_SKIP.has(n))) return;
    const next = fn(token.value, open);
    if (next !== token.value) {
      token.value = next;
      changed = true;
    }
  });
  return changed ? joinTokens(tokens) : html;
}

const COPYRIGHT_CONTEXT = /©|&copy;|&#169;|&#xa9;|\(c\)|copyright|telif|tüm hakları|all rights reserved/i;

/**
 * Models write the year of their training data into footers ("© 2023"). Updates copyright
 * years (single years and the end of ranges) to the current year; other numbers stay.
 */
export function fixCopyrightYears(html: string, year = new Date().getFullYear()): string {
  return mapText(html, (text) => {
    if (!COPYRIGHT_CONTEXT.test(text)) return text;
    const stale = (y: string) => {
      const n = parseInt(y, 10);
      return n >= 1990 && n < year;
    };
    // "2019 - 2023" -> "2019 - <year>"
    let out = text.replace(/\b((?:19|20)\d{2})(\s*[-–—]\s*)((?:19|20)\d{2})\b/g, (m, from, sep, to) =>
      stale(to) && parseInt(from, 10) < year ? `${from}${sep}${year}` : m
    );
    // a lone year right after/before the copyright sign or wording
    out = out.replace(
      /((?:©|&copy;|&#169;|&#xa9;|\(c\)|copyright|telif(?:\s+hakkı)?)\s*)((?:19|20)\d{2})\b(?!\s*[-–—]\s*\d)/gi,
      (m, lead, y) => (stale(y) ? `${lead}${year}` : m)
    );
    out = out.replace(/(?<![\d–—-]\s*)\b((?:19|20)\d{2})(\s*(?:©|&copy;|&#169;))/gi, (m, y, tail) =>
      stale(y) ? `${year}${tail}` : m
    );
    // "2023 Kahve Durağı. Tüm hakları saklıdır." (no sign, one year in the sentence)
    if (/tüm hakları|all rights reserved/i.test(out) && !/©|&copy;|&#169;|copyright|telif/i.test(out)) {
      const years = out.match(/\b(?:19|20)\d{2}\b/g) || [];
      if (years.length === 1 && stale(years[0])) out = out.replace(/\b(?:19|20)\d{2}\b/, String(year));
    }
    return out;
  });
}

const EMOJI_RE =
  /(?:\p{Extended_Pictographic}|✓)[︎️]?[\u{1F3FB}-\u{1F3FF}]?(?:‍\p{Extended_Pictographic}[︎️]?[\u{1F3FB}-\u{1F3FF}]?)*/gu;

export function iconSvg(name: string, solo: boolean): string {
  const inner = ICON_PATHS[name];
  if (!inner) return '';
  return `<svg class="ti${solo ? ' ti-solo' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;
}

const normalizeEmoji = (e: string) => e.replace(/[︎️]|[\u{1F3FB}-\u{1F3FF}]/gu, '');

/**
 * Replaces the emoji that stand in for icons ("☕ Kahve", a lone "🚀" in a feature card) with
 * line icons that follow the theme (stroke width, caps, color). Emoji without a known icon,
 * repeated emoji (⭐⭐⭐⭐⭐ ratings) and emoji inside form options, code or <head> stay as they are.
 */
export function replaceEmojiIcons(html: string): { html: string; replaced: number } {
  let replaced = 0;
  const out = mapText(html, (text) => {
    const trimmed = text.trim();
    return text.replace(EMOJI_RE, (match, offset: number, whole: string) => {
      const name = EMOJI_TO_ICON[normalizeEmoji(match)];
      if (!name) return match;
      const before = whole.slice(0, offset);
      const after = whole.slice(offset + match.length);
      // a run of the same emoji is a rating or decoration, not an icon
      if (before.endsWith(match) || after.startsWith(match)) return match;
      const solo = trimmed === match || normalizeEmoji(trimmed) === normalizeEmoji(match);
      replaced++;
      return iconSvg(name, solo);
    });
  });
  return { html: out, replaced };
}
