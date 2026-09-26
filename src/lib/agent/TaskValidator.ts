/**
 * TaskValidator.ts
 * Evidence-Based Structural and Syntactic Validator for Emir Code.
 * Moves beyond shallow string matching to parse structure, syntax, and criteria evidence.
 */

import { TaskContract, ValidationCriterion } from './TaskContract';

export interface CriterionResult {
  criterion: ValidationCriterion;
  passed: boolean;
  error?: string;
}

export interface ValidationReport {
  passed: boolean;
  criterionResults: CriterionResult[];
  missingEvidence: string[];
}

export type FileContentProvider = (relativePath: string) => Promise<string | null>;

/**
 * True when a file was written with JSON string escapes instead of real characters
 * (e.g. `<html lang=\"tr\">\n<head>` on a single line). Browsers then ignore class names,
 * charset and scripts, which is why such pages looked like "plain HTML without styles".
 */
export function looksJsonEscaped(content: string): boolean {
  if (!content || content.length < 40) return false;
  const realNewlines = (content.match(/\n/g) || []).length;
  const literalNewlines = (content.match(/\\n/g) || []).length;
  const escapedQuotes = (content.match(/\\"/g) || []).length;
  if (realNewlines > 1 || escapedQuotes < 2 || (literalNewlines < 3 && escapedQuotes < 4)) return false;
  // A document written as one JSON string has an escape on every line or attribute (and escaped
  // quotes around attributes/strings); a minified bundle or a one-line data string with many
  // "\n" inside a string literal is valid code and must not be "unescaped".
  return (literalNewlines + escapedQuotes) * 150 >= content.length;
}

/**
 * True when a script body is plausibly JavaScript. Small models sometimes put HTML markup
 * inside <script> ("<script><h1>Merhaba</h1></script>"), which satisfied a length-only check.
 */
export function looksLikeJavaScript(body: string): boolean {
  const code = (body || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .trim();
  if (code.length < 10) return false;
  if (/^<\/?[a-zA-Z!]/.test(code)) return false;
  return /[(=;{]/.test(code) || /\b(?:function|const|let|var|document|window|console|return|import|export)\b/.test(code);
}

function resolveRelative(fromFile: string, ref: string): string {
  const baseParts = fromFile.replace(/\\/g, '/').split('/').slice(0, -1);
  const clean = ref.split('#')[0].split('?')[0];
  const parts = clean.startsWith('/') ? [] : [...baseParts];
  for (const seg of clean.replace(/^\/+/, '').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

function isRemoteRef(ref: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref.trim());
}

export function extractLocalStylesheets(html: string): string[] {
  const refs: string[] = [];
  const re = /<link\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) continue;
    const href = tag.match(/href\s*=\s*["']([^"']+)["']/i);
    if (href && !isRemoteRef(href[1])) refs.push(href[1].trim());
  }
  return refs;
}

export function extractLocalScripts(html: string): string[] {
  const refs: string[] = [];
  const re = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (!isRemoteRef(m[1])) refs.push(m[1].trim());
  }
  return refs;
}

export interface MenuLink {
  text: string;
  href: string | null;
  /** 1-based line of the <a> tag. */
  line: number;
  attrs: string;
}

/** Links of the page's menu: the anchors inside <nav>, or inside <header> when there is no <nav>. */
export function extractMenuLinks(html: string): MenuLink[] {
  const regions: Array<{ start: number; text: string }> = [];
  const collect = (tag: string) => {
    const re = new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) regions.push({ start: m.index, text: m[0] });
  };
  collect('nav');
  if (regions.length === 0) collect('header');
  const links: MenuLink[] = [];
  for (const region of regions) {
    const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(region.text)) !== null) {
      links.push({
        text: m[2].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(),
        href: m[1].match(/\bhref\s*=\s*["']([^"']*)["']/i)?.[1] ?? null,
        line: html.slice(0, region.start + m.index).split('\n').length,
        attrs: m[1],
      });
    }
  }
  return links;
}

/**
 * Menu links that lead nowhere: href="#" (or none), an anchor whose target id does not exist, or a
 * local page that does not exist. Links handled in JavaScript (onclick / data-* attributes, or a
 * script that attaches click or hashchange handlers to the menu) count as working.
 */
export async function deadMenuLinks(page: string, html: string, fileProvider: FileContentProvider): Promise<string[]> {
  const links = extractMenuLinks(html);
  if (links.length === 0) return [];
  const scripts = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join('\n');
  const scriptRoutesMenu =
    /addEventListener\s*\(\s*['"](?:click|hashchange)['"]/.test(scripts) &&
    /\bnav\b|header|nav-link|nav-item|data-(?:page|section|target|tab|view)|querySelectorAll\(\s*['"]a\b|getElementsByTagName\(\s*['"]a['"]|hashchange|location\.hash/.test(scripts);
  if (scriptRoutesMenu) return [];
  const ids = new Set([...html.matchAll(/\b(?:id|name)\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]));
  const problems: string[] = [];
  for (const link of links) {
    const label = link.text || link.href || 'bağlantı';
    if (/\bonclick\s*=|\bdata-(?:page|section|target|tab|view)\s*=/i.test(link.attrs)) continue;
    const href = (link.href ?? '').trim();
    if (!href || href === '#' || /^javascript:/i.test(href)) {
      problems.push(`"${label}" (satır ${link.line}) hiçbir yere gitmiyor (href="${href}")`);
    } else if (isRemoteRef(href)) {
      continue;
    } else if (href.startsWith('#')) {
      const id = href.slice(1);
      if (!ids.has(id)) problems.push(`"${label}" (satır ${link.line}) #${id} bölümüne gidiyor ama sayfada id="${id}" olan bir öğe yok`);
    } else if ((await fileProvider(resolveRelative(page, href))) === null) {
      problems.push(`"${label}" (satır ${link.line}) "${href}" sayfasına gidiyor ama bu dosya yok`);
    }
  }
  return problems;
}

/** 1-based line of the last occurrence of `tag` (case-insensitive), or 0. */
function lineOfTag(content: string, tag: string): number {
  const idx = content.toLowerCase().lastIndexOf(tag);
  return idx === -1 ? 0 : content.slice(0, idx).split('\n').length;
}

const SCRIPT_CANDIDATES = ['script.js', 'main.js', 'app.js', 'index.js', 'js/script.js', 'js/main.js', 'js/app.js'];
const STYLE_CANDIDATES = ['style.css', 'styles.css', 'main.css', 'index.css', 'css/style.css', 'css/styles.css', 'css/main.css'];

/**
 * A JS/CSS file next to the page that has real content but is not linked from it (small models
 * write script.js and forget the <script src> tag). Returns the page-relative reference.
 */
async function findUnlinkedAsset(
  page: string,
  candidates: string[],
  linked: string[],
  isValid: (text: string) => boolean,
  fileProvider: FileContentProvider
): Promise<string | null> {
  const linkedPaths = new Set(linked.map((ref) => resolveRelative(page, ref)));
  for (const candidate of candidates) {
    const resolved = resolveRelative(page, candidate);
    if (linkedPaths.has(resolved)) continue;
    const text = await fileProvider(resolved);
    if (text && isValid(text)) return candidate;
  }
  return null;
}

export class TaskValidator {
  /**
   * Validates a TaskContract against actual disk/workspace state via evidence provider.
   */
  static async validate(
    contract: TaskContract,
    fileProvider: FileContentProvider
  ): Promise<ValidationReport> {
    const criterionResults: CriterionResult[] = [];
    const missingEvidence: string[] = [];

    const fail = (crit: ValidationCriterion, error: string, evidence?: string) => {
      criterionResults.push({ criterion: crit, passed: false, error });
      missingEvidence.push(evidence || error);
    };
    const pass = (crit: ValidationCriterion) => criterionResults.push({ criterion: crit, passed: true });

    for (const crit of contract.criteria) {
      let target = crit.target;
      let content = await fileProvider(crit.target);
      if (content === null && (crit.target === 'index.html' || crit.target === 'src/index.html')) {
        const altTarget = crit.target === 'index.html' ? 'src/index.html' : 'index.html';
        const altContent = await fileProvider(altTarget);
        if (altContent !== null) {
          content = altContent;
          target = altTarget;
        }
      }

      switch (crit.type) {
        case 'file_exists': {
          if (content === null) fail(crit, `'${crit.target}' dosyası bulunamadı.`, crit.description);
          else pass(crit);
          break;
        }

        case 'min_size': {
          const minBytes = crit.params?.minBytes || 1;
          if (content === null || content.trim().length < minBytes) {
            fail(
              crit,
              `'${crit.target}' içeriği çok kısa veya boş (${content?.trim().length || 0} < ${minBytes} bayt).`,
              crit.description
            );
          } else {
            pass(crit);
          }
          break;
        }

        case 'html_structure': {
          if (!content) {
            fail(crit, 'Dosya içeriği boş.', crit.description);
            break;
          }
          if (looksJsonEscaped(content)) {
            fail(
              crit,
              `'${target}' JSON kaçış karakterleriyle bozulmuş (gerçek satır sonu yerine "\\n", tırnak yerine \\"). Dosyayı gerçek satır sonları ve normal tırnaklarla baştan yazın.`
            );
            break;
          }
          const lower = content.toLowerCase();
          const hasDocTypeOrHtml = lower.includes('<!doctype') || lower.includes('<html');
          const hasBody = lower.includes('<body') && lower.includes('</body>');
          const hasClosingHtml = lower.includes('</html>');

          if (!hasDocTypeOrHtml || (!hasBody && !hasClosingHtml)) {
            fail(
              crit,
              `'${target}' geçerli bir HTML5 iskeletine sahip değil. (<html, <body, </html> etiketleri eksik)`,
              crit.description
            );
          } else {
            pass(crit);
          }
          break;
        }

        case 'contains_style': {
          if (!content) {
            fail(crit, 'Dosya içeriği boş.', crit.description);
            break;
          }
          const inlineOnly = !!crit.params?.inlineOnly;
          // Validate real <style> block with actual CSS rules (not just empty tag)
          let hasValidCss = false;
          const styleBlocks = content.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || [];
          for (const block of styleBlocks) {
            const cssBody = block.replace(/<\/?style[^>]*>/gi, '').trim();
            if (cssBody.length >= 10 && cssBody.includes('{') && cssBody.includes('}')) {
              hasValidCss = true;
              break;
            }
          }

          const externalSheets = extractLocalStylesheets(content);
          let hasValidExternalCss = false;
          if (!hasValidCss && !inlineOnly) {
            for (const href of externalSheets) {
              const css = await fileProvider(resolveRelative(target, href));
              if (css && css.trim().length >= 10 && css.includes('{') && css.includes('}')) {
                hasValidExternalCss = true;
                break;
              }
            }
          }

          if (hasValidCss || hasValidExternalCss) {
            pass(crit);
          } else {
            const headLine = lineOfTag(content, '</head>');
            const where = headLine ? `</head> etiketinden (satır ${headLine}) hemen önce` : '<head> içine';
            const unlinked =
              externalSheets.length === 0
                ? await findUnlinkedAsset(target, STYLE_CANDIDATES, externalSheets, (css) => css.includes('{') && css.includes('}'), fileProvider)
                : null;
            const errorMsg =
              externalSheets.length > 0 && inlineOnly
                ? `'${target}' içinde harici '<link rel="stylesheet">' tespit edildi; stiller dosya içine (<style>...</style>) gömülü olmalıdır.`
                : externalSheets.length > 0
                ? `'${target}' harici stil dosyasına (${externalSheets.join(', ')}) bağlanıyor ama bu dosya yok veya içinde CSS kuralı yok.`
                : unlinked && !inlineOnly
                ? `'${target}' stil yüklemiyor: '${unlinked}' dosyası var ama sayfaya bağlanmamış. ${where} <link rel="stylesheet" href="${unlinked}"> satırını ekleyin.`
                : `'${target}' dosyasında geçerli bir <style> bloğu veya stil tanımları bulunamadı. ${where} CSS kuralları içeren bir <style>...</style> bloğu ekleyin.`;
            fail(crit, errorMsg);
          }
          break;
        }

        case 'contains_script': {
          if (!content) {
            fail(crit, 'Dosya içeriği boş.', crit.description);
            break;
          }
          const inlineOnly = !!crit.params?.inlineOnly;
          // Validate real <script> block with actual JS code (excluding external src)
          const scriptRe = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi;
          let hasValidJs = false;
          let markupInScript = false;
          /** Lines of inline <script> blocks that hold only comments or nothing. */
          const emptyBlockLines: number[] = [];
          let sm: RegExpExecArray | null;
          while ((sm = scriptRe.exec(content)) !== null) {
            const body = sm[1].trim();
            if (looksLikeJavaScript(body)) {
              hasValidJs = true;
              break;
            }
            if (/^<\/?[a-zA-Z!]/.test(body)) markupInScript = true;
            else if (!body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').trim()) {
              emptyBlockLines.push(content.slice(0, sm.index).split('\n').length);
            }
          }

          const externalScripts = extractLocalScripts(content);
          let hasValidExternalJs = false;
          if (!hasValidJs && !inlineOnly) {
            for (const src of externalScripts) {
              const js = await fileProvider(resolveRelative(target, src));
              if (js && looksLikeJavaScript(js)) {
                hasValidExternalJs = true;
                break;
              }
            }
          }

          if (hasValidJs || hasValidExternalJs) {
            pass(crit);
          } else {
            const bodyLine = lineOfTag(content, '</body>');
            const where = bodyLine ? `</body> etiketinden (satır ${bodyLine}) hemen önce` : 'sayfanın sonuna';
            const unlinked =
              externalScripts.length === 0 && !markupInScript
                ? await findUnlinkedAsset(target, SCRIPT_CANDIDATES, externalScripts, looksLikeJavaScript, fileProvider)
                : null;
            const errorMsg =
              markupInScript
                ? `'${target}' içindeki <script> bloğunda JavaScript yerine HTML işaretlemesi var; <script> içine çalışan JavaScript kodu yazın (ör. form doğrulaması için addEventListener).`
                : externalScripts.length > 0 && inlineOnly
                ? `'${target}' içinde harici '<script src="..."> tespit edildi; JavaScript kodları dosya içine (<script>...</script>) gömülü olmalıdır.`
                : externalScripts.length > 0
                ? `'${target}' harici script dosyasına (${externalScripts.join(', ')}) bağlanıyor ama bu dosya yok veya JavaScript içermiyor.`
                : unlinked && !inlineOnly
                ? `'${target}' JavaScript yüklemiyor: '${unlinked}' dosyası var ama sayfaya bağlanmamış. ${where} <script src="${unlinked}"></script> satırını ekleyin.`
                : emptyBlockLines.length > 0
                ? // "Add a <script> block" made a 7B model append a new empty block on every step.
                  `'${target}' içindeki <script> bloğu (satır ${emptyBlockLines[0]}) boş: yalnızca yorum var, JavaScript kodu yok. Yeni <script> bloğu eklemeyin; çalışan kodu bu bloğun içine yazın.${
                    emptyBlockLines.length > 1 ? ` Fazladan boş <script> bloklarını (satır ${emptyBlockLines.slice(1, 6).join(', ')}${emptyBlockLines.length > 6 ? ', …' : ''}) silin.` : ''
                  }`
                : `'${target}' dosyasında geçerli bir <script> bloğu veya JavaScript kodu bulunamadı. ${where} çalışan JavaScript içeren bir <script>...</script> bloğu ekleyin.`;
            fail(crit, errorMsg);
          }
          break;
        }

        case 'references_resolve': {
          if (!content) {
            pass(crit); // file_exists already reports the missing file
            break;
          }
          const missing: string[] = [];
          for (const ref of [...extractLocalStylesheets(content), ...extractLocalScripts(content)]) {
            const resolved = resolveRelative(target, ref);
            const refContent = await fileProvider(resolved);
            if (refContent === null || !refContent.trim()) missing.push(ref);
          }
          if (missing.length > 0) {
            fail(
              crit,
              `'${target}' mevcut olmayan veya boş dosyalara bağlanıyor: ${missing.join(', ')}. Bu dosyaları oluşturun ya da içeriklerini sayfaya gömün.`
            );
          } else {
            pass(crit);
          }
          break;
        }

        case 'links_work': {
          if (!content) {
            fail(crit, 'Dosya içeriği boş.', crit.description);
            break;
          }
          const dead = await deadMenuLinks(target, content, fileProvider);
          if (dead.length === 0) {
            pass(crit);
          } else {
            fail(
              crit,
              `'${target}' menüsünde çalışmayan bağlantılar var: ${dead.slice(0, 6).join('; ')}. Her bağlantıyı sayfadaki bir bölüme bağlayın (ör. href="#hakkimizda" ve o bölümde id="hakkimizda"), var olan bir sayfaya yönlendirin ya da tıklamayı JavaScript ile ele alın.`
            );
          }
          break;
        }

        case 'viewport_meta': {
          if (!content) {
            fail(crit, 'Dosya içeriği boş.', crit.description);
            break;
          }
          if (/<meta\b[^>]*name\s*=\s*["']?viewport["']?[^>]*>/i.test(content)) {
            pass(crit);
          } else {
            fail(
              crit,
              `'${target}' içinde <meta name="viewport" content="width=device-width, initial-scale=1.0"> yok; sayfa telefonlarda responsive görünmez. Bunu <head> içine ekleyin.`
            );
          }
          break;
        }

        case 'json_valid': {
          if (!content) {
            fail(crit, 'Dosya içeriği boş.', crit.description);
            break;
          }
          try {
            JSON.parse(content);
            pass(crit);
          } catch (e: any) {
            fail(crit, `JSON sözdizim hatası: ${e.message}`, crit.description);
          }
          break;
        }

        case 'syntax_valid': {
          if (!content) {
            fail(crit, 'Dosya içeriği boş.', crit.description);
            break;
          }
          // Balanced bracket validation
          let balance = 0;
          for (let i = 0; i < content.length; i++) {
            if (content[i] === '{') balance++;
            else if (content[i] === '}') balance--;
            if (balance < 0) break;
          }
          if (balance === 0) {
            pass(crit);
          } else {
            fail(crit, `'${crit.target}' dosyasında dengesiz parantez ({}) sözdizimi tespit edildi.`, crit.description);
          }
          break;
        }
      }
    }

    const passed = criterionResults.every((r) => r.passed);
    return {
      passed,
      criterionResults,
      missingEvidence,
    };
  }
}
