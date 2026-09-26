/**
 * categorize.ts — which kind of site a request is about (restaurant, law firm, portfolio ...).
 *
 * Keywords answer the clear cases instantly; when they find nothing or several categories, the
 * model answers one short, grammar-constrained question (the only thing the theme system asks
 * of the model).
 */
import { DESIGN_CATEGORIES, DesignCategory } from './themes';

/** Word starts; a trailing "$" means the whole word only (short or ambiguous stems). */
const KEYWORDS: Record<Exclude<DesignCategory, 'genel'>, string[]> = {
  yemek: [
    'kafe', 'cafe', 'kahve', 'coffee', 'restoran', 'restaurant', 'lokanta', 'bistro', 'pastane', 'patisserie', 'fırın',
    'bakery', 'pizza', 'burger', 'kebap', 'kebab', 'döner', 'yemek', 'food', 'tarif', 'recipe', 'meyhane', 'kokteyl',
    'cocktail', 'şarap', 'wine', 'çikolata', 'chocolate', 'dondurma', 'börek', 'simit', 'catering', 'şef$', 'gurme',
    'gourmet', 'manav', 'kasap', 'balıkçı', 'çay bahçesi', 'çayevi', 'pub$', 'brasserie', 'sushi', 'vegan', 'dessert',
    'pide', 'lahmacun', 'mantı', 'köfte', 'ev yemekleri', 'baklava', 'kahvaltı', 'breakfast',
  ],
  teknoloji: [
    'yazılım', 'software', 'uygulama', 'app$', 'apps$', 'startup', 'girişim', 'saas', 'yapay zeka', 'yapay zekâ', 'ai$',
    'kripto', 'crypto', 'blockchain', 'teknoloji', 'technology', 'tech$', 'bilişim', 'siber', 'cyber', 'robot', 'donanım',
    'hardware', 'elektronik', 'electronic', 'developer', 'geliştirici', 'api$', 'bulut', 'cloud', 'hosting', 'sunucu',
    'server', 'veri$', 'veriler', 'veritaban', 'data$', 'analitik', 'analytics', 'dashboard', 'yönetim paneli',
    'admin panel', 'otomasyon', 'automation', 'iot$', 'drone', 'web3', 'fintech', 'mobil uygulama',
  ],
  kurumsal: [
    'şirket', 'company', 'kurumsal', 'corporate', 'avukat', 'hukuk', 'law$', 'lawyer', 'danışman', 'consult', 'muhasebe',
    'accounting', 'mali müşavir', 'finans', 'finance', 'sigorta', 'insurance', 'banka', 'bank$', 'yatırım', 'invest',
    'inşaat', 'construction', 'mimar', 'architect', 'emlak', 'real estate', 'gayrimenkul', 'lojistik', 'logistic',
    'nakliye', 'fabrika', 'factory', 'üretim', 'manufactur', 'holding', 'b2b$', 'denetim', 'audit', 'insan kaynakları',
    'recruit', 'kariyer', 'career', 'noter', 'ihracat', 'ithalat', 'tekstil', 'otomotiv', 'enerji', 'energy',
    'mühendislik', 'engineering', 'temizlik şirketi', 'tadilat',
  ],
  luks: [
    'lüks', 'luxury', 'mücevher', 'jewel', 'kuyum', 'pırlanta', 'elmas', 'diamond', 'moda', 'fashion', 'butik', 'boutique',
    'parfüm', 'perfume', 'düğün', 'wedding', 'gelinlik', 'bridal', 'otel', 'hotel', 'resort', 'spa$', 'güzellik', 'beauty',
    'kuaför', 'berber', 'barber', 'kozmetik', 'cosmetic', 'villa', 'yat$', 'yacht', 'nişan', 'makyaj', 'makeup', 'estetik',
    'couture', 'premium',
  ],
  eglenceli: [
    'çocuk', 'kids', 'child', 'oyuncak', 'toy$', 'toys$', 'parti', 'party', 'doğum günü', 'birthday', 'etkinlik', 'event',
    'festival', 'eğlence', 'fun$', 'oyun', 'game', 'evcil', 'pet$', 'pets$', 'köpek', 'kedi', 'dog$', 'dogs$', 'cat$',
    'cats$', 'kreş', 'anaokul', 'kindergarten', 'hobi', 'hobby', 'konser', 'concert', 'sirk', 'lunapark', 'bebek', 'baby',
    'balon', 'kostüm', 'cosplay', 'kaçış odası', 'escape room', 'bowling', 'karaoke', 'playground',
  ],
  doga_saglik: [
    'sağlık', 'health', 'klinik', 'clinic', 'hastane', 'hospital', 'doktor', 'doctor', 'diş', 'dental', 'dentist',
    'eczane', 'pharmacy', 'psikolog', 'psycholog', 'terapi', 'therapy', 'fizyoterapi', 'physio', 'yoga', 'pilates',
    'meditasyon', 'meditation', 'spor salonu', 'gym$', 'fitness', 'antrenör', 'diyet', 'beslenme', 'nutrition', 'organik',
    'organic', 'bahçe', 'garden', 'çiftlik', 'farm', 'doğa', 'nature', 'eko$', 'ekoloj', 'çevre', 'environment', 'kamp$',
    'kamp alanı', 'kampçılık', 'seyahat', 'travel', 'turizm', 'tourism', 'tur$', 'turlar', 'tour', 'tatil', 'holiday',
    'vacation', 'veteriner', 'vet$', 'bitki', 'plant', 'çiçek', 'flower', 'florist', 'arıcılık', 'bal$', 'honey', 'masaj',
    'massage', 'wellness', 'kaplıca', 'trekking', 'bisiklet', 'hemşire', 'nurse',
  ],
  yaratici: [
    'portfolyo', 'portfolio', 'fotoğraf', 'photo', 'tasarımcı', 'designer', 'ajans', 'agency', 'sanat', 'art$', 'artist',
    'galeri', 'gallery', 'müzik', 'music', 'müzisyen', 'musician', 'band$', 'blog', 'dergi', 'magazine', 'şair', 'poet',
    'kitap', 'film', 'stüdyo', 'studio', 'illüstrasyon', 'illustrat', 'dövme', 'tattoo', 'grafik', 'graphic', 'animasyon',
    'animation', 'podcast', 'kişisel site', 'kişisel web', 'cv$', 'özgeçmiş', 'resume', 'tiyatro', 'theatre', 'theater',
    'dans', 'dance', 'seramik', 'ceramic', 'el yapımı', 'handmade', 'atölye', 'workshop', 'yazarlık', 'fotoğrafçı',
  ],
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const MATCHERS: Array<[DesignCategory, RegExp]> = (Object.keys(KEYWORDS) as Array<Exclude<DesignCategory, 'genel'>>).map(
  (cat) => {
    const alternatives = KEYWORDS[cat].map((k) =>
      k.endsWith('$') ? `${escapeRe(k.slice(0, -1)).replace(/ /g, '\\s+')}(?![\\p{L}\\p{N}])` : escapeRe(k).replace(/ /g, '\\s+')
    );
    return [cat, new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join('|')})`, 'u')];
  }
);

export interface KeywordResult {
  /** The single matching category, or null when none or several matched. */
  category: DesignCategory | null;
  matches: DesignCategory[];
}

export function categorizeByKeywords(goal: string): KeywordResult {
  const text = (goal || '').toLocaleLowerCase('tr');
  const matches = MATCHERS.filter(([, re]) => re.test(text)).map(([cat]) => cat);
  return { category: matches.length === 1 ? matches[0] : null, matches };
}

export const CATEGORY_IDS = DESIGN_CATEGORIES.map((c) => c.id);

export const CATEGORY_SCHEMA = {
  type: 'object',
  properties: { category: { type: 'string', enum: CATEGORY_IDS } },
  required: ['category'],
};

/** The one question the model is asked (kept short: it runs before the agent on slow CPUs too). */
export function buildCategoryPrompt(goal: string): string {
  const list = DESIGN_CATEGORIES.map((c) => `- ${c.id}: ${c.hint}`).join('\n');
  return `Classify this website request into exactly one category.\n\nCategories:\n${list}\n\nRequest: """${goal
    .trim()
    .slice(0, 600)}"""\n\nReply with JSON only: {"category": "<category id>"}`;
}

export function parseCategoryAnswer(text: string): DesignCategory | null {
  const raw = (text || '').trim();
  try {
    const data = JSON.parse(raw);
    if (data && CATEGORY_IDS.includes(data.category)) return data.category;
  } catch {
    // fall through to a plain search
  }
  const found = CATEGORY_IDS.find((id) => new RegExp(`\\b${id}\\b`).test(raw));
  return found || null;
}
