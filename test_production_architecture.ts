/**
 * test_production_architecture.ts
 * Comprehensive automated verification for Emir Code's Evidence-Based Stateful Agent Architecture.
 */

import { AgentStateMachine } from './src/lib/agent/AgentStateMachine';
import { TaskCompiler } from './src/lib/agent/TaskContract';
import { decomposeGoalIntoSubtasks, isSmallLanguageModel } from './src/lib/agent/AgentEngine';
import { TaskValidator } from './src/lib/agent/TaskValidator';
import { ToolDispatcher } from './src/lib/agent/ToolDispatcher';

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, message: string) {
  totalTests++;
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✅ PASSED: ${message}`);
  passedTests++;
}

async function run() {
  console.log('--- 1. Testing AgentStateMachine Strict Transitions ---');
  const sm = new AgentStateMachine();
  assert(sm.getState() === 'PENDING', 'Initial state must be PENDING');

  sm.transition('PLANNING', 'Planlama başladı');
  assert(sm.getState() === 'PLANNING', 'Transitioned to PLANNING');

  sm.transition('EXECUTING', 'Yürütme başladı');
  assert(sm.getState() === 'EXECUTING', 'Transitioned to EXECUTING');

  sm.transition('VALIDATING', 'Doğrulama başladı');
  assert(sm.getState() === 'VALIDATING', 'Transitioned to VALIDATING');

  sm.transition('COMPLETED', 'Görev doğrulandı');
  assert(sm.getState() === 'COMPLETED', 'Transitioned to COMPLETED');

  sm.transition('DONE', 'Süreç tamamlandı');
  assert(sm.getState() === 'DONE', 'Transitioned to DONE');

  // Verify illegal transitions are blocked
  sm.reset();
  sm.transition('PLANNING');
  sm.transition('EXECUTING');
  sm.transition('BLOCKED', 'Döngü tespit edildi');
  assert(sm.getState() === 'BLOCKED', 'Transitioned to BLOCKED');

  let threwOnIllegal = false;
  try {
    // BLOCKED to COMPLETED is strictly forbidden!
    sm.transition('COMPLETED');
  } catch {
    threwOnIllegal = true;
  }
  assert(threwOnIllegal, 'Illegal transition BLOCKED -> COMPLETED was strictly rejected');

  console.log('\n--- 2. Testing TaskCompiler & Compiler Guard ---');
  const userPrompt = 'alışveriş için bir web sitesi oluştur. sadece html dosyası oluşturulacak. Bu HTML dosyasının içinde stil ve kod etiketleri de tanımlı olacak';
  const contracts = TaskCompiler.compile(userPrompt);

  assert(contracts.length === 1, 'Compiled exactly 1 TaskContract for overarching goal');
  const contract = contracts[0];
  assert(contract.expected_artifacts.includes('src/index.html'), 'Expected artifact is src/index.html');
  assert(contract.criteria.some(c => c.type === 'contains_style'), 'Compiler Guard enforced contains_style criterion');
  assert(contract.criteria.some(c => c.type === 'contains_script'), 'Compiler Guard enforced contains_script criterion');
  assert(contract.criteria.some(c => c.type === 'html_structure'), 'Compiler Guard enforced html_structure criterion');

  console.log('\n--- 3. Testing Constraint Separation in Subtasks ---');
  const subtasks = decomposeGoalIntoSubtasks(userPrompt);
  assert(subtasks.length === 1, `Subtasks cleanly consolidated (Count: ${subtasks.length}, expected 1 without constraint splitting)`);
  assert(subtasks[0].description.includes('alışveriş için bir web sitesi oluştur'), 'Subtask retains the core action');

  console.log('\n--- 4. Testing TaskValidator with Evidence ---');
  // Incomplete HTML (Missing style and script)
  const badHtml = '<!DOCTYPE html><html><head><title>Test</title></head><body><h1>Merhaba</h1></body></html>';
  const badProvider = async () => badHtml;
  const badReport = await TaskValidator.validate(contract, badProvider);
  assert(!badReport.passed, 'Incomplete HTML rejected by TaskValidator (False success prevented!)');
  assert(badReport.missingEvidence.length >= 2, 'Validator accurately flagged missing style and script');

  // Complete HTML with full criteria
  const goodHtml = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <title>Alışveriş Sitesi</title>
  <style>
    body { font-family: sans-serif; background: #fafafa; }
    .card { border: 1px solid #ddd; padding: 12px; }
  </style>
</head>
<body>
  <h1>Alışveriş Mağazası</h1>
  <div class="card">Ürün 1</div>
  <script>
    console.log("Sepete eklendi!");
  </script>
</body>
</html>`;
  const goodProvider = async () => goodHtml;
  const goodReport = await TaskValidator.validate(contract, goodProvider);
  assert(goodReport.passed, 'Valid and complete HTML verified by TaskValidator');
  assert(goodReport.missingEvidence.length === 0, 'No missing evidence on complete HTML');

  console.log('\n--- 5. Testing Coder Model Strict Fallback Hierarchy ---');
  // Step 1: Explicit path in raw code
  const rawCodeWithExplicit = '```html\n<!-- file: src/index.html -->\n<!DOCTYPE html><html><body>Test</body></html>\n```';
  const parsed1 = ToolDispatcher.parseActionFromResponse(rawCodeWithExplicit);
  assert(parsed1.type === 'propose_create', 'Parsed raw code with explicit file comment');
  assert(parsed1.payload.path === 'src/index.html', 'Accurately resolved target path to src/index.html');

  // Step 2: Fallback to single active contract expected artifact
  const rawCodeWithoutExplicit = '```html\n<!DOCTYPE html><html><body>Test</body></html>\n```';
  const parsed2 = ToolDispatcher.parseActionFromResponse(rawCodeWithoutExplicit, {
    expectedArtifacts: ['src/index.html'],
  });
  assert(parsed2.type === 'propose_create', 'Mapped raw code to active contract expected artifact');
  assert(parsed2.payload.path === 'src/index.html', 'Target matched contract artifact');

  // Step 3: Ambiguous raw code with NO explicit path and multiple artifacts -> MUST NOT GUESS, MUST STOP!
  const parsed3 = ToolDispatcher.parseActionFromResponse(rawCodeWithoutExplicit, {
    expectedArtifacts: ['src/app.js', 'src/index.html'],
  });
  assert(parsed3.type === 'unknown', 'Ambiguous target was NOT guessed blindly; returned unknown/stopped');

  console.log('\n--- 6. Testing Coder SLM Model Detection ---');
  assert(isSmallLanguageModel('qwen2.5-coder:1.5b'), 'qwen2.5-coder:1.5b detected as SLM');
  assert(isSmallLanguageModel('deepseek-coder:1.3b'), 'deepseek-coder:1.3b detected as SLM');
  assert(isSmallLanguageModel('codegemma:2b'), 'codegemma:2b detected as SLM');
  assert(isSmallLanguageModel('gemma2:2b'), 'gemma2:2b detected as SLM');

  console.log(`\n===========================================`);
  console.log(`🎉 ALL ${passedTests}/${totalTests} TESTS PASSED PERFECTLY!`);
  console.log(`===========================================`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
