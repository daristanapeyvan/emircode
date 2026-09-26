/**
 * themes.ts — the design themes applied to web pages the agent creates.
 *
 * Every theme is a complete, hand-tuned design direction (palette, type pairing, shape,
 * depth, button style, texture and icon stroke), not a color swap. Text pairs meet WCAG AAA
 * (7:1) — test_design_theme.ts verifies every pair listed in THEME_CONTRAST_PAIRS.
 */

export type DesignCategory =
  | 'kurumsal'
  | 'luks'
  | 'eglenceli'
  | 'teknoloji'
  | 'doga_saglik'
  | 'yemek'
  | 'yaratici'
  | 'genel';

export const DESIGN_CATEGORIES: Array<{ id: DesignCategory; label: string; hint: string }> = [
  { id: 'kurumsal', label: 'Kurumsal', hint: 'company, law firm, consulting, finance, insurance, construction, real estate, logistics' },
  { id: 'luks', label: 'Lüks', hint: 'luxury brand, jewelry, fashion, boutique, hotel, wedding, beauty salon, spa' },
  { id: 'eglenceli', label: 'Eğlenceli', hint: 'kids, toys, party, events, festival, games, pets, hobby' },
  { id: 'teknoloji', label: 'Teknoloji', hint: 'software, app, startup, SaaS, AI, crypto, electronics, developer tools' },
  { id: 'doga_saglik', label: 'Doğa & Sağlık', hint: 'health, clinic, dentist, psychologist, yoga, gym, garden, farm, eco, travel' },
  { id: 'yemek', label: 'Yemek & Kafe', hint: 'restaurant, cafe, coffee, bakery, patisserie, bar, food, recipes, catering' },
  { id: 'yaratici', label: 'Yaratıcı', hint: 'portfolio, photography, designer, art, gallery, music, blog, magazine, studio' },
  { id: 'genel', label: 'Genel', hint: 'anything else, personal pages, tools, unclear requests' },
];

export interface ThemeFont {
  /** Google Fonts family name ("" = system fonts only). */
  family: string;
  weights: number[];
  /** System font stack used offline or when web fonts are turned off. */
  fallback: string;
}

export interface ThemeColors {
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  /** Form field outlines: >= 3:1 against surface (WCAG non-text contrast). */
  fieldBorder: string;
  ink: string;
  inkSoft: string;
  /** Contrasting band (header / footer / dark sections). */
  inverse: string;
  onInverse: string;
  onInverseSoft: string;
  accent: string;
  /** Hover / pressed state of accent buttons. */
  accentStrong: string;
  /** Tinted background (badges, highlights, selection). */
  accentSoft: string;
  /** Accent for text and links on bg / surface. */
  accentInk: string;
  onAccent: string;
  accent2: string;
  onAccent2: string;
}

export type ShadowStyle = 'none' | 'soft' | 'crisp' | 'hard' | 'hard-accent2';
export type ButtonStyle = 'solid' | 'solid-caps' | 'outline' | 'hard';
export type PatternStyle = 'none' | 'grid' | 'dots' | 'grain';

export interface ThemeDefinition {
  id: string;
  name: string;
  category: DesignCategory;
  mode: 'light' | 'dark';
  /** One line in Turkish, shown in settings and in the agent timeline. */
  mood: string;
  colors: ThemeColors;
  fonts: { heading: ThemeFont; body: ThemeFont; mono: ThemeFont };
  shape: { radius: number; radiusLarge: number; buttonRadius: number };
  type: {
    headingWeight: number;
    headingTracking: string;
    headingLeading: number;
    headingCase: 'none' | 'uppercase';
    /** Largest h1 size (rem) — wide display faces need less. */
    h1Max: number;
    bodySize: string;
    bodyLeading: number;
  };
  style: {
    borderWidth: number;
    cardBorder: 'solid' | 'double';
    shadow: ShadowStyle;
    button: ButtonStyle;
    buttonFont: 'body' | 'heading' | 'mono';
    pattern: PatternStyle;
    iconStroke: number;
    iconCap: 'round' | 'square';
    link: 'underline' | 'plain';
    density: 'airy' | 'regular';
    /** Rule above section headings (editorial look). */
    headingRule: boolean;
  };
}

// ---------------------------------------------------------------------------
// System font stacks (used when offline or when web fonts are off)
// ---------------------------------------------------------------------------
const SANS = 'system-ui, -apple-system, "Segoe UI Variable Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const SANS_DISPLAY = '"Segoe UI Variable Display", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const HUMANIST = 'Seravek, "Gill Sans Nova", Ubuntu, Calibri, "Segoe UI", system-ui, sans-serif';
const GEOMETRIC = '"Avenir Next", Avenir, Futura, "Century Gothic", "Segoe UI", system-ui, sans-serif';
const INDUSTRIAL = 'Bahnschrift, "DIN Alternate", "Franklin Gothic Medium", "Arial Narrow", system-ui, sans-serif';
const ROUNDED = 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", "Segoe UI", system-ui, sans-serif';
const SERIF_TEXT = '"Iowan Old Style", "Sitka Text", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif';
const SERIF_DISPLAY = '"Sitka Heading", "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';
const DIDONE = '"Bodoni 72", Didot, "Bodoni MT", "Sitka Banner", Georgia, serif';
const CLASSICAL = 'Optima, Candara, "Sitka Heading", "Palatino Linotype", Georgia, serif';
const SLAB = 'Rockwell, "Rockwell Nova", "Roboto Slab", "Sitka Heading", Georgia, serif';
const MONO = 'ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

const gf = (family: string, weights: number[], fallback: string): ThemeFont => ({ family, weights, fallback });
const systemMono = gf('', [], MONO);

// ---------------------------------------------------------------------------
// Themes (3 per category)
// ---------------------------------------------------------------------------
export const THEMES: ThemeDefinition[] = [
  // ---------------------------------------------------------------- Kurumsal
  {
    id: 'muhur',
    name: 'Mühür',
    category: 'kurumsal',
    mode: 'light',
    mood: 'Kâğıt tonları, klasik serif başlıklar ve derin prusya mavisi — hukuk ve danışmanlık için güven veren bir ağırbaşlılık.',
    colors: {
      bg: '#F7F5F0', surface: '#FFFFFF', surface2: '#EEEAE1', border: '#DDD6C8', fieldBorder: '#8A8374',
      ink: '#161B26', inkSoft: '#444B59',
      inverse: '#142033', onInverse: '#F7F5F0', onInverseSoft: '#B9C0CC',
      accent: '#1D4470', accentStrong: '#14314F', accentSoft: '#E2E9F1', accentInk: '#1D4470', onAccent: '#FFFFFF',
      accent2: '#6B5020', onAccent2: '#FFFFFF',
    },
    fonts: { heading: gf('Newsreader', [500, 600], SERIF_DISPLAY), body: gf('Hanken Grotesk', [400, 500, 600], SANS), mono: systemMono },
    shape: { radius: 4, radiusLarge: 6, buttonRadius: 3 },
    type: { headingWeight: 500, headingTracking: '-0.015em', headingLeading: 1.12, headingCase: 'none', h1Max: 4.25, bodySize: '1.0625rem', bodyLeading: 1.65 },
    style: { borderWidth: 1, cardBorder: 'solid', shadow: 'crisp', button: 'solid', buttonFont: 'body', pattern: 'none', iconStroke: 1.5, iconCap: 'round', link: 'underline', density: 'airy', headingRule: false },
  },
  {
    id: 'grafit',
    name: 'Grafit',
    category: 'kurumsal',
    mode: 'light',
    mood: 'İsviçre ekolü: sıkı grotesk başlıklar, keskin köşeler, ince çizgiler ve tek bir sinyal turuncusu.',
    colors: {
      bg: '#F4F4F1', surface: '#FFFFFF', surface2: '#E8E8E3', border: '#CFCFC8', fieldBorder: '#7D7D76',
      ink: '#111111', inkSoft: '#4A4A46',
      inverse: '#111111', onInverse: '#F4F4F1', onInverseSoft: '#BDBDB6',
      accent: '#FF7A1A', accentStrong: '#FF8F40', accentSoft: '#FFE6D2', accentInk: '#8F3200', onAccent: '#111111',
      accent2: '#2B2B2B', onAccent2: '#FFFFFF',
    },
    fonts: { heading: gf('Archivo', [700, 800], INDUSTRIAL), body: gf('Archivo', [400, 500, 600], SANS), mono: systemMono },
    shape: { radius: 0, radiusLarge: 0, buttonRadius: 0 },
    type: { headingWeight: 800, headingTracking: '-0.035em', headingLeading: 1.0, headingCase: 'none', h1Max: 4.5, bodySize: '1rem', bodyLeading: 1.6 },
    style: { borderWidth: 1, cardBorder: 'solid', shadow: 'none', button: 'solid-caps', buttonFont: 'body', pattern: 'none', iconStroke: 2, iconCap: 'square', link: 'underline', density: 'regular', headingRule: false },
  },
  {
    id: 'ufuk',
    name: 'Ufuk',
    category: 'kurumsal',
    mode: 'light',
    mood: 'Serin beyazlar, lacivert metin ve kararlı bir mavi — finans ve sigorta için sakin, modern ve net.',
    colors: {
      bg: '#F6F8FB', surface: '#FFFFFF', surface2: '#EAEFF5', border: '#D6DEE8', fieldBorder: '#7A8699',
      ink: '#0F1B2D', inkSoft: '#3F4B5E',
      inverse: '#0F1B2D', onInverse: '#F6F8FB', onInverseSoft: '#B4BFCE',
      accent: '#0A529C', accentStrong: '#083F78', accentSoft: '#E1ECF8', accentInk: '#0A529C', onAccent: '#FFFFFF',
      accent2: '#095E55', onAccent2: '#FFFFFF',
    },
    fonts: { heading: gf('Plus Jakarta Sans', [700, 800], SANS_DISPLAY), body: gf('Plus Jakarta Sans', [400, 500, 600], SANS), mono: systemMono },
    shape: { radius: 12, radiusLarge: 20, buttonRadius: 10 },
    type: { headingWeight: 700, headingTracking: '-0.025em', headingLeading: 1.1, headingCase: 'none', h1Max: 4, bodySize: '1rem', bodyLeading: 1.65 },
    style: { borderWidth: 1, cardBorder: 'solid', shadow: 'soft', button: 'solid', buttonFont: 'body', pattern: 'none', iconStroke: 1.75, iconCap: 'round', link: 'plain', density: 'airy', headingRule: false },
  },

  // ---------------------------------------------------------------- Lüks
  {
    id: 'gece-yarisi',
    name: 'Gece Yarısı',
    category: 'luks',
    mode: 'dark',
    mood: 'Sıcak siyah zemin, şampanya rengi metin, yüksek kontrastlı Bodoni başlıklar ve ölçülü antika altın.',
    colors: {
      bg: '#0F0E0C', surface: '#171512', surface2: '#201D19', border: '#332E27', fieldBorder: '#7D7466',
      ink: '#F1EADC', inkSoft: '#B9AF9E',
      inverse: '#080706', onInverse: '#F1EADC', onInverseSoft: '#B9AF9E',
      accent: '#C8A86B', accentStrong: '#DCC08A', accentSoft: '#2A241A', accentInk: '#D9BD85', onAccent: '#14110C',
      accent2: '#7A2E2E', onAccent2: '#F1EADC',
    },
    fonts: { heading: gf('Bodoni Moda', [500, 600], DIDONE), body: gf('Jost', [400, 500], GEOMETRIC), mono: systemMono },
    shape: { radius: 0, radiusLarge: 0, buttonRadius: 0 },
    type: { headingWeight: 500, headingTracking: '0em', headingLeading: 1.08, headingCase: 'none', h1Max: 4.75, bodySize: '1.0625rem', bodyLeading: 1.7 },
    style: { borderWidth: 1, cardBorder: 'solid', shadow: 'none', button: 'outline', buttonFont: 'body', pattern: 'grain', iconStroke: 1.25, iconCap: 'round', link: 'plain', density: 'airy', headingRule: false },
  },
  {
    id: 'porselen',
    name: 'Porselen',
    category: 'luks',
    mode: 'light',
    mood: 'Porselen beyazı, espresso metin, zarif ince serif başlıklar ve gül ağacı tonu — gelinlik, mücevher, spa.',
    colors: {
      bg: '#FBF8F3', surface: '#FFFFFF', surface2: '#F3EDE4', border: '#E6DDD0', fieldBorder: '#8F8275',
      ink: '#2A2320', inkSoft: '#574B45',
      inverse: '#2A2320', onInverse: '#FBF8F3', onInverseSoft: '#CBBFB4',
      accent: '#7E433A', accentStrong: '#663530', accentSoft: '#F3E4DE', accentInk: '#7E433A', onAccent: '#FFFFFF',
      accent2: '#C9B083', onAccent2: '#2A2320',
    },
    fonts: { heading: gf('Instrument Serif', [400], SERIF_DISPLAY), body: gf('Albert Sans', [400, 500, 600], HUMANIST), mono: systemMono },
    shape: { radius: 2, radiusLarge: 4, buttonRadius: 999 },
    type: { headingWeight: 400, headingTracking: '-0.01em', headingLeading: 1.05, headingCase: 'none', h1Max: 5, bodySize: '1rem', bodyLeading: 1.7 },
    style: { borderWidth: 1, cardBorder: 'solid', shadow: 'soft', button: 'solid-caps', buttonFont: 'body', pattern: 'none', iconStroke: 1.25, iconCap: 'round', link: 'underline', density: 'airy', headingRule: false },
  },
  {
    id: 'zumrut',
    name: 'Zümrüt',
    category: 'luks',
    mode: 'light',
    mood: 'Art deco esintisi: fildişi zemin, derin zümrüt, pirinç detaylar, klasik büyük harf başlıklar ve çift çizgili çerçeveler.',
    colors: {
      bg: '#F6F1E6', surface: '#FCF9F2', surface2: '#ECE4D3', border: '#D8CCB2', fieldBorder: '#857A63',
      ink: '#13231D', inkSoft: '#3E4C45',
      inverse: '#0E3A2C', onInverse: '#F6F1E6', onInverseSoft: '#BFD0C4',
      accent: '#0E5A43', accentStrong: '#0A4533', accentSoft: '#DCE9E1', accentInk: '#0E5A43', onAccent: '#FFFFFF',
      accent2: '#C9A55E', onAccent2: '#13231D',
    },
    fonts: { heading: gf('Marcellus', [400], CLASSICAL), body: gf('Mulish', [400, 600, 700], GEOMETRIC), mono: systemMono },
    shape: { radius: 0, radiusLarge: 0, buttonRadius: 0 },
    type: { headingWeight: 400, headingTracking: '0.06em', headingLeading: 1.18, headingCase: 'uppercase', h1Max: 3.5, bodySize: '1.0625rem', bodyLeading: 1.7 },
    style: { borderWidth: 3, cardBorder: 'double', shadow: 'none', button: 'solid-caps', buttonFont: 'body', pattern: 'none', iconStroke: 1.25, iconCap: 'square', link: 'underline', density: 'airy', headingRule: false },
  },

  // ---------------------------------------------------------------- Eğlenceli
  {
    id: 'seker',
    name: 'Şeker',
    category: 'eglenceli',
    mode: 'light',
    mood: 'Neo-brütalist neşe: krem zemin, kalın mürekkep çerçeveler, sert gölgeler, domates ve ayçiçeği renkleri.',
    colors: {
      bg: '#FFF6E9', surface: '#FFFFFF', surface2: '#FFE9CC', border: '#14110E', fieldBorder: '#14110E',
      ink: '#14110E', inkSoft: '#4B443C',
      inverse: '#14110E', onInverse: '#FFF6E9', onInverseSoft: '#D9CFC0',
      accent: '#FF7A59', accentStrong: '#FF9474', accentSoft: '#FFE1D6', accentInk: '#962C12', onAccent: '#14110E',
      accent2: '#FFC53D', onAccent2: '#14110E',
    },
    fonts: { heading: gf('Bricolage Grotesque', [700, 800], SANS_DISPLAY), body: gf('Figtree', [400, 500, 600, 700], SANS), mono: systemMono },
    shape: { radius: 14, radiusLarge: 22, buttonRadius: 12 },
    type: { headingWeight: 800, headingTracking: '-0.03em', headingLeading: 1.02, headingCase: 'none', h1Max: 4.75, bodySize: '1.0625rem', bodyLeading: 1.6 },
    style: { borderWidth: 2, cardBorder: 'solid', shadow: 'hard', button: 'hard', buttonFont: 'body', pattern: 'dots', iconStroke: 2.25, iconCap: 'round', link: 'underline', density: 'regular', headingRule: false },
  },
  {
    id: 'lunapark',
    name: 'Lunapark',
    category: 'eglenceli',
    mode: 'light',
    mood: 'Yuvarlak, sevimli harfler; mandalina butonlar, kraliyet mavisi bağlantılar ve bol yumuşak köşe — çocuklar ve evcil dostlar için.',
    colors: {
      bg: '#F3F8FF', surface: '#FFFFFF', surface2: '#E4EEFC', border: '#CFDDF3', fieldBorder: '#6F81A3',
      ink: '#14213D', inkSoft: '#3D4A66',
      inverse: '#14213D', onInverse: '#F3F8FF', onInverseSoft: '#B9C6DE',
      accent: '#FFA23A', accentStrong: '#FFB45E', accentSoft: '#FFEBD3', accentInk: '#174699', onAccent: '#14213D',
      accent2: '#174699', onAccent2: '#FFFFFF',
    },
    fonts: { heading: gf('Fredoka', [600], ROUNDED), body: gf('Nunito', [400, 600, 700], ROUNDED), mono: systemMono },
    shape: { radius: 18, radiusLarge: 28, buttonRadius: 999 },
    type: { headingWeight: 600, headingTracking: '-0.01em', headingLeading: 1.1, headingCase: 'none', h1Max: 4.25, bodySize: '1.0625rem', bodyLeading: 1.65 },
    style: { borderWidth: 1, cardBorder: 'solid', shadow: 'soft', button: 'solid', buttonFont: 'heading', pattern: 'dots', iconStroke: 2, iconCap: 'round', link: 'plain', density: 'regular', headingRule: false },
  },
  {
    id: 'konfeti',
    name: 'Konfeti',
    category: 'eglenceli',
    mode: 'light',
    mood: "70'ler retro pop: sıcak krem, petrol yeşili, hardal sarısı gölgeler ve kıvrak retro başlıklar — etkinlik ve festival.",
    colors: {
      bg: '#FFF3DE', surface: '#FFF9EF', surface2: '#F9E5C2', border: '#E8CFA0', fieldBorder: '#8C7654',
      ink: '#2A1C12', inkSoft: '#5A4636',
      inverse: '#2A1C12', onInverse: '#FFF3DE', onInverseSoft: '#E3CFB3',
      accent: '#0A5451', accentStrong: '#083F3D', accentSoft: '#D5EBE7', accentInk: '#0A5451', onAccent: '#FFFFFF',
      accent2: '#E9A93A', onAccent2: '#2A1C12',
    },
    fonts: { heading: gf('Shrikhand', [400], SLAB), body: gf('DM Sans', [400, 500, 700], SANS), mono: systemMono },
    shape: { radius: 16, radiusLarge: 24, buttonRadius: 999 },
    type: { headingWeight: 400, headingTracking: '0em', headingLeading: 1.12, headingCase: 'none', h1Max: 4.25, bodySize: '1.0625rem', bodyLeading: 1.6 },
    style: { borderWidth: 2, cardBorder: 'solid', shadow: 'hard-accent2', button: 'hard', buttonFont: 'body', pattern: 'none', iconStroke: 2, iconCap: 'round', link: 'underline', density: 'regular', headingRule: false },
  },

  // ---------------------------------------------------------------- Teknoloji
  {
    id: 'terminal',
    name: 'Terminal',
    category: 'teknoloji',
    mode: 'dark',
    mood: 'Neredeyse siyah zemin, silik ızgara, monospace ayrıntılar ve tek bir asit yeşili — geliştirici araçları için.',
    colors: {
      bg: '#0B0D10', surface: '#111418', surface2: '#181C22', border: '#262C35', fieldBorder: '#667080',
      ink: '#E7EAEE', inkSoft: '#A1AAB7',
      inverse: '#07090B', onInverse: '#E7EAEE', onInverseSoft: '#A1AAB7',
      accent: '#B8F04A', accentStrong: '#CBFF6B', accentSoft: '#1B2410', accentInk: '#C4F56A', onAccent: '#0B0D10',
      accent2: '#5CC8FF', onAccent2: '#0B0D10',
    },
    fonts: { heading: gf('Geist', [600, 700], SANS_DISPLAY), body: gf('Geist', [400, 500], SANS), mono: gf('Geist Mono', [400, 500], MONO) },
    shape: { radius: 8, radiusLarge: 14, buttonRadius: 8 },
    type: { headingWeight: 600, headingTracking: '-0.035em', headingLeading: 1.05, headingCase: 'none', h1Max: 4.25, bodySize: '1rem', bodyLeading: 1.65 },
    style: { borderWidth: 1, cardBorder: 'solid', shadow: 'none', button: 'solid', buttonFont: 'mono', pattern: 'grid', iconStroke: 1.5, iconCap: 'square', link: 'plain', density: 'regular', headingRule: false },
  },
  {
    id: 'cizim',
    name: 'Çizim',
    category: 'teknoloji',
    mode: 'light',
    mood: 'Teknik çizim kâğıdı: soğuk zemin üstünde ince ızgara, kobalt mavisi, monospace etiketler ve kesin çizgiler.',
    colors: {
      bg: '#F2F5F9', surface: '#FFFFFF', surface2: '#E3E9F1', border: '#C9D4E3', fieldBorder: '#6E7F99',
      ink: '#0C1A2E', inkSoft: '#3B4A60',
      inverse: '#0C1A2E', onInverse: '#F2F5F9', onInverseSoft: '#AFBDD0',
      accent: '#1240B3', accentStrong: '#0F3597', accentSoft: '#DEE7F8', accentInk: '#1240B3', onAccent: '#FFFFFF',
      accent2: '#F2994A', onAccent2: '#0C1A2E',
    },
    fonts: { heading: gf('Schibsted Grotesk', [700, 800], SANS_DISPLAY), body: gf('IBM Plex Sans', [400, 500, 600], SANS), mono: gf('IBM Plex Mono', [400, 500], MONO) },
    shape: { radius: 4, radiusLarge: 6, buttonRadius: 4 },
    type: { headingWeight: 700, headingTracking: '-0.025em', headingLeading: 1.08, headingCase: 'none', h1Max: 4.25, bodySize: '1rem', bodyLeading: 1.65 },
    style: { borderWidth: 1, cardBorder: 'solid', shadow: 'crisp', button: 'solid', buttonFont: 'mono', pattern: 'grid', iconStroke: 1.5, iconCap: 'square', link: 'underline', density: 'regular', headingRule: false },
  },
  {
    id: 'krom',
    name: 'Krom',
    category: 'teknoloji',
    mode: 'light',
    mood: 'Tek renkli, rafine ürün sayfası: saf beyaz, derin siyah hap butonlar, sıkı başlıklar ve yalnızca bağlantılarda mavi.',
    colors: {
      bg: '#FAFAFA', surface: '#FFFFFF', surface2: '#F0F0F1', border: '#E0E0E3', fieldBorder: '#7C7C86',
      ink: '#0A0A0B', inkSoft: '#4A4A52',
      inverse: '#0A0A0B', onInverse: '#FAFAFA', onInverseSoft: '#B4B4BC',
      accent: '#0A0A0B', accentStrong: '#2A2A2E', accentSoft: '#EEEEF0', accentInk: '#1747C9', onAccent: '#FFFFFF',
      accent2: '#1747C9', onAccent2: '#FFFFFF',
    },
    fonts: { heading: gf('Onest', [600, 700], SANS_DISPLAY), body: gf('Onest', [400, 500], SANS), mono: gf('JetBrains Mono', [400], MONO) },
    shape: { radius: 10, radiusLarge: 16, buttonRadius: 999 },
    type: { headingWeight: 600, headingTracking: '-0.04em', headingLeading: 1.02, headingCase: 'none', h1Max: 4.5, bodySize: '1rem', bodyLeading: 1.6 },
    style: { borderWidth: 1, cardBorder: 'solid', shadow: 'soft', button: 'solid', buttonFont: 'body', pattern: 'none', iconStroke: 1.5, iconCap: 'round', link: 'underline', density: 'airy', headingRule: false },
  },

  // ---------------------------------------------------------------- Doğa & Sağlık
  {
    id: 'orman',
    name: 'Orman',
    category: 'doga_saglik',
    mode: 'light',
    mood: 'Yulaf rengi zemin, orman yeşili, pas turuncusu vurgular, yumuşak serif başlıklar ve hafif kâğıt dokusu.',
    colors: {
      bg: '#F3F0E7', surface: '#FAF8F2', surface2: '#E7E2D4', border: '#D5CDB9', fieldBorder: '#7F7866',
      ink: '#1B261F', inkSoft: '#3F4A44',
      inverse: '#1E3A2C', onInverse: '#F3F0E7', onInverseSoft: '#BCCDC0',
      accent: '#255239', accentStrong: '#1B3E2B', accentSoft: '#DDE8DE', accentInk: '#255239', onAccent: '#FFFFFF',
      accent2: '#8C3F1C', onAccent2: '#FFFFFF',
    },
    fonts: { heading: gf('Fraunces', [600], SERIF_DISPLAY), body: gf('Karla', [400, 500, 700], HUMANIST), mono: systemMono },
    shape: { radius: 10, radiusLarge: 18, buttonRadius: 999 },
    type: { headingWeight: 600, headingTracking: '-0.02em', headingLeading: 1.08, headingCase: 'none', h1Max: 4.5, bodySize: '1.0625rem', bodyLeading: 1.7 },
    style: { borderWidth: 1, cardBorder: 'solid', shadow: 'soft', button: 'solid', buttonFont: 'body', pattern: 'grain', iconStroke: 1.75, iconCap: 'round', link: 'underline', density: 'airy', headingRule: false },
  },
  {
    id: 'nane',
    name: 'Nane',
    category: 'doga_saglik',
    mode: 'light',
    mood: 'Ferah nane beyazı, güven veren koyu turkuaz ve sıcak şeftali dokunuşu — klinik ve sağlık için sakin, okunaklı.',
    colors: {
      bg: '#F4FAF8', surface: '#FFFFFF', surface2: '#E3F1ED', border: '#CFE3DD', fieldBorder: '#6C8A83',
      ink: '#0F2A26', inkSoft: '#3A534E',
      inverse: '#0D3B35', onInverse: '#F4FAF8', onInverseSoft: '#B5D2CB',
      accent: '#095C50', accentStrong: '#07483F', accentSoft: '#D4ECE6', accentInk: '#095C50', onAccent: '#FFFFFF',
      accent2: '#F5A78F', onAccent2: '#0F2A26',
    },
    fonts: { heading: gf('Lexend', [500, 600], SANS_DISPLAY), body: gf('Figtree', [400, 500, 600], SANS), mono: systemMono },
    shape: { radius: 14, radiusLarge: 22, buttonRadius: 12 },
    type: { headingWeight: 600, headingTracking: '-0.02em', headingLeading: 1.12, headingCase: 'none', h1Max: 4, bodySize: '1.0625rem', bodyLeading: 1.7 },
    style: { borderWidth: 1, cardBorder: 'solid', shadow: 'soft', button: 'solid', buttonFont: 'body', pattern: 'none', iconStroke: 1.75, iconCap: 'round', link: 'plain', density: 'airy', headingRule: false },
  },
  {
    id: 'kiyi',
    name: 'Kıyı',
    category: 'doga_saglik',
    mode: 'light',
    mood: 'Akdeniz kıyısı: kireç beyazı, Ege mavisi, kiremit tonu ve zarif serif başlıklar — seyahat, yoga, tatil.',
    colors: {
      bg: '#F7F4EE', surface: '#FFFFFF', surface2: '#ECE6DA', border: '#DDD4C3', fieldBorder: '#817A6C',
      ink: '#13283A', inkSoft: '#3C4C5E',
      inverse: '#0F3150', onInverse: '#F7F4EE', onInverseSoft: '#B7C8D8',
      accent: '#0F4C81', accentStrong: '#0B3A63', accentSoft: '#DEE8F2', accentInk: '#0F4C81', onAccent: '#FFFFFF',
      accent2: '#8A4122', onAccent2: '#FFFFFF',
    },
    fonts: { heading: gf('DM Serif Display', [400], SERIF_DISPLAY), body: gf('Instrument Sans', [400, 500, 600], SANS), mono: systemMono },
    shape: { radius: 16, radiusLarge: 28, buttonRadius: 999 },
    type: { headingWeight: 400, headingTracking: '-0.01em', headingLeading: 1.08, headingCase: 'none', h1Max: 4.75, bodySize: '1.0625rem', bodyLeading: 1.7 },
    style: { borderWidth: 1, cardBorder: 'solid', shadow: 'soft', button: 'solid', buttonFont: 'body', pattern: 'none', iconStroke: 1.5, iconCap: 'round', link: 'underline', density: 'airy', headingRule: false },
  },

  // ---------------------------------------------------------------- Yemek & Kafe
  {
    id: 'firin',
    name: 'Fırın',
    category: 'yemek',
    mode: 'light',
    mood: 'Un beyazı ve kremalı tonlar, bitter çikolata metin, kırmızı biber vurgusu ve sıcak, eski usul serif başlıklar.',
    colors: {
      bg: '#FBF3E6', surface: '#FFFAF2', surface2: '#F3E3C9', border: '#E4CDA8', fieldBorder: '#8E7658',
      ink: '#3A2417', inkSoft: '#5C4435',
      inverse: '#3A2417', onInverse: '#FBF3E6', onInverseSoft: '#E0CBB4',
      accent: '#87331A', accentStrong: '#6E2914', accentSoft: '#F6DFCF', accentInk: '#87331A', onAccent: '#FFFFFF',
      accent2: '#4D571C', onAccent2: '#FFFFFF',
    },
    fonts: { heading: gf('Young Serif', [400], SERIF_DISPLAY), body: gf('Work Sans', [400, 500, 600], SANS), mono: systemMono },
    shape: { radius: 12, radiusLarge: 20, buttonRadius: 999 },
    type: { headingWeight: 400, headingTracking: '-0.01em', headingLeading: 1.1, headingCase: 'none', h1Max: 4.5, bodySize: '1.0625rem', bodyLeading: 1.7 },
    style: { borderWidth: 1, cardBorder: 'solid', shadow: 'soft', button: 'solid', buttonFont: 'body', pattern: 'grain', iconStroke: 1.75, iconCap: 'round', link: 'underline', density: 'airy', headingRule: false },
  },
  {
    id: 'bistro',
    name: 'Bistro',
    category: 'yemek',
    mode: 'dark',
    mood: 'Loş ceviz tonları, kehribar ışık, şarap kırmızısı ve dolgun, yüksek kontrastlı başlıklar — akşam restoranı ve bar.',
    colors: {
      bg: '#15100D', surface: '#1D1612', surface2: '#271E18', border: '#3A2D24', fieldBorder: '#857260',
      ink: '#F3E9DC', inkSoft: '#BFAE9B',
      inverse: '#0D0907', onInverse: '#F3E9DC', onInverseSoft: '#BFAE9B',
      accent: '#E3A857', accentStrong: '#EDBB73', accentSoft: '#33251A', accentInk: '#EDB76A', onAccent: '#1A120C',
      accent2: '#7E2A2E', onAccent2: '#F3E9DC',
    },
    fonts: { heading: gf('Rozha One', [400], DIDONE), body: gf('Albert Sans', [400, 500, 600], HUMANIST), mono: systemMono },
    shape: { radius: 6, radiusLarge: 10, buttonRadius: 4 },
    type: { headingWeight: 400, headingTracking: '-0.005em', headingLeading: 1.08, headingCase: 'none', h1Max: 4.75, bodySize: '1.0625rem', bodyLeading: 1.7 },
    style: { borderWidth: 1, cardBorder: 'solid', shadow: 'none', button: 'solid-caps', buttonFont: 'body', pattern: 'grain', iconStroke: 1.5, iconCap: 'round', link: 'underline', density: 'airy', headingRule: false },
  },
  {
    id: 'pazar',
    name: 'Pazar',
    category: 'yemek',
    mode: 'light',
    mood: 'Taze pazar tezgâhı: aydınlık zemin, yaprak yeşili, domates kırmızısı ve tombul, iştah açan retro başlıklar.',
    colors: {
      bg: '#FBFAF4', surface: '#FFFFFF', surface2: '#EFEDDF', border: '#DDD9C4', fieldBorder: '#7F7B66',
      ink: '#1F2316', inkSoft: '#4A503C',
      inverse: '#243119', onInverse: '#FBFAF4', onInverseSoft: '#C6D0B5',
      accent: '#365C19', accentStrong: '#2A4813', accentSoft: '#E3EDD5', accentInk: '#365C19', onAccent: '#FFFFFF',
      accent2: '#9C2A1A', onAccent2: '#FFFFFF',
    },
    fonts: { heading: gf('Caprasimo', [400], SLAB), body: gf('Rubik', [400, 500, 600], SANS), mono: systemMono },
    shape: { radius: 10, radiusLarge: 16, buttonRadius: 999 },
    type: { headingWeight: 400, headingTracking: '-0.01em', headingLeading: 1.05, headingCase: 'none', h1Max: 4.25, bodySize: '1rem', bodyLeading: 1.65 },
    style: { borderWidth: 1, cardBorder: 'solid', shadow: 'crisp', button: 'solid', buttonFont: 'body', pattern: 'none', iconStroke: 2, iconCap: 'round', link: 'underline', density: 'regular', headingRule: false },
  },

  // ---------------------------------------------------------------- Yaratıcı
  {
    id: 'galeri',
    name: 'Galeri',
    category: 'yaratici',
    mode: 'light',
    mood: 'Beyaz küp galeri: bol boşluk, keskin köşeler, iddialı geniş başlıklar ve tek bir Klein mavisi.',
    colors: {
      bg: '#FFFFFF', surface: '#F7F7F5', surface2: '#EDEDEA', border: '#E2E2DE', fieldBorder: '#7A7A75',
      ink: '#0D0D0D', inkSoft: '#4D4D4D',
      inverse: '#0D0D0D', onInverse: '#FFFFFF', onInverseSoft: '#B8B8B8',
      accent: '#002FA7', accentStrong: '#00247F', accentSoft: '#E3E8F7', accentInk: '#002FA7', onAccent: '#FFFFFF',
      accent2: '#0D0D0D', onAccent2: '#FFFFFF',
    },
    fonts: { heading: gf('Syne', [700, 800], GEOMETRIC), body: gf('Instrument Sans', [400, 500, 600], SANS), mono: systemMono },
    shape: { radius: 0, radiusLarge: 0, buttonRadius: 0 },
    type: { headingWeight: 700, headingTracking: '-0.04em', headingLeading: 1.0, headingCase: 'none', h1Max: 4.25, bodySize: '1rem', bodyLeading: 1.6 },
    style: { borderWidth: 1, cardBorder: 'solid', shadow: 'none', button: 'solid', buttonFont: 'body', pattern: 'none', iconStroke: 1.5, iconCap: 'square', link: 'underline', density: 'airy', headingRule: false },
  },
  {
    id: 'dergi',
    name: 'Dergi',
    category: 'yaratici',
    mode: 'light',
    mood: 'Gazete kâğıdı zemin, klasik Caslon başlıklar, serif gövde metni, bölüm çizgileri ve editoryal kırmızı.',
    colors: {
      bg: '#F6F2E9', surface: '#FBF8F1', surface2: '#ECE6D8', border: '#D6CDB8', fieldBorder: '#827A66',
      ink: '#151412', inkSoft: '#45423C',
      inverse: '#151412', onInverse: '#F6F2E9', onInverseSoft: '#C8C1B2',
      accent: '#951D17', accentStrong: '#7A1712', accentSoft: '#F4DEDA', accentInk: '#951D17', onAccent: '#FFFFFF',
      accent2: '#151412', onAccent2: '#F6F2E9',
    },
    fonts: { heading: gf('Libre Caslon Display', [400], SERIF_DISPLAY), body: gf('Source Serif 4', [400, 600], SERIF_TEXT), mono: systemMono },
    shape: { radius: 0, radiusLarge: 0, buttonRadius: 0 },
    type: { headingWeight: 400, headingTracking: '-0.015em', headingLeading: 1.05, headingCase: 'none', h1Max: 5, bodySize: '1.125rem', bodyLeading: 1.7 },
    style: { borderWidth: 1, cardBorder: 'solid', shadow: 'none', button: 'solid-caps', buttonFont: 'body', pattern: 'none', iconStroke: 1.25, iconCap: 'square', link: 'underline', density: 'regular', headingRule: true },
  },
  {
    id: 'atolye',
    name: 'Atölye',
    category: 'yaratici',
    mode: 'dark',
    mood: 'Kömür grisi stüdyo: geniş ve iddialı başlıklar, safran sarısı butonlar, cıva kırmızısı ikinci vurgu.',
    colors: {
      bg: '#121212', surface: '#1A1A1A', surface2: '#232323', border: '#333333', fieldBorder: '#777777',
      ink: '#F2F0EB', inkSoft: '#B3B0A8',
      inverse: '#0A0A0A', onInverse: '#F2F0EB', onInverseSoft: '#B3B0A8',
      accent: '#FFB000', accentStrong: '#FFC233', accentSoft: '#2B2412', accentInk: '#FFC233', onAccent: '#121212',
      accent2: '#FF7B5C', onAccent2: '#121212',
    },
    fonts: { heading: gf('Unbounded', [500, 600], GEOMETRIC), body: gf('Manrope', [400, 500, 600], SANS), mono: systemMono },
    shape: { radius: 4, radiusLarge: 8, buttonRadius: 999 },
    type: { headingWeight: 600, headingTracking: '-0.03em', headingLeading: 1.02, headingCase: 'none', h1Max: 3.75, bodySize: '1rem', bodyLeading: 1.65 },
    style: { borderWidth: 1, cardBorder: 'solid', shadow: 'none', button: 'solid', buttonFont: 'heading', pattern: 'none', iconStroke: 1.75, iconCap: 'round', link: 'underline', density: 'airy', headingRule: false },
  },

  // ---------------------------------------------------------------- Genel
  {
    id: 'kum',
    name: 'Kum',
    category: 'genel',
    mode: 'light',
    mood: 'Sıcak kum tonları, dengeli grotesk harfler ve kararlı kobalt — hemen her konuya yakışan sade bir modern tasarım.',
    colors: {
      bg: '#F7F5F0', surface: '#FFFFFF', surface2: '#EEEAE2', border: '#DED8CC', fieldBorder: '#857E71',
      ink: '#1F1D1A', inkSoft: '#4E4A44',
      inverse: '#1F1D1A', onInverse: '#F7F5F0', onInverseSoft: '#C9C3B8',
      accent: '#2745B8', accentStrong: '#1E3690', accentSoft: '#E3E8F7', accentInk: '#2745B8', onAccent: '#FFFFFF',
      accent2: '#8F3F1F', onAccent2: '#FFFFFF',
    },
    fonts: { heading: gf('Epilogue', [700], SANS_DISPLAY), body: gf('Epilogue', [400, 500], SANS), mono: systemMono },
    shape: { radius: 10, radiusLarge: 16, buttonRadius: 10 },
    type: { headingWeight: 700, headingTracking: '-0.03em', headingLeading: 1.05, headingCase: 'none', h1Max: 4.25, bodySize: '1rem', bodyLeading: 1.65 },
    style: { borderWidth: 1, cardBorder: 'solid', shadow: 'soft', button: 'solid', buttonFont: 'body', pattern: 'none', iconStroke: 1.75, iconCap: 'round', link: 'underline', density: 'regular', headingRule: false },
  },
  {
    id: 'sis',
    name: 'Sis',
    category: 'genel',
    mode: 'light',
    mood: 'İskandinav sakinliği: serin açık griler, arduvaz mavisi, kil tonu, bol hava ve yumuşak, dostça harfler.',
    colors: {
      bg: '#F3F5F6', surface: '#FFFFFF', surface2: '#E6EAEC', border: '#D3DADE', fieldBorder: '#76838B',
      ink: '#1B2328', inkSoft: '#424E55',
      inverse: '#26323A', onInverse: '#F3F5F6', onInverseSoft: '#BAC5CC',
      accent: '#35536F', accentStrong: '#2A4259', accentSoft: '#E0E8EF', accentInk: '#35536F', onAccent: '#FFFFFF',
      accent2: '#7A4B30', onAccent2: '#FFFFFF',
    },
    fonts: { heading: gf('Nunito Sans', [600, 700], SANS_DISPLAY), body: gf('Nunito Sans', [400, 600], SANS), mono: systemMono },
    shape: { radius: 8, radiusLarge: 12, buttonRadius: 8 },
    type: { headingWeight: 600, headingTracking: '-0.02em', headingLeading: 1.12, headingCase: 'none', h1Max: 4, bodySize: '1.0625rem', bodyLeading: 1.7 },
    style: { borderWidth: 1, cardBorder: 'solid', shadow: 'soft', button: 'solid', buttonFont: 'body', pattern: 'none', iconStroke: 1.5, iconCap: 'round', link: 'plain', density: 'airy', headingRule: false },
  },
  {
    id: 'gece',
    name: 'Gece',
    category: 'genel',
    mode: 'dark',
    mood: 'Grafit gecesi: yumuşak beyaz metin, sıcak mercan butonlar ve gök mavisi ikinci vurgu — göz yormayan koyu tasarım.',
    colors: {
      bg: '#111315', surface: '#181B1E', surface2: '#202428', border: '#2F3439', fieldBorder: '#6E757D',
      ink: '#EDEEEF', inkSoft: '#A9AFB6',
      inverse: '#0A0B0C', onInverse: '#EDEEEF', onInverseSoft: '#A9AFB6',
      accent: '#FF8A65', accentStrong: '#FF9E7F', accentSoft: '#2E211C', accentInk: '#FF9B7A', onAccent: '#111315',
      accent2: '#7CC4FF', onAccent2: '#111315',
    },
    fonts: { heading: gf('Hanken Grotesk', [700], SANS_DISPLAY), body: gf('Hanken Grotesk', [400, 500], SANS), mono: systemMono },
    shape: { radius: 12, radiusLarge: 18, buttonRadius: 999 },
    type: { headingWeight: 700, headingTracking: '-0.03em', headingLeading: 1.05, headingCase: 'none', h1Max: 4.25, bodySize: '1rem', bodyLeading: 1.65 },
    style: { borderWidth: 1, cardBorder: 'solid', shadow: 'none', button: 'solid', buttonFont: 'body', pattern: 'none', iconStroke: 1.75, iconCap: 'round', link: 'underline', density: 'regular', headingRule: false },
  },
];

/** Used when the theme is off but the base stylesheet is on: calm defaults, system fonts only. */
export const NEUTRAL_THEME: ThemeDefinition = {
  ...THEMES.find((t) => t.id === 'kum')!,
  id: 'notr',
  name: 'Nötr',
  mood: 'Tema kapalıyken kullanılan sade varsayılanlar.',
  fonts: { heading: gf('', [], SANS_DISPLAY), body: gf('', [], SANS), mono: systemMono },
};

/** [foreground role, background role, minimum ratio] pairs every theme must pass. */
export const THEME_CONTRAST_PAIRS: Array<[keyof ThemeColors, keyof ThemeColors, number]> = [
  ['ink', 'bg', 7],
  ['ink', 'surface', 7],
  ['ink', 'surface2', 7],
  ['ink', 'accentSoft', 7],
  ['inkSoft', 'bg', 7],
  ['inkSoft', 'surface', 7],
  ['inkSoft', 'surface2', 7],
  ['onInverse', 'inverse', 7],
  ['onInverseSoft', 'inverse', 7],
  ['accentInk', 'bg', 7],
  ['accentInk', 'surface', 7],
  ['accentInk', 'accentSoft', 4.5],
  ['onAccent', 'accent', 7],
  ['onAccent', 'accentStrong', 7],
  ['onAccent2', 'accent2', 7],
  ['fieldBorder', 'surface', 3],
];

export function getTheme(id: string | null | undefined): ThemeDefinition | undefined {
  return THEMES.find((t) => t.id === id);
}

export function themesInCategory(category: DesignCategory): ThemeDefinition[] {
  return THEMES.filter((t) => t.category === category);
}

export function categoryLabel(category: DesignCategory): string {
  return DESIGN_CATEGORIES.find((c) => c.id === category)?.label || category;
}

/**
 * Picks a theme of the category (random among the fitting ones). `mode` restricts to light or
 * dark themes when the request asked for one; `avoid` skips the previously used theme so two
 * sites in a row do not look the same.
 */
export function pickTheme(
  category: DesignCategory,
  options: { mode?: 'light' | 'dark' | null; avoid?: string | null; random?: () => number } = {}
): ThemeDefinition {
  const random = options.random || Math.random;
  let pool = themesInCategory(category);
  if (options.mode) {
    const byMode = pool.filter((t) => t.mode === options.mode);
    if (byMode.length > 0) pool = byMode;
    else {
      const anyMode = THEMES.filter((t) => t.mode === options.mode);
      if (anyMode.length > 0) pool = anyMode;
    }
  }
  if (options.avoid && pool.length > 1) pool = pool.filter((t) => t.id !== options.avoid);
  return pool[Math.floor(random() * pool.length) % pool.length];
}
