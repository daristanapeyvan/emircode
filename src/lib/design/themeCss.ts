/**
 * themeCss.ts — builds the theme stylesheet written to <project>/theme/theme.css.
 *
 * Layout: (1) Google Fonts import, (2) :root design tokens, (3) essentials (page colors,
 * typography, links, icons), (4) optional base components (buttons, forms, tables, cards...).
 * Every rule is wrapped in :where() — zero specificity — so the page's own CSS always wins;
 * the theme only fills in what the model left unstyled.
 */
import { ThemeDefinition, ThemeFont, ShadowStyle } from './themes';

export const THEME_DIR = 'theme';
export const THEME_FILE = 'theme/theme.css';
const MARKER = 'emir-theme';

export interface ThemeCssOptions {
  /** Include the component layer (buttons, forms, tables, cards, sections). */
  base: boolean;
  /** Load the theme fonts from Google Fonts (otherwise system fonts only). */
  webFonts: boolean;
  /** false = the user asked for their own fonts: the theme leaves font families alone. */
  fonts: boolean;
}

export interface ThemeMarker {
  id: string;
  mode: 'light' | 'dark';
  v: number;
}

export function isThemeAsset(path: string): boolean {
  return /^theme\/theme\.css$/i.test(path.replace(/\\/g, '/').replace(/^\.\//, ''));
}

export function readThemeMarker(css: string | null | undefined): ThemeMarker | null {
  const m = (css || '').match(new RegExp(`${MARKER}\\s+(\\{[^}]*\\})`));
  if (!m) return null;
  try {
    const data = JSON.parse(m[1]);
    if (typeof data.id !== 'string') return null;
    return { id: data.id, mode: data.mode === 'dark' ? 'dark' : 'light', v: Number(data.v) || 1 };
  } catch {
    return null;
  }
}

const quoteFamily = (family: string) => (/^[\w-]+$/.test(family) ? family : `"${family}"`);

function fontStack(font: ThemeFont): string {
  return font.family ? `${quoteFamily(font.family)}, ${font.fallback}` : font.fallback;
}

/** One css2 URL for all web fonts of the theme (families merged, weights sorted). */
export function googleFontsUrl(theme: ThemeDefinition): string | null {
  return googleFontsUrlFor([theme.fonts.heading, theme.fonts.body, theme.fonts.mono]);
}

/** One css2 URL for a list of fonts (families merged, weights sorted); null when none is a web font. */
export function googleFontsUrlFor(fonts: ThemeFont[]): string | null {
  const families = new Map<string, Set<number>>();
  for (const font of fonts) {
    if (!font.family) continue;
    const set = families.get(font.family) || new Set<number>();
    font.weights.forEach((w) => set.add(w));
    families.set(font.family, set);
  }
  if (families.size === 0) return null;
  const parts = Array.from(families.entries()).map(([family, weights]) => {
    const name = family.replace(/ /g, '+');
    const list = Array.from(weights).sort((a, b) => a - b);
    return list.length === 1 && list[0] === 400 ? `family=${name}` : `family=${name}:wght@${list.join(';')}`;
  });
  return `https://fonts.googleapis.com/css2?${parts.join('&')}&display=swap`;
}

const mix = (token: string, pct: number) => `color-mix(in srgb, var(--theme-${token}) ${pct}%, transparent)`;

function shadows(style: ShadowStyle): [string, string, string] {
  switch (style) {
    case 'soft':
      return [
        `0 1px 2px ${mix('ink', 6)}`,
        `0 1px 2px ${mix('ink', 5)}, 0 12px 32px -14px ${mix('ink', 24)}`,
        `0 32px 64px -24px ${mix('ink', 30)}`,
      ];
    case 'crisp':
      return [
        `0 1px 0 ${mix('ink', 8)}`,
        `0 1px 2px ${mix('ink', 10)}, 0 3px 8px ${mix('ink', 6)}`,
        `0 16px 40px -12px ${mix('ink', 22)}`,
      ];
    case 'hard':
      return ['2px 2px 0 var(--theme-ink)', '4px 4px 0 var(--theme-ink)', '8px 8px 0 var(--theme-ink)'];
    case 'hard-accent2':
      return ['3px 3px 0 var(--theme-accent-2)', '5px 5px 0 var(--theme-accent-2)', '9px 9px 0 var(--theme-accent-2)'];
    default:
      return ['none', 'none', 'none'];
  }
}

function patternLayer(theme: ThemeDefinition): { image: string; size: string } {
  switch (theme.style.pattern) {
    case 'grid': {
      const line = mix('border', 70);
      return {
        image: `linear-gradient(${line} 1px, transparent 1px), linear-gradient(90deg, ${line} 1px, transparent 1px)`,
        size: '40px 40px',
      };
    }
    case 'dots':
      return { image: `radial-gradient(${mix('ink', 14)} 1.2px, transparent 1.6px)`, size: '22px 22px' };
    case 'grain': {
      // Fine paper/film grain (black noise on light themes, white on dark ones).
      const c = theme.mode === 'dark' ? 1 : 0;
      const alpha = theme.mode === 'dark' ? 0.06 : 0.045;
      const svg =
        `<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'>` +
        `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/>` +
        `<feColorMatrix values='0 0 0 0 ${c} 0 0 0 0 ${c} 0 0 0 0 ${c} 0 0 0 ${alpha} 0'/></filter>` +
        `<rect width='100%' height='100%' filter='url(#n)'/></svg>`;
      return { image: `url("data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, '%27')}")`, size: '180px 180px' };
    }
    default:
      return { image: 'none', size: 'auto' };
  }
}

function buttonTokens(theme: ThemeDefinition): string[] {
  const font = `var(--theme-font-${theme.style.buttonFont})`;
  const base = [
    `--theme-button-font: ${font};`,
    `--theme-button-weight: ${theme.style.buttonFont === 'heading' ? theme.type.headingWeight : 600};`,
    '--theme-button-case: none;',
    '--theme-button-tracking: 0;',
    `--theme-button-size: ${theme.style.buttonFont === 'mono' ? '0.875rem' : '0.95rem'};`,
    '--theme-button-pad: 0.85em 1.5em;',
    '--theme-button-bg: var(--theme-accent);',
    '--theme-button-fg: var(--theme-on-accent);',
    '--theme-button-border: 1px solid transparent;',
    '--theme-button-shadow: none;',
    '--theme-button-bg-hover: var(--theme-accent-strong);',
    '--theme-button-fg-hover: var(--theme-on-accent);',
    '--theme-button-shadow-hover: none;',
    '--theme-button-lift: translateY(-1px);',
  ];
  const set = (name: string, value: string) => {
    const i = base.findIndex((l) => l.startsWith(`--theme-button-${name}:`));
    base[i] = `--theme-button-${name}: ${value};`;
  };
  switch (theme.style.button) {
    case 'solid-caps':
      set('case', 'uppercase');
      set('tracking', '0.14em');
      set('size', '0.78rem');
      set('pad', '1.15em 2.1em');
      break;
    case 'outline':
      set('case', 'uppercase');
      set('tracking', '0.18em');
      set('size', '0.76rem');
      set('pad', '1.2em 2.3em');
      set('bg', 'transparent');
      set('fg', 'var(--theme-accent-ink)');
      set('border', '1px solid var(--theme-accent)');
      set('bg-hover', 'var(--theme-accent)');
      set('fg-hover', 'var(--theme-on-accent)');
      set('lift', 'none');
      break;
    case 'hard': {
      const shadowColor = theme.style.shadow === 'hard-accent2' ? 'var(--theme-accent-2)' : 'var(--theme-ink)';
      set('border', '2px solid var(--theme-ink)');
      set('shadow', `3px 3px 0 ${shadowColor}`);
      set('bg-hover', 'var(--theme-accent)');
      set('shadow-hover', `5px 5px 0 ${shadowColor}`);
      set('lift', 'translate(-2px, -2px)');
      set('weight', '700');
      break;
    }
  }
  return base;
}

function tokens(theme: ThemeDefinition, options: ThemeCssOptions): string {
  const c = theme.colors;
  const [shadowSm, shadow, shadowLg] = shadows(theme.style.shadow);
  const pattern = patternLayer(theme);
  const inheritFonts = !options.fonts;
  const lines = [
    `color-scheme: ${theme.mode};`,
    '',
    '/* Renkler */',
    `--theme-bg: ${c.bg};`,
    `--theme-surface: ${c.surface};`,
    `--theme-surface-2: ${c.surface2};`,
    `--theme-border: ${c.border};`,
    `--theme-field-border: ${c.fieldBorder};`,
    `--theme-ink-base: ${c.ink};`,
    `--theme-ink-soft-base: ${c.inkSoft};`,
    `--theme-accent-ink-base: ${c.accentInk};`,
    '/* Metin renkleri bulundukları zemine göre değişir (koyu şerit, vurgu kartı...) */',
    '--theme-ink: var(--theme-ink-base);',
    '--theme-ink-soft: var(--theme-ink-soft-base);',
    '--theme-accent-ink: var(--theme-accent-ink-base);',
    `--theme-inverse: ${c.inverse};`,
    `--theme-on-inverse: ${c.onInverse};`,
    `--theme-on-inverse-soft: ${c.onInverseSoft};`,
    `--theme-accent: ${c.accent};`,
    `--theme-accent-strong: ${c.accentStrong};`,
    `--theme-accent-soft: ${c.accentSoft};`,
    `--theme-on-accent: ${c.onAccent};`,
    `--theme-accent-2: ${c.accent2};`,
    `--theme-on-accent-2: ${c.onAccent2};`,
    `--theme-focus-ring: ${mix('accent-ink-base', 35)};`,
    '',
    '/* Yazı tipleri */',
    `--theme-font-heading: ${inheritFonts ? 'inherit' : fontStack(theme.fonts.heading)};`,
    `--theme-font-body: ${inheritFonts ? 'inherit' : fontStack(theme.fonts.body)};`,
    `--theme-font-mono: ${fontStack(theme.fonts.mono)};`,
    `--theme-heading-weight: ${theme.type.headingWeight};`,
    `--theme-heading-tracking: ${theme.type.headingTracking};`,
    `--theme-heading-leading: ${theme.type.headingLeading};`,
    `--theme-heading-case: ${theme.type.headingCase};`,
    `--theme-h1: clamp(2.4rem, 1.5rem + 3.6vw, ${theme.type.h1Max}rem);`,
    `--theme-h2: clamp(1.75rem, 1.3rem + 2vw, ${Math.round(theme.type.h1Max * 0.62 * 100) / 100}rem);`,
    '--theme-h3: clamp(1.25rem, 1.1rem + 0.6vw, 1.6rem);',
    `--theme-body-size: ${theme.type.bodySize};`,
    `--theme-body-leading: ${theme.type.bodyLeading};`,
    '',
    '/* Biçim */',
    `--theme-radius: ${theme.shape.radius}px;`,
    `--theme-radius-lg: ${theme.shape.radiusLarge}px;`,
    `--theme-radius-button: ${theme.shape.buttonRadius}px;`,
    `--theme-line: ${theme.style.borderWidth === 2 ? 2 : 1}px;`,
    `--theme-card-border: ${theme.style.borderWidth}px ${theme.style.cardBorder} var(--theme-border);`,
    `--theme-shadow-sm: ${shadowSm};`,
    `--theme-shadow: ${shadow};`,
    `--theme-shadow-lg: ${shadowLg};`,
    `--theme-section-space: ${theme.style.density === 'airy' ? 'clamp(4.5rem, 9vw, 8rem)' : 'clamp(3.5rem, 7vw, 6rem)'};`,
    '--theme-container: 1160px;',
    `--theme-bg-pattern: ${pattern.image};`,
    `--theme-bg-pattern-size: ${pattern.size};`,
    '',
    '/* Simgeler */',
    `--theme-icon-stroke: ${theme.style.iconStroke};`,
    `--theme-icon-cap: ${theme.style.iconCap};`,
    `--theme-icon-join: ${theme.style.iconCap === 'square' ? 'miter' : 'round'};`,
    '',
    '/* Butonlar */',
    ...buttonTokens(theme),
  ];
  return `:root {\n${lines.map((l) => (l ? `  ${l}` : '')).join('\n')}\n}`;
}

const ESSENTIALS = `
/* ---- Temel: sayfa, tipografi, bağlantılar, simgeler ---- */
:where(*, *::before, *::after) { box-sizing: border-box; }
:where(html) { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
@media (prefers-reduced-motion: no-preference) {
  :where(html) { scroll-behavior: smooth; }
}
:where(body) {
  margin: 0;
  background-color: var(--theme-bg);
  background-image: var(--theme-bg-pattern);
  background-size: var(--theme-bg-pattern-size);
  color: var(--theme-ink);
  font-family: var(--theme-font-body);
  font-size: var(--theme-body-size);
  line-height: var(--theme-body-leading);
  font-kerning: normal;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
:where(h1, h2, h3, h4, h5, h6) {
  font-family: var(--theme-font-heading);
  font-weight: var(--theme-heading-weight);
  letter-spacing: var(--theme-heading-tracking);
  line-height: var(--theme-heading-leading);
  text-transform: var(--theme-heading-case);
  text-wrap: balance;
  margin: 0 0 0.5em;
}
:where(h1) { font-size: var(--theme-h1); }
:where(h2) { font-size: var(--theme-h2); }
:where(h3) { font-size: var(--theme-h3); }
:where(h4) { font-size: 1.2rem; }
:where(h5, h6) { font-size: 1rem; }
:where(.logo, .brand, .navbar-brand, .site-title, .site-name) {
  font-family: var(--theme-font-heading);
  font-weight: var(--theme-heading-weight);
  letter-spacing: var(--theme-heading-tracking);
}
:where(p) { margin: 0 0 1em; text-wrap: pretty; }
:where(a) {
  color: var(--theme-accent-ink);
  text-decoration-thickness: 1px;
  text-underline-offset: 0.22em;
  transition: color 0.15s ease, text-decoration-color 0.15s ease, opacity 0.15s ease;
}
:where(a:hover) { text-decoration-thickness: 2px; }
:where(img, video) { max-width: 100%; height: auto; }
:where(:focus-visible) { outline: 2px solid var(--theme-accent-ink); outline-offset: 3px; }
:where(hr) { border: 0; border-top: var(--theme-line) solid var(--theme-border); margin: 2.5rem 0; }
::selection { background-color: var(--theme-accent-soft); color: var(--theme-ink-base); }
:where(svg.ti) {
  width: 1.1em;
  height: 1.1em;
  vertical-align: -0.18em;
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-width: var(--theme-icon-stroke);
  stroke-linecap: var(--theme-icon-cap);
  stroke-linejoin: var(--theme-icon-join);
}
:where(svg.ti-solo) { width: 1em; height: 1em; vertical-align: middle; }
`;

/** Light panels inside dark or colored bands get the normal text colors back. */
const RESET_INK =
  '--theme-ink: var(--theme-ink-base); --theme-ink-soft: var(--theme-ink-soft-base); --theme-accent-ink: var(--theme-accent-ink-base); color: var(--theme-ink);';

const BASE = `
/* ---- Bileşenler: yalnızca sayfanın biçimlendirmediği yerleri doldurur ---- */
:where(.container, .wrapper) { width: min(100% - 2.5rem, var(--theme-container)); margin-inline: auto; }
:where(section) { padding-block: var(--theme-section-space); }
:where(header nav > ul, body > nav > ul, .navbar ul, .nav-links, nav .menu) {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 1.75rem;
}
:where(nav a) { color: inherit; text-decoration: none; font-weight: 500; }
:where(nav a:hover) { text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 0.4em; }
:where(footer) { padding-block: clamp(2.5rem, 5vw, 4rem); font-size: 0.95em; }
:where(footer a) { color: inherit; }

:where(button, input[type="submit"], input[type="button"], input[type="reset"], .btn, .button, .cta, .cta-button) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.55em;
  font-family: var(--theme-button-font);
  font-size: var(--theme-button-size);
  font-weight: var(--theme-button-weight);
  letter-spacing: var(--theme-button-tracking);
  text-transform: var(--theme-button-case);
  line-height: 1.2;
  padding: var(--theme-button-pad);
  border: var(--theme-button-border);
  border-radius: var(--theme-radius-button);
  background-color: var(--theme-button-bg);
  color: var(--theme-button-fg);
  box-shadow: var(--theme-button-shadow);
  text-decoration: none;
  cursor: pointer;
  transition: background-color 0.18s ease, color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease, border-color 0.18s ease;
}
:where(button, input[type="submit"], input[type="button"], input[type="reset"], .btn, .button, .cta, .cta-button):hover {
  background-color: var(--theme-button-bg-hover);
  color: var(--theme-button-fg-hover);
  box-shadow: var(--theme-button-shadow-hover);
  transform: var(--theme-button-lift);
}
:where(button, input[type="submit"], input[type="button"], input[type="reset"], .btn, .button, .cta, .cta-button):active { transform: translateY(1px); }
:where(button:disabled, input:disabled) { opacity: 0.5; cursor: not-allowed; transform: none; }

:where(input:not([type="checkbox"], [type="radio"], [type="range"], [type="submit"], [type="button"], [type="reset"], [type="color"], [type="file"], [type="image"], [type="hidden"]), select, textarea) {
  font: inherit;
  ${RESET_INK}
  background-color: var(--theme-surface);
  border: var(--theme-line) solid var(--theme-field-border);
  border-radius: var(--theme-radius);
  padding: 0.75em 1em;
  line-height: 1.4;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
:where(input, select, textarea):focus-visible {
  outline: none;
  border-color: var(--theme-accent-ink);
  box-shadow: 0 0 0 3px var(--theme-focus-ring);
}
:where(textarea) { min-height: 8rem; resize: vertical; }
::placeholder { color: var(--theme-ink-soft); opacity: 0.85; }
:where(label) { font-weight: 600; font-size: 0.925em; }
:where(input[type="checkbox"], input[type="radio"], input[type="range"], progress) { accent-color: var(--theme-accent); }
:where(fieldset) { border: var(--theme-line) solid var(--theme-border); border-radius: var(--theme-radius); padding: 1.25rem 1.5rem; }

:where(table) { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
:where(th, td) { padding: 0.75em 1em; text-align: left; vertical-align: top; border-bottom: var(--theme-line) solid var(--theme-border); }
:where(th) { font-weight: 600; background-color: var(--theme-surface-2); ${RESET_INK} }

:where(.card, .feature, .feature-card, .service, .service-card, .pricing-card, .plan, .testimonial, .team-member, .team-card, .product-card) {
  ${RESET_INK}
  background-color: var(--theme-surface);
  border: var(--theme-card-border);
  border-radius: var(--theme-radius-lg);
  padding: clamp(1.25rem, 3vw, 2rem);
  box-shadow: var(--theme-shadow);
}

:where(blockquote) {
  margin: 2rem 0;
  padding: 0.25rem 0 0.25rem 1.5rem;
  border-left: 3px solid var(--theme-accent);
  font-family: var(--theme-font-heading);
  font-size: 1.2em;
  line-height: 1.45;
}
:where(code, kbd, samp, pre) { font-family: var(--theme-font-mono); font-size: 0.9em; }
:where(:not(pre) > code) { background-color: var(--theme-surface-2); ${RESET_INK} padding: 0.15em 0.4em; border-radius: calc(var(--theme-radius) / 2 + 2px); }
:where(pre) { background-color: var(--theme-surface-2); ${RESET_INK} padding: 1.25rem 1.5rem; border-radius: var(--theme-radius); overflow-x: auto; line-height: 1.55; }
:where(mark) { background-color: var(--theme-accent-soft); color: var(--theme-ink-base); padding: 0 0.2em; border-radius: 3px; }
:where(figure) { margin: 2rem 0; }
:where(figcaption) { margin-top: 0.6rem; font-size: 0.875em; color: var(--theme-ink-soft); }
:where(details) { border: var(--theme-line) solid var(--theme-border); border-radius: var(--theme-radius); padding: 0.9rem 1.2rem; background-color: var(--theme-surface); ${RESET_INK} }
:where(details + details) { margin-top: 0.75rem; }
:where(summary) { cursor: pointer; font-weight: 600; }
:where(address) { font-style: normal; }
`;

const REDUCED_MOTION = `
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; }
}
`;

function linkStyle(theme: ThemeDefinition): string {
  return theme.style.link === 'plain'
    ? ':where(a) { text-decoration: none; }\n:where(a:hover) { text-decoration: underline; }\n'
    : ':where(a) { text-decoration: underline; }\n';
}

function headingRule(theme: ThemeDefinition): string {
  if (!theme.style.headingRule) return '';
  return ':where(section > h2:first-child, main > h2, article > h2) { border-top: 2px solid currentColor; padding-top: 0.55em; }\n';
}

/** The complete theme.css for a project. */
export function buildThemeCss(theme: ThemeDefinition, options: ThemeCssOptions): string {
  const fontsUrl = options.webFonts && options.fonts ? googleFontsUrl(theme) : null;
  const marker = JSON.stringify({ id: theme.id, mode: theme.mode, v: 1 });
  const header = `/*
 * Emir Code tasarım teması: "${theme.name}"
 * ${theme.mood}
 *
 * Renkleri ve yazı tiplerini aşağıdaki :root değişkenlerinden değiştirebilirsiniz; sayfanın kendi
 * CSS'i her zaman önceliklidir (buradaki kurallar :where() ile sıfır öncelik taşır).
 * ${MARKER} ${marker}
 */
`;
  return [
    header,
    fontsUrl ? `@import url("${fontsUrl}");\n` : '',
    tokens(theme, options),
    ESSENTIALS,
    linkStyle(theme),
    options.base ? BASE : '',
    options.base ? headingRule(theme) : '',
    REDUCED_MOTION,
  ]
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}
