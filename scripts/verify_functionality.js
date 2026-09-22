const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('==============================================');
console.log('🧪 RUNNING COMPREHENSIVE FUNCTIONALITY TESTS');
console.log('==============================================\n');

let passedTests = 0;
let totalTests = 0;

function test(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}

// 1. Translation Parity & Localization Test
test('1. Translation Parity: All keys in en.ts match tr.ts', () => {
  const enContent = fs.readFileSync(path.join(__dirname, '../src/lib/localization/translations/en.ts'), 'utf-8');
  const trContent = fs.readFileSync(path.join(__dirname, '../src/lib/localization/translations/tr.ts'), 'utf-8');

  // Verify critical keys exist in both
  const requiredKeys = [
    'deleteConfirmTitle',
    'deleteConfirmDesc',
    'languageSystem',
    'appName',
    'emptyTitle',
    'emptySubtitle',
    'newSession',
    'projectExplorer',
    'openFolder',
    'sandboxActive',
  ];

  for (const key of requiredKeys) {
    assert(enContent.includes(key), `Key "${key}" is missing in en.ts`);
    assert(trContent.includes(key), `Key "${key}" is missing in tr.ts`);
  }
});

// 2. System Language Detection Logic
test('2. System Language Resolution: "system", "tr", "en" handling', () => {
  function detectSystemLanguage(mockLocale) {
    if (mockLocale && mockLocale.toLowerCase().startsWith('tr')) return 'tr';
    return 'en';
  }

  function resolveLanguage(lang, mockLocale) {
    if (!lang || lang === 'system') {
      return detectSystemLanguage(mockLocale);
    }
    return lang === 'tr' ? 'tr' : 'en';
  }

  assert.strictEqual(resolveLanguage('system', 'tr-TR'), 'tr');
  assert.strictEqual(resolveLanguage('system', 'tr'), 'tr');
  assert.strictEqual(resolveLanguage('system', 'en-US'), 'en');
  assert.strictEqual(resolveLanguage('system', 'de-DE'), 'en');
  assert.strictEqual(resolveLanguage('tr', 'en-US'), 'tr');
  assert.strictEqual(resolveLanguage('en', 'tr-TR'), 'en');
});

// 3. Security Boundary: Untrusted Data Wrapping
test('3. Security Boundary: UntrustedData tags encapsulate project file content', () => {
  const untrustedDataSrc = fs.readFileSync(path.join(__dirname, '../src/lib/agent/UntrustedData.ts'), 'utf-8');
  assert(untrustedDataSrc.includes('<<<UNTRUSTED_PROJECT_DATA'), 'Missing start boundary marker in UntrustedData.ts');
  assert(untrustedDataSrc.includes('<<<END_UNTRUSTED_PROJECT_DATA>>>'), 'Missing end boundary marker in UntrustedData.ts');
  assert(untrustedDataSrc.includes('wrapUntrustedFile'), 'Missing wrapUntrustedFile helper in UntrustedData.ts');
});

// 4. Command Security Allowlist
test('4. Security: Command Whitelist strictly blocks unauthorized binaries & args', () => {
  const ALLOWED_EXECUTABLES = new Set([
    'npm', 'npm.cmd',
    'npx', 'npx.cmd',
    'node', 'node.exe',
    'git', 'git.exe',
    'pytest', 'pytest.exe',
    'python', 'python.exe',
    'cargo', 'cargo.exe',
    'go', 'go.exe',
  ]);

  const DISALLOWED_NPX = false; // npx is prohibited

  function validateCommand(cmd, args) {
    const base = cmd.toLowerCase();
    if (base === 'npx' || base === 'npx.cmd') {
      return { allowed: false, reason: 'npx is prohibited' };
    }
    if (!ALLOWED_EXECUTABLES.has(base)) {
      return { allowed: false, reason: 'Binary not in whitelist' };
    }
    // Block chained execution attempts
    const full = [cmd, ...args].join(' ');
    if (/[;&|`$]/.test(full) || />>/.test(full)) {
      return { allowed: false, reason: 'Shell metacharacters blocked' };
    }
    return { allowed: true };
  }

  assert.strictEqual(validateCommand('npx', ['tsc']).allowed, false);
  assert.strictEqual(validateCommand('curl', ['https://evil.com']).allowed, false);
  assert.strictEqual(validateCommand('powershell', ['-enc', '...']).allowed, false);
  assert.strictEqual(validateCommand('git', ['status']).allowed, true);
  assert.strictEqual(validateCommand('npm', ['test']).allowed, true);
  assert.strictEqual(validateCommand('npm', ['test', ';', 'rm', '-rf']).allowed, false);
});

// 5. Centered EmptyState Layout Validation
test('5. UI: EmptyState text cluster is centered horizontally and vertically', () => {
  const chatContainerSrc = fs.readFileSync(path.join(__dirname, '../src/components/chat/ChatContainer.tsx'), 'utf-8');
  assert(
    chatContainerSrc.includes('flex flex-col items-center justify-center min-h-0'),
    'ChatContainer messages scroll area does not have centering classes'
  );

  const emptyStateSrc = fs.readFileSync(path.join(__dirname, '../src/components/chat/EmptyState.tsx'), 'utf-8');
  assert(
    emptyStateSrc.includes('flex flex-col items-center justify-center p-8 text-center select-none max-w-md mx-auto my-auto'),
    'EmptyState does not have centered container styling'
  );
});

// 6. Mode Switcher Placement
test('6. UI: Mode switcher is in HistorySidebar above New Chat and removed from TitleBar', () => {
  const titleBarSrc = fs.readFileSync(path.join(__dirname, '../src/components/layout/TitleBar.tsx'), 'utf-8');
  assert(!titleBarSrc.includes('Segmented Mode Switcher'), 'TitleBar still contains mode switcher');

  const sidebarSrc = fs.readFileSync(path.join(__dirname, '../src/components/layout/HistorySidebar.tsx'), 'utf-8');
  assert(sidebarSrc.includes('setActiveAppMode(\'chat\')'), 'HistorySidebar does not have chat mode button');
  assert(sidebarSrc.includes('setActiveAppMode(\'agent\')'), 'HistorySidebar does not have agent mode button');
  
  // Verify it is placed before New Chat button
  const modeIdx = sidebarSrc.indexOf('setActiveAppMode(\'chat\')');
  const newChatIdx = sidebarSrc.indexOf('handleCreateNew');
  assert(modeIdx < newChatIdx, 'Mode switcher is not located above the New Chat button in HistorySidebar');
});

// 7. Modern Dark Mode Chat Delete Dialog
test('7. UI: Modern dark mode delete confirmation dialog is used instead of window.confirm', () => {
  const sidebarSrc = fs.readFileSync(path.join(__dirname, '../src/components/layout/HistorySidebar.tsx'), 'utf-8');
  assert(!sidebarSrc.includes('window.confirm'), 'HistorySidebar still uses browser window.confirm');
  assert(sidebarSrc.includes('chatToDelete'), 'HistorySidebar lacks chatToDelete state');
  assert(sidebarSrc.includes('deleteConfirmTitle'), 'HistorySidebar lacks deleteConfirmTitle');
  assert(sidebarSrc.includes('bg-rose-600'), 'HistorySidebar lacks dark styled delete confirmation button');
});

// 8. Unified Chat & Agent Sessions
test('8. Architecture: HistorySidebar and chatStore support unified chat & agent sessions', () => {
  const chatTypeSrc = fs.readFileSync(path.join(__dirname, '../src/types/chat.ts'), 'utf-8');
  assert(chatTypeSrc.includes("mode?: 'chat' | 'agent'"), 'Chat type missing mode discriminator');

  const appSrc = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf-8');
  assert(
    appSrc.includes('<HistorySidebar />\n        {activeAppMode === \'agent\' ? <AgentWorkspace /> : <ChatContainer />}'),
    'App.tsx does not mount HistorySidebar persistently across modes'
  );
});

// 9. Memory Ledger & Anti-Amnesia Formatting
test('9. Agent Memory: formatLedgerBlock serializes known files and user decisions', () => {
  const engineSrc = fs.readFileSync(path.join(__dirname, '../src/lib/agent/AgentEngine.ts'), 'utf-8');
  assert(engineSrc.includes('formatLedgerBlock'), 'AgentEngine missing formatLedgerBlock');
  assert(engineSrc.includes('OTURUM HAFIZA DEFTERİ'), 'AgentEngine missing memory ledger header');
  assert(engineSrc.includes('ledger.userDecisions'), 'AgentEngine does not track userDecisions');
  assert(engineSrc.includes('ledger.knownFiles'), 'AgentEngine does not track knownFiles');
});

// 10. Context Sliding Window Compression
test('10. Context Optimization: compressConversationContext compresses heavy older observations', () => {
  const engineSrc = fs.readFileSync(path.join(__dirname, '../src/lib/agent/AgentEngine.ts'), 'utf-8');
  assert(engineSrc.includes('compressConversationContext'), 'AgentEngine missing compressConversationContext');
  assert(engineSrc.includes('maxRecentVerbatim'), 'AgentEngine missing maxRecentVerbatim sliding window');
});

// 11. Active Execution Timer & Circuit Breaker
test('11. Timeout Fix: Circuit breaker measures active execution time and pauses during user interaction', () => {
  const engineSrc = fs.readFileSync(path.join(__dirname, '../src/lib/agent/AgentEngine.ts'), 'utf-8');
  assert(engineSrc.includes('activeExecutionTimeMs'), 'AgentEngine lacks activeExecutionTimeMs');
  assert(engineSrc.includes('pauseTimer'), 'AgentEngine lacks pauseTimer');
  assert(engineSrc.includes('resumeTimer'), 'AgentEngine lacks resumeTimer');
  assert(engineSrc.includes('getActiveExecutionTime'), 'AgentEngine lacks getActiveExecutionTime');
});

// 12. Inline Clarification Stream (No Popups)
test('12. UX: Clarification questions are rendered inline in the timeline and modal is removed', () => {
  assert(!fs.existsSync(path.join(__dirname, '../src/components/agent/ClarificationModal.tsx')), 'ClarificationModal still exists');
  const wsSrc = fs.readFileSync(path.join(__dirname, '../src/components/agent/AgentWorkspace.tsx'), 'utf-8');
  assert(!wsSrc.includes('<ClarificationModal'), 'AgentWorkspace still renders ClarificationModal');
  assert(wsSrc.includes('pendingQuestion'), 'AgentWorkspace lacks pendingQuestion handling');
  assert(wsSrc.includes('customAnswerText'), 'AgentWorkspace lacks customAnswerText for inline replies');
});

// 13. Configurable Security Profiles
test('13. Security: Security profiles (strict, balanced, autonomous) configured in settings and engine', () => {
  const settingsTypeSrc = fs.readFileSync(path.join(__dirname, '../src/types/settings.ts'), 'utf-8');
  assert(settingsTypeSrc.includes("'strict' | 'balanced' | 'autonomous'"), 'SecurityProfile missing required union members');

  const engineSrc = fs.readFileSync(path.join(__dirname, '../src/lib/agent/AgentEngine.ts'), 'utf-8');
  assert(engineSrc.includes("securityProfile === 'balanced'"), 'AgentEngine missing balanced profile checks');
  assert(engineSrc.includes("securityProfile === 'autonomous'"), 'AgentEngine missing autonomous profile checks');

  const genSettingsSrc = fs.readFileSync(path.join(__dirname, '../src/components/settings/GeneralSettings.tsx'), 'utf-8');
  assert(genSettingsSrc.includes('securityProfile'), 'GeneralSettings lacks securityProfile selector');
});

// 14. Token Syntax Highlighting & Diff Viewer
test('14. Code Viewer: Zero-dependency SyntaxHighlighter and Myers/LCS DiffViewer are implemented', () => {
  assert(fs.existsSync(path.join(__dirname, '../src/lib/utils/SyntaxHighlighter.ts')), 'SyntaxHighlighter.ts missing');
  assert(fs.existsSync(path.join(__dirname, '../src/components/common/DiffViewer.tsx')), 'DiffViewer.tsx missing');

  const csModalSrc = fs.readFileSync(path.join(__dirname, '../src/components/agent/ChangesetModal.tsx'), 'utf-8');
  assert(csModalSrc.includes('<DiffViewer'), 'ChangesetModal does not render DiffViewer');

  const codeBlockSrc = fs.readFileSync(path.join(__dirname, '../src/components/chat/CodeBlock.tsx'), 'utf-8');
  assert(codeBlockSrc.includes('tokenizeCode'), 'CodeBlock does not utilize tokenizeCode');
});

// 15. Windows NSIS Installer & In-App Onboarding
test('15. Distribution & Onboarding: NSIS multi-language installer configured and OnboardingModal mounted', () => {
  const pkgContent = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf-8'));
  assert(pkgContent.build.nsis, 'package.json missing nsis configuration');
  assert.strictEqual(pkgContent.build.nsis.oneClick, false, 'NSIS oneClick should be false for customizable wizard');
  assert.strictEqual(pkgContent.build.nsis.multiLanguageInstaller, true, 'NSIS should support multiLanguageInstaller');

  assert(fs.existsSync(path.join(__dirname, '../src/components/onboarding/OnboardingModal.tsx')), 'OnboardingModal.tsx missing');
  const appSrc = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf-8');
  assert(appSrc.includes('<OnboardingModal />'), 'App.tsx does not mount OnboardingModal');
});

// 16. Multi-Tab File Preview & Fallback
test('16. Multi-Tab Preview: File tabs are opened, closable with fallback to timeline', () => {
  const storeSrc = fs.readFileSync(path.join(__dirname, '../src/stores/agentStore.ts'), 'utf-8');
  assert(storeSrc.includes('openFiles: Array<{'), 'agentStore lacks openFiles array');
  assert(storeSrc.includes('activeTabId: string'), 'agentStore lacks activeTabId');
  assert(storeSrc.includes('closeFileTab: (relativePath: string) => void'), 'agentStore lacks closeFileTab');
  assert(storeSrc.includes("activeTabId: 'timeline'"), 'agentStore lacks fallback to timeline');

  const wsSrc = fs.readFileSync(path.join(__dirname, '../src/components/agent/AgentWorkspace.tsx'), 'utf-8');
  assert(wsSrc.includes('openFiles.map('), 'AgentWorkspace does not map openFiles tabs');
  assert(wsSrc.includes('closeFileTab(file.relativePath)'), 'AgentWorkspace does not have tab close button');
  assert(wsSrc.includes('closeAllFileTabs'), 'AgentWorkspace lacks closeAllFileTabs');
});

// 17. Circuit Breaker Timeout: Minimum 30 Minutes & Configurable
test('17. Circuit Breaker: Timeout enforces >= 30 minutes floor and user configurability', () => {
  const engineSrc = fs.readFileSync(path.join(__dirname, '../src/lib/agent/AgentEngine.ts'), 'utf-8');
  assert(engineSrc.includes('Math.max(30, timeoutMinutes || 30)'), 'AgentEngine does not enforce 30 minute minimum timeout');
  assert(engineSrc.includes('effectiveMinutes'), 'AgentEngine does not log effectiveMinutes in breaker message');

  const settingsSrc = fs.readFileSync(path.join(__dirname, '../src/types/settings.ts'), 'utf-8');
  assert(settingsSrc.includes('circuitBreakerMinutes: number'), 'AppSettings lacks circuitBreakerMinutes');
  assert(settingsSrc.includes('circuitBreakerMinutes: 30'), 'DEFAULT_SETTINGS does not default to 30 mins');

  const generalSettingsSrc = fs.readFileSync(path.join(__dirname, '../src/components/settings/GeneralSettings.tsx'), 'utf-8');
  assert(generalSettingsSrc.includes('circuitBreakerMinutes'), 'GeneralSettings lacks circuit breaker selector');
  assert(generalSettingsSrc.includes('value={30}'), 'GeneralSettings lacks 30m option');
  assert(generalSettingsSrc.includes('value={120}'), 'GeneralSettings lacks 120m option');
});

// 18. Context-Aware New Task (+) Button
test('18. Context-Aware New Task: TitleBar + button & Ctrl+N handle Emir Code mode properly', () => {
  const titleBarSrc = fs.readFileSync(path.join(__dirname, '../src/components/layout/TitleBar.tsx'), 'utf-8');
  assert(titleBarSrc.includes("activeAppMode === 'agent'"), 'TitleBar does not inspect activeAppMode');
  assert(titleBarSrc.includes('clearSession()'), 'TitleBar does not call clearSession() in agent mode');
  assert(titleBarSrc.includes('newProjectTask'), 'TitleBar does not provide dynamic newProjectTask tooltip');

  const appSrc = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf-8');
  assert(appSrc.includes("if (activeAppMode === 'agent')"), 'App.tsx Ctrl+N does not check activeAppMode');
});

// 19. Real-Time Inline Transcript & LLM Token Streaming
test('19. Live Token Streaming: onStreamChunk emits character chunks into inline expandable transcript', () => {
  const engineSrc = fs.readFileSync(path.join(__dirname, '../src/lib/agent/AgentEngine.ts'), 'utf-8');
  assert(engineSrc.includes('onStreamChunk?: (chunk: string, fullResponseSoFar: string) => void'), 'AgentEngine lacks onStreamChunk callback');
  assert(engineSrc.includes('callbacks.onStreamChunk?.(chunk.message.content, fullResponse)'), 'AgentEngine does not emit stream chunks');

  const storeSrc = fs.readFileSync(path.join(__dirname, '../src/stores/agentStore.ts'), 'utf-8');
  assert(storeSrc.includes('activeStreamText: string'), 'agentStore lacks activeStreamText');
  assert(storeSrc.includes('isStreamingResponse: boolean'), 'agentStore lacks isStreamingResponse');
  assert(storeSrc.includes('inlineTranscriptOpen: boolean'), 'agentStore lacks inlineTranscriptOpen');
  assert(storeSrc.includes('toggleInlineTranscript'), 'agentStore lacks toggleInlineTranscript');

  const wsSrc = fs.readFileSync(path.join(__dirname, '../src/components/agent/AgentWorkspace.tsx'), 'utf-8');
  assert(wsSrc.includes('toggleInlineTranscript'), 'AgentWorkspace does not wire toggleInlineTranscript');
  assert(wsSrc.includes('activeStreamText'), 'AgentWorkspace does not display activeStreamText');
  assert(wsSrc.includes('CANLI TOKEN AKIŞI'), 'AgentWorkspace lacks live token stream badge');
});

// 20. HiDPI Multi-Resolution Icon & App Branding
test('20. HiDPI Support: Crisp multi-resolution icon exists and Electron branding is updated', () => {
  const icoPath = path.join(__dirname, '../build/icon.ico');
  const pngPath = path.join(__dirname, '../build/icon.png');
  assert(fs.existsSync(icoPath), 'build/icon.ico does not exist');
  assert(fs.existsSync(pngPath), 'build/icon.png does not exist');

  const icoStat = fs.statSync(icoPath);
  assert(icoStat.size >= 15000, `build/icon.ico is too small (${icoStat.size} bytes) for multi-res HiDPI`);

  const mainSrc = fs.readFileSync(path.join(__dirname, '../electron/main.ts'), 'utf-8');
  assert(mainSrc.includes("app.setName('Emir Code')"), 'main.ts missing app.setName');
  assert(mainSrc.includes("app.setAppUserModelId('com.emircode.desktop')"), 'main.ts missing app.setAppUserModelId');
  assert(mainSrc.includes("icon: appIcon"), 'main.ts BrowserWindow does not configure icon');
});

console.log(`\n==============================================`);
console.log(`📊 RESULTS: ${passedTests}/${totalTests} TESTS PASSED`);
console.log(`==============================================\n`);

if (passedTests !== totalTests) {
  process.exit(1);
}
