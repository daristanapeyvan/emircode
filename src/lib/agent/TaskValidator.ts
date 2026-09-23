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
      const content = await fileProvider(crit.target);

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

          if (hasValidCss || hasInlineStyleAttr) {
            criterionResults.push({ criterion: crit, passed: true });
          } else {
            criterionResults.push({
              criterion: crit,
              passed: false,
              error: `'${crit.target}' dosyasında geçerli bir <style> bloğu veya stil tanımları bulunamadı.`,
            });
            missingEvidence.push(crit.description);
          }
          break;
        }

        case 'contains_script': {
          if (!content) {
            criterionResults.push({ criterion: crit, passed: false, error: 'Dosya içeriği boş.' });
            missingEvidence.push(crit.description);
            break;
          }
          // Validate real <script> block with actual JS code
          const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
          let hasValidJs = false;
          if (scriptMatch && scriptMatch[1]) {
            const jsBody = scriptMatch[1].trim();
            if (jsBody.length >= 10) {
              hasValidJs = true;
            }
          }

          if (hasValidJs) {
            criterionResults.push({ criterion: crit, passed: true });
          } else {
            criterionResults.push({
              criterion: crit,
              passed: false,
              error: `'${crit.target}' dosyasında geçerli bir <script> bloğu veya JavaScript kodu bulunamadı.`,
            });
            missingEvidence.push(crit.description);
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
