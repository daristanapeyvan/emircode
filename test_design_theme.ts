/**
 * test_design_theme.ts
 * Design themes for generated web pages: theme quality (WCAG AAA text contrast), color/font
 * mapping, page fixes (theme link, viewport, copyright year, emoji icons), when the feature
 * turns on, topic detection and the end-of-run file changes.
 *
 * Run: node scripts/run-ts-test.mjs test_design_theme.ts
 */
import { parseColor, contrastRatio, toOklch } from './src/lib/design/color';
import { THEMES, THEME_CONTRAST_PAIRS, DESIGN_CATEGORIES, getTheme, pickTheme } from './src/lib/design/themes';
import { buildThemeCss, readThemeMarker, googleFontsUrl, isThemeAsset, THEME_FILE } from './src/lib/design/themeCss';
import { ThemeRewriter } from './src/lib/design/cssRewrite';
import {
  tokenizeHtml,
  joinTokens,
  injectThemeLink,
  ensureViewport,
  fixCopyrightYears,
  replaceEmojiIcons,
  relativeHref,
} from './src/lib/design/html';
import { ICON_PATHS, EMOJI_TO_ICON } from './src/lib/design/icons';
import { categorizeByKeywords, parseCategoryAnswer, buildCategoryPrompt, CATEGORY_SCHEMA } from './src/lib/design/categorize';
import {
  planDesignTheme,
  needsModelCategory,
  resolvePlanTheme,
  applyDesign,
  userGaveColors,
  modePreference,
  DesignPlan,
} from './src/lib/design/DesignTheme';
import { DEFAULT_SETTINGS } from './src/types/settings';

let passed = 0;
const failures: string[] = [];

function check(condition: boolean, message: string, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`✅ ${message}`);
  } else {
    failures.push(message);
    console.error(`❌ ${message}${detail !== undefined ? `\n   → ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  }
}

function section(title: string) {
  console.log(`\n--- ${title} ---`);
}

const PAGE = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <title>Kahve Durağı</title>
  <style>
    body { font-family: Arial, sans-serif; background-color: #f4f4f4; }
    .topnav { background-color: #333; overflow: hidden; }
    .topnav a { color: #f2f2f2; float: left; padding: 14px 16px; }
    .topnav a:hover { background-color: #ddd; color: black; }
    .hero { background-color: #4CAF50; color: white; padding: 60px 20px; }
    .button { background-color: #4CAF50; color: white; border: none; }
    .button:hover { background-color: #45a049; }
    .card { background: white; box-shadow: 0 2px 5px rgba(0,0,0,0.1); border: 1px solid #ddd; }
    .card p { color: #666; }
    footer { background-color: #333; color: #aaa; }
    footer p { color: #ccc; }
    h1, h2 { font-family: Georgia, serif; }
  </style>
</head>
<body>
  <div class="topnav"><a href="#">Ana Sayfa</a></div>
  <div class="hero"><h1>Hoş Geldiniz</h1><button class="button">Menü</button></div>
  <div class="card"><div class="icon">☕</div><p>📍 Kadıköy</p></div>
  <select><option>🍕 Pizza</option></select>
  <p>Puan: ⭐⭐⭐⭐⭐</p>
  <script>const y = "© 2023";</script>
  <footer><p>&copy; 2023 Kahve Durağı. Tüm hakları saklıdır.</p></footer>
</body>
</html>`;

const plan = (over: Partial<DesignPlan> = {}): DesignPlan => ({
  kind: 'new', theme: true, base: true, webFonts: true, fonts: true, icons: true, modePreference: null, web: true,
  category: 'yemek', categorySource: 'fixed', themeId: 'orman', mode: null, ...over,
});

async function run() {
  // =====================================================================
  section('1. Themes: variety and WCAG AAA contrast');
  // =====================================================================
  check(parseColor('#4CAF50')?.g === 175 && parseColor('rgb(10 20 30 / 50%)')?.a === 0.5, 'Colors parse (hex, space-separated rgb with alpha)');
  check(parseColor('white')?.r === 255 && parseColor('transparent')?.a === 0 && parseColor('var(--x)') === null, 'Named colors, transparent and non-colors');
  check(Math.round(contrastRatio('#000', '#fff')) === 21 && toOklch(parseColor('#808080')!).C < 0.01, 'Contrast and OKLCH basics');
  check(THEMES.length >= 24 && new Set(THEMES.map((t) => t.id)).size === THEMES.length, `${THEMES.length} themes with unique ids`);
  for (const cat of DESIGN_CATEGORIES) {
    check(THEMES.filter((t) => t.category === cat.id).length >= 3, `Category "${cat.id}" has 3+ themes`);
  }
  const lowPairs: string[] = [];
  for (const t of THEMES) {
    for (const [fg, bg, min] of THEME_CONTRAST_PAIRS) {
      const ratio = contrastRatio(t.colors[fg], t.colors[bg]);
      if (ratio < min) lowPairs.push(`${t.id}: ${fg}/${bg} ${ratio.toFixed(2)} < ${min}`);
    }
  }
  check(lowPairs.length === 0, 'Every theme meets its contrast targets (text 7:1 = AAA)', lowPairs);
  check(new Set(THEMES.map((t) => `${t.fonts.heading.family}/${t.fonts.body.family}`)).size >= 20, 'Themes use distinct type pairings');
  const url = googleFontsUrl(getTheme('grafit')!);
  check(!!url && (url.match(/family=Archivo/g) || []).length === 1 && url.includes('wght@400;500;600;700;800'), 'Google Fonts URL merges one family used twice', url);
  check(googleFontsUrl(getTheme('porselen')!)!.includes('family=Instrument+Serif&'), 'Single-weight fonts are requested without an axis');

  // =====================================================================
  section('2. Theme stylesheet');
  // =====================================================================
  const css = buildThemeCss(getTheme('orman')!, { base: true, webFonts: true, fonts: true });
  check(readThemeMarker(css)?.id === 'orman' && readThemeMarker(css)?.mode === 'light', 'Marker identifies the theme');
  check(css.includes('@import url("https://fonts.googleapis.com/css2?family=Fraunces'), 'Web fonts imported');
  check(css.includes(':where(button,') && css.includes('--theme-accent: #255239;'), 'Base components and tokens present');
  const noWeb = buildThemeCss(getTheme('orman')!, { base: false, webFonts: false, fonts: true });
  check(!noWeb.includes('@import') && !noWeb.includes(':where(button,') && noWeb.includes('--theme-font-heading: Fraunces, "Sitka Heading"'), 'Web fonts / base layer can be turned off (system fallback kept)');
  const ownFonts = buildThemeCss(getTheme('orman')!, { base: true, webFonts: true, fonts: false });
  check(!ownFonts.includes('@import') && ownFonts.includes('--theme-font-body: inherit;'), 'User-chosen fonts: the theme leaves font families alone');
  const selectors = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/^[^{}@\n][^{}]*\{/gm) || [];
  const unscoped = selectors.filter((s) => !/^\s*(?::root|:where|::selection|::placeholder|\*)/.test(s.trim()) && !/^\s*--/.test(s));
  check(unscoped.length === 0, 'Every theme rule has zero specificity (the page always wins)', unscoped);

  // =====================================================================
  section('3. Mapping the page colors and fonts to theme roles');
  // =====================================================================
  const rw = new ThemeRewriter({ mode: 'light', colors: true, fonts: true });
  rw.collectHtml(PAGE);
  const out = rw.rewriteHtml(PAGE);
  const has = (s: string) => out.includes(s);
  check(has('.topnav { background-color: var(--theme-inverse, #333);'), 'Dark navbar -> inverse band');
  check(has('.topnav a { color: var(--theme-on-inverse, #f2f2f2);'), 'Light text inside the navbar -> on-inverse (ancestor band)');
  check(has('.topnav a:hover { background-color: var(--theme-surface-2, #ddd); color: var(--theme-ink, black); }'), 'Hover panel and its dark text');
  check(has('.hero { background-color: var(--theme-accent, #4CAF50); color: var(--theme-on-accent, white);'), 'Accent section and the text on it');
  check(has('.button:hover { background-color: var(--theme-accent-strong, #45a049); }'), 'Accent hover -> accent-strong');
  check(has('background: var(--theme-surface, white);') && has('rgba(0,0,0,0.1)'), 'White card -> surface; black shadow untouched');
  check(has('border: 1px solid var(--theme-border, #ddd)') && has('.card p { color: var(--theme-ink-soft, #666); }'), 'Hairline border and muted text');
  check(has('footer { background-color: var(--theme-inverse, #333); color: var(--theme-on-inverse-soft, #aaa);'), 'Footer band with muted light text');
  check(
    has('color: var(--theme-on-inverse-soft, #aaa); --theme-ink: var(--theme-on-inverse); --theme-ink-soft: var(--theme-on-inverse-soft);') &&
      /\.hero \{[^}]*--theme-ink-soft: var\(--theme-on-accent\);/.test(out) &&
      /\.card \{[^}]*--theme-ink: var\(--theme-ink-base\);/.test(out) &&
      !/:hover \{[^}]*--theme-ink\s*:/.test(out),
    'Bands re-point the text colors inside them (dark bar, accent section, white card; not hover states)'
  );
  check(has('footer p { color: var(--theme-on-inverse-soft, #ccc); }'), 'Footer paragraphs stay readable on the dark band');
  check(has('font-family: var(--theme-font-body, Arial, sans-serif)') && has('h1, h2 { font-family: var(--theme-font-heading, Georgia, serif); }'), 'Generic fonts -> theme body / heading fonts');
  check(rw.rewriteHtml(out) === out, 'Rewriting again changes nothing (idempotent)');

  const vars = new ThemeRewriter({ mode: 'light', colors: true, fonts: true });
  const varCss = `:root { --primary-color: #667eea; --text-color: #333; }
.hero { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; }
.featured { background: var(--primary-color); }
.featured .price span { color: #999; }
.pill { background: rgba(102, 126, 234, 0.15); }
.btn { background: white; color: var(--primary-color); }
.footer { background: var(--text-color); }`;
  vars.collectCss(varCss);
  const varOut = vars.rewriteCss(varCss);
  check(varOut.includes('--primary-color: var(--theme-accent, #667eea)') && varOut.includes('--text-color: var(--theme-ink, #333)'), 'Custom properties mapped by their value', varOut);
  check(varOut.includes('linear-gradient(135deg, var(--theme-accent, #667eea) 0%, var(--theme-accent-strong, #764ba2) 100%)'), 'Purple gradient -> theme accent gradient');
  check(varOut.includes('.featured .price span { color: var(--theme-on-accent, #999); }'), 'var() background resolves: text on it becomes on-accent', varOut);
  check(varOut.includes('color-mix(in srgb, var(--theme-accent, rgba(102, 126, 234, 0.15)) 15%, transparent)'), 'Translucent accent tint keeps its alpha');
  check(varOut.includes('.btn { background: var(--theme-surface, white); color: var(--theme-accent-ink, var(--primary-color));'), 'Page variable used as text -> text-safe accent', varOut);
  check(varOut.includes('.footer { background: var(--theme-inverse, var(--text-color));') && vars.rewriteCss(varOut) === varOut, 'Page variable used as a band -> inverse; idempotent');
  check(/\.featured \{[^}]*--theme-ink-soft: var\(--theme-on-accent\);/.test(varOut), 'Colored card from a page variable re-points muted text inside it', varOut);

  const sticky = new ThemeRewriter({ mode: 'light', colors: false, fonts: false });
  const stickyCss = `.navbar { position: sticky; top: 0; background: white; }\n.modal { position: fixed; z-index: 2000; }\n.hero p { opacity: 0.9; }\n`;
  sticky.collectCss(stickyCss);
  const stickyOut = sticky.rewriteCss(stickyCss);
  check(
    stickyOut.includes('.navbar { position: sticky; top: 0; background: white; z-index: 100; }') &&
      stickyOut.includes('.modal { position: fixed; z-index: 2000; }') &&
      stickyOut.endsWith('html { scroll-padding-top: 5rem; }\n') &&
      sticky.rewriteCss(stickyOut) === stickyOut,
    'Sticky bar without z-index is kept above later content; anchors leave room for it (colors untouched)',
    stickyOut
  );

  const dark = new ThemeRewriter({ mode: 'dark', colors: true, fonts: false });
  const darkCss = `body { background: #fff; color: #333; } .card { background: #f9f9f9; } .muted { color: #777; }`;
  dark.collectCss(darkCss);
  const darkOut = dark.rewriteCss(darkCss);
  check(darkOut.includes('body { background: var(--theme-bg, #fff); color: var(--theme-ink, #333); }') && darkOut.includes('var(--theme-surface, #f9f9f9)') && darkOut.includes('var(--theme-ink-soft, #777)'), 'Dark themes turn a light page dark', darkOut);

  // =====================================================================
  section('4. Page fixes: link, viewport, copyright year, emoji icons');
  // =====================================================================
  check(joinTokens(tokenizeHtml(PAGE)) === PAGE, 'Tokenizer is loss-free');
  const linked = injectThemeLink(PAGE, 'theme/theme.css');
  check(linked.indexOf('theme/theme.css') < linked.indexOf('<style>') && injectThemeLink(linked, 'theme/theme.css') === linked, 'Theme link goes before the page styles, once');
  check(relativeHref('pages/about.html', THEME_FILE) === '../theme/theme.css' && relativeHref('index.html', THEME_FILE) === 'theme/theme.css', 'Relative link from sub folders');
  const vp = ensureViewport(PAGE);
  check(/charset="UTF-8">\n  <meta name="viewport"/.test(vp) && ensureViewport(vp) === vp, 'Viewport meta added after charset, once');
  check(injectThemeLink('<p>parça</p>', 'theme/theme.css') === '<p>parça</p>', 'Fragments without <head> are left alone');

  const years = fixCopyrightYears(PAGE, 2026);
  check(years.includes('&copy; 2026 Kahve Durağı') && years.includes('const y = "© 2023"'), 'Footer year updated, scripts untouched');
  check(fixCopyrightYears('<footer>2019 - 2023 © Firma</footer>', 2026) === '<footer>2019 - 2026 © Firma</footer>', 'Year ranges keep their start');
  check(fixCopyrightYears('<p>2023 © Firma</p>', 2026) === '<p>2026 © Firma</p>', 'Year before the sign');
  check(fixCopyrightYears('<p>2022 Firma. Tüm hakları saklıdır.</p>', 2026) === '<p>2026 Firma. Tüm hakları saklıdır.</p>', '"Tüm hakları saklıdır" without a sign');
  check(fixCopyrightYears('<p>1998’den beri · Tel: 0212 2023 55 55</p>', 2026) === '<p>1998’den beri · Tel: 0212 2023 55 55</p>', 'Other years and numbers are not touched');
  check(fixCopyrightYears('<p>© 2026 Firma</p>', 2026) === '<p>© 2026 Firma</p>', 'Current year stays');

  const icons = replaceEmojiIcons(PAGE);
  check(icons.replaced === 2, 'Two icon emoji replaced', icons.replaced);
  check(icons.html.includes('<div class="icon"><svg class="ti ti-solo"') && icons.html.includes('<p><svg class="ti" viewBox'), 'Lone emoji -> solo icon, inline emoji -> inline icon');
  check(icons.html.includes('<option>🍕 Pizza</option>') && icons.html.includes('⭐⭐⭐⭐⭐') && icons.html.includes('&copy;'), 'Options, rating runs and © stay as they are');
  check(Object.keys(ICON_PATHS).length >= 150 && Object.values(EMOJI_TO_ICON).every((n) => ICON_PATHS[n]), 'Icon set complete (every emoji maps to an icon)');

  // =====================================================================
  section('5. When the theme turns on');
  // =====================================================================
  const cfg = DEFAULT_SETTINGS.designTheme;
  const base = { projectFiles: [] as string[], config: cfg, modelSizeB: 7.6, existingThemeCss: null };
  const cafe = planDesignTheme({ ...base, goal: 'Bir kafe için web sitesi yap' });
  check(!!cafe && cafe.kind === 'new' && cafe.theme && cafe.base && cafe.category === 'yemek' && cafe.categorySource === 'keywords', 'New cafe site: theme by keywords', cafe);
  check(!needsModelCategory(cafe), 'Clear topic needs no model call');
  const unclear = planDesignTheme({ ...base, goal: 'Ahmet için bir web sitesi oluştur' });
  check(!!unclear && needsModelCategory(unclear), 'Unclear topic asks the model');
  check(planDesignTheme({ ...base, goal: 'kafe sitesi', projectFiles: ['index.html'] }) === null, 'Existing sites keep their design');
  check(planDesignTheme({ ...base, goal: 'React ile kafe sitesi' }) === null, 'Framework projects are skipped');
  check(planDesignTheme({ ...base, goal: 'tek dosya halinde kafe sitesi' }) === null, 'Explicit single-file requests are skipped');
  const blue = planDesignTheme({ ...base, goal: 'Mavi tonlarında bir kafe sitesi' });
  check(!!blue && !blue.theme && blue.base, 'Own colors: no palette, base layer only', blue);
  check(userGaveColors('butonlar #ff0000 olsun') && !userGaveColors('Mavi Kafe için site') && !userGaveColors('koyu tema bir site'), 'Color requests vs business names vs dark mode');
  check(modePreference('koyu temalı bir portfolyo') === 'dark' && modePreference('portfolyo') === null, 'Dark-mode wish detected');
  check(planDesignTheme({ ...base, goal: 'kafe sitesi', config: { ...cfg, mode: 'off', baseCss: 'off' } }) === null, 'Everything off = no plan');
  check(planDesignTheme({ ...base, goal: 'kafe sitesi', config: { ...cfg, mode: 'off' }, modelSizeB: 14 }) === null, 'Theme off + big model (automatic base off) = no plan');
  const fixed = planDesignTheme({ ...base, goal: 'site yap', config: { ...cfg, mode: 'fixed', fixedThemeId: 'dergi' } });
  check(fixed?.themeId === 'dergi', 'Fixed theme');
  const cont = planDesignTheme({ ...base, goal: 'iletişim sayfası ekle', projectFiles: ['index.html', 'theme/theme.css'], existingThemeCss: css });
  check(cont?.kind === 'continue' && cont.themeId === 'orman' && cont.mode === 'light', 'Themed project: follow-ups continue the theme');
  check(planDesignTheme({ ...base, goal: 'site yap', existingThemeCss: 'body{}' }) === null, 'A theme.css we did not write is never touched');
  check(isThemeAsset('theme/theme.css') && !isThemeAsset('css/theme.css'), 'Theme asset path');

  // =====================================================================
  section('6. Topic detection');
  // =====================================================================
  const kw = (g: string) => categorizeByKeywords(g).category;
  check(kw('Kadıköy’de bir kafe için site') === 'yemek' && kw('Avukatlık bürosu sitesi') === 'kurumsal', 'Food and law');
  check(kw('Diş kliniği için web sayfası') === 'doga_saglik' && kw('Fotoğrafçı portfolyosu') === 'yaratici', 'Clinic and portfolio');
  check(kw('Yapay zeka girişimi için landing page') === 'teknoloji' && kw('Mücevher butiği') === 'luks', 'Tech and luxury');
  check(kw('mobil uyumlu bir site') === null && kw('kampanya sayfası') === null, 'No false hits on "mobil uyumlu" / "kampanya"');
  check(categorizeByKeywords('çocuklar için oyun alanı olan bir kafe').matches.length >= 2, 'Several topics -> ambiguous (model decides)');
  check(parseCategoryAnswer('{"category":"luks"}') === 'luks' && parseCategoryAnswer('kategori: yemek') === 'yemek' && parseCategoryAnswer('???') === null, 'Model answers parsed');
  check(buildCategoryPrompt('x').length < 1200 && CATEGORY_SCHEMA.properties.category.enum.length === 8, 'Classification prompt stays small, answer is constrained');
  const p = plan({ themeId: null, category: 'yemek' });
  resolvePlanTheme(p, null, 'keywords', () => 0);
  check(getTheme(p.themeId)?.category === 'yemek', 'Theme picked inside the category');
  check(pickTheme('yemek', { mode: 'dark', random: () => 0 }).mode === 'dark', 'Dark wish picks a dark theme');

  // =====================================================================
  section('7. End of run: file changes');
  // =====================================================================
  const result = applyDesign({ plan: plan(), files: [{ path: 'index.html', content: PAGE }], themeCss: null, year: 2026 });
  const page = result.changes.find((c) => c.path === 'index.html')?.after || '';
  const themeFile = result.changes.find((c) => c.path === THEME_FILE);
  check(result.createdThemeFile && !!themeFile && themeFile.before === null && result.changes[0].path === THEME_FILE, 'theme/theme.css created first');
  check(page.includes('href="theme/theme.css"') && page.includes('var(--theme-accent, #4CAF50)') && page.includes('class="ti ti-solo"'), 'Page linked, recolored and given icons');
  check(page.includes('&copy; 2026') && page.includes('name="viewport"') && result.icons === 2, 'Year and viewport fixed');

  const fixesOnly = applyDesign({ plan: null, files: [{ path: 'index.html', content: PAGE }, { path: 'app.py', content: 'print(1)' }], themeCss: null, year: 2026 });
  check(fixesOnly.changes.length === 1 && !fixesOnly.theme && !fixesOnly.changes[0].after.includes('theme.css') && fixesOnly.changes[0].after.includes('&copy; 2026'), 'Theme off: only the year/viewport fixes');
  const noHtml = applyDesign({ plan: plan(), files: [{ path: 'main.py', content: 'print(1)' }], themeCss: null, year: 2026 });
  check(noHtml.changes.length === 0, 'No page written -> nothing to theme');
  const follow = applyDesign({
    plan: plan({ kind: 'continue', themeId: 'orman', mode: 'light' }),
    files: [{ path: 'pages/iletisim.html', content: PAGE }],
    themeCss: css,
    year: 2026,
  });
  check(!follow.createdThemeFile && follow.changes.length === 1 && follow.changes[0].after.includes('href="../theme/theme.css"'), 'Follow-up page joins the existing theme');
  const foreign = applyDesign({ plan: plan(), files: [{ path: 'index.html', content: PAGE }], themeCss: 'body{}', year: 2026 });
  check(!foreign.theme && !foreign.changes.some((c) => c.path === THEME_FILE), 'Foreign theme.css: page fixes only');

  console.log(`\n===========================================`);
  if (failures.length > 0) {
    console.error(`❌ ${failures.length} FAILED, ${passed} passed`);
    failures.forEach((f) => console.error(`   - ${f}`));
    process.exit(1);
  }
  console.log(`🎉 ALL ${passed} DESIGN THEME TESTS PASSED`);
  console.log(`===========================================`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
