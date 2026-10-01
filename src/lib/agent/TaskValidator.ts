/**
 * TaskValidator.ts
 * Evidence-Based Structural and Syntactic Validator for Emir Code.
 * Moves beyond shallow string matching to parse structure, syntax, and criteria evidence.
 */

import { TaskContract, ValidationCriterion } from './TaskContract';

import { check, renderCheck, CheckText } from './checkTexts';
export interface CriterionResult {
  criterion: ValidationCriterion;
  passed: boolean;
  /** Why it failed, in English (for the model). */
  error?: string;
}

export interface ValidationReport {
  passed: boolean;
  criterionResults: CriterionResult[];
  /** What is still missing, in English: the model is told exactly this. */
  missingEvidence: string[];
  /** The same as translatable texts, for the interface (see renderCheck). */
  missingTexts: CheckText[];
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
  return (await deadMenuLinkTexts(page, html, fileProvider)).map((t) => renderCheck(t, 'en'));
}

/** The dead menu links of a page as translatable texts. */
export async function deadMenuLinkTexts(page: string, html: string, fileProvider: FileContentProvider): Promise<CheckText[]> {
  const links = extractMenuLinks(html);
  if (links.length === 0) return [];
  const scripts = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join('\n');
  const scriptRoutesMenu =
    /addEventListener\s*\(\s*['"](?:click|hashchange)['"]/.test(scripts) &&
    /\bnav\b|header|nav-link|nav-item|data-(?:page|section|target|tab|view)|querySelectorAll\(\s*['"]a\b|getElementsByTagName\(\s*['"]a['"]|hashchange|location\.hash/.test(scripts);
  if (scriptRoutesMenu) return [];
  const ids = new Set([...html.matchAll(/\b(?:id|name)\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]));
  const problems: CheckText[] = [];
  for (const link of links) {
    const label = link.text || link.href || renderCheck(check('linkLabel'), 'en');
    if (/\bonclick\s*=|\bdata-(?:page|section|target|tab|view)\s*=/i.test(link.attrs)) continue;
    const href = (link.href ?? '').trim();
    if (!href || href === '#' || /^javascript:/i.test(href)) {
      problems.push(check('deadLinkNowhere', { label, line: link.line, href }));
    } else if (isRemoteRef(href)) {
      continue;
    } else if (href.startsWith('#')) {
      const id = href.slice(1);
      if (!ids.has(id)) problems.push(check('deadLinkMissingId', { label, line: link.line, id }));
    } else if ((await fileProvider(resolveRelative(page, href))) === null) {
      problems.push(check('deadLinkMissingFile', { label, line: link.line, href }));
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
    const missingTexts: CheckText[] = [];

    /** A failed criterion; `restate` reports the criterion's own requirement instead of the finding. */
    const fail = (crit: ValidationCriterion, finding: CheckText, restate = false) => {
      criterionResults.push({ criterion: crit, passed: false, error: renderCheck(finding, 'en') });
      const reported = restate ? crit.text : finding;
      missingTexts.push(reported);
      missingEvidence.push(renderCheck(reported, 'en'));
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
          if (content === null) fail(crit, check('fileNotFound', { target: crit.target }), true);
          else pass(crit);
          break;
        }

        case 'min_size': {
          const minBytes = crit.params?.minBytes || 1;
          if (content === null || content.trim().length < minBytes) {
            fail(crit, check('tooShort', { target: crit.target, length: content?.trim().length || 0, min: minBytes }), true);
          } else {
            pass(crit);
          }
          break;
        }

        case 'html_structure': {
          if (!content) {
            fail(crit, check('fileEmpty'), true);
            break;
          }
          if (looksJsonEscaped(content)) {
            fail(crit, check('jsonEscaped', { target }));
            break;
          }
          const lower = content.toLowerCase();
          const hasDocTypeOrHtml = lower.includes('<!doctype') || lower.includes('<html');
          const hasBody = lower.includes('<body') && lower.includes('</body>');
          const hasClosingHtml = lower.includes('</html>');

          if (!hasDocTypeOrHtml || (!hasBody && !hasClosingHtml)) {
            fail(crit, check('notHtml5', { target }), true);
          } else {
            pass(crit);
          }
          break;
        }

        case 'contains_style': {
          if (!content) {
            fail(crit, check('fileEmpty'), true);
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
            const where = headLine ? check('whereBeforeHead', { line: headLine }) : check('whereInHead');
            const unlinked =
              externalSheets.length === 0
                ? await findUnlinkedAsset(target, STYLE_CANDIDATES, externalSheets, (css) => css.includes('{') && css.includes('}'), fileProvider)
                : null;
            const finding =
              externalSheets.length > 0 && inlineOnly
                ? check('externalStyleInline', { target })
                : externalSheets.length > 0
                ? check('externalStyleMissing', { target, files: externalSheets.join(', ') })
                : unlinked && !inlineOnly
                ? check('styleNotLinked', { target, file: unlinked, where })
                : check('noStyle', { target, where });
            fail(crit, finding);
          }
          break;
        }

        case 'contains_script': {
          if (!content) {
            fail(crit, check('fileEmpty'), true);
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
            const where = bodyLine ? check('whereBeforeBody', { line: bodyLine }) : check('whereEndOfPage');
            const unlinked =
              externalScripts.length === 0 && !markupInScript
                ? await findUnlinkedAsset(target, SCRIPT_CANDIDATES, externalScripts, looksLikeJavaScript, fileProvider)
                : null;
            const finding =
              markupInScript
                ? check('markupInScript', { target })
                : externalScripts.length > 0 && inlineOnly
                ? check('externalScriptInline', { target })
                : externalScripts.length > 0
                ? check('externalScriptMissing', { target, files: externalScripts.join(', ') })
                : unlinked && !inlineOnly
                ? check('scriptNotLinked', { target, file: unlinked, where })
                : emptyBlockLines.length > 0
                ? // "Add a <script> block" made a 7B model append a new empty block on every step.
                  check('emptyScript', {
                    target,
                    line: emptyBlockLines[0],
                    extra:
                      emptyBlockLines.length > 1
                        ? [check('emptyScriptExtra', { lines: `${emptyBlockLines.slice(1, 6).join(', ')}${emptyBlockLines.length > 6 ? ', …' : ''}` })]
                        : '',
                  })
                : check('noScript', { target, where });
            fail(crit, finding);
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
            fail(crit, check('missingReferences', { target, files: missing.join(', ') }));
          } else {
            pass(crit);
          }
          break;
        }

        case 'links_work': {
          if (!content) {
            fail(crit, check('fileEmpty'), true);
            break;
          }
          const dead = await deadMenuLinkTexts(target, content, fileProvider);
          if (dead.length === 0) {
            pass(crit);
          } else {
            fail(crit, check('deadLinks', { target, links: dead.slice(0, 6) }));
          }
          break;
        }

        case 'viewport_meta': {
          if (!content) {
            fail(crit, check('fileEmpty'), true);
            break;
          }
          if (/<meta\b[^>]*name\s*=\s*["']?viewport["']?[^>]*>/i.test(content)) {
            pass(crit);
          } else {
            fail(crit, check('noViewport', { target }));
          }
          break;
        }

        case 'json_valid': {
          if (!content) {
            fail(crit, check('fileEmpty'), true);
            break;
          }
          try {
            JSON.parse(content);
            pass(crit);
          } catch (e: any) {
            fail(crit, check('jsonSyntax', { error: e.message }), true);
          }
          break;
        }

        case 'syntax_valid': {
          if (!content) {
            fail(crit, check('fileEmpty'), true);
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
            fail(crit, check('unbalancedBraces', { target: crit.target }), true);
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
      missingTexts,
    };
  }
}
