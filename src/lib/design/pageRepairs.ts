/**
 * pageRepairs.ts — two faults small models leave in web pages, repaired at the end of a run without
 * the model:
 *  - buttons with no style of their own keep the browser's grey default when no theme's base layer
 *    covers them: they get a zero-specificity style in the page's own accent color;
 *  - the hamburger button of the mobile menu does not work: the script toggles a class on one element
 *    while the CSS expects it on another (qwen2.5-coder: `nav.classList.toggle('active')` with
 *    `.navbar.active a { display: block }`), no CSS reacts to the class, there is no script at all,
 *    or the menu stays open after a link is chosen.
 * Pages whose CSS or scripts are not all known (a linked local file this run did not write) are left
 * alone, and a page that already works is never touched.
 */
import { tokenizeHtml } from './html';
import { parseColor, toOklch, contrastRatio } from './color';

// ---------------------------------------------------------------------------
// A small DOM and selector matcher (tag, #id, .class, [attr=value]; descendant and child combinators)
// ---------------------------------------------------------------------------

export interface PageElement {
  tag: string;
  id: string;
  classes: string[];
  attrs: Record<string, string>;
  parent: PageElement | null;
  /** Direct text of the element (for "☰" buttons). */
  text: string;
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

function parseAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const body = tag.replace(/^<\s*[\w-]+/, '').replace(/\/?>$/, '');
  for (const m of body.matchAll(/([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g)) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return attrs;
}

export function buildDom(html: string): PageElement[] {
  const elements: PageElement[] = [];
  const stack: PageElement[] = [];
  for (const token of tokenizeHtml(html)) {
    if (token.type === 'tag' && token.name) {
      if (token.closing) {
        const at = stack.map((e) => e.tag).lastIndexOf(token.name);
        if (at >= 0) stack.length = at;
        continue;
      }
      const attrs = parseAttrs(token.value);
      const el: PageElement = {
        tag: token.name,
        id: attrs.id || '',
        classes: (attrs.class || '').split(/\s+/).filter(Boolean),
        attrs,
        parent: stack[stack.length - 1] || null,
        text: '',
      };
      elements.push(el);
      if (!token.selfClosing && !VOID.has(token.name)) stack.push(el);
    } else if (token.type === 'text' && stack.length) {
      stack[stack.length - 1].text += token.value;
    }
  }
  return elements;
}

interface Compound {
  tag?: string;
  id?: string;
  classes: string[];
  attrs: Array<[string, string | null]>;
}

/** One compound selector ("nav.main#top[type=submit]"); pseudo-classes and pseudo-elements are ignored. */
function parseCompound(text: string): Compound | null {
  const s = text.replace(/::?[\w-]+(\([^)]*\))?/g, '');
  if (!s) return { classes: [], attrs: [] };
  const c: Compound = { classes: [], attrs: [] };
  const re = /([#.]?)([\w-]+)|\[\s*([\w-]+)\s*(?:[~|^$*]?=\s*["']?([^"'\]]*)["']?)?\s*\]|(\*)/g;
  let consumed = 0;
  for (const m of s.matchAll(re)) {
    consumed += m[0].length;
    if (m[5]) continue;
    if (m[3]) c.attrs.push([m[3].toLowerCase(), m[4] ?? null]);
    else if (m[1] === '#') c.id = m[2];
    else if (m[1] === '.') c.classes.push(m[2]);
    else c.tag = m[2].toLowerCase();
  }
  return consumed === s.length ? c : null;
}

function matchesCompound(el: PageElement, c: Compound): boolean {
  if (c.tag && c.tag !== el.tag) return false;
  if (c.id && c.id !== el.id) return false;
  if (c.classes.some((k) => !el.classes.includes(k))) return false;
  return c.attrs.every(([name, value]) => name in el.attrs && (value === null || el.attrs[name].toLowerCase() === value.toLowerCase()));
}

/** "header nav > a" → compounds with the combinator before each; null when a part is not supported. */
function parseSelector(sel: string): Array<{ compound: Compound; combinator: ' ' | '>' }> | null {
  const parts = sel.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/);
  const result: Array<{ compound: Compound; combinator: ' ' | '>' }> = [];
  let combinator: ' ' | '>' = ' ';
  for (const part of parts) {
    if (part === '>') {
      combinator = '>';
      continue;
    }
    if (/^[+~]$/.test(part)) return null;
    const compound = parseCompound(part);
    if (!compound) return null;
    result.push({ compound, combinator });
    combinator = ' ';
  }
  return result.length ? result : null;
}

function matchesSelector(el: PageElement, parts: Array<{ compound: Compound; combinator: ' ' | '>' }>): boolean {
  const last = parts.length - 1;
  if (!matchesCompound(el, parts[last].compound)) return false;
  let node: PageElement | null = el;
  for (let i = last - 1; i >= 0; i--) {
    const direct = parts[i + 1].combinator === '>';
    node = node.parent;
    if (direct) {
      if (!node || !matchesCompound(node, parts[i].compound)) return false;
    } else {
      while (node && !matchesCompound(node, parts[i].compound)) node = node.parent;
      if (!node) return false;
    }
  }
  return true;
}

export function selectAll(dom: PageElement[], selector: string): PageElement[] {
  const result = new Set<PageElement>();
  for (const one of selector.split(',')) {
    const parts = parseSelector(one);
    if (!parts) continue;
    for (const el of dom) if (matchesSelector(el, parts)) result.add(el);
  }
  return Array.from(result);
}

// ---------------------------------------------------------------------------
// CSS rules with their media condition
// ---------------------------------------------------------------------------

export interface CssRule {
  selector: string;
  body: string;
  media: string | null;
}

export function parseCssRules(css: string, media: string | null = null): CssRule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: CssRule[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    const head = text.slice(i, open).trim();
    // the matching closing brace
    let depth = 1;
    let j = open + 1;
    for (; j < text.length && depth > 0; j++) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}') depth--;
    }
    const body = text.slice(open + 1, j - 1);
    if (/^@media/i.test(head)) rules.push(...parseCssRules(body, head.replace(/^@media\s*/i, '').trim()));
    else if (head && !head.startsWith('@')) rules.push({ selector: head.replace(/\s+/g, ' '), body: body.trim(), media });
    i = j;
  }
  return rules;
}

const declaration = (body: string, prop: string) => {
  const m = body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;!]+)`, 'i'));
  return m ? m[1].trim() : null;
};

// ---------------------------------------------------------------------------
// What a page brings along
// ---------------------------------------------------------------------------

export interface PageSources {
  /** Inline <style> plus the linked local style sheets. */
  css: string;
  /** Inline <script> plus the linked local scripts. */
  js: string;
  /** Every linked local style sheet and script is among the known files. */
  complete: boolean;
}

const isLocal = (href: string) => !!href && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href.trim()) && !href.startsWith('#');

function resolvePath(fromFile: string, ref: string): string {
  const base = fromFile.replace(/\\/g, '/').split('/').slice(0, -1);
  const parts = ref.split(/[?#]/)[0].startsWith('/') ? [] : [...base];
  for (const seg of ref.split(/[?#]/)[0].replace(/^\/+/, '').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

export function pageSources(pagePath: string, html: string, files: Map<string, string>): PageSources {
  const lower = new Map(Array.from(files.entries()).map(([p, c]) => [p.toLowerCase(), c]));
  let complete = true;
  const css: string[] = Array.from(html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)).map((m) => m[1]);
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = parseAttrs(m[0]);
    if (!/stylesheet/i.test(attrs.rel || '') || !isLocal(attrs.href || '')) continue;
    const sheet = lower.get(resolvePath(pagePath, attrs.href).toLowerCase());
    if (sheet === undefined) {
      // theme.css is written by the app itself and only uses zero-specificity rules
      if (!/(^|\/)theme\/theme\.css$/i.test(attrs.href)) complete = false;
    } else css.push(sheet);
  }
  const js: string[] = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = parseAttrs(`<script ${m[1]}>`);
    if (attrs.src) {
      if (!isLocal(attrs.src)) continue;
      const code = lower.get(resolvePath(pagePath, attrs.src).toLowerCase());
      if (code === undefined) complete = false;
      else js.push(code);
    } else js.push(m[2]);
  }
  // inline handlers (onclick="toggleMenu()") call functions of the scripts; keep them for the analysis
  for (const m of html.matchAll(/\son(?:click|touchstart)\s*=\s*"([^"]*)"/gi)) js.push(m[1]);
  return { css: css.join('\n'), js: js.join('\n'), complete };
}

function insertBeforeClosing(html: string, tag: 'head' | 'body', block: string): string {
  const at = html.search(new RegExp(`</${tag}\\s*>`, 'i'));
  if (at < 0) return tag === 'head' ? insertBeforeClosing(html, 'body', block) : `${html}\n${block}\n`;
  const lineStart = html.lastIndexOf('\n', at) + 1;
  const indent = /^\s*$/.test(html.slice(lineStart, at)) ? html.slice(lineStart, at) : '';
  return `${html.slice(0, at)}${block.replace(/\n/g, `\n${indent}  `).replace(/^/, '  ')}\n${indent}${html.slice(at)}`;
}

// ---------------------------------------------------------------------------
// Buttons without a style
// ---------------------------------------------------------------------------

const BUTTON_INPUT = /^(submit|button|reset)$/i;

/** Buttons that no rule of the page's CSS selects. */
export function bareButtons(dom: PageElement[], rules: CssRule[]): PageElement[] {
  const buttons = dom.filter((el) => el.tag === 'button' || (el.tag === 'input' && BUTTON_INPUT.test(el.attrs.type || '')));
  if (buttons.length === 0) return [];
  const lastCompounds: Compound[] = [];
  for (const rule of rules) {
    for (const one of rule.selector.split(',')) {
      const parts = parseSelector(one);
      if (parts) lastCompounds.push(parts[parts.length - 1].compound);
    }
  }
  return buttons.filter((b) => !lastCompounds.some((c) => (c.tag || c.id || c.classes.length || c.attrs.length) && matchesCompound(b, c)));
}

/** The page's own accent: its first clearly colored background, else a dark band color, else a calm blue. */
export function pageAccent(rules: CssRule[]): string {
  const backgrounds: string[] = [];
  const texts: string[] = [];
  for (const r of rules) {
    const bg = declaration(r.body, 'background-color') || declaration(r.body, 'background');
    if (bg) backgrounds.push(...(bg.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi) || []));
    const color = declaration(r.body, 'color');
    if (color) texts.push(color);
  }
  const parsed = (list: string[]) => list.map((v) => ({ v, c: parseColor(v) })).filter((x): x is { v: string; c: NonNullable<ReturnType<typeof parseColor>> } => !!x.c && x.c.a > 0.9);
  const colored = [...parsed(backgrounds), ...parsed(texts)].find((x) => {
    const o = toOklch(x.c);
    return o.C >= 0.08 && o.L >= 0.35 && o.L <= 0.75;
  });
  if (colored) return colored.v;
  const dark = parsed(backgrounds).find((x) => toOklch(x.c).L < 0.4);
  return dark ? dark.v : '#2563eb';
}

export function styleBareButtons(html: string, sources: PageSources): { html: string; count: number } {
  if (!sources.complete || /data-emir-code="buttons"/.test(html)) return { html, count: 0 };
  const dom = buildDom(html);
  const rules = parseCssRules(sources.css);
  const bare = bareButtons(dom, rules);
  if (bare.length === 0) return { html, count: 0 };
  const selectors = Array.from(
    new Set(
      bare.map((b) => {
        const base = b.tag === 'input' ? `input[type="${(b.attrs.type || 'submit').toLowerCase()}"]` : 'button';
        return b.classes.length ? `${base}.${b.classes[0]}` : `${base}:not([class])`;
      })
    )
  ).join(', ');
  const accent = pageAccent(rules);
  const onAccent = contrastRatio(accent, '#ffffff') >= 4.5 ? '#ffffff' : '#111111';
  const block = [
    '<style data-emir-code="buttons">',
    '  /* Emir Code: these buttons had no style of their own; the page\'s own rules still win */',
    `  :where(${selectors}) { font: inherit; font-weight: 600; padding: 0.65em 1.4em; border: 0; border-radius: 8px; background: ${accent}; color: ${onAccent}; cursor: pointer; transition: filter 0.15s ease, transform 0.15s ease; }`,
    `  :where(${selectors}):hover { filter: brightness(1.1); }`,
    `  :where(${selectors}):active { transform: translateY(1px); }`,
    `  :where(${selectors}):focus-visible { outline: 2px solid ${accent}; outline-offset: 2px; }`,
    '</style>',
  ].join('\n');
  return { html: insertBeforeClosing(html, 'head', block), count: bare.length };
}

// ---------------------------------------------------------------------------
// The mobile menu
// ---------------------------------------------------------------------------

const HAMBURGER_RE = /hamburger|burger|menu-?toggle|nav-?toggle|toggle-?menu|toggle-?nav|menu-?btn|menu-?button|menu-?icon|mobile-?menu-?(?:btn|button|toggle|icon)|navbar-?toggler/i;
const NAV_RE = /nav|menu|links|header/i;

export function isHamburger(el: PageElement): boolean {
  if (HAMBURGER_RE.test(`${el.id} ${el.classes.join(' ')}`)) return true;
  if (/^(button|div|span|a|label|i)$/.test(el.tag) && /^[\s☰≡]*[☰≡][\s☰≡]*$|^\s*&#(?:9776|x2630);\s*$/.test(el.text)) return true;
  return el.tag === 'button' && /^(menu|menü|open menu|menüyü aç|toggle navigation)$/i.test((el.attrs['aria-label'] || '').trim());
}

const inNav = (el: PageElement) => {
  for (let n: PageElement | null = el; n; n = n.parent) {
    if (n.tag === 'nav' || n.tag === 'header' || NAV_RE.test(`${n.id} ${n.classes.join(' ')}`)) return true;
  }
  return false;
};

/** A selector that finds this element: #id, tag.class (when unique) or the tag inside nav. */
function selectorFor(el: PageElement, dom: PageElement[]): string | null {
  if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) return `#${el.id}`;
  for (const c of el.classes) {
    if (!/^[A-Za-z_-][\w-]*$/.test(c)) continue;
    const sel = `${el.tag}.${c}`;
    if (selectAll(dom, sel).length === 1) return sel;
  }
  if (selectAll(dom, el.tag).length === 1) return el.tag;
  return null;
}

export interface MenuToggle {
  /** Selector of the element whose class is toggled. */
  target: string;
  className: string;
}

/** Class toggles in the page's scripts, with the element each one targets. */
export function findToggles(js: string, dom: PageElement[]): MenuToggle[] {
  const vars = new Map<string, string>();
  const lookup = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*document\s*\.\s*(querySelector|getElementById|getElementsByClassName)\s*\(\s*(['"`])([^'"`]+)\3\s*\)(\s*\[\s*0\s*\])?/g;
  for (const m of js.matchAll(lookup)) {
    const sel = m[2] === 'getElementById' ? `#${m[4]}` : m[2] === 'getElementsByClassName' ? `.${m[4].trim().split(/\s+/).join('.')}` : m[4];
    vars.set(m[1], sel);
  }
  const toggles: MenuToggle[] = [];
  // 1: the element expression, 3: its selector when looked up inline, 5: the class
  const toggleRe = /([A-Za-z_$][\w$.]*|document\s*\.\s*(?:querySelector|getElementById)\s*\(\s*(['"`])([^'"`]+)\2\s*\))\s*\.\s*classList\s*\.\s*toggle\s*\(\s*(['"`])([\w-]+)\4/g;
  for (const m of js.matchAll(toggleRe)) {
    const subject = m[1];
    const className = m[5];
    let target: string | null = null;
    const direct = subject.match(/document\s*\.\s*(querySelector|getElementById)/);
    if (direct) target = direct[1] === 'getElementById' ? `#${m[3]}` : m[3];
    else if (vars.has(subject)) target = vars.get(subject)!;
    else if (/^(this|e\.currentTarget|event\.currentTarget)$/.test(subject)) {
      // the element the click listener sits on: the last lookup before this toggle
      const before = js.slice(0, m.index);
      const listener = Array.from(before.matchAll(/([A-Za-z_$][\w$]*|document\s*\.\s*(?:querySelector|getElementById)\s*\(\s*(['"`])([^'"`]+)\2\s*\))\s*\.\s*addEventListener\s*\(\s*['"]click['"]/g)).pop();
      if (listener) {
        const d = listener[1].match(/getElementById/);
        target = listener[3] ? (d ? `#${listener[3]}` : listener[3]) : vars.get(listener[1]) || null;
      }
    }
    if (target && /^[\w-]+$/.test(className) && selectAll(dom, target).length > 0) toggles.push({ target, className });
  }
  return toggles;
}

/** A rule body that hides its element: display none, off-screen, collapsed or invisible. */
function hidingDeclarations(body: string): boolean {
  const is = (prop: string, re: RegExp) => re.test(declaration(body, prop) || '');
  return (
    is('display', /^none$/i) ||
    is('visibility', /^hidden$/i) ||
    (is('opacity', /^0(\.0+)?$/) && is('pointer-events', /^none$/i)) ||
    is('transform', /translate[XY]?\(\s*-?\d{2,3}%/i) ||
    is('max-height', /^0(px)?$/i) ||
    is('height', /^0(px)?$/i) ||
    is('left', /^-\d/) ||
    is('right', /^-\d/) ||
    is('top', /^-\d/)
  );
}

/** Declarations that undo what hid the element (display comes back as on large screens, else block). */
function revealDeclarations(body: string, desktopDisplay: string | null): string {
  const out: string[] = [];
  if (/^none$/i.test(declaration(body, 'display') || '')) out.push(`display: ${desktopDisplay && !/^none$/i.test(desktopDisplay) ? desktopDisplay : 'block'};`);
  if (declaration(body, 'visibility')) out.push('visibility: visible;');
  if (declaration(body, 'opacity')) out.push('opacity: 1; pointer-events: auto;');
  if (declaration(body, 'transform')) out.push('transform: none;');
  if (declaration(body, 'max-height')) out.push('max-height: 100vh;');
  if (/^0(px)?$/i.test(declaration(body, 'height') || '')) out.push('height: auto;');
  for (const side of ['left', 'right', 'top']) if (/^-\d/.test(declaration(body, side) || '')) out.push(`${side}: 0;`);
  return out.join(' ');
}

/** The selector with `.className` removed from the compound that carries it ("" when nothing is left). */
function withoutClass(selector: string, className: string): string {
  const re = new RegExp(`\\.${className.replace(/[-]/g, '\\-')}(?![\\w-])`, 'g');
  return selector
    .replace(re, '')
    .replace(/(^|\s|>)\s*(?=\s|>|$)/g, '$1')
    .replace(/\s*>\s*(?=$)/, '')
    .replace(/^\s*>\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface MenuRepair {
  html: string;
  /** What was repaired: "open" (the button now opens the menu), "script" (a toggle was added), "close". */
  repaired: Array<'open' | 'script' | 'close'>;
}

export function repairMobileMenu(html: string, sources: PageSources): MenuRepair {
  const none = { html, repaired: [] as MenuRepair['repaired'] };
  if (!sources.complete || /data-emir-code="menu"/.test(html)) return none;
  const dom = buildDom(html);
  const hamburger = dom.find(isHamburger);
  if (!hamburger) return none;
  const rules = parseCssRules(sources.css);
  const isMobile = (media: string | null) => !!media && /max-width/i.test(media);
  // what the phone layout hides: navigation elements other than the button itself
  const hidden = rules.filter((r) => {
    if (!isMobile(r.media) || !hidingDeclarations(r.body)) return false;
    const els = selectAll(dom, r.selector.replace(/::?[\w-]+(\([^)]*\))?/g, ''));
    return els.length > 0 && els.every((el) => el !== hamburger && inNav(el) && !isHamburger(el));
  });
  if (hidden.length === 0) return none;

  const toggles = findToggles(sources.js, dom);
  const hiddenEls = new Set(hidden.flatMap((r) => selectAll(dom, r.selector)));
  const related = (t: MenuToggle) => selectAll(dom, t.target).some((el) => el !== hamburger && !isHamburger(el) && inNav(el));
  const menuToggles = toggles.filter(related);

  // Does the page's own CSS open the menu when its script toggles the class?
  const works = (t: MenuToggle) => {
    const targets = selectAll(dom, t.target);
    return rules.some((r) =>
      r.selector.split(',').some((one) => {
        const m = one.match(new RegExp(`([^\\s>+~]*)\\.${t.className}(?![\\w-])([^\\s>+~]*)`));
        if (!m) return false;
        const carrier = parseCompound(`${m[1]}${m[2]}`);
        return !!carrier && targets.some((el) => matchesCompound(el, carrier));
      })
    );
  };

  const cssBlocks: Array<{ media: string | null; rule: string }> = [];
  const repaired: MenuRepair['repaired'] = [];
  let script = '';
  let menuTarget: string | null = null;
  let menuClass: string | null = null;

  const openRulesFor = (target: string, className: string) => {
    const owner = `:root:has(${target}.${className})`;
    const hasClass = new RegExp(`\\.${className}(?![\\w-])`);
    const covered = new Set<PageElement>();
    // the page's own open-state rules, attached to the element the script really toggles
    for (const r of rules.filter((x) => x.selector.split(',').some((one) => hasClass.test(one)))) {
      const bare = r.selector
        .split(',')
        .filter((one) => hasClass.test(one))
        .map((one) => withoutClass(one, className))
        .filter(Boolean);
      if (bare.length === 0) continue;
      for (const b of bare) selectAll(dom, b).forEach((el) => covered.add(el));
      cssBlocks.push({ media: r.media, rule: `${bare.map((b) => `${owner} ${b}`).join(', ')} { ${r.body} }` });
    }
    // whatever the phone layout hides and no open-state rule shows again
    for (const r of hidden) {
      if (selectAll(dom, r.selector).every((el) => covered.has(el))) continue;
      const desktop = rules.find((x) => !x.media && x.selector === r.selector && declaration(x.body, 'display'));
      cssBlocks.push({
        media: r.media,
        rule: `${r.selector.split(',').map((one) => `${owner} ${one.trim()}`).join(', ')} { ${revealDeclarations(r.body, desktop ? declaration(desktop.body, 'display') : null)} }`,
      });
    }
  };

  if (menuToggles.length === 0 && toggles.length === 0) {
    // No script opens the menu: toggle a class on the menu's container.
    const first = Array.from(hiddenEls)[0];
    let container: PageElement | null = first;
    for (let n: PageElement | null = first; n; n = n.parent) {
      if (n.tag === 'nav' || /nav|menu/i.test(`${n.id} ${n.classes.join(' ')}`)) {
        container = n;
        break;
      }
    }
    const menuSel = container ? selectorFor(container, dom) : null;
    const buttonSel = selectorFor(hamburger, dom);
    if (!menuSel || !buttonSel) return none;
    menuTarget = menuSel;
    menuClass = 'emir-menu-open';
    openRulesFor(menuSel, menuClass);
    script += [
      '// Emir Code: the menu button opens and closes the menu on phones',
      '(function () {',
      `  var button = document.querySelector('${buttonSel}');`,
      `  var menu = document.querySelector('${menuSel}');`,
      '  if (!button || !menu) return;',
      "  button.setAttribute('aria-expanded', 'false');",
      "  button.addEventListener('click', function () {",
      "    var open = menu.classList.toggle('emir-menu-open');",
      "    button.setAttribute('aria-expanded', open ? 'true' : 'false');",
      '  });',
      '})();',
    ].join('\n');
    repaired.push('script');
  } else {
    const chosen = menuToggles[0] || toggles[0];
    menuTarget = chosen.target;
    menuClass = chosen.className;
    // Only the menu's own toggles count: a working icon animation (".hamburger.active span") does not open the menu.
    const relevant = menuToggles.length ? menuToggles : toggles;
    const siblingOpen = (t: MenuToggle) => rules.some((r) => new RegExp(`\\.${t.className}(?![\\w-])[^,]*[+~]`).test(r.selector));
    if (!relevant.some((t) => works(t) || siblingOpen(t))) {
      openRulesFor(chosen.target, chosen.className);
      repaired.push('open');
    }
  }

  // A menu that stays open after a link is chosen covers the section the visitor wanted.
  const closes = (menuToggles.length ? menuToggles : toggles).some((t) => new RegExp(`classList\\s*\\.\\s*remove\\s*\\(\\s*['"\`]${t.className}['"\`]`).test(sources.js));
  if (menuTarget && menuClass && !closes) {
    const all = (menuToggles.length ? menuToggles : toggles.length ? toggles : [{ target: menuTarget, className: menuClass }]).filter(
      (t, i, list) => list.findIndex((x) => x.target === t.target && x.className === t.className) === i
    );
    script += `${script ? '\n' : ''}${[
      '// Emir Code: the menu closes when a link is chosen',
      "document.querySelectorAll('nav a[href], " + menuTarget + " a[href]').forEach(function (link) {",
      "  link.addEventListener('click', function () {",
      ...all.map((t) => `    document.querySelectorAll('${t.target}').forEach(function (el) { el.classList.remove('${t.className}'); });`),
      '  });',
      '});',
    ].join('\n')}`;
    repaired.push('close');
  }

  if (repaired.length === 0) return none;
  let out = html;
  if (cssBlocks.length) {
    const byMedia = new Map<string, string[]>();
    for (const b of cssBlocks) byMedia.set(b.media || '', [...(byMedia.get(b.media || '') || []), b.rule]);
    const css = Array.from(byMedia.entries())
      .map(([media, list]) => (media ? `@media ${media} {\n${list.map((l) => `  ${l}`).join('\n')}\n}` : list.join('\n')))
      .join('\n');
    out = insertBeforeClosing(out, 'head', `<style data-emir-code="menu">\n/* Emir Code: the mobile menu opens with its button */\n${css}\n</style>`);
  }
  if (script) out = insertBeforeClosing(out, 'body', `<script data-emir-code="menu">\n${script}\n</script>`);
  return { html: out, repaired };
}
