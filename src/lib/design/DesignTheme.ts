/**
 * DesignTheme.ts — connects the design themes to agent runs.
 *
 * plan (before the agent's first step): is this a new web page, which theme, does the model
 *   need to name the topic? Existing sites, framework projects, single-file requests and
 *   requests with their own colors are left alone.
 * apply (after the agent finished): writes theme/theme.css, rewrites the colors and fonts of the
 *   files written in this run to theme roles, links the stylesheet and swaps icon emoji for SVG
 *   icons. Stale copyright years and a missing viewport tag are fixed on every run's pages.
 *
 * The agent never sees any of this while it works: its files change only after it finished, so
 * its view of the files stays consistent during the run.
 */
import { DesignThemeConfig, DEFAULT_SETTINGS } from '@/types/settings';
import { WEB_PATTERN, NO_STYLE_PATTERN, SINGLE_FILE_PATTERN } from '../agent/TaskContract';
import { DesignCategory, ThemeDefinition, THEMES, NEUTRAL_THEME, getTheme, pickTheme } from './themes';
import { buildThemeCss, readThemeMarker, isThemeAsset, THEME_FILE } from './themeCss';
import { ThemeRewriter } from './cssRewrite';
import { injectThemeLink, ensureViewport, fixCopyrightYears, replaceEmojiIcons, relativeHref } from './html';
import { pageSources, repairMobileMenu, styleBareButtons } from './pageRepairs';
import { categorizeByKeywords } from './categorize';

export type CategorySource = 'keywords' | 'model' | 'fixed' | 'random' | 'default' | 'existing' | 'wizard';

/**
 * A theme decision made by the user for one run (the site wizard): it replaces the settings and
 * the request heuristics for that run.
 */
export interface DesignOverride {
  /** false = no theme for this run ("Tema kullanma"). */
  enabled: boolean;
  /** A specific theme; otherwise one is picked from `category`. */
  themeId?: string | null;
  category?: DesignCategory | null;
  mode?: 'light' | 'dark' | null;
}

export interface DesignPlan {
  kind: 'new' | 'continue';
  /** Palette + fonts: rewrite the page's colors and fonts to the theme roles. */
  theme: boolean;
  /** Component layer (buttons, forms, tables, cards) in theme.css. */
  base: boolean;
  webFonts: boolean;
  /** false when the user named their own fonts. */
  fonts: boolean;
  /** Replace icon emoji with SVG icons. */
  icons: boolean;
  /** Light or dark, when the request asked for one ("koyu tema"). */
  modePreference: 'light' | 'dark' | null;
  /** The request is about a web page (its topic can pick the theme). */
  web: boolean;
  category: DesignCategory | null;
  categorySource: CategorySource | null;
  themeId: string | null;
  /** Mode of an existing theme (continue plans). */
  mode: 'light' | 'dark' | null;
  /** Write theme.css even if our theme file already exists (a new theme was chosen explicitly). */
  replaceThemeFile?: boolean;
}

export interface DesignChange {
  path: string;
  /** null = new file. */
  before: string | null;
  after: string;
}

export interface DesignResult {
  changes: DesignChange[];
  /** The theme that was applied (null when only the page fixes ran). */
  theme: ThemeDefinition | null;
  createdThemeFile: boolean;
  /** theme/theme.css is among the changes (created, or replaced by an explicit new choice). */
  themeFileChanged: boolean;
  colorChanges: number;
  icons: number;
  fixedYears: string[];
  /** Pages whose buttons had no style of their own and got one (no theme covered them). */
  buttons: Array<{ path: string; count: number }>;
  /** Pages whose mobile menu was repaired: "open" (the button now opens it), "script" (a toggle was added), "close". */
  menus: Array<{ path: string; repaired: Array<'open' | 'script' | 'close'> }>;
}

const FRAMEWORK =
  /(?<![\p{L}])(?:bootstrap|tailwind|bulma|foundation|materialize|material[\s-]?ui|mui|chakra|shadcn|daisyui|react|vue|angular|svelte|next\.?js|nuxt|astro|jquery\s*ui)(?![\p{L}])/iu;
const FONT_REQUEST =
  /(?<![\p{L}])(?:font|fontu|fontları|fontlar|yazı\s*tipi|yazı\s*tipleri|typeface|poppins|roboto|montserrat|open\s+sans|lato|raleway|playfair|merriweather|nunito|oswald|ubuntu|arial|helvetica|georgia|times\s+new\s+roman|verdana|comic\s+sans)(?![\p{L}])/iu;
const COLOR_WORD =
  /(?<![\p{L}])(?:kırmızı|mavi|yeşil|sarı|turuncu|mor|pembe|siyah|beyaz|gri|kahverengi|lacivert|turkuaz|bordo|eflatun|lila|fuşya|haki|red|blue|green|yellow|orange|purple|pink|black|white|gr[ae]y|brown|navy|teal|gold|golden)/iu;
const STYLE_WORD =
  /(?<![\p{L}])(?:renk|renkli|rengi|renkler|renklerinde|ton|tonlar|tonunda|tonlarında|tema|arka\s*plan|arkaplan|zemin|buton|düğme|yazılar|başlıklar|palet|colou?rs?|theme|background|buttons?|palette|accent)/iu;
const HEX_COLOR = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i;
const DARK_REQUEST =
  /(?<![\p{L}])(?:koyu|karanlık|siyah|dark)\s+(?:bir\s+)?(?:tema|mod|modu|arka\s*plan|arkaplan|zemin|tasarım|theme|mode|background|design)|dark\s*mode|gece\s+modu/giu;
const LIGHT_REQUEST =
  /(?<![\p{L}])(?:açık|aydınlık|beyaz|light)\s+(?:bir\s+)?(?:tema|mod|modu|arka\s*plan|arkaplan|zemin|tasarım|theme|mode|background|design)|light\s*mode/giu;

/** "koyu tema" / "dark mode" -> dark, "açık tema" -> light. */
export function modePreference(goal: string): 'light' | 'dark' | null {
  if (DARK_REQUEST.test(goal)) {
    DARK_REQUEST.lastIndex = 0;
    return 'dark';
  }
  DARK_REQUEST.lastIndex = 0;
  const light = LIGHT_REQUEST.test(goal);
  LIGHT_REQUEST.lastIndex = 0;
  return light ? 'light' : null;
}

/** The request names its own colors ("mavi tonlarında", "#1e3a8a", "butonlar kırmızı olsun"). */
export function userGaveColors(goal: string): boolean {
  if (HEX_COLOR.test(goal)) return true;
  // "koyu tema" is a light/dark wish, not a palette
  const rest = goal.replace(DARK_REQUEST, ' ').replace(LIGHT_REQUEST, ' ');
  return COLOR_WORD.test(rest) && STYLE_WORD.test(rest);
}

export function userGaveFonts(goal: string): boolean {
  return FONT_REQUEST.test(goal);
}

function baseEnabled(config: DesignThemeConfig, modelSizeB: number | null): boolean {
  if (config.baseCss === 'on') return true;
  if (config.baseCss === 'off') return false;
  return modelSizeB === null || modelSizeB < 8;
}

let lastPickedThemeId: string | null = null;

/** Decides the design treatment of a run before the agent starts. */
export function planDesignTheme(input: {
  goal: string;
  projectFiles: string[];
  config: Partial<DesignThemeConfig> | undefined;
  modelSizeB: number | null;
  /** Current content of theme/theme.css (null = the project has none). */
  existingThemeCss: string | null;
  random?: () => number;
  /** The user's explicit choice for this run (site wizard). */
  override?: DesignOverride | null;
}): DesignPlan | null {
  const config: DesignThemeConfig = { ...DEFAULT_SETTINGS.designTheme, ...(input.config || {}) };
  const goal = input.goal || '';

  if (input.override) {
    // The user picked the design for this run: no request heuristics, no topic question.
    const o = input.override;
    if (!o.enabled) return null;
    const existingMarker = readThemeMarker(input.existingThemeCss);
    if (input.existingThemeCss !== null && !existingMarker) return null; // never overwrite a foreign theme.css
    const fixed = o.themeId ? getTheme(o.themeId) : undefined;
    return {
      kind: 'new',
      theme: true,
      base: baseEnabled(config, input.modelSizeB),
      webFonts: config.webFonts,
      fonts: true,
      icons: true,
      modePreference: o.mode || null,
      web: true,
      category: fixed?.category || o.category || null,
      categorySource: 'wizard',
      themeId: fixed?.id || null,
      mode: null,
      replaceThemeFile: !!existingMarker,
    };
  }
  const themeOn = config.mode !== 'off';
  const baseOn = baseEnabled(config, input.modelSizeB);
  if (!themeOn && !baseOn) return null;
  const colorsGiven = userGaveColors(goal);
  const fonts = !userGaveFonts(goal);
  const icons = !/emoji/i.test(goal);

  const marker = readThemeMarker(input.existingThemeCss);
  if (marker) {
    // A page this feature themed before: new pages and new CSS follow the same theme.
    return {
      kind: 'continue',
      theme: themeOn && !colorsGiven,
      base: false,
      webFonts: config.webFonts,
      fonts,
      icons,
      modePreference: null,
      web: true,
      category: getTheme(marker.id)?.category || null,
      categorySource: 'existing',
      themeId: marker.id,
      mode: marker.mode,
    };
  }
  if (input.existingThemeCss !== null) return null; // a theme/theme.css we did not write
  if (input.projectFiles.some((f) => /\.html?$/i.test(f))) return null; // an existing site keeps its design
  if (FRAMEWORK.test(goal) || NO_STYLE_PATTERN.test(goal) || SINGLE_FILE_PATTERN.test(goal)) return null;

  const theme = themeOn && !colorsGiven;
  if (!theme && !baseOn) return null;
  const plan: DesignPlan = {
    kind: 'new',
    theme,
    base: baseOn,
    webFonts: config.webFonts,
    fonts,
    icons,
    modePreference: modePreference(goal),
    web: WEB_PATTERN.test(goal),
    category: null,
    categorySource: null,
    themeId: null,
    mode: null,
  };
  if (!theme) {
    plan.themeId = NEUTRAL_THEME.id;
    return plan;
  }
  const random = input.random || Math.random;
  if (config.mode === 'fixed') {
    const fixed = getTheme(config.fixedThemeId) || getTheme(DEFAULT_SETTINGS.designTheme.fixedThemeId)!;
    plan.themeId = fixed.id;
    plan.category = fixed.category;
    plan.categorySource = 'fixed';
  } else if (config.mode === 'random') {
    let pool = plan.modePreference ? THEMES.filter((t) => t.mode === plan.modePreference) : THEMES;
    if (pool.length > 1 && lastPickedThemeId) pool = pool.filter((t) => t.id !== lastPickedThemeId);
    const chosen = pool[Math.floor(random() * pool.length) % pool.length];
    plan.themeId = chosen.id;
    plan.category = chosen.category;
    plan.categorySource = 'random';
    lastPickedThemeId = chosen.id;
  } else if (plan.web) {
    const kw = categorizeByKeywords(goal);
    if (kw.category) {
      plan.category = kw.category;
      plan.categorySource = 'keywords';
    }
  }
  return plan;
}

/** True when only the model can tell the topic (no keyword or several). */
export function needsModelCategory(plan: DesignPlan | null): boolean {
  return !!plan && plan.kind === 'new' && plan.theme && plan.web && !plan.themeId && !plan.category;
}

/** Picks the concrete theme once the category is known. */
export function resolvePlanTheme(
  plan: DesignPlan,
  category: DesignCategory | null,
  source: CategorySource,
  random?: () => number
): void {
  if (plan.themeId) return;
  if (!plan.category) {
    plan.category = category || 'genel';
    plan.categorySource = category ? source : 'default';
  }
  const theme = pickTheme(plan.category, { mode: plan.modePreference, avoid: lastPickedThemeId, random });
  plan.themeId = theme.id;
  lastPickedThemeId = theme.id;
}

function themeFor(plan: DesignPlan): ThemeDefinition {
  if (plan.themeId === NEUTRAL_THEME.id) return NEUTRAL_THEME;
  const known = getTheme(plan.themeId);
  if (known) return known;
  return { ...NEUTRAL_THEME, mode: plan.mode || 'light' };
}

/**
 * The end-of-run changes: page fixes for every HTML file the run wrote, plus the theme when the
 * plan asks for one. `files` are the text files the run wrote, with their current content.
 */
export function applyDesign(params: {
  plan: DesignPlan | null;
  files: Array<{ path: string; content: string }>;
  themeCss: string | null;
  year?: number;
  random?: () => number;
}): DesignResult {
  const year = params.year ?? new Date().getFullYear();
  const result: DesignResult = {
    changes: [],
    theme: null,
    createdThemeFile: false,
    themeFileChanged: false,
    colorChanges: 0,
    icons: 0,
    fixedYears: [],
    buttons: [],
    menus: [],
  };
  const files = params.files.filter((f) => !isThemeAsset(f.path));
  const pages = files.filter((f) => /\.html?$/i.test(f.path));
  const sheets = files.filter((f) => /\.css$/i.test(f.path));
  const next = new Map(files.map((f) => [f.path, f.content]));

  for (const page of pages) {
    const html = next.get(page.path)!;
    const fixed = fixCopyrightYears(html, year);
    if (fixed !== html) result.fixedYears.push(page.path);
    next.set(page.path, ensureViewport(fixed));
  }

  const plan = params.plan;
  const foreignThemeFile = params.themeCss !== null && !readThemeMarker(params.themeCss);
  const applies =
    !!plan &&
    !foreignThemeFile &&
    (plan.kind === 'continue' ? pages.length + sheets.length > 0 : pages.length > 0);

  if (plan && applies) {
    if (plan.kind === 'new' && plan.theme && !plan.themeId) resolvePlanTheme(plan, plan.category, 'default', params.random);
    const theme = themeFor(plan);
    result.theme = theme;

    if (plan.kind === 'new' && (params.themeCss === null || plan.replaceThemeFile)) {
      const css = buildThemeCss(theme, { base: plan.base, webFonts: plan.webFonts, fonts: plan.fonts });
      if (css !== params.themeCss) {
        result.changes.push({ path: THEME_FILE, before: params.themeCss, after: css });
        result.createdThemeFile = params.themeCss === null;
        result.themeFileChanged = true;
      }
    }

    if (plan.theme || plan.base) {
      // Base layer only (own colors / theme off): layout fixes, colors and fonts stay the page's.
      const rewriter = new ThemeRewriter({ mode: plan.mode || theme.mode, colors: plan.theme, fonts: plan.theme && plan.fonts });
      for (const s of sheets) rewriter.collectCss(next.get(s.path)!);
      for (const p of pages) rewriter.collectHtml(next.get(p.path)!);
      for (const s of sheets) next.set(s.path, rewriter.rewriteCss(next.get(s.path)!));
      for (const p of pages) next.set(p.path, rewriter.rewriteHtml(next.get(p.path)!));
      result.colorChanges = rewriter.replacements;
    }

    for (const page of pages) {
      let html = injectThemeLink(next.get(page.path)!, relativeHref(page.path, THEME_FILE));
      if (plan.icons) {
        const swapped = replaceEmojiIcons(html);
        html = swapped.html;
        result.icons += swapped.replaced;
      }
      next.set(page.path, html);
    }
  }

  // Faults the model left in its pages: buttons without a style (when no theme's base layer covers
  // them) and a hamburger menu that does not open, or does not close after a link is chosen.
  const covered = !!plan && applies && !!(plan.theme || plan.base);
  for (const page of pages) {
    let html = next.get(page.path)!;
    if (!covered) {
      const buttons = styleBareButtons(html, pageSources(page.path, html, next));
      if (buttons.count > 0) {
        html = buttons.html;
        result.buttons.push({ path: page.path, count: buttons.count });
      }
    }
    const menu = repairMobileMenu(html, pageSources(page.path, html, next));
    if (menu.repaired.length > 0) {
      html = menu.html;
      result.menus.push({ path: page.path, repaired: menu.repaired });
    }
    next.set(page.path, html);
  }

  for (const f of files) {
    const after = next.get(f.path)!;
    if (after !== f.content) result.changes.push({ path: f.path, before: f.content, after });
  }
  return result;
}
