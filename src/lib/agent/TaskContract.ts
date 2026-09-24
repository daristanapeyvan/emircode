/**
 * TaskContract.ts
 * Evidence-Based Task Contract & Compiler Guard for Emir Code.
 * Extracts source constraints and generates enforceable validation criteria.
 *
 * Contracts are only produced where they can be verified reliably: building or restyling a
 * web page. Other tasks (bug fixes, refactors, Python/Node work in an existing project) get no
 * file-name contract, because guessing an artifact such as "src/index.js" blocked `finish` for
 * every task that did not happen to create that exact file.
 */

export type CriterionType =
  | 'file_exists'
  | 'min_size'
  | 'html_structure'
  | 'contains_style'
  | 'contains_script'
  | 'references_resolve'
  | 'viewport_meta'
  | 'links_work'
  | 'json_valid'
  | 'syntax_valid';

export interface ValidationCriterion {
  type: CriterionType;
  target: string;
  description: string;
  params?: Record<string, any>;
}

export interface TaskContract {
  id: string;
  goal: string;
  source_constraints: string[];
  expected_artifacts: string[];
  criteria: ValidationCriterion[];
}

export interface CompileContext {
  /** Relative paths of files already in the workspace. */
  projectFiles?: string[];
  /** Force styles/scripts to live inside the HTML file (single-file synthesis strategy). */
  singleFile?: boolean;
  /** Texts of the existing page's menu links ("Home", "About", …), to recognise requests about them. */
  menuTexts?: string[];
}

const WEB_PATTERN = /web\s*sitesi|web\s*sayfa|website|web\s*page|landing|\bsite(?:si|sine|nin|de|ye)?\b|\bsayfa|\bhtml\b|frontend|arayüz|portfolyo|portfolio/i;
const CREATE_PATTERN = /oluştur|yap(?:ar|abilir|)\b|yap\b|kur\b|hazırla|yarat|tasarla|geliştir|üret|yaz\b|create|build|make|generate|design|develop|write/i;
const STYLE_PATTERN = /\bstil|\bcss\b|tasarım|style|görünüm|renk|tema\b|theme|responsive|duyarlı/i;
const SCRIPT_PATTERN = /\bscript|javascript|\bjs\b|kod\s+etiket|etkileşim|interaktif|interactive|dinamik|dynamic/i;
const RESPONSIVE_PATTERN = /responsive|duyarlı|mobil|mobile|telefon|phone|tablet/i;
const NO_STYLE_PATTERN = /stil\s*(?:olmasın|istemiyorum|yok)|stilsiz|css\s*(?:olmasın|istemiyorum|yok)|without\s+(?:css|styles?)|no\s+(?:css|styles?)|unstyled/i;
const SINGLE_FILE_PATTERN = /başka\s+dosya\s+oluşturma|tek\s+(?:bir\s+)?dosya|single[\s-]+file|sadece\s+(?:bir\s+)?html|yalnızca\s+(?:bir\s+)?html|only\s+(?:one\s+)?html|inline|içinde\s+(?:stil|css|script)|gömülü/i;

/** Requests about links / navigation ("menü" alone is not enough: restaurant pages have menus). */
const LINKS_PATTERN = /\blink(?:s|ler\w*|leri\w*)?\b|bağlantı\w*|\bnav(?:bar|igasyon|igation)?\b|yönlendir\w*|redirect\w*|\banchor/i;
const LINK_INTENT = /çalış|work|git(?:sin|meli)|yönlendir|redirect|link|bağla|tıkla|click|açıl/i;
const REMOVE_INTENT = /\bkaldır|\bsil\b|\bsilin|remove|delete/i;

/** The page a web task is about: index.html (or src/index.html), else the only HTML file. */
export function findHtmlTarget(projectFiles: string[]): string | null {
  const html = projectFiles.filter((f) => /\.html?$/i.test(f));
  const preferred = html.find((f) => /^(?:src\/)?index\.html?$/i.test(f.replace(/\\/g, '/')));
  if (preferred) return preferred.replace(/\\/g, '/');
  return html.length === 1 ? html[0].replace(/\\/g, '/') : null;
}

/** Case folding that treats Turkish İ/I/ı/i alike (a plain "i" regex flag misses "İletişim"). */
const fold = (s: string) => s.toLocaleLowerCase('tr').replace(/ı/g, 'i').replace(/̇/g, '');

/** True when `text` contains `phrase` as whole words (case-insensitive, Unicode letters). */
export function mentionsPhrase(text: string, phrase: string): boolean {
  const p = fold(phrase.trim());
  if (p.length < 2) return false;
  const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'u').test(fold(text));
}

/** Menu link texts the request names — "Home About Services Contact, get these working". */
export function mentionedMenuTexts(goal: string, menuTexts: string[]): string[] {
  return Array.from(new Set(menuTexts.filter((t) => mentionsPhrase(goal, t))));
}

export class TaskCompiler {
  /**
   * Compiles user prompt into zero or more verifiable Task Contracts.
   * Employs Compiler Guard to guarantee user constraints map to concrete validation criteria.
   */
  static compile(prompt: string, context: CompileContext = {}): TaskContract[] {
    const trimmed = (prompt || '').trim();
    if (!trimmed) return [];

    const projectFiles = context.projectFiles || [];
    const sourceConstraints: string[] = [];

    // 1. Detect and isolate source constraints
    const constraintPatterns = [
      /(?:sadece|yalnızca|only|just)\s+([^.,;\n]+(?:oluşturulacak|yapılacak|kullanılacak|olsun|olacak|kullan)?)/gi,
      /(?:içinde|dahilinde|inline)\s+([^.,;\n]+(?:tanımlı\s+olacak|bulunacak|içerecek|dahil\s+olacak))/gi,
      /(?:başka\s+dosya\s+oluşturma|tek\s+(?:bir\s+)?dosya\s+olacak|single\s+file)/gi,
      /(?:stil|css|script|kod)\s+etiketleri\s+(?:de\s+)?tanımlı\s+olacak/gi,
    ];

    for (const pattern of constraintPatterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(trimmed)) !== null) {
        const found = match[0].trim();
        if (!sourceConstraints.includes(found)) {
          sourceConstraints.push(found);
        }
      }
    }

    const existingHtml = findHtmlTarget(projectFiles);
    const mentionsWeb = WEB_PATTERN.test(trimmed);
    const wantsStyle = STYLE_PATTERN.test(trimmed);
    const wantsScript = SCRIPT_PATTERN.test(trimmed);

    // A web contract is created for new web pages, for restyling an existing page, and for
    // making an existing page's links work (by name: "navbar linkleri", or by naming the links).
    const isNewWebPage = mentionsWeb && (CREATE_PATTERN.test(trimmed) || !existingHtml);
    const isRestyle = !!existingHtml && (wantsStyle || wantsScript) && (mentionsWeb || projectFiles.length <= 12);
    const namedLinks = mentionedMenuTexts(trimmed, context.menuTexts || []);
    const isLinkFix =
      !!existingHtml &&
      !REMOVE_INTENT.test(trimmed) &&
      ((LINKS_PATTERN.test(trimmed) && LINK_INTENT.test(trimmed)) ||
        namedLinks.length >= 3 ||
        (namedLinks.length >= 2 && LINK_INTENT.test(trimmed)));
    if (!isNewWebPage && !isRestyle && !isLinkFix) return [];

    const target = existingHtml || 'index.html';
    const inlineOnly = !!context.singleFile || SINGLE_FILE_PATTERN.test(trimmed);
    const expectedArtifacts = target === 'index.html' ? ['index.html', 'src/index.html'] : [target];
    const criteria: ValidationCriterion[] = [];

    // Baseline criterion: File must exist and have non-trivial size
    criteria.push({
      type: 'file_exists',
      target,
      description: `'${target}' dosyası diskte oluşturulmuş olmalıdır.`,
    });
    criteria.push({
      type: 'min_size',
      target,
      description: `'${target}' dosyası en az 100 bayt içerik barındırmalıdır.`,
      params: { minBytes: 100 },
    });
    criteria.push({
      type: 'html_structure',
      target,
      description: `'${target}' geçerli bir HTML5 belge yapısına (DOCTYPE, html, body) ve gerçek satır sonlarına sahip olmalıdır.`,
    });

    // COMPILER GUARD: Verify constraints map to criteria.
    // A styled result is the norm for any new page, so style is always required for new pages.
    if ((wantsStyle || isNewWebPage) && !NO_STYLE_PATTERN.test(trimmed)) {
      criteria.push({
        type: 'contains_style',
        target,
        description: inlineOnly
          ? `'${target}' içinde gömülü stil (<style>...</style>) tanımlanmış olmalıdır.`
          : `'${target}' için gerçek CSS kuralları tanımlanmış olmalıdır (<style> bloğu veya mevcut bir .css dosyası).`,
        params: { inlineOnly },
      });
    }

    if (wantsScript) {
      criteria.push({
        type: 'contains_script',
        target,
        description: inlineOnly
          ? `'${target}' içinde gömülü script (<script>...</script>) tanımlanmış olmalıdır.`
          : `'${target}' için çalışan JavaScript kodu olmalıdır (<script> bloğu veya mevcut bir .js dosyası).`,
        params: { inlineOnly },
      });
    }

    criteria.push({
      type: 'references_resolve',
      target,
      description: `'${target}' içinde bağlantı verilen tüm yerel CSS/JS dosyaları diskte mevcut olmalıdır.`,
    });

    if (isLinkFix) {
      criteria.push({
        type: 'links_work',
        target,
        description: `'${target}' menüsündeki her bağlantı çalışmalıdır: sayfadaki bir bölüme (id), var olan bir dosyaya ya da JavaScript ile ele alınan bir işleve gitmelidir.`,
      });
    }

    // Without the viewport meta tag no page is responsive on phones, whatever the CSS says.
    if (isNewWebPage || RESPONSIVE_PATTERN.test(trimmed)) {
      criteria.push({
        type: 'viewport_meta',
        target,
        description: `'${target}' <head> içinde <meta name="viewport" content="width=device-width, initial-scale=1.0"> içermelidir.`,
      });
    }

    return [
      {
        id: 'contract_web_1',
        goal: trimmed.split('.')[0].trim(),
        source_constraints: sourceConstraints,
        expected_artifacts: expectedArtifacts,
        criteria,
      },
    ];
  }

  /**
   * Merges a follow-up instruction (live steering, e.g. "stilleri de ekle") into the active
   * contracts so the new requirement is actually verified instead of being ignored.
   */
  static mergeDirective(contracts: TaskContract[], directive: string, context: CompileContext = {}): TaskContract[] {
    const extra = TaskCompiler.compile(directive, context);
    if (extra.length === 0) return contracts;
    if (contracts.length === 0) return extra;

    const merged = contracts.map((c) => ({ ...c, criteria: [...c.criteria] }));
    const base = merged[0];
    for (const crit of extra[0].criteria) {
      const exists = base.criteria.some((c) => c.type === crit.type);
      if (!exists) {
        base.criteria.push({ ...crit, target: base.criteria[0]?.target || crit.target });
      }
    }
    return merged;
  }
}
