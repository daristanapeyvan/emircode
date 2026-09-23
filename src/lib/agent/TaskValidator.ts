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

    for (const crit of contract.criteria) {
      let content = await fileProvider(crit.target);
      if (content === null && (crit.target === 'index.html' || crit.target === 'src/index.html')) {
        const altTarget = crit.target === 'index.html' ? 'src/index.html' : 'index.html';
        const altContent = await fileProvider(altTarget);
        if (altContent !== null) {
          content = altContent;
        }
      }

      switch (crit.type) {
        case 'file_exists': {
          if (content === null) {
            criterionResults.push({
              criterion: crit,
              passed: false,
              error: `'${crit.target}' dosyası bulunamadı.`,
            });
            missingEvidence.push(crit.description);
          } else {
            criterionResults.push({ criterion: crit, passed: true });
          }
          break;
        }

        case 'min_size': {
          const minBytes = crit.params?.minBytes || 1;
          if (content === null || content.trim().length < minBytes) {
            criterionResults.push({
              criterion: crit,
              passed: false,
              error: `'${crit.target}' içeriği çok kısa veya boş (${content?.trim().length || 0} < ${minBytes} bayt).`,
            });
            missingEvidence.push(crit.description);
          } else {
            criterionResults.push({ criterion: crit, passed: true });
          }
          break;
        }

        case 'html_structure': {
          if (!content) {
            criterionResults.push({ criterion: crit, passed: false, error: 'Dosya içeriği boş.' });
            missingEvidence.push(crit.description);
            break;
          }
          const lower = content.toLowerCase();
          const hasDocTypeOrHtml = lower.includes('<!doctype') || lower.includes('<html');
          const hasBody = lower.includes('<body') && lower.includes('</body>');
          const hasClosingHtml = lower.includes('</html>');

          if (!hasDocTypeOrHtml || (!hasBody && !hasClosingHtml)) {
            criterionResults.push({
              criterion: crit,
              passed: false,
              error: `'${crit.target}' geçerli bir HTML5 iskeletine sahip değil. (<html, <body, </html> etiketleri eksik)`,
            });
            missingEvidence.push(crit.description);
          } else {
            criterionResults.push({ criterion: crit, passed: true });
          }
          break;
        }

        case 'contains_style': {
          if (!content) {
            criterionResults.push({ criterion: crit, passed: false, error: 'Dosya içeriği boş.' });
            missingEvidence.push(crit.description);
            break;
          }
          // Check for external link tags
          const hasExternalCssLink = /<link\s+[^>]*rel=["']stylesheet["']/i.test(content);
          // Validate real <style> block with actual CSS rules (not just empty tag)
          const styleMatch = content.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
          const hasInlineStyleAttr = /style\s*=\s*["'][^"']{5,}["']/i.test(content);

          let hasValidCss = false;
          if (styleMatch && styleMatch[1]) {
            const cssBody = styleMatch[1].trim();
            // Check for at least one CSS rule-like structure (selector { property: value })
            if (cssBody.length >= 10 && cssBody.includes('{') && cssBody.includes('}')) {
              hasValidCss = true;
            }
          }

          if (hasValidCss || (hasInlineStyleAttr && !hasExternalCssLink)) {
            criterionResults.push({ criterion: crit, passed: true });
          } else {
            const errorMsg = hasExternalCssLink
              ? `'${crit.target}' içinde harici '<link rel="stylesheet">' tespit edildi; stiller dosya içine (<style>...</style>) gömülü olmalıdır.`
              : `'${crit.target}' dosyasında geçerli bir <style> bloğu veya stil tanımları bulunamadı.`;
            criterionResults.push({
              criterion: crit,
              passed: false,
              error: errorMsg,
            });
            missingEvidence.push(errorMsg);
          }
          break;
        }

        case 'contains_script': {
          if (!content) {
            criterionResults.push({ criterion: crit, passed: false, error: 'Dosya içeriği boş.' });
            missingEvidence.push(crit.description);
            break;
          }
          // Check for external script src tags
          const hasExternalScriptSrc = /<script\s+[^>]*src=/i.test(content);
          // Validate real <script> block with actual JS code (excluding external src)
          const scriptMatches = content.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi);
          let hasValidJs = false;
          if (scriptMatches) {
            for (const sm of scriptMatches) {
              const body = sm.replace(/<script[^>]*>|<\/script>/gi, '').trim();
              if (body.length >= 10) {
                hasValidJs = true;
                break;
              }
            }
          }

          if (hasValidJs) {
            criterionResults.push({ criterion: crit, passed: true });
          } else {
            const errorMsg = hasExternalScriptSrc
              ? `'${crit.target}' içinde harici '<script src="..."> tespit edildi; JavaScript kodları dosya içine (<script>...</script>) gömülü olmalıdır.`
              : `'${crit.target}' dosyasında geçerli bir <script> bloğu veya JavaScript kodu bulunamadı.`;
            criterionResults.push({
              criterion: crit,
              passed: false,
              error: errorMsg,
            });
            missingEvidence.push(errorMsg);
          }
          break;
        }

        case 'json_valid': {
          if (!content) {
            criterionResults.push({ criterion: crit, passed: false, error: 'Dosya içeriği boş.' });
            missingEvidence.push(crit.description);
            break;
          }
          try {
            JSON.parse(content);
            criterionResults.push({ criterion: crit, passed: true });
          } catch (e: any) {
            criterionResults.push({
              criterion: crit,
              passed: false,
              error: `JSON sözdizim hatası: ${e.message}`,
            });
            missingEvidence.push(crit.description);
          }
          break;
        }

        case 'syntax_valid': {
          if (!content) {
            criterionResults.push({ criterion: crit, passed: false, error: 'Dosya içeriği boş.' });
            missingEvidence.push(crit.description);
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
            criterionResults.push({ criterion: crit, passed: true });
          } else {
            criterionResults.push({
              criterion: crit,
              passed: false,
              error: `'${crit.target}' dosyasında dengesiz parantez ({}) sözdizimi tespit edildi.`,
            });
            missingEvidence.push(crit.description);
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
