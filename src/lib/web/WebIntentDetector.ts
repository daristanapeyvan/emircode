/**
 * WebIntentDetector.ts
 * Multi-lingual proactive intent detection, search query extraction,
 * and conversational raw JSON sanitization for Emir Code.
 */

// Every pattern matches whole words only. Substring matches sent coding questions to the web:
// "options" contains "ons" (gold), "method" contains "eth", "know" contains "now", "concurrency"
// contains "currency", "güncelle" (update) contains "güncel" (current), "kurulum" contains "kur".
// JavaScript's \b only knows ASCII letters, so Turkish words are bounded with Unicode lookarounds.

/** Whole-word alternatives; `suffix` allows a Turkish ending of up to that many letters. */
function words(alternatives: string[], suffix = 0): string {
  const tail = suffix > 0 ? `\\p{L}{0,${suffix}}` : '';
  return `(?<![\\p{L}\\p{N}])(?:${alternatives.join('|')})${tail}(?![\\p{L}\\p{N}])`;
}
const rx = (...parts: string[]) => new RegExp(parts.join('|'), 'iu');

// 1. Time: years 2024-2039, full dates, relative dates (TR & EN)
const TEMPORAL_PATTERN = rx(
  words(['202[4-9]', '203\\d']),
  '(?<!\\d)\\d{1,2}[./-]\\d{1,2}[./-]\\d{2,4}(?!\\d)',
  words(['bugün', 'dün', 'yarın', 'şimdi', 'tarihli', 'güncel'], 3),
  words(['bu\\s+hafta', 'bu\\s+ay', 'bu\\s+yıl', 'şu\\s+an'], 3),
  words(['today', 'yesterday', 'tomorrow', 'this\\s+week', 'this\\s+month', 'this\\s+year', 'latest', 'currently', 'recently', 'right\\s+now', 'nowadays'])
);
/** A question: question words or a question mark. */
const QUESTION_PATTERN = rx(
  words(['ne', 'neler', 'nedir', 'nasıl', 'kaç', 'kim', 'nerede', 'hangi', 'hangisi', 'mi', 'mı', 'mu', 'mü']),
  words(['what', 'when', 'where', 'who', 'how', 'which', 'why', 'is', 'are', 'did', 'will']),
  '\\?'
);

// 2. Weather (TR & EN)
const WEATHER_PATTERN = rx(
  words(['hava\\s+durumu', 'hava\\s+nas[ıi]l', 'yağmur', 'kar\\s+yağ[ıi]ş', 'rüzgar', 'fırtına', 'sıcaklık', 'kaç\\s+derece'], 4),
  words(['weather', 'forecast', 'snowing', 'raining', 'how\\s+hot', 'how\\s+cold'])
);

// 3. Money, markets and crypto (TR & EN)
const FINANCE_PATTERN = rx(
  words(['dolar', 'euro', 'sterlin', 'döviz', 'borsa', 'altın', 'faiz', 'enflasyon', 'kripto', 'bitcoin', 'ethereum', 'fiyat'], 5),
  words(['(?:döviz|dolar|euro|sterlin)\\s+kur', 'ons\\s+altın', 'altın\\s+ons', 'kaç\\s+tl', 'bist(?:\\s*100)?'], 4),
  words(['btc', 'eth', 'crypto', 'cryptocurrency', 'exchange\\s+rates?', 'currency', 'currencies', 'stocks?', 'stock\\s+price', 'gold\\s+price', 'interest\\s+rates?', 'inflation', 'market\\s+cap'])
);

// 4. News and current events (TR & EN)
const NEWS_PATTERN = rx(
  words(['haber', 'son\\s+dakika', 'gündem'], 5),
  words(['ne\\s+oldu', 'neler\\s+oldu']),
  words(['news', 'breaking\\s+news', 'headlines', 'what\\s+happened', 'current\\s+events'])
);

// 5. An explicit request to search (TR & EN). A search verb is required: "web sitesi oluştur"
// (build a website) or "google maps api" are not requests to search.
const EXPLICIT_SEARCH_PATTERN = rx(
  words(["web(?:'?de|te)\\s+(?:ara|arat|bul|araştır)", 'internet(?:te|ten)\\s+(?:ara|arat|bul|araştır|bak)', "google(?:'?da|'?la)\\s+(?:ara|arat|bul)", 'googlela'], 4),
  words(['web\\s+arac[ıi]\\s*(?:n[ıi]\\s+kullan|ile|yla)', 'arama\\s+yap', 'araştır'], 6),
  words(['search\\s+(?:the\\s+)?(?:web|internet|online)', 'web\\s+search', 'browse\\s+the\\s+web', 'look\\s+(?:it\\s+)?up\\s+online', 'find\\s+online', 'google\\s+it'])
);

// 6. Knowledge lookups about people, places, organisations and facts (TR & EN).
// Small local models either hallucinate or refuse on these ("bu bilgiye erişimim sınırlı").
const ENTITY_LOOKUP_PATTERN = /(?:\bkim(?:dir|dır|di)\b|\bkim\s*\?|hakkında\s+(?:bilgi|ne\s+biliyorsun|neler\s+biliyorsun)|biyografi|hayat[ıi]\s+(?:hakkında|nasıl)|\bnereli(?:dir)?\b|kaç\s+yaşında|ne\s+zaman\s+(?:doğdu|öldü|kuruldu|çıktı|yayınlandı|başladı)|nerede\s+(?:doğdu|yaşıyor|doğmuştur)|kurucusu|nüfusu|başkenti|\bwho\s+(?:is|was|are|were)\b|tell\s+me\s+about|biography|how\s+old\s+is|when\s+(?:was|did)\b[^?]*\b(?:born|founded|released|died?)\b|where\s+(?:is|was)\b[^?]*\b(?:born|from)\b|founder\s+of|ceo\s+of|population\s+of|capital\s+of)/i;

// Programming questions are answered from the model's own knowledge; only an explicit request
// sends them to the web.
const CODE_CONTEXT_PATTERN = rx(
  words(['kod', 'fonksiyon', 'hata', 'derle', 'algoritma', 'değişken', 'dizi', 'döngü', 'sınıf', 'metot', 'metod', 'kütüphane', 'bileşen', 'betik', 'komut'], 5),
  words(['code', 'function', 'functions', 'class', 'method', 'methods', 'variable', 'array', 'loop', 'error', 'exception', 'bug', 'compile', 'compiler', 'algorithm', 'library', 'framework', 'component', 'script', 'import', 'module', 'parameter', 'parameters', 'options', 'api', 'regex', 'query', 'syntax']),
  words(['python', 'javascript', 'typescript', 'java', 'kotlin', 'swift', 'rust', 'golang', 'php', 'ruby', 'html', 'css', 'json', 'yaml', 'sql', 'react', 'vue', 'angular', 'node', 'nodejs', 'npm', 'pip', 'git', 'docker', 'electron', 'ollama', 'llm']),
  '(?<![\\p{L}\\p{N}])(?:c\\+\\+|c#|\\.net)'
);

/** The user asked for a web search in so many words (used to explain that web access is off). */
export function isExplicitWebRequest(prompt: string): boolean {
  return typeof prompt === 'string' && EXPLICIT_SEARCH_PATTERN.test(prompt);
}

// 7. Answers in which the model refuses or sends the user to search the web themselves.
/** The model says it has no access to current information, or tells the user to search. */
const NO_ACCESS_PATTERNS: RegExp[] = [
  /bilgi(?:ye|lere)?\s+erişim(?:im)?\s+(?:yok|sınırlı|bulunmuyor|kısıtlı)/i,
  /erişimim\s+(?:yok|sınırlı|bulunmuyor|kısıtlı)/i,
  /internet(?:e)?\s+(?:erişimim|bağlantım)\s+(?:yok|bulunmuyor)/i,
  /(?:internette|internetten|google['’]?(?:da|dan)?|web(?:['’]?de))\s+(?:arama\s+yap|araştır|bak(?:abilir|manız)|arat)/i,
  /güncel\s+bilgi(?:ye|lere|m)?\s+(?:sahip\s+değilim|erişemiyorum|ulaşamıyorum|yok)/i,
  /(?:bilgi\s+kesim\s+tarih|eğitim\s+veriler(?:im|ime))/i,
  /yapay\s+zeka\s+(?:modeli\s+|asistanı\s+)?olarak/i,
  /hakkında\s+(?:yeterli\s+|herhangi\s+bir\s+|güncel\s+)?bilgi(?:m|ye)?\s+(?:yok|sahip\s+değilim|bulunmuyor|veremiyorum)/i,
  /\bi\s+(?:don['’]?t|do\s+not)\s+have\s+(?:access|real[-\s]?time|current|up[-\s]?to[-\s]?date|browsing|any\s+information|information)/i,
  /\bas\s+an\s+ai\b/i,
  /knowledge\s+cut[-\s]?off/i,
  /\bi\s+(?:can['’]?t|cannot)\s+(?:browse|access|search)/i,
  /(?:check|search|look\s+(?:it\s+)?up)\s+(?:online|the\s+(?:internet|web)|on\s+google)/i,
];
/** Plain uncertainty: a reason to search only in a short answer to a question about facts. */
const UNSURE_PATTERNS: RegExp[] = [
  /(?:tanımıyorum|bilmiyorum|emin\s+değilim|bilgim\s+yok)/i,
  /\bi\s+(?:don['’]?t|do\s+not)\s+know\b/i,
  /\bi['’]?m\s+not\s+(?:sure|aware|familiar)/i,
];

/**
 * True when a (short) answer is a refusal or tells the user to search online. With web access
 * enabled the app performs that search itself and answers again. Given the question, plain
 * uncertainty ("I'm not sure, but try arr.sort()") in an answer to a programming question does
 * not count: the answer is useful and a search would replace it.
 */
export function detectKnowledgeRefusal(answer: string, question = ''): boolean {
  if (!answer || typeof answer !== 'string') return false;
  const trimmed = answer.trim();
  if (!trimmed || trimmed.length > 900) return false;
  if (NO_ACCESS_PATTERNS.some((pattern) => pattern.test(trimmed))) return true;
  if (trimmed.length > 300 || CODE_CONTEXT_PATTERN.test(question)) return false;
  return UNSURE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Detects whether a user prompt has intent requiring web search.
 * Supports multi-lingual queries (Turkish, English, international financial/crypto/tech terms).
 */
export function detectWebSearchIntent(prompt: string): boolean {
  if (!prompt || typeof prompt !== 'string') return false;
  const trimmed = prompt.trim();
  if (trimmed.length < 3) return false;

  // An explicit request always searches, whatever the topic.
  if (EXPLICIT_SEARCH_PATTERN.test(trimmed)) {
    return true;
  }

  // Everything else is a guess from the topic; a programming question is not sent to the web.
  if (CODE_CONTEXT_PATTERN.test(trimmed)) {
    return false;
  }

  // Weather, news and prices always need current data.
  if (WEATHER_PATTERN.test(trimmed) || NEWS_PATTERN.test(trimmed) || FINANCE_PATTERN.test(trimmed)) {
    return true;
  }

  // People, places, organisations and other facts ("şebnem ferah kimdir", "who is ...")
  if (ENTITY_LOOKUP_PATTERN.test(trimmed)) {
    return true;
  }

  // A time reference in a question ("bugün ne oldu?", "latest iPhone model?")
  return TEMPORAL_PATTERN.test(trimmed) && QUESTION_PATTERN.test(trimmed);
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
