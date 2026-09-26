/**
 * siteWizard.ts — the "Website Oluştur" wizard: data model, smart defaults and the compiler that
 * turns the answers into the request the agent works best with.
 *
 * The request is built by the app, not by the model: an explicit file plan, the sections of every
 * page in order with their anchors, the user's own texts as ready HTML fragments, contact data,
 * the interactive features and a short quality bar. Multi-page sites get one checklist item per
 * page; the chosen design theme is passed to the run directly (no topic question to the model).
 */
import { DesignCategory, DESIGN_CATEGORIES, getTheme, categoryLabel } from '../design/themes';
import { categorizeByKeywords } from '../design/categorize';
import type { DesignOverride } from '../design/DesignTheme';
import { markdownToHtml, markdownTextLength } from './markdown';

export type WizardMode = 'simple' | 'detailed';
export type SiteLanguage = 'tr' | 'en';
export type Tone = 'samimi' | 'profesyonel' | 'eglenceli' | 'zarif' | 'sade';
export type ImageStyle = 'placeholders' | 'photos';
export type SectionKind =
  | 'hero' | 'about' | 'services' | 'menu' | 'products' | 'features' | 'gallery' | 'pricing'
  | 'testimonials' | 'team' | 'faq' | 'stats' | 'blog' | 'contact' | 'cta' | 'custom';
export type FeatureKey =
  | 'contactForm' | 'mobileMenu' | 'smoothScroll' | 'faqAccordion' | 'backToTop' | 'revealAnimations'
  | 'darkModeToggle' | 'whatsappButton' | 'mapEmbed' | 'galleryLightbox' | 'newsletter';

export interface WizardSection {
  id: string;
  kind: SectionKind;
  /** Optional heading chosen by the user. */
  title: string;
  /** The user's own text (Markdown); empty = the agent writes it. */
  content: string;
  /** Extra wishes for this section. */
  notes: string;
}

export interface WizardPage {
  id: string;
  name: string;
  sections: WizardSection[];
}

export interface WizardContact {
  address: string;
  phone: string;
  email: string;
  hours: string;
  whatsapp: string;
  instagram: string;
  facebook: string;
  x: string;
  linkedin: string;
  youtube: string;
}

export interface SiteWizardData {
  mode: WizardMode;
  siteName: string;
  siteType: string;
  description: string;
  slogan: string;
  audience: string;
  language: SiteLanguage;
  tone: Tone;
  /** 'auto' = from the site type and description. */
  category: DesignCategory | 'auto';
  /** 'auto' (by topic), 'none' (the model's own design) or a theme id. */
  theme: string;
  colorMode: 'auto' | 'light' | 'dark';
  multiPage: boolean;
  pages: WizardPage[];
  /** The user changed pages/sections by hand: topic changes no longer reset them. */
  pagesTouched: boolean;
  contact: WizardContact;
  features: Record<FeatureKey, boolean>;
  images: ImageStyle;
  seoTitle: string;
  seoDescription: string;
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

interface SectionInfo {
  tr: string;
  en: string;
  anchorTr: string;
  anchorEn: string;
  /** What the agent writes when the user leaves the text empty. */
  guideTr: string;
  guideEn: string;
  /** Linked from the menu of a one-page site. */
  inMenu: boolean;
}

export const SECTION_KINDS: SectionKind[] = [
  'hero', 'about', 'services', 'menu', 'products', 'features', 'gallery', 'pricing',
  'testimonials', 'team', 'faq', 'stats', 'blog', 'contact', 'cta', 'custom',
];

export const SECTION_INFO: Record<SectionKind, SectionInfo> = {
  hero: {
    tr: 'Karşılama', en: 'Hero', anchorTr: 'giris', anchorEn: 'home', inMenu: false,
    guideTr: 'büyük bir başlık, bir iki cümlelik güçlü bir açıklama ve ana eylem butonu',
    guideEn: 'a large headline, one or two strong sentences and the main call-to-action button',
  },
  about: {
    tr: 'Hakkımızda', en: 'About', anchorTr: 'hakkimizda', anchorEn: 'about', inMenu: true,
    guideTr: 'hikâye, değerler ve farkı anlatan iki üç kısa paragraf',
    guideEn: 'two or three short paragraphs on the story, values and what makes it different',
  },
  services: {
    tr: 'Hizmetler', en: 'Services', anchorTr: 'hizmetler', anchorEn: 'services', inMenu: true,
    guideTr: '3-6 hizmet kartı; her birinde başlık, kısa açıklama ve simge',
    guideEn: '3-6 service cards, each with a title, a short description and an icon',
  },
  menu: {
    tr: 'Menü', en: 'Menu', anchorTr: 'menu', anchorEn: 'menu', inMenu: true,
    guideTr: 'kategorilere ayrılmış ürünler; her ürün için ad, kısa açıklama ve fiyat (₺)',
    guideEn: 'items grouped by category, each with a name, a short description and a price',
  },
  products: {
    tr: 'Ürünler', en: 'Products', anchorTr: 'urunler', anchorEn: 'products', inMenu: true,
    guideTr: 'öne çıkan 4-6 ürün kartı; ad, kısa açıklama, fiyat ve buton',
    guideEn: '4-6 featured product cards with name, short description, price and a button',
  },
  features: {
    tr: 'Özellikler', en: 'Features', anchorTr: 'ozellikler', anchorEn: 'features', inMenu: true,
    guideTr: '3-6 özellik/avantaj kartı; her birinde simge, başlık ve kısa açıklama',
    guideEn: '3-6 feature/benefit cards, each with an icon, a title and a short description',
  },
  gallery: {
    tr: 'Galeri', en: 'Gallery', anchorTr: 'galeri', anchorEn: 'gallery', inMenu: true,
    guideTr: '6 görsellik düzenli bir ızgara ve kısa görsel açıklamaları',
    guideEn: 'a tidy grid of six images with short captions',
  },
  pricing: {
    tr: 'Fiyatlar', en: 'Pricing', anchorTr: 'fiyatlar', anchorEn: 'pricing', inMenu: true,
    guideTr: '2-3 paket kartı; ad, fiyat, özellik listesi ve buton; biri öne çıkan paket',
    guideEn: '2-3 plan cards with name, price, feature list and button; one highlighted plan',
  },
  testimonials: {
    tr: 'Yorumlar', en: 'Testimonials', anchorTr: 'yorumlar', anchorEn: 'testimonials', inMenu: false,
    guideTr: '3 gerçekçi müşteri yorumu; isim ve kısa alıntı',
    guideEn: 'three realistic customer quotes with names',
  },
  team: {
    tr: 'Ekibimiz', en: 'Team', anchorTr: 'ekip', anchorEn: 'team', inMenu: false,
    guideTr: '3-4 ekip üyesi kartı; ad, unvan ve bir cümlelik tanıtım',
    guideEn: '3-4 team member cards with name, role and one sentence',
  },
  faq: {
    tr: 'Sıkça Sorulan Sorular', en: 'FAQ', anchorTr: 'sss', anchorEn: 'faq', inMenu: true,
    guideTr: '4-6 soru ve kısa, net cevapları',
    guideEn: '4-6 questions with short, clear answers',
  },
  stats: {
    tr: 'Rakamlarla Biz', en: 'In numbers', anchorTr: 'rakamlar', anchorEn: 'numbers', inMenu: false,
    guideTr: '3-4 büyük rakam ve açıklaması (ör. yıllık deneyim, mutlu müşteri)',
    guideEn: '3-4 large figures with labels (e.g. years of experience, happy customers)',
  },
  blog: {
    tr: 'Blog', en: 'Blog', anchorTr: 'blog', anchorEn: 'blog', inMenu: true,
    guideTr: '3 yazı kartı; başlık, tarih ve iki cümlelik özet',
    guideEn: 'three post cards with title, date and a two-sentence summary',
  },
  contact: {
    tr: 'İletişim', en: 'Contact', anchorTr: 'iletisim', anchorEn: 'contact', inMenu: true,
    guideTr: 'iletişim bilgileri ve iletişim formu',
    guideEn: 'contact details and a contact form',
  },
  cta: {
    tr: 'Çağrı Bandı', en: 'Call to action', anchorTr: 'cagri', anchorEn: 'cta', inMenu: false,
    guideTr: 'tek cümlelik güçlü bir çağrı ve buton',
    guideEn: 'one strong sentence and a button',
  },
  custom: {
    tr: 'Özel Bölüm', en: 'Custom section', anchorTr: 'bolum', anchorEn: 'section', inMenu: true,
    guideTr: 'başlığa ve notlara uygun içerik',
    guideEn: 'content that fits the title and the notes',
  },
};

export const FEATURE_KEYS: FeatureKey[] = [
  'contactForm', 'mobileMenu', 'smoothScroll', 'faqAccordion', 'backToTop', 'revealAnimations',
  'darkModeToggle', 'whatsappButton', 'mapEmbed', 'galleryLightbox', 'newsletter',
];

export const TONES: Tone[] = ['samimi', 'profesyonel', 'eglenceli', 'zarif', 'sade'];

/** Common site types (chips in the first step); the category follows from the words. */
export const SITE_TYPE_SUGGESTIONS = [
  'Kafe', 'Restoran', 'Pastane', 'Hukuk bürosu', 'Diş kliniği', 'Spor salonu', 'Kuaför', 'Otel',
  'Portfolyo', 'Fotoğrafçı', 'Yazılım girişimi', 'Mobil uygulama', 'Kişisel blog', 'Etkinlik', 'Dernek',
];

const DEFAULT_SECTIONS: Record<DesignCategory, SectionKind[]> = {
  yemek: ['hero', 'about', 'menu', 'gallery', 'testimonials', 'contact'],
  kurumsal: ['hero', 'services', 'about', 'stats', 'testimonials', 'contact'],
  teknoloji: ['hero', 'features', 'pricing', 'testimonials', 'faq', 'cta'],
  yaratici: ['hero', 'about', 'gallery', 'services', 'testimonials', 'contact'],
  eglenceli: ['hero', 'features', 'gallery', 'pricing', 'faq', 'contact'],
  doga_saglik: ['hero', 'services', 'about', 'team', 'testimonials', 'contact'],
  luks: ['hero', 'about', 'products', 'gallery', 'testimonials', 'contact'],
  genel: ['hero', 'about', 'services', 'contact'],
};

const DEFAULT_PAGES: Record<DesignCategory, Array<{ tr: string; en: string; sections: SectionKind[] }>> = {
  yemek: [
    { tr: 'Ana Sayfa', en: 'Home', sections: ['hero', 'features', 'testimonials', 'cta'] },
    { tr: 'Menü', en: 'Menu', sections: ['menu'] },
    { tr: 'Hakkımızda', en: 'About', sections: ['about', 'gallery'] },
    { tr: 'İletişim', en: 'Contact', sections: ['contact'] },
  ],
  kurumsal: [
    { tr: 'Ana Sayfa', en: 'Home', sections: ['hero', 'services', 'stats', 'testimonials', 'cta'] },
    { tr: 'Hakkımızda', en: 'About', sections: ['about', 'team'] },
    { tr: 'Hizmetler', en: 'Services', sections: ['services', 'faq'] },
    { tr: 'İletişim', en: 'Contact', sections: ['contact'] },
  ],
  teknoloji: [
    { tr: 'Ana Sayfa', en: 'Home', sections: ['hero', 'features', 'testimonials', 'cta'] },
    { tr: 'Fiyatlar', en: 'Pricing', sections: ['pricing', 'faq'] },
    { tr: 'Hakkımızda', en: 'About', sections: ['about', 'team'] },
    { tr: 'İletişim', en: 'Contact', sections: ['contact'] },
  ],
  yaratici: [
    { tr: 'Ana Sayfa', en: 'Home', sections: ['hero', 'gallery', 'testimonials'] },
    { tr: 'Hakkımda', en: 'About', sections: ['about', 'services'] },
    { tr: 'İletişim', en: 'Contact', sections: ['contact'] },
  ],
  eglenceli: [
    { tr: 'Ana Sayfa', en: 'Home', sections: ['hero', 'features', 'gallery', 'cta'] },
    { tr: 'Paketler', en: 'Packages', sections: ['pricing', 'faq'] },
    { tr: 'İletişim', en: 'Contact', sections: ['contact'] },
  ],
  doga_saglik: [
    { tr: 'Ana Sayfa', en: 'Home', sections: ['hero', 'services', 'testimonials', 'cta'] },
    { tr: 'Hakkımızda', en: 'About', sections: ['about', 'team'] },
    { tr: 'Hizmetler', en: 'Services', sections: ['services', 'faq'] },
    { tr: 'İletişim', en: 'Contact', sections: ['contact'] },
  ],
  luks: [
    { tr: 'Ana Sayfa', en: 'Home', sections: ['hero', 'about', 'products', 'testimonials'] },
    { tr: 'Koleksiyon', en: 'Collection', sections: ['products', 'gallery'] },
    { tr: 'İletişim', en: 'Contact', sections: ['contact'] },
  ],
  genel: [
    { tr: 'Ana Sayfa', en: 'Home', sections: ['hero', 'about', 'services', 'cta'] },
    { tr: 'İletişim', en: 'Contact', sections: ['contact'] },
  ],
};

let idCounter = 0;
export const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;

export function newSection(kind: SectionKind): WizardSection {
  return { id: newId('sec'), kind, title: '', content: '', notes: '' };
}

/** The category the wizard works with: chosen, or read from the site type and description. */
export function resolveCategory(data: Pick<SiteWizardData, 'category' | 'siteType' | 'description' | 'siteName'>): DesignCategory {
  if (data.category !== 'auto') return data.category;
  const byType = categorizeByKeywords(data.siteType || '');
  if (byType.category) return byType.category;
  const byAll = categorizeByKeywords(`${data.siteType} ${data.description} ${data.siteName}`);
  return byAll.category || (byType.matches[0] ?? byAll.matches[0] ?? 'genel');
}

/** Pages for the category: one page with the typical sections, or the typical page set. */
export function defaultPages(category: DesignCategory, multiPage: boolean, language: SiteLanguage): WizardPage[] {
  if (!multiPage) {
    return [{ id: newId('page'), name: language === 'en' ? 'Home' : 'Ana Sayfa', sections: DEFAULT_SECTIONS[category].map(newSection) }];
  }
  return DEFAULT_PAGES[category].map((p) => ({ id: newId('page'), name: language === 'en' ? p.en : p.tr, sections: p.sections.map(newSection) }));
}

export function createWizardData(mode: WizardMode = 'simple'): SiteWizardData {
  return {
    mode,
    siteName: '',
    siteType: '',
    description: '',
    slogan: '',
    audience: '',
    language: 'tr',
    tone: 'samimi',
    category: 'auto',
    theme: 'auto',
    colorMode: 'auto',
    multiPage: false,
    pages: defaultPages('genel', false, 'tr'),
    pagesTouched: false,
    contact: { address: '', phone: '', email: '', hours: '', whatsapp: '', instagram: '', facebook: '', x: '', linkedin: '', youtube: '' },
    features: {
      contactForm: true, mobileMenu: true, smoothScroll: true, faqAccordion: true, backToTop: false, revealAnimations: false,
      darkModeToggle: false, whatsappButton: false, mapEmbed: false, galleryLightbox: false, newsletter: false,
    },
    images: 'placeholders',
    seoTitle: '',
    seoDescription: '',
  };
}

// ---------------------------------------------------------------------------
// Files and anchors
// ---------------------------------------------------------------------------

export function slugify(text: string): string {
  return (text || '')
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** File of every page: the first page is index.html, the others follow their names. */
export function pageFiles(pages: WizardPage[]): string[] {
  const used = new Set<string>(['index.html']);
  return pages.map((page, i) => {
    if (i === 0) return 'index.html';
    const base = slugify(page.name) || `sayfa-${i + 1}`;
    let file = `${base}.html`;
    for (let n = 2; used.has(file); n++) file = `${base}-${n}.html`;
    used.add(file);
    return file;
  });
}

/** Anchor id of every section of a page (unique within the page). */
export function sectionAnchors(page: WizardPage, language: SiteLanguage): string[] {
  const used = new Set<string>();
  return page.sections.map((s) => {
    const info = SECTION_INFO[s.kind];
    const base = (s.kind === 'custom' && slugify(s.title)) || (language === 'en' ? info.anchorEn : info.anchorTr);
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return id;
  });
}

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

export interface CompiledSite {
  prompt: string;
  /** One item per page for multi-page sites; [] = one task. */
  checklist: string[];
  displayGoal: string;
  design: DesignOverride;
  category: DesignCategory;
  stats: { pages: number; sections: number; userTexts: number; contentChars: number };
  warnings: string[];
}

const TONE_TEXT: Record<Tone, { tr: string; en: string }> = {
  samimi: { tr: 'samimi ve sıcak', en: 'friendly and warm' },
  profesyonel: { tr: 'profesyonel ve güven veren', en: 'professional and trustworthy' },
  eglenceli: { tr: 'eğlenceli ve enerjik', en: 'playful and energetic' },
  zarif: { tr: 'zarif ve seçkin', en: 'elegant and refined' },
  sade: { tr: 'sade ve net', en: 'simple and clear' },
};

const FEATURE_TEXT: Record<FeatureKey, { tr: string; en: string }> = {
  contactForm: {
    tr: 'İletişim formu: ad, e-posta ve mesaj alanları; gönderince alanları JavaScript ile doğrula, hataları alanın altında göster ve başarılı olunca teşekkür mesajı göster (sunucuya gönderme).',
    en: 'Contact form with name, e-mail and message; on submit validate the fields with JavaScript, show errors under the fields and a thank-you message on success (no server).',
  },
  mobileMenu: {
    tr: 'Mobilde üst menü bir hamburger düğmesiyle açılıp kapansın.',
    en: 'On phones the top menu opens and closes with a hamburger button.',
  },
  smoothScroll: { tr: 'Sayfa içi bağlantılarda yumuşak kaydırma.', en: 'Smooth scrolling for in-page links.' },
  faqAccordion: {
    tr: 'SSS bölümünde soruya tıklayınca cevabı açılıp kapansın.',
    en: 'In the FAQ, clicking a question opens and closes its answer.',
  },
  backToTop: { tr: 'Aşağı kaydırınca sağ altta "yukarı çık" düğmesi görünsün.', en: 'A "back to top" button appears at the bottom right after scrolling down.' },
  revealAnimations: {
    tr: 'Bölümler ekrana girerken hafifçe belirsin (IntersectionObserver ile, abartısız).',
    en: 'Sections fade in gently as they enter the screen (IntersectionObserver, subtle).',
  },
  darkModeToggle: {
    tr: 'Üst menüde açık/koyu görünüm düğmesi; seçim localStorage’da saklansın.',
    en: 'A light/dark mode switch in the top menu; remember the choice in localStorage.',
  },
  whatsappButton: { tr: 'Sağ altta sabit bir WhatsApp düğmesi.', en: 'A fixed WhatsApp button at the bottom right.' },
  mapEmbed: {
    tr: 'İletişim bölümünde adresi gösteren gömülü Google Haritalar haritası (iframe).',
    en: 'An embedded Google Maps map of the address in the contact section (iframe).',
  },
  galleryLightbox: {
    tr: 'Galeride bir görsele tıklayınca büyük hâli ekranı kaplayan bir pencerede açılsın; Esc ile kapansın.',
    en: 'Clicking a gallery image opens it large in an overlay; Esc closes it.',
  },
  newsletter: {
    tr: 'Alt bilgide e-posta ile bülten aboneliği kutusu (doğrulama ve teşekkür mesajı).',
    en: 'A newsletter sign-up box in the footer (validation and a thank-you message).',
  },
};

function socialUrl(kind: keyof WizardContact, value: string): string {
  const v = value.trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  const handle = v.replace(/^@/, '').replace(/\s+/g, '');
  switch (kind) {
    case 'instagram': return `https://instagram.com/${handle}`;
    case 'facebook': return `https://facebook.com/${handle}`;
    case 'x': return `https://x.com/${handle}`;
    case 'linkedin': return `https://linkedin.com/in/${handle}`;
    case 'youtube': return `https://youtube.com/@${handle}`;
    case 'whatsapp': return `https://wa.me/${v.replace(/\D/g, '').replace(/^0/, '90')}`;
    default: return v;
  }
}

const quoteBlock = (text: string) => `"""\n${text.trim()}\n"""`;

/** Turns the wizard answers into the agent request, checklist and theme choice. */
export function compileSitePrompt(data: SiteWizardData, opts: { year?: number } = {}): CompiledSite {
  const year = opts.year ?? new Date().getFullYear();
  const en = data.language === 'en';
  const L = (tr: string, enText: string) => (en ? enText : tr);
  const name = data.siteName.trim() || L('Web Sitem', 'My Website');
  const category = resolveCategory(data);
  const pages = data.pages.length > 0 ? data.pages : defaultPages(category, false, data.language);
  const multi = pages.length > 1;
  const files = pageFiles(pages);
  const warnings: string[] = [];
  const lines: string[] = [];
  let userTexts = 0;
  let contentChars = 0;

  // ---- Heading line
  lines.push(
    multi
      ? L(`"${name}" için ${pages.length} sayfalık bir web sitesi oluştur.`, `Create a ${pages.length}-page website for "${name}".`)
      : L(`"${name}" için tek sayfalık bir web sitesi oluştur.`, `Create a one-page website for "${name}".`)
  );

  // ---- About the site
  const about: string[] = [];
  if (data.siteType.trim()) about.push(L(`Site türü: ${data.siteType.trim()}.`, `Kind of site: ${data.siteType.trim()}.`));
  if (data.description.trim()) about.push(data.description.trim().replace(/\s+/g, ' '));
  if (data.slogan.trim()) about.push(L(`Slogan: "${data.slogan.trim()}"`, `Tagline: "${data.slogan.trim()}"`));
  if (data.audience.trim()) about.push(L(`Hedef kitle: ${data.audience.trim()}.`, `Audience: ${data.audience.trim()}.`));
  about.push(
    L(
      `Yazım tonu: ${TONE_TEXT[data.tone].tr}. Sayfadaki tüm metinler Türkçe olsun.`,
      `Tone of voice: ${TONE_TEXT[data.tone].en}. All page text is in English.`
    )
  );
  lines.push('', L('HAKKINDA', 'ABOUT'), ...about.map((a) => `- ${a}`));

  // ---- Files
  lines.push('', L('DOSYALAR', 'FILES'));
  if (multi) {
    pages.forEach((p, i) => lines.push(`- ${files[i]} — ${p.name.trim() || L('Sayfa', 'Page')}`));
    lines.push(
      L(
        '- Her sayfada aynı üst menü (site adı ve tüm sayfaların bağlantıları, açık olan sayfa vurgulu) ve aynı alt bilgi (footer) olsun. Menü bağlantıları bu dosyalara gitsin.',
        '- Every page has the same top menu (site name and links to all pages, the current page highlighted) and the same footer. Menu links point to these files.'
      )
    );
  } else {
    const anchors = sectionAnchors(pages[0], data.language);
    const menu = pages[0].sections
      .map((s, i) => ({ s, id: anchors[i] }))
      .filter(({ s }) => SECTION_INFO[s.kind].inMenu)
      .map(({ s, id }) => `${s.title.trim() || (en ? SECTION_INFO[s.kind].en : SECTION_INFO[s.kind].tr)} (#${id})`);
    lines.push(L('- index.html (tek sayfa).', '- index.html (one page).'));
    if (menu.length > 0) {
      lines.push(L(`- Üst menüde site adı ve şu bağlantılar olsun: ${menu.join(', ')}.`, `- The top menu shows the site name and these links: ${menu.join(', ')}.`));
    }
  }

  // ---- Pages and sections
  let sectionCount = 0;
  pages.forEach((page, pi) => {
    const anchors = sectionAnchors(page, data.language);
    lines.push(
      '',
      multi
        ? L(`SAYFA ${pi + 1}: ${files[pi]} (${page.name.trim() || 'Sayfa'}) — bölümler bu sırayla:`, `PAGE ${pi + 1}: ${files[pi]} (${page.name.trim() || 'Page'}) — sections in this order:`)
        : L('BÖLÜMLER (bu sırayla):', 'SECTIONS (in this order):')
    );
    if (page.sections.length === 0) {
      lines.push(L('- Sayfanın adına uygun bir içerik bölümü.', '- One content section that fits the page name.'));
      return;
    }
    page.sections.forEach((section, si) => {
      sectionCount++;
      const info = SECTION_INFO[section.kind];
      const label = en ? info.en : info.tr;
      const title = section.title.trim();
      const head = `- ${label} (id="${anchors[si]}")${title ? L(` — başlık: "${title}"`, ` — heading: "${title}"`) : ''}`;
      const content = section.content.trim();
      if (content) {
        userTexts++;
        contentChars += markdownTextLength(content);
        lines.push(`${head}. ${L('İçerik olarak bu HTML’i aynen kullan:', 'Use exactly this HTML as the content:')}`);
        lines.push(quoteBlock(markdownToHtml(content)));
        if (section.notes.trim()) lines.push(`  ${L('Not', 'Note')}: ${section.notes.trim().replace(/\s+/g, ' ')}`);
      } else {
        const notes = section.notes.trim() ? ` ${section.notes.trim().replace(/\s+/g, ' ')}` : '';
        lines.push(`${head}. ${L('Metni sen yaz', 'Write the text yourself')}: ${en ? info.guideEn : info.guideTr}.${notes}`);
      }
    });
  });

  // ---- Contact
  const c = data.contact;
  const contactLines: string[] = [];
  if (c.address.trim()) contactLines.push(`${L('Adres', 'Address')}: ${c.address.trim().replace(/\s+/g, ' ')}`);
  if (c.phone.trim()) contactLines.push(`${L('Telefon', 'Phone')}: ${c.phone.trim()}`);
  if (c.email.trim()) contactLines.push(`${L('E-posta', 'E-mail')}: ${c.email.trim()}`);
  if (c.hours.trim()) contactLines.push(`${L('Çalışma saatleri', 'Opening hours')}: ${c.hours.trim().replace(/\n+/g, '; ')}`);
  const socials = (['instagram', 'facebook', 'x', 'linkedin', 'youtube', 'whatsapp'] as const)
    .map((k) => ({ k, url: socialUrl(k, c[k]) }))
    .filter((s) => s.url);
  if (socials.length > 0) {
    contactLines.push(
      `${L('Sosyal medya bağlantıları (alt bilgide)', 'Social links (in the footer)')}: ${socials
        .map((s) => `${s.k === 'x' ? 'X' : s.k[0].toUpperCase() + s.k.slice(1)} ${s.url}`)
        .join(', ')}`
    );
  }
  if (contactLines.length > 0) {
    lines.push('', L('İLETİŞİM BİLGİLERİ (aynen kullan; iletişim bölümünde ve alt bilgide)', 'CONTACT DETAILS (use exactly; in the contact section and the footer)'), ...contactLines.map((l) => `- ${l}`));
  }

  // ---- Features (only those the page can use)
  const kinds = new Set(pages.flatMap((p) => p.sections.map((s) => s.kind)));
  const feature = (key: FeatureKey) => !!data.features[key];
  const wanted = FEATURE_KEYS.filter((key) => {
    if (!feature(key)) return false;
    if (key === 'contactForm' || key === 'mapEmbed') return kinds.has('contact');
    if (key === 'faqAccordion') return kinds.has('faq');
    if (key === 'galleryLightbox') return kinds.has('gallery');
    if (key === 'smoothScroll') return !multi || pages.some((p) => p.sections.length > 2);
    if (key === 'whatsappButton') return !!c.whatsapp.trim() || !!c.phone.trim();
    return true;
  });
  if (wanted.length > 0) {
    lines.push('', L('İŞLEVLER (JavaScript ile)', 'BEHAVIOUR (JavaScript)'));
    for (const key of wanted) {
      let text = en ? FEATURE_TEXT[key].en : FEATURE_TEXT[key].tr;
      if (key === 'whatsappButton') text += ` (${socialUrl('whatsapp', c.whatsapp.trim() || c.phone.trim())})`;
      lines.push(`- ${text}`);
    }
  }

  // ---- Images, SEO
  lines.push(
    '',
    L('GÖRSELLER', 'IMAGES'),
    data.images === 'photos'
      ? L(
          `- Fotoğraf gereken yerlerde https://picsum.photos/seed/<konu-kelimesi>/800/600 adreslerini kullan (her görsel için farklı bir kelime) ve anlamlı alt metinler yaz.`,
          `- Where photos are needed use https://picsum.photos/seed/<topic-word>/800/600 (a different word per image) and write meaningful alt texts.`
        )
      : L(
          '- Harici görsel kullanma; görsel alanları CSS ile yumuşak degrade renkli yer tutucular olsun (içlerinde kısa bir etiket).',
          '- Use no external images; image areas are soft CSS gradient placeholders with a short label.'
        )
  );
  const seoTitle = data.seoTitle.trim();
  const seoDesc = data.seoDescription.trim();
  if (seoTitle || seoDesc) {
    lines.push('', 'SEO');
    if (seoTitle) lines.push(L(`- <title>: "${seoTitle}"`, `- <title>: "${seoTitle}"`));
    if (seoDesc) lines.push(L(`- <meta name="description">: "${seoDesc.replace(/\s+/g, ' ')}"`, `- <meta name="description">: "${seoDesc.replace(/\s+/g, ' ')}"`));
  }

  // ---- Quality bar for small models
  lines.push(
    '',
    L('KALİTE', 'QUALITY'),
    L(
      '- Bütün bölümleri eksiksiz ve gerçekçi metinlerle yaz; "Lorem ipsum" veya "buraya metin gelecek" gibi yer tutucular kullanma.',
      '- Write every section completely with realistic text; no "Lorem ipsum" or "text goes here" placeholders.'
    ),
    L(
      '- Modern ve ferah bir tasarım: belirgin karşılama bölümü, bölümler arasında bol boşluk, kartlar, telefon ve bilgisayarda düzgün görünen esnek düzen.',
      '- A modern, airy design: a strong hero, generous spacing between sections, cards, and a flexible layout that works on phones and desktops.'
    ),
    L(`- Alt bilgideki telif satırında ${year} yılını kullan.`, `- Use the year ${year} in the footer copyright line.`)
  );
  if (data.theme === 'none') {
    const modeText =
      data.colorMode === 'dark' ? L('- Koyu renkli bir tasarım kullan.', '- Use a dark design.')
      : data.colorMode === 'light' ? L('- Açık renkli bir tasarım kullan.', '- Use a light design.')
      : '';
    if (modeText) lines.push(modeText);
  }

  // ---- Design theme for this run
  let design: DesignOverride;
  if (data.theme === 'none') design = { enabled: false };
  else if (data.theme !== 'auto' && getTheme(data.theme)) design = { enabled: true, themeId: data.theme, category: getTheme(data.theme)!.category };
  else design = { enabled: true, themeId: null, category, mode: data.colorMode === 'auto' ? null : data.colorMode };

  // ---- Checklist: one item per page file
  const checklist = multi
    ? pages.map((p, i) => {
        const names = p.sections.map((s) => s.title.trim() || (en ? SECTION_INFO[s.kind].en : SECTION_INFO[s.kind].tr));
        return `${files[i]} — ${p.name.trim() || L('Sayfa', 'Page')}${names.length ? `: ${names.join(', ')}` : ''}`;
      })
    : [];

  if (contentChars > 6000) {
    warnings.push(
      L(
        'Metinler uzun: küçük modellerde sayfalar yavaş yazılır; gerekirse metinleri kısaltın veya bazı sayfaları sonraya bırakın.',
        'Your texts are long: small models write such pages slowly; shorten them or leave some pages for later.'
      )
    );
  }
  if (pages.length > 6) {
    warnings.push(L('Altıdan fazla sayfa küçük modellerde çok uzun sürebilir.', 'More than six pages can take very long with small models.'));
  }
  if (!data.siteName.trim()) warnings.push(L('Site adı boş.', 'The site name is empty.'));

  const themeName = design.enabled ? (design.themeId ? getTheme(design.themeId)?.name : L('konuya göre', 'by topic')) : L('yok', 'none');
  const displayGoal = L(
    `Website Oluştur: "${name}" — ${pages.length} sayfa, ${sectionCount} bölüm · ${categoryLabel(category)} · tema: ${themeName}`,
    `Create website: "${name}" — ${pages.length} page(s), ${sectionCount} sections · ${categoryLabel(category)} · theme: ${themeName}`
  );

  return {
    prompt: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    checklist,
    displayGoal,
    design,
    category,
    stats: { pages: pages.length, sections: sectionCount, userTexts, contentChars },
    warnings,
  };
}

/** The category options of the first step (auto + the eight categories). */
export const CATEGORY_OPTIONS: Array<DesignCategory | 'auto'> = ['auto', ...DESIGN_CATEGORIES.map((c) => c.id)];
