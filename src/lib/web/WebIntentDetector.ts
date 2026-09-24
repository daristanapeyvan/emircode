/**
 * WebIntentDetector.ts
 * Multi-lingual proactive intent detection, search query extraction,
 * and conversational raw JSON sanitization for Emir Code.
 */

// 1. Temporal Patterns (Years 2024-2029, full dates, relative dates in TR & EN)
const TEMPORAL_PATTERN = /(?:202[4-9]|203\d|\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|bugün(?:ün)?|dün|yarın|bu\s+hafta|bu\s+ay|bu\s+yıl|şu\s+an|şimdi|tarihli|güncel|today|yesterday|tomorrow|this\s+week|this\s+month|this\s+year|latest|current(?:ly)?|recent(?:ly)?|now)/i;

// 2. Weather Patterns (TR & EN)
const WEATHER_PATTERN = /(?:hava\s+durumu|hava\s+nas[ıi]l|derece|yağmur(?:lu)?|kar\s+yağ[ıi]ş[ıi]|rüzgar|fırtına|sıcaklık|weather|forecast|temperature|climate|snowing|raining)/i;

// 3. Finance & Currency Patterns (TR, EN & Crypto)
const FINANCE_PATTERN = /(?:dolar|euro|sterlin|döviz|kur(?:u)?|borsa|bist|altın|çeyrek\s+altın|gram\s+altın|ons|faiz|enflasyon|bitcoin|btc|ethereum|eth|kripto|crypto|kaç\s+tl|fiyat(?:ı|lar)?|exchange\s+rate|currency|stock(?:s)?|shares|gold\s+price|interest\s+rate|inflation|market\s+cap)/i;

// 4. News & Current Events Patterns (TR & EN)
const NEWS_PATTERN = /(?:haber(?:ler|i)?|son\s+dakika|gündem|güncel|ne\s+oldu|olaylar|news|breaking(?:\s+news)?|headlines|what\s+happened|current\s+events)/i;

// 5. Explicit Search Requests (TR & EN)
const EXPLICIT_SEARCH_PATTERN = /(?:web\s*(?:arac[ıi](?:n[ıi])?\s*kullanarak|ile|üzerinden|aracı\s*ile)?|internette\s+ara|internetten\s+ara|webde\s+ara|web'de\s+ara|google(?:'da)?|arama\s+yap|araştır|internetten\s+bul|search(?:\s+the\s+web|\s+online)?|browse(?:\s+the\s+web)?|look\s+up\s+online|find\s+online)/i;

// 6. Knowledge lookups about people, places, organisations and facts (TR & EN).
// Small local models either hallucinate or refuse on these ("bu bilgiye erişimim sınırlı").
const ENTITY_LOOKUP_PATTERN = /(?:\bkim(?:dir|dır|di)\b|\bkim\s*\?|hakkında\s+(?:bilgi|ne\s+biliyorsun|neler\s+biliyorsun)|biyografi|hayat[ıi]\s+(?:hakkında|nasıl)|\bnereli(?:dir)?\b|kaç\s+yaşında|ne\s+zaman\s+(?:doğdu|öldü|kuruldu|çıktı|yayınlandı|başladı)|nerede\s+(?:doğdu|yaşıyor|doğmuştur)|kurucusu|nüfusu|başkenti|\bwho\s+(?:is|was|are|were)\b|tell\s+me\s+about|biography|how\s+old\s+is|when\s+(?:was|did)\b[^?]*\b(?:born|founded|released|died?)\b|where\s+(?:is|was)\b[^?]*\b(?:born|from)\b|founder\s+of|ceo\s+of|population\s+of|capital\s+of)/i;

// Programming questions are answered from the model's own knowledge.
const CODE_CONTEXT_PATTERN = /(?:\bkod(?:u|da|lar)?\b|fonksiyon|function|\bclass\b|\bhata\b|error|exception|\bbug\b|derle|compile|python|javascript|typescript|\bjava\b|c\+\+|c#|react|\bsql\b|regex|\bnpm\b|\bpip\b|algoritma|algorithm)/i;

// 7. Answers in which the model refuses or sends the user to search the web themselves.
const REFUSAL_PATTERNS: RegExp[] = [
  /bilgi(?:ye|lere)?\s+erişim(?:im)?\s+(?:yok|sınırlı|bulunmuyor|kısıtlı)/i,
  /erişimim\s+(?:yok|sınırlı|bulunmuyor|kısıtlı)/i,
  /internet(?:e)?\s+(?:erişimim|bağlantım)\s+(?:yok|bulunmuyor)/i,
  /(?:internette|internetten|google['’]?(?:da|dan)?|web(?:['’]?de))\s+(?:arama\s+yap|araştır|bak(?:abilir|manız)|arat)/i,
  /güncel\s+bilgi(?:ye|lere|m)?\s+(?:sahip\s+değilim|erişemiyorum|ulaşamıyorum|yok)/i,
  /(?:bilgi\s+kesim\s+tarih|eğitim\s+veriler(?:im|ime))/i,
  /yapay\s+zeka\s+(?:modeli\s+|asistanı\s+)?olarak/i,
  /hakkında\s+(?:yeterli\s+|herhangi\s+bir\s+|güncel\s+)?bilgi(?:m|ye)?\s+(?:yok|sahip\s+değilim|bulunmuyor|veremiyorum)/i,
  /(?:tanımıyorum|bilmiyorum|emin\s+değilim|bilgim\s+yok)/i,
  /\bi\s+(?:don['’]?t|do\s+not)\s+have\s+(?:access|real[-\s]?time|current|up[-\s]?to[-\s]?date|browsing|any\s+information|information)/i,
  /\bas\s+an\s+ai\b/i,
  /knowledge\s+cut[-\s]?off/i,
  /\bi\s+(?:can['’]?t|cannot)\s+(?:browse|access|search)/i,
  /(?:check|search|look\s+(?:it\s+)?up)\s+(?:online|the\s+(?:internet|web)|on\s+google)/i,
  /\bi\s+(?:don['’]?t|do\s+not)\s+know\b/i,
  /\bi['’]?m\s+not\s+(?:sure|aware|familiar)/i,
];

/**
 * True when a (short) answer is a refusal or tells the user to search online.
 * With web access enabled the app performs that search itself and answers again.
 */
export function detectKnowledgeRefusal(answer: string): boolean {
  if (!answer || typeof answer !== 'string') return false;
  const trimmed = answer.trim();
  if (!trimmed || trimmed.length > 900) return false;
  return REFUSAL_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Detects whether a user prompt has intent requiring web search.
 * Supports multi-lingual queries (Turkish, English, international financial/crypto/tech terms).
 */
export function detectWebSearchIntent(prompt: string): boolean {
  if (!prompt || typeof prompt !== 'string') return false;
  const trimmed = prompt.trim();
  if (trimmed.length < 3) return false;

  // Explicit web search commands always trigger
  if (EXPLICIT_SEARCH_PATTERN.test(trimmed)) {
    return true;
  }

  // Weather inquiries always require current real-world data
  if (WEATHER_PATTERN.test(trimmed)) {
    return true;
  }

  // News and breaking events always require current data
  if (NEWS_PATTERN.test(trimmed)) {
    return true;
  }

  // Financial rates/prices combined with either temporal cues or questions about price/rate
  if (FINANCE_PATTERN.test(trimmed)) {
    return true;
  }

  // People, places, organisations and other facts ("şebnem ferah kimdir", "who is ...")
  if (ENTITY_LOOKUP_PATTERN.test(trimmed) && !CODE_CONTEXT_PATTERN.test(trimmed)) {
    return true;
  }

  // Temporal cues combined with a question/inquiry
  if (TEMPORAL_PATTERN.test(trimmed)) {
    // If it has temporal cue + question words or specific nouns, search
    if (/(?:ne|nasıl|kaç|kim|nerede|hangisi|what|when|where|who|how|which|why|\?)/i.test(trimmed)) {
      return true;
    }
  }

  return false;
}

/**
 * Extracts a clean, focused search query from a conversational user prompt
 * by stripping conversational pleasantries and search imperatives in TR & EN.
 */
export function extractSearchQuery(prompt: string): string {
  if (!prompt) return '';
  let cleaned = prompt.trim();

  // Strip leading conversational phrases
  cleaned = cleaned.replace(
    /^(?:web\s*(?:arac[ıi]n[ıi]\s*kullanarak|arac[ıi]yla|ile|üzerinden|aracı\s*ile)?|lütfen|bana|acaba|internetten|webde|internette|google(?:'da)?|please|can\s+you|search\s+for|look\s+up|find)\s+/gi,
    ''
  );

  // Strip explicit search wrappers: "web aracını kullanarak ... bul"
  cleaned = cleaned.replace(/web\s+arac[ıi]n[ıi]\s+kullanarak\s*/gi, '');
  cleaned = cleaned.replace(/internetten\s+(?:ara|bul|araştır)\s*/gi, '');
  cleaned = cleaned.replace(/webde\s+(?:ara|bul)\s*/gi, '');
  cleaned = cleaned.replace(/web'de\s+(?:ara|bul)\s*/gi, '');
  cleaned = cleaned.replace(/using\s+(?:the\s+)?web\s+(?:tool|search)\s*/gi, '');

  // Strip trailing imperatives: "bul", "ara", "söyle", "getir", "hakkında bilgi ver"
  cleaned = cleaned.replace(
    /\s+(?:bul(?:ur\s*musun)?|ara(?:ştır)?|söyle(?:yebilir\s*misin)?|getir|göster|hakkında\s+bilgi\s+ver(?:ir\s*misin)?|nedir|ne\s+kadar|nelerdir|please)\s*[.?!]*$/gi,
    ''
  );
  // "X kimdir?" -> "X" is a poor query; keep the name and ask for who they are.
  cleaned = cleaned.replace(/\s+kim(?:dir|dır|di)?\s*[.?!]*$/i, ' kimdir');

  // Strip extra punctuation marks but keep dates intact (e.g. 23.09.2026)
  cleaned = cleaned.replace(/["'«»“”]/g, '').trim();

  // If query is cleaned to be too short, return the original trimmed prompt
  if (cleaned.length < 3) {
    return prompt.trim();
  }

  return cleaned;
}

/**
 * Sanitizes chat content by removing raw action JSON code blocks
 * and conversational prefaces like "JSON yazabilirim:" so they are
 * never displayed nakedly to the user.
 */
export function cleanChatContent(content: string): string {
  if (!content) return '';

  // 1. Remove markdown json action blocks: ```json { "action": ... } ```
  let cleaned = content.replace(/```(?:json)?\s*\{[\s\S]*?"action"[\s\S]*?\}\s*```/gi, '');

  // 2. Remove bare standalone action JSON: { "action": "..." ... }
  cleaned = cleaned.replace(
    /\{\s*"action"\s*:\s*"(?:web_search|fetch_url|propose_\w+|finish|ask_question|read_\w+|search_code)"[\s\S]*?\}/gi,
    ''
  );

  // 3. Remove phrases talking about writing JSON:
  // "JSON yazabilirim:", "şöyle bir JSON formatı oluşturabilirim:", "I can write JSON:"
  cleaned = cleaned.replace(
    /(?:bu\s+amaçla\s+|bunun\s+için\s+)?(?:şöyle\s+bir\s+|aşağıdaki\s+)?(?:json\s+(?:formatında\s+)?(?:yazabilirim|oluşturabilirim|kodunu\s+kullanabilirim|çıktısı\s+verebilirim)|json\s+yazabilirim)[\s:]*/gi,
    ''
  );
  cleaned = cleaned.replace(
    /(?:for\s+this\s+purpose\s+)?(?:i\s+can\s+write\s+(?:a\s+)?json|here\s+is\s+(?:the\s+)?json(?:\s+action)?)[\s:]*/gi,
    ''
  );

  return cleaned.trim();
}

/**
 * Sanitizes thought block content by stripping any accidental
 * JSON code blocks from thoughts.
 */
export function cleanThoughtContent(content: string): string {
  if (!content) return '';
  return content
    .replace(/```(?:json)?\s*\{[\s\S]*?"action"[\s\S]*?\}\s*```/gi, '')
    .replace(/\{\s*"action"[\s\S]*?\}/gi, '')
    .trim();
}
