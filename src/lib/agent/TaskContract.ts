/**
 * TaskContract.ts
 * Evidence-Based Task Contract & Compiler Guard for Emir Code.
 * Extracts source constraints and generates enforceable validation criteria.
 */

export type CriterionType =
  | 'file_exists'
  | 'min_size'
  | 'html_structure'
  | 'contains_style'
  | 'contains_script'
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

export class TaskCompiler {
  /**
   * Compiles user prompt into one or more verifiable Task Contracts.
   * Employs Compiler Guard to guarantee user constraints map to concrete validation criteria.
   */
  static compile(prompt: string): TaskContract[] {
    const trimmed = (prompt || '').trim();
    if (!trimmed) return [];

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

    // 2. Determine Primary Goal and Expected Artifacts
    const lower = trimmed.toLowerCase();
    const isWeb = /web\s*sitesi|web\s*sayfa|website|site|html|sayfa|frontend|arayüz/i.test(lower);
    const isPython = /python|flask|fastapi|django|\.py\b/i.test(lower);
    const isNode = /express|node|backend|\.js\b|\.ts\b/i.test(lower);

    const contracts: TaskContract[] = [];
    const expectedArtifacts: string[] = [];
    const criteria: ValidationCriterion[] = [];

    if (isWeb) {
      const target = 'index.html';
      expectedArtifacts.push('index.html', 'src/index.html');

      // Baseline criterion: File must exist and have non-trivial size
      criteria.push({
        type: 'file_exists',
        target,
        description: `'index.html' (veya 'src/index.html') dosyası diskte oluşturulmuş olmalıdır.`,
      });
      criteria.push({
        type: 'min_size',
        target,
        description: `'index.html' dosyası en az 100 bayt içerik barındırmalıdır.`,
        params: { minBytes: 100 },
      });
      criteria.push({
        type: 'html_structure',
        target,
        description: `'index.html' geçerli bir HTML5 belge yapısına (DOCTYPE, html, body) sahip olmalıdır.`,
      });

      // COMPILER GUARD: Verify constraints map to criteria
      const requiresStyle = /stil|css|tasarım|style/i.test(lower);
      if (requiresStyle) {
        criteria.push({
          type: 'contains_style',
          target,
          description: `'index.html' içinde gömülü stil (<style>...</style>) tanımlanmış olmalıdır.`,
        });
      }

      const requiresScript = /script|kod\s+etiket|javascript|etkileşim|dinamik/i.test(lower);
      if (requiresScript) {
        criteria.push({
          type: 'contains_script',
          target,
          description: `'index.html' içinde gömülü script (<script>...</script>) tanımlanmış olmalıdır.`,
        });
      }

      contracts.push({
        id: 'contract_web_1',
        goal: trimmed.split('.')[0].trim(),
        source_constraints: sourceConstraints,
        expected_artifacts: expectedArtifacts,
        criteria,
      });
    } else if (isPython) {
      const target = 'main.py';
      expectedArtifacts.push(target);
      criteria.push({
        type: 'file_exists',
        target,
        description: `'${target}' dosyası diskte oluşturulmuş olmalıdır.`,
      });
      criteria.push({
        type: 'min_size',
        target,
        description: `'${target}' dosyası en az 50 bayt geçerli kod içermelidir.`,
        params: { minBytes: 50 },
      });
      contracts.push({
        id: 'contract_py_1',
        goal: trimmed.split('.')[0].trim(),
        source_constraints: sourceConstraints,
        expected_artifacts: expectedArtifacts,
        criteria,
      });
    } else {
      // General Task fallback
      const target = 'src/index.js';
      expectedArtifacts.push(target);
      criteria.push({
        type: 'file_exists',
        target,
        description: `'${target}' veya talep edilen dosya oluşturulmalıdır.`,
      });
      contracts.push({
        id: 'contract_gen_1',
        goal: trimmed.split('.')[0].trim(),
        source_constraints: sourceConstraints,
        expected_artifacts: expectedArtifacts,
        criteria,
      });
    }

    return contracts;
  }
}
