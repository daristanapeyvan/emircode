import { ollamaClient } from '../ollama/OllamaClient';
import { modelGateway, isCloudRequestError } from '../providers/ModelGateway';
import { cloudErrorText } from '../providers/errorText';
import { PROVIDER_COMPANIES, cloudOwner, modelLabel } from '../providers/modelRef';
import {
  AgentStep,
  AgentStatus,
  ChangesetItem,
  CommandApprovalItem,
  ClarificationItem,
  AppliedTransaction,
  AgentMemoryLedger,
  TaskChecklistItem,
  AgentCapabilities,
} from '@/types/agent';
import { WorkspaceFileInfo } from '../../../electron/preload';
import { OllamaChatMessage, GenerationOptions, OllamaFormat, OllamaThinkValue } from '@/types/ollama';
import { SecurityProfile, WebSynthesisStrategy, ModificationStrategy } from '@/types/settings';
import { ToolDispatcher, ParsedAction } from './ToolDispatcher';
import {
  wrapUntrustedFileContent,
  wrapUntrustedSearchResults,
  wrapUntrustedGitOutput,
  wrapUntrustedWebResult,
} from './UntrustedData';
import { AgentStateMachine, AgentState } from './AgentStateMachine';
import { TaskCompiler, TaskContract, findHtmlTarget, mentionedMenuTexts } from './TaskContract';
import { TaskValidator, ValidationReport, looksJsonEscaped, extractMenuLinks, MenuLink } from './TaskValidator';
import { WebAccessService } from '../web/WebAccessService';
import { checkCommand } from '../../../electron/commandPolicy';
import { format, getTranslations, resolveLanguage } from '../localization/i18n';
import { renderCheck } from './checkTexts';
import { en } from '../localization/translations/en';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  getModelRuntimeInfo,
  resolveRequestProfile,
  resolveThinkParam,
  buildAgentSamplingOptions,
  estimateTokens,
  parameterSizeFromName,
  ModelRuntimeInfo,
} from '../ollama/ModelRuntime';
import {
  planDesignTheme,
  needsModelCategory,
  resolvePlanTheme,
  applyDesign,
  DesignPlan,
  DesignChange,
  DesignOverride,
} from '../design/DesignTheme';
import { buildCategoryPrompt, parseCategoryAnswer, CATEGORY_SCHEMA } from '../design/categorize';
import { THEME_FILE, isThemeAsset } from '../design/themeCss';
import { DesignCategory, categoryLabel, getTheme, themeName, themeMood } from '../design/themes';
import {
  AgentToolset,
  buildAgentSystemPrompt,
  buildActionSchema,
  sanitizeFileContent,
  detectLazyPlaceholder,
  detectRepetitionLoop,
  describeAction,
  compactActionForHistory,
  summarizeActionForHistory,
  lineCount,
  lineRangeExcerpt,
} from './AgentProtocol';
import {
  checkFileSanity,
  formatSanityIssues,
  SanityIssue,
  strictFormatError,
  jsonKeyLoss,
  definitionLoss,
  detectDestructiveRewrite,
  mergeJsonPreservingKeys,
  damageFromChange,
} from './FileSanity';

import {
  findClosestPath,
  ACTION_WORD,
  REFERS_BACK,
  CONTINUES_PREVIOUS,
  continuesPreviousTask,
  decomposeGoalIntoSubtasks,
  isSmallLanguageModel,
  toolsetFrom,
  buildCompactSystemPrompt,
  buildSystemPrompt,
  formatLedgerBlock,
  compressConversationContext,
  findBestMatchRegion,
  countOccurrences,
  spliceReplace,
  applyChunkEdit,
  stripLineNumberPrefixes,
  numberedLines,
  applyLineRangeEdit,
  alignReplacementIndent,
  changedRegionExcerpt,
  copiedLinesAdded,
  hashText,
  formatKb,
  isSafePath,
  GOAL_REQUIRES_CHANGES,
  REMOVAL_INTENT,
  REWRITE_INTENT,
  EMPTY_FILE_OK,
  EMPTY_FILE_INTENT,
  isEmptyWrite,
  TEST_FILE,
  TEST_CHANGE_INTENT,
  RUNS_WITH_COMMANDS,
  runsWithCommands,
  isProtectedTestFile,
  STATUS_WORDS,
  looksLikeStatusMessage,
  looksLikeUsageText,
  findErrorLocation,
  hostPlatform,
} from './engineHelpers';
import type {
  AgentEngineCallbacks,
  PreviousTask,
  RunGoalOptions,
  LedgerExtras,
  ConversationEntry,
  DoneInfo,
  StreamOutcome,
} from './engineHelpers';

import { et } from './engineText';
export * from './engineHelpers';
import { handleFinish } from './run/finishTool';
import { handleListDir, handleReadFile, handleSearchCode, handleGit } from './run/readTools';
import { handleWebSearch, handleFetchUrl } from './run/webTools';
import { handleWriteFile } from './run/writeTool';
import { handleEditFile } from './run/editTool';
import { handleDeleteFile } from './run/deleteTool';
import { handleRunCommand } from './run/commandTool';
import { handleAskUser } from './run/askTool';
import type { RunContext } from './run/context';

/** The interface language, for theme and category names in the agent's messages. */
const uiLanguage = () => resolveLanguage(useSettingsStore.getState().settings.language);

export class AgentEngine {
  abortController: AbortController | null = null;
  stepAbortController: AbortController | null = null;
  isRunning: boolean = false;
  pendingInterruptDirective: string | null = null;

  stop() {
    this.isRunning = false;
    this.pendingInterruptDirective = null;
    if (this.stepAbortController) {
      this.stepAbortController.abort();
      this.stepAbortController = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  interrupt(userDirective: string) {
    if (!this.isRunning) return;
    this.pendingInterruptDirective = userDirective.trim();
    if (this.stepAbortController) {
      this.stepAbortController.abort();
      this.stepAbortController = null;
    }
  }

  /** One streamed model call. Aborts early when the output degenerates into a repetition loop. */
  private async streamOnce(params: {
    model: string;
    system: string;
    messages: OllamaChatMessage[];
    options: GenerationOptions;
    format?: OllamaFormat;
    think?: OllamaThinkValue;
    callbacks: AgentEngineCallbacks;
  }): Promise<StreamOutcome> {
    const { callbacks } = params;
    let fullResponse = '';
    let thinkingText = '';
    let done: DoneInfo | null = null;
    let repetition = false;
    let lastLoopCheck = 0;
    let lastThinkingCheck = 0;

    this.stepAbortController = new AbortController();
    const stepController = this.stepAbortController;
    const onGlobalAbort = () => stepController.abort();
    this.abortController?.signal.addEventListener('abort', onGlobalAbort, { once: true });

    try {
      await modelGateway.chatStream(
        {
          model: params.model,
          system: params.system,
          messages: params.messages,
          options: params.options,
          keep_alive: '30m',
          format: params.format,
          think: params.think,
        },
        (chunk) => {
          if (chunk.message?.thinking) {
            thinkingText += chunk.message.thinking;
            callbacks.onStreamChunk?.(chunk.message.thinking, `<think>${thinkingText}`);
            if (thinkingText.length - lastThinkingCheck > 400) {
              lastThinkingCheck = thinkingText.length;
              if (detectRepetitionLoop(thinkingText)) {
                repetition = true;
                stepController.abort();
              }
            }
          }
          if (chunk.message?.content) {
            fullResponse += chunk.message.content;
            callbacks.onStreamChunk?.(chunk.message.content, fullResponse);
            if (fullResponse.length - lastLoopCheck > 400) {
              lastLoopCheck = fullResponse.length;
              if (detectRepetitionLoop(fullResponse)) {
                repetition = true;
                stepController.abort();
              }
            }
          }
          if (chunk.done) {
            done = {
              doneReason: chunk.done_reason,
              evalCount: chunk.eval_count || 0,
              promptEvalCount: chunk.prompt_eval_count || 0,
              evalDurationNs: chunk.eval_duration || 0,
              promptEvalDurationNs: chunk.prompt_eval_duration || 0,
              loadDurationNs: chunk.load_duration || 0,
            };
          }
        },
        stepController.signal
      );
    } catch (err: any) {
      const aborted = err?.name === 'AbortError' || stepController.signal.aborted;
      if (!(aborted && repetition)) throw err;
    } finally {
      this.abortController?.signal.removeEventListener('abort', onGlobalAbort);
      if (this.stepAbortController === stepController) this.stepAbortController = null;
    }

    return { text: fullResponse, thinking: thinkingText, done, repetition };
  }

  /**
   * The one question the design theme asks the model: which kind of site is this? A short,
   * grammar-constrained call made before the agent's first step (a call in the middle of the run
   * would evict the agent's cached prompt on single-slot Ollama setups). Same model and num_ctx
   * as the agent, so nothing is reloaded; null on any failure.
   */
  private async classifySiteCategory(
    model: string,
    goal: string,
    runtime: ModelRuntimeInfo,
    numCtx: number
  ): Promise<DesignCategory | null> {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    this.abortController?.signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), 90000);
    let text = '';
    try {
      await modelGateway.chatStream(
        {
          model,
          messages: [{ role: 'user', content: buildCategoryPrompt(goal) }],
          // Cloud models may reason before answering even when asked not to; give them room.
          options: { temperature: 0, num_ctx: numCtx, num_predict: runtime.remote ? 1024 : runtime.supportsThinking ? 512 : 48 },
          keep_alive: '30m',
          format: CATEGORY_SCHEMA,
          think: resolveThinkParam(runtime, false),
        },
        (chunk) => {
          if (chunk.message?.content) text += chunk.message.content;
        },
        controller.signal
      );
    } catch {
      // keywords / the general themes take over
    } finally {
      clearTimeout(timer);
      this.abortController?.signal.removeEventListener('abort', onAbort);
    }
    return parseCategoryAnswer(text);
  }

  async runGoal(
    goal: string,
    model: string,
    callbacks: AgentEngineCallbacks,
    securityProfile: SecurityProfile = 'strict',
    timeoutMinutes: number = 30,
    runOptions: RunGoalOptions = {}
  ) {
    this.isRunning = true;
    this.abortController = new AbortController();
    this.stepAbortController = null;
    this.pendingInterruptDirective = null;

    // Circuit Breakers: Minimum 30 minutes for slow CPU/GPU inference
    const MAX_STEPS = 35;
    const MAX_TOOL_CALLS = 50;
    const effectiveMinutes = Math.max(30, timeoutMinutes || 30);
    const MAX_TASK_TIME_MS = effectiveMinutes * 60 * 1000;
    const MAX_CONSECUTIVE_ERRORS = 3;
    const MAX_REPEAT_STREAK = 3;
    const MAX_STEPS_WITHOUT_PROGRESS = 10;
    const MAX_READ_CHARS = 16000;

    // Active Execution Timer (pauses while waiting for user interaction)
    let activeExecutionTimeMs = 0;
    let lastTimerStart = Date.now();

    const pauseTimer = () => {
      activeExecutionTimeMs += Date.now() - lastTimerStart;
    };

    const resumeTimer = () => {
      lastTimerStart = Date.now();
    };

    const getActiveExecutionTime = () => {
      return activeExecutionTimeMs + (Date.now() - lastTimerStart);
    };

    let stepCount = 0;
    let toolCallCount = 0;
    let consecutiveErrors = 0;
    let autonomousRecoveries = 0;
    let repeatStreak = 0;
    let stepsWithoutProgress = 0;
    let finishPushbacks = 0;
    let mutationCount = 0;
    let finished = false;

    const stateMachine = new AgentStateMachine((from, to, reason) => {
      callbacks.onLog(et('stateChange', { from, to, reason: reason || et('stateLoop') }));
    });
    const moveTo = (path: AgentState[], reason?: string) => {
      for (const state of path) {
        if (stateMachine.canTransitionTo(state)) stateMachine.transition(state, reason);
      }
    };

    const releaseSubtasks = (ledger: AgentMemoryLedger) => {
      if (!ledger.subtasks) return;
      for (const t of ledger.subtasks) {
        if (t.status === 'in_progress') t.status = 'pending';
      }
      callbacks.onSubtasksUpdated?.(ledger.subtasks);
    };

    // 1. Pre-flight Environment & Git Capability Check
    let gitAvailable = false;
    try {
      const gitCheck = await window.electronAPI?.readGit('status');
      gitAvailable = !!gitCheck?.success;
    } catch {
      gitAvailable = false;
    }

    // 2. Pre-flight Project File Tree Discovery (up to depth 4)
    let projectFiles: string[] = [];
    try {
      const listRes = await window.electronAPI?.listWorkspaceFiles({ maxDepth: 4 });
      if (listRes?.success && listRes.files) {
        const flatten = (items: WorkspaceFileInfo[]): string[] => {
          const res: string[] = [];
          for (const item of items) {
            if (!item.isDirectory) res.push(item.relativePath);
            if (item.children) res.push(...flatten(item.children));
          }
          return res;
        };
        projectFiles = flatten(listRes.files);
      }
    } catch {
      projectFiles = [];
    }

    // 3. Model runtime profile: context window, output budget, sampling, reasoning mode
    const settingsState = useSettingsStore.getState();
    const agentOpt = settingsState.settings.agentOptimization;
    const webAccessConfig = settingsState.settings.webAccess;
    const runtime = await getModelRuntimeInfo(model);
    const requestProfile = resolveRequestProfile({
      info: runtime,
      agentOpt,
      hardware: settingsState.hardware,
      cloudContextLength: settingsState.settings.cloud?.contextLength,
    });
    const requestedMaxTokens = agentOpt?.maxTokens || 4096;
    let think = requestProfile.think;
    let formatSupported = true;
    // Start with a moderate output reserve so small windows (8K) keep room for the prompt;
    // a reply cut off by the limit raises it automatically (up to 60 % of the window).
    let desiredPredict = Math.min(requestProfile.numPredict, Math.max(1536, Math.floor(requestProfile.numCtx * 0.35)));
    let charsPerToken = 3.2;

    const capabilities = ToolDispatcher.getCapabilities('coding', webAccessConfig, gitAvailable);
    const synthesisStrategy = agentOpt?.webSynthesisStrategy || 'auto';
    const modStrategy = agentOpt?.modificationStrategy || 'smart_injection';

    stateMachine.transition('PLANNING', et('statePlanning'));
    // The page's menu links: "Home About Services Contact — get these working" names them, and a
    // 7B model otherwise did not connect "these" to the menu (it built a modal instead).
    const menuPage = findHtmlTarget(projectFiles);
    let menuLinks: MenuLink[] = [];
    if (menuPage) {
      try {
        const pageRes = await window.electronAPI?.readWorkspaceFile(menuPage);
        if (pageRes?.success && pageRes.content) menuLinks = extractMenuLinks(pageRes.content);
      } catch {
        menuLinks = [];
      }
    }
    const namedMenuLinks = menuLinks.filter((l) => l.text && mentionedMenuTexts(goal, [l.text]).length > 0);
    const contractsEnabled = runOptions.contracts !== false;
    let contracts: TaskContract[] = contractsEnabled
      ? TaskCompiler.compile(goal, {
          projectFiles,
          singleFile: synthesisStrategy === 'single_file',
          menuTexts: menuLinks.map((l) => l.text).filter(Boolean),
        })
      : [];
    const subtasks: TaskChecklistItem[] = runOptions.checklist
      ? runOptions.checklist.filter((item) => item.trim()).length >= 2
        ? runOptions.checklist
            .filter((item) => item.trim())
            .map((description, idx) => ({ id: `task_${idx + 1}`, description: description.trim(), status: idx === 0 ? 'in_progress' : 'pending' }))
        : [{ id: 'task_1', description: (runOptions.displayGoal || goal).trim(), status: 'in_progress' }]
      : decomposeGoalIntoSubtasks(goal);
    const ledger: AgentMemoryLedger = {
      goal,
      projectTree: projectFiles,
      knownFiles: {},
      appliedChanges: [],
      userDecisions: [],
      discoveredFacts: [],
      unavailableBinaries: gitAvailable ? [] : ['git'],
      invalidPaths: [],
      milestones: [],
      subtasks,
      activeSubtaskId: subtasks.length > 0 ? subtasks[0].id : undefined,
      currentPhase: 'investigation',
    };

    const toolset: AgentToolset = {
      web: capabilities.webSearch || capabilities.webFetch,
      git: gitAvailable,
      ask: securityProfile !== 'autonomous',
      commands: true,
      checklist: subtasks.length > 1,
    };
    const systemPrompt = buildAgentSystemPrompt({
      securityProfile,
      toolset,
      webSynthesisStrategy: synthesisStrategy,
      modificationStrategy: modStrategy,
      compact: runtime.isSmall,
    });
    const actionSchema = buildActionSchema(toolset, runtime.isSmall);

    const owner = cloudOwner(model);
    if (owner) callbacks.onLog(et('cloudModelNotice', { model: modelLabel(model), company: PROVIDER_COMPANIES[owner] }));
    callbacks.onLog(
      et('modelProfile', {
        model: `${modelLabel(model)}${runtime.parameterSizeB ? ` (${runtime.parameterSizeB}B)` : ''}`,
        context: requestProfile.numCtx,
        output: requestProfile.numPredict,
        setting: requestedMaxTokens,
        thinking: think === undefined ? et('thinkingUnsupported') : String(think),
      })
    );

    // Design theme for new web pages: decided now (the model is asked at most one short question,
    // before its first step), applied after the agent finished.
    let designPlan: DesignPlan | null = null;
    try {
      let existingThemeCss: string | null = null;
      if (projectFiles.some(isThemeAsset)) {
        const themeRes = await window.electronAPI?.readWorkspaceFile(THEME_FILE);
        existingThemeCss = themeRes?.success ? (themeRes.content ?? '') : null;
      }
      designPlan = planDesignTheme({
        goal,
        projectFiles,
        config: settingsState.settings.designTheme,
        modelSizeB: runtime.parameterSizeB,
        existingThemeCss,
        override: runOptions.design,
      });
      if (designPlan && needsModelCategory(designPlan)) {
        const started = Date.now();
        const category = await this.classifySiteCategory(model, goal, runtime, requestProfile.numCtx);
        resolvePlanTheme(designPlan, category, 'model');
        callbacks.onLog(
          et('designCategoryByModel', {
            category: category ? categoryLabel(category, uiLanguage()) : et('designCategoryUnknown'),
            seconds: ((Date.now() - started) / 1000).toFixed(1),
          })
        );
      } else if (designPlan && designPlan.kind === 'new' && designPlan.theme && designPlan.web) {
        resolvePlanTheme(designPlan, designPlan.category, designPlan.categorySource || 'keywords');
      }
      if (designPlan) {
        const theme = getTheme(designPlan.themeId);
        callbacks.onLog(
          designPlan.kind === 'continue'
            ? et('designContinues', { theme: theme ? themeName(theme, uiLanguage()) : String(designPlan.themeId) })
            : et('designPlanned', {
                theme: theme
                  ? `"${themeName(theme, uiLanguage())}" (${categoryLabel(theme.category, uiLanguage())})`
                  : designPlan.theme
                    ? et('designGeneralTheme')
                    : et('designBaseOnly'),
                base: designPlan.base ? et('on') : et('off'),
              })
        );
      }
    } catch (err: any) {
      designPlan = null;
      callbacks.onLog(et('designSkipped', { error: String(err?.message || err) }));
    }
    if (!this.isRunning) return;

    if (subtasks.length > 1) {
      callbacks.onStep({
        id: `step_tasks_init_${Date.now()}`,
        timestamp: Date.now(),
        type: 'system_notice',
        content: `${
          !runOptions.checklist ? et('checklistFromRequest', { count: subtasks.length })
          : subtasks.every((t) => /^\S+\.html?\s—/.test(t.description)) ? et('checklistPages', { count: subtasks.length })
          : et('checklistWizard', { count: subtasks.length })
        }:\n${subtasks
          .map((s, i) => `  ${i + 1}. ${s.description}`)
          .join('\n')}`,
        status: 'success',
      });
    }
    callbacks.onSubtasksUpdated?.(ledger.subtasks);

    // ---------------------------------------------------------------------
    // Shared state & helpers
    // ---------------------------------------------------------------------
    const conversation: ConversationEntry[] = [];
    const seenActions = new Map<string, { step: number; entry?: ConversationEntry }>();
    /** Output and run count of each successful command per model-change count, to spot repeats. */
    const commandOutputs = new Map<string, string>();
    const commandRuns = new Map<string, number>();
    /** Successful runs with RunGoalOptions.applyFlag, by command without the flag and model-change count. */
    const appliedRuns = new Map<string, { step: number; output: string }>();
    /**
     * The model-change count at which a file the model wrote last ran with exit code 0; -1 when none
     * did, or a command failed since (see tryGracefulCompletion).
     */
    let programOkAt = -1;
    /**
     * Changes the model re-sent although they were already in the file, since its last real change.
     * A model that keeps re-sending its finished edit instead of calling finish has done the work.
     */
    let noopResends = 0;
    /** Names of the files the model created or edited in this run (lower case, without folders). */
    const writtenByModel = new Set<string>();
    /** The run wrote code or command settings: test commands then need approval (see RUNS_WITH_COMMANDS). */
    let wroteRunnableFile = false;
    const baseName = (p: string) => (p.replace(/\\/g, '/').split('/').pop() || '').toLowerCase();
    const editFailures = new Map<string, number>();
    const openSanityIssues = new Map<string, SanityIssue[]>();
    /** Content of each file before the agent first changed it in this run (null = new file). */
    const originalSnapshots = new Map<string, string | null>();
    /** path:contentHash of writes that were refused, with the step they were refused at. */
    const rejectedWrites = new Map<string, number>();
    /** Latest content written by the agent per file (for numbered problem excerpts). */
    const latestContent = new Map<string, string>();
    /** Edits applied in this run (path:target:replacement hash -> step), to refuse identical re-applies. */
    const appliedEdits = new Map<string, number>();
    /** Per file: the number of check errors after the last change, and how many changes in a row did not reduce it. */
    const errorCounts = new Map<string, number>();
    const unchangedErrorStreak = new Map<string, number>();
    /** Changes in a row that only added copies of lines already in the file (see copiedLinesAdded). */
    let copiesStreak = 0;
    /** Files created or changed in this run (the design theme is applied to them at the end). */
    const writtenFiles = new Set<string>();
    let treeVersion = 0;
    let lastAcceptance: { passed: number; total: number } | null = null;
    let lastMissing: string[] = [];

    const fileProvider = async (relPath: string) => {
      try {
        const res = await window.electronAPI?.readWorkspaceFile(relPath);
        return res?.success ? (res.content ?? null) : null;
      } catch {
        return null;
      }
    };

    /** The acceptance checks now: `missing` in English for the model, `missingUi` for the user. */
    const runAcceptanceChecks = async (): Promise<{ report: ValidationReport | null; missing: string[]; missingUi: string[] }> => {
      if (contracts.length === 0) {
        lastAcceptance = null;
        return { report: null, missing: [], missingUi: [] };
      }
      const missing: string[] = [];
      const missingUi: string[] = [];
      const uiLanguage = resolveLanguage(useSettingsStore.getState().settings.language);
      let passed = 0;
      let total = 0;
      let lastReport: ValidationReport | null = null;
      for (const contract of contracts) {
        const report = await TaskValidator.validate(contract, fileProvider);
        lastReport = report;
        total += report.criterionResults.length;
        passed += report.criterionResults.filter((r) => r.passed).length;
        missing.push(...report.missingEvidence);
        missingUi.push(...report.missingTexts.map((t) => renderCheck(t, uiLanguage)));
      }
      lastAcceptance = { passed, total };
      lastMissing = missing;
      return { report: lastReport, missing, missingUi };
    };

    /** Repeats what the acceptance checks still miss, for messages sent when the model stalls. */
    const acceptanceNote = () =>
      lastMissing.length > 0 ? `\nAcceptance checks still failing — add exactly this:\n${lastMissing.map((m) => `- ${m}`).join('\n')}\n` : '';

    const stateLine = () =>
      formatLedgerBlock(ledger, { step: stepCount, maxSteps: MAX_STEPS, acceptance: lastAcceptance });

    /** True while an earlier tool result is still in the prompt verbatim (not compacted or dropped). */
    const stillVisible = (entry?: ConversationEntry) =>
      !!entry && conversation.includes(entry) && !entry.meta?.compacted;

    /** Everything the user asked for in this run: the goal plus live directives and answers. */
    const userRequestText = () => [goal, ...ledger.userDecisions.map((d) => d.answer)].join(' ');

    /** Numbered lines around the first reported problem of a file, so replace_lines has exact numbers. */
    const problemExcerpt = (filePath: string) => {
      const content = latestContent.get(filePath);
      const issues = (openSanityIssues.get(filePath) || []).filter((i) => i.severity === 'error');
      const lineMatch = issues.map((i) => i.message.match(/line (\d+)/)).find(Boolean);
      if (!content || !lineMatch) return '';
      const line = parseInt(lineMatch[1], 10);
      const from = Math.max(1, line - 2);
      const to = line + 6;
      return `\nLines ${from}-${Math.min(to, lineCount(content))} of "${filePath}":\n${numberedLines(content, from, to)}`;
    };

    /** Numbered lines of `content` around the first line an issue names (for refused changes). */
    const issueExcerpt = (content: string, issues: SanityIssue[], label: string) => {
      const lineMatch = issues.map((i) => i.message.match(/line (\d+)/)).find(Boolean);
      if (!lineMatch) return '';
      const line = parseInt(lineMatch[1], 10);
      const from = Math.max(1, line - 3);
      const to = Math.min(line + 5, lineCount(content));
      return `\n${label} lines ${from}-${to}:\n${numberedLines(content, from, to)}`;
    };

    /**
     * How often a change to a file was refused for the same fault. The fault is compared without
     * its line numbers, which move between attempts.
     */
    const refusalCounts = new Map<string, number>();
    const countRefusal = (filePath: string, damage: SanityIssue[]) => {
      const key = `${filePath}:${(damage[0]?.message || '').replace(/\d+/g, '#')}`;
      const times = (refusalCounts.get(key) || 0) + 1;
      refusalCounts.set(key, times);
      return times;
    };

    /**
     * After a repeated refusal the model gets the CURRENT lines (it kept patching from its own broken
     * version) and one different way to do the change.
     */
    const repeatedRefusalHelp = (filePath: string, current: string, damage: SanityIssue[], times: number, kind: 'edit' | 'write') => {
      const lines = lineCount(current);
      const way =
        kind === 'edit' && lines <= 150
          ? `write the COMPLETE file with write_file (it has ${lines} lines) with the change made and every bracket and tag closed`
          : kind === 'edit'
            ? 'replace the whole block you are changing (for CSS: the complete rule from its selector to its closing }) in one replace_lines call, using the line numbers below'
            : 'change only the part the task needs with edit_file or replace_lines instead of rewriting the file';
      return `\nThis change was refused ${times} times for the same reason. Do not send it again; ${way}.${issueExcerpt(current, damage, `The current "${filePath}" (unchanged),`)}${repeatNudge()}`;
    };

    /** Restates a file's unresolved check failures where the model looks last (end of the context). */
    const openProblemsFor = (filePath: string) => {
      const issues = (openSanityIssues.get(filePath) || []).filter((i) => i.severity === 'error');
      if (issues.length === 0) return '';
      return `\nStill wrong in "${filePath}" — fix exactly this and change only the line(s) that are wrong (replace_lines with the line numbers below, or edit_file):\n${formatSanityIssues(issues)}${problemExcerpt(filePath)}\n`;
    };

    /** Firmer wording once the model starts repeating itself (small models need the explicit way out). */
    const scriptOutputs = (runOptions.scriptOutputs || []).map((n) => n.toLowerCase());
    /** True for a path only the generated program may create (see RunGoalOptions.scriptOutputs). */
    const isScriptOutput = (p: string) => {
      const parts = String(p || '').replace(/\\/g, '/').toLowerCase().split('/').filter(Boolean);
      return scriptOutputs.some((name) =>
        name.endsWith('*') ? parts.some((part) => part.startsWith(name.slice(0, -1))) : parts[parts.length - 1] === name
      );
    };

    /**
     * The next open checklist item as a concrete way out of a loop: a 7B model re-read a preloaded
     * helper module three times instead of writing the script the first item named.
     */
    const nextItemHint = () => {
      const list = ledger.subtasks || [];
      const next = list.find((t) => t.status !== 'completed');
      if (!next || list.length < 2) return '';
      const file = next.description.match(/^(\S+\.\w+)\s+—/)?.[1];
      const missing = !!file && !ledger.projectTree.some((f) => f.toLowerCase() === file.toLowerCase());
      return ` Next checklist item: ${list.indexOf(next) + 1}. ${next.description}${missing ? ` — "${file}" does not exist yet: create it now with write_file.` : ''}`;
    };
    const repeatNudge = () =>
      repeatStreak >= 1
        ? ` Do NOT repeat this action again (repeat #${repeatStreak}). If the task is complete, reply with finish now; otherwise do a different, necessary step.${nextItemHint()}`
        : '';

    const pushExchange = (
      assistantText: string,
      raw: any,
      observation: string,
      summary?: string
    ): ConversationEntry => {
      conversation.push({ role: 'assistant', content: assistantText, meta: { kind: 'action', step: stepCount, raw } });
      const entry: ConversationEntry = {
        role: 'user',
        content: `${observation}\n\n${stateLine()}`,
        meta: { kind: 'observation', step: stepCount, summary: summary ? `${summary}\n\n${stateLine()}` : undefined },
      };
      conversation.push(entry);
      return entry;
    };

    const notice = (content: string, status: AgentStep['status'], title?: string) => {
      callbacks.onStep({
        id: `step_notice_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        type: 'system_notice',
        title,
        content,
        status,
      });
    };

    const markChecklist = (raw: any) => {
      const done = Array.isArray(raw?.checklist_done) ? raw.checklist_done : [];
      if (done.length === 0 || !ledger.subtasks || ledger.subtasks.length < 2) return;
      let changed = false;
      for (const n of done) {
        const task = ledger.subtasks[Number(n) - 1];
        if (task && task.status !== 'completed') {
          task.status = 'completed';
          task.completedAt = Date.now();
          changed = true;
        }
      }
      if (changed) {
        const next = ledger.subtasks.find((t) => t.status !== 'completed');
        if (next && next.status === 'pending') {
          next.status = 'in_progress';
          next.startedAt = Date.now();
          ledger.activeSubtaskId = next.id;
        }
        callbacks.onSubtasksUpdated?.(ledger.subtasks);
      }
    };

    /** Common bookkeeping after a successful create/edit. Returns the model-facing verdict. */
    const afterMutation = async (filePath: string, finalContent: string, previousContent?: string | null): Promise<string> => {
      mutationCount++;
      noopResends = 0;
      writtenByModel.add(baseName(filePath));
      if (runsWithCommands(filePath)) wroteRunnableFile = true;
      editFailures.delete(filePath);
      ledger.currentPhase = 'modification';
      ledger.knownFiles[filePath] = { size: finalContent.length, lastAction: 'written' };
      if (!ledger.projectTree.includes(filePath)) {
        ledger.projectTree.push(filePath);
        treeVersion++;
      }

      const parts: string[] = [];
      const issues = checkFileSanity(filePath, finalContent);
      if (issues.some((i) => i.severity === 'error')) {
        openSanityIssues.set(filePath, issues);
      } else {
        openSanityIssues.delete(filePath);
      }
      latestContent.set(filePath, finalContent);

      // On a broken file only fewer errors is progress: swapping one error for another (a
      // qwen2.5-coder run patched a page for 30 steps this way) must reach the no-progress brake.
      const errorCount = issues.filter((i) => i.severity === 'error').length;
      const previousCount = errorCounts.get(filePath);
      const stuck = errorCount > 0 && previousCount !== undefined && errorCount >= previousCount;
      const errorStreak = stuck ? (unchangedErrorStreak.get(filePath) || 0) + 1 : 0;
      errorCounts.set(filePath, errorCount);
      unchangedErrorStreak.set(filePath, errorStreak);
      // A change that only repeats lines the file already had is no progress either, although the
      // file changed; in a row it reaches the loop brake (the caller has just reset repeatStreak).
      const copies = typeof previousContent === 'string' ? copiedLinesAdded(previousContent, finalContent) : 0;
      copiesStreak = copies >= 2 ? copiesStreak + 1 : 0;
      if (copiesStreak > 0) repeatStreak = copiesStreak;
      if (stuck || copiesStreak > 0) stepsWithoutProgress++;
      else stepsWithoutProgress = 0;
      if (copiesStreak > 0) {
        parts.push(
          `[COPIES ONLY]: this change only added ${copies} lines that were already in "${filePath}" — nothing new. Do not add them again; if a block is now there twice, remove the extra copy.${repeatNudge()}`
        );
      }

      if (issues.length > 0) {
        parts.push(
          `Automatic check of ${filePath} found problems:\n${formatSanityIssues(issues)}${problemExcerpt(filePath)}\nFix them before finishing: ${
            // Patching a short file line by line went wrong twice in the app (a stray indent, a deleted
            // function); the whole file is cheap to write again.
            lineCount(finalContent) <= 60
              ? 'the file is short, so rewrite the whole file correctly with write_file (its complete content), or change only the wrong line(s) with replace_lines.'
              : 'change only the wrong line(s) with replace_lines (repeat the lines of the range that must stay), or rewrite the whole file with write_file.'
          }`
        );
        if (errorStreak >= 2) {
          parts.push(
            `"${filePath}" still has errors after your last ${errorStreak + 1} changes — patching single lines is not fixing it. ${
              finalContent.length <= 6000
                ? `Here is the complete current file with line numbers. Rewrite the WHOLE file correctly with write_file (for a web page: one <style> block inside <head>, the content in <body>, one <script> block right before </body>):\n${wrapUntrustedFileContent(filePath, numberedLines(finalContent))}`
                : 'Read the reported part of the file again and rewrite that whole section correctly in one edit.'
            }`
          );
        }
        notice(
          `${et('checkFoundProblems', { path: filePath, count: issues.length })}\n${issues.map((i) => `• ${i.message}`).join('\n')}`,
          issues.some((i) => i.severity === 'error') ? 'failed' : 'rejected',
          et('fileCheckTitle')
        );
      }

      if (contracts.length > 0) {
        const { missing } = await runAcceptanceChecks();
        const openErrors = Array.from(openSanityIssues.values()).some((list) => list.some((i) => i.severity === 'error'));
        if (missing.length === 0) {
          parts.push(
            openErrors
              ? 'Acceptance checks: all passed.'
              : 'Acceptance checks: all passed. If every part of the task is done, reply with finish now.'
          );
        } else {
          parts.push(`Acceptance checks still failing:\n${missing.map((m) => `- ${m}`).join('\n')}`);
        }
      }
      return parts.join('\n');
    };

    const applyMutation = async (params: {
      filePath: string;
      exists: boolean;
      baseHash: string;
      newContent: string;
    }): Promise<{ ok: boolean; error?: string }> => {
      const operation: 'create' | 'edit' = params.exists ? 'edit' : 'create';
      const explain = (error: string) => {
        if (/EEXIST|ENOTDIR|not a directory/i.test(error)) {
          const segments = params.filePath.split('/');
          const blocking = segments
            .slice(0, -1)
            .map((_, i) => segments.slice(0, i + 1).join('/'))
            .find((prefix) => ledger.projectTree.includes(prefix));
          return `${error} — "${blocking || segments.slice(0, -1).join('/')}" is a FILE, so nothing can be created inside it. Delete that file with delete_file or use another folder name.`;
        }
        return error;
      };
      try {
        const tokenRes = await window.electronAPI?.requestMutationToken({
          relativePath: params.filePath,
          operation,
          expectedBaseHash: params.exists ? params.baseHash : '',
          proposedContentHash: '',
        });
        if (!tokenRes?.success || !tokenRes.token) {
          return { ok: false, error: explain(tokenRes?.error || 'token could not be issued') };
        }
        const applyRes = await window.electronAPI?.applyApprovedMutation({
          token: tokenRes.token,
          relativePath: params.filePath,
          operation,
          newContent: params.newContent,
        });
        if (!applyRes?.success) {
          return { ok: false, error: explain(applyRes?.error || 'write failed') };
        }
        writtenFiles.add(params.filePath);
        callbacks.onTransactionApplied?.({
          transactionId: tokenRes.token,
          relativePath: params.filePath,
          operation,
          timestamp: Date.now(),
          approvedHash: applyRes.approvedHash || '',
          baseHash: params.exists ? params.baseHash : '',
        });
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: explain(String(err?.message || err)) };
      }
    };
    const requestApproval = async (item: ChangesetItem, autoTitle: string, pendingTitle: string, detail: string) => {
      const isAutoApprove = securityProfile === 'balanced' || securityProfile === 'autonomous';
      if (isAutoApprove) {
        callbacks.onStep({
          id: `step_cs_pr_${Date.now()}`,
          timestamp: Date.now(),
          type: 'changeset_proposal',
          title: autoTitle,
          content: `${detail} ${et(securityProfile === 'autonomous' ? 'autoApprovedAutonomous' : 'autoApprovedBalanced')}`,
          status: 'approved',
        });
        return true;
      }
      callbacks.onStep({
        id: `step_cs_pr_${Date.now()}`,
        timestamp: Date.now(),
        type: 'changeset_proposal',
        title: pendingTitle,
        content: detail,
        status: 'pending',
      });
      callbacks.onStatusChange('waiting_changeset_approval');
      pauseTimer();
      try {
        return await callbacks.onRequestChangesetApproval([item]);
      } finally {
        resumeTimer();
        callbacks.onStatusChange('thinking');
      }
    };

    /**
     * End of run: theme the pages this run wrote (theme.css, color/font roles, icons) and fix
     * stale copyright years / a missing viewport. Runs once, after the agent's last step, so the
     * model's view of its files never changed under it. A change that would break a file is dropped.
     */
    let designDone = false;
    const applyDesignTheme = async () => {
      if (designDone) return;
      designDone = true;
      try {
        const paths = Array.from(writtenFiles).filter((p) => /\.(?:html?|css|js)$/i.test(p) && !isThemeAsset(p));
        if (!paths.some((p) => /\.(?:html?|css)$/i.test(p))) return;
        const files: Array<{ path: string; content: string }> = [];
        const hashes = new Map<string, string>();
        for (const p of paths) {
          const res = await window.electronAPI?.readWorkspaceFile(p);
          if (res?.success && typeof res.content === 'string') {
            files.push({ path: p, content: res.content });
            hashes.set(p, res.hash || '');
          }
        }
        const themeRes = await window.electronAPI?.readWorkspaceFile(THEME_FILE);
        const themeCss = themeRes?.success ? (themeRes.content ?? '') : null;
        let result = applyDesign({ plan: designPlan, files, themeCss });
        if (result.changes.length === 0) return;

        const autoApprove = securityProfile === 'balanced' || securityProfile === 'autonomous';
        const write = async (change: DesignChange): Promise<boolean> => {
          if (change.before !== null && damageFromChange(change.path, change.before, change.after).length > 0) {
            callbacks.onLog(et('designWouldBreak', { path: change.path }));
            return false;
          }
          const item: ChangesetItem = {
            id: `cs_theme_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            operation: change.before === null ? 'create' : 'edit',
            relativePath: change.path,
            baseHash: hashes.get(change.path) || '',
            proposedContentHash: '',
            originalContent: change.before ?? '',
            newContent: change.after,
            reason: change.path === THEME_FILE ? et('designThemeFile') : et('designPageLinked'),
            selected: true,
            status: 'pending',
          };
          if (!autoApprove) {
            const approved = await requestApproval(item, et('designTitle'), et('designProposalTitle'), et('designChangeDetail', { path: change.path }));
            if (!approved) return false;
          }
          const res = await applyMutation({
            filePath: change.path,
            exists: change.before !== null,
            baseHash: hashes.get(change.path) || '',
            newContent: change.after,
          });
          if (!res.ok) callbacks.onLog(et('designWriteFailed', { path: change.path, error: String(res.error) }));
          return res.ok;
        };

        // The theme file comes first; without it the pages only get the plain fixes.
        if (result.themeFileChanged) {
          const themeChange = result.changes.find((c) => c.path === THEME_FILE)!;
          if (!(await write(themeChange))) result = applyDesign({ plan: null, files, themeCss });
        }
        const done: string[] = result.themeFileChanged ? [THEME_FILE] : [];
        for (const change of result.changes) {
          if (change.path === THEME_FILE) continue;
          if (await write(change)) done.push(change.path);
        }
        if (done.length === 0) return;
        for (const p of done) ledger.appliedChanges.push(`Design: "${p}"`);

        const theme = result.theme;
        const lines: string[] = [];
        if (theme && designPlan) {
          const lang = uiLanguage();
          const source =
            designPlan.categorySource === 'model' ? et('designSourceModel')
            : designPlan.categorySource === 'keywords' ? et('designSourceKeywords')
            : designPlan.categorySource === 'fixed' ? et('designSourceFixed')
            : designPlan.categorySource === 'random' ? et('designSourceRandom')
            : designPlan.categorySource === 'existing' ? et('designSourceExisting')
            : designPlan.categorySource === 'wizard' ? et('designSourceWizard')
            : et('designSourceGeneral');
          lines.push(
            designPlan.theme
              ? `${et('designApplied', { theme: themeName(theme, lang), category: categoryLabel(theme.category, lang), source })}\n${themeMood(theme, lang)}`
              : et('designBaseApplied')
          );
          const details = [
            et('designFiles', { count: done.length }),
            result.colorChanges > 0 ? et('designColors', { count: result.colorChanges }) : '',
            result.icons > 0 ? et('designIcons', { count: result.icons }) : '',
          ].filter(Boolean);
          lines.push(`• ${details.join(' · ')}`);
        }
        if (result.fixedYears.length > 0) lines.push(`• ${et('designYear', { year: new Date().getFullYear() })}`);
        for (const b of result.buttons.filter((x) => done.includes(x.path))) {
          lines.push(`• ${et('designButtons', { path: b.path, count: b.count })}`);
        }
        for (const m of result.menus.filter((x) => done.includes(x.path))) {
          const what = [
            m.repaired.includes('script') ? et('designMenuToggle') : m.repaired.includes('open') ? et('designMenuOpens') : '',
            m.repaired.includes('close') ? et('designMenuCloses') : '',
          ].filter(Boolean);
          lines.push(`• ${et('designMenuRepaired', { path: m.path, what: what.join(', ') })}`);
        }
        if (theme && designPlan) lines.push(et('designSettingsHint'));
        notice(lines.join('\n') || et('pageFixesApplied', { files: done.join(', ') }), 'success', theme ? et('designTitle') : et('pageFixesTitle'));
      } catch (err: any) {
        callbacks.onLog(et('designFailed', { error: String(err?.message || err) }));
      }
    };

    // Starting files of a wizard: written once, before the first step, never over an existing file.
    // They are listed but not preloaded: a model shown a ready module read it again and again.
    const seeded = new Set<string>();
    for (const seed of runOptions.seedFiles || []) {
      const rel = seed.path.replace(/\\/g, '/');
      if (!isSafePath(rel) || projectFiles.some((f) => f.toLowerCase() === rel.toLowerCase())) continue;
      const item: ChangesetItem = {
        id: `cs_seed_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        operation: 'create',
        relativePath: rel,
        baseHash: '',
        proposedContentHash: '',
        originalContent: '',
        newContent: seed.content,
        reason: et('wizardFileReason'),
        selected: true,
        status: 'pending',
      };
      const detail = et('wizardFileDetail', { path: rel, lines: lineCount(seed.content) });
      if (!(await requestApproval(item, et('wizardFileAutoTitle'), et('wizardFileProposalTitle'), detail))) continue;
      const res = await applyMutation({ filePath: rel, exists: false, baseHash: '', newContent: seed.content });
      if (res.ok) {
        projectFiles.push(rel); // ledger.projectTree is the same list
        seeded.add(rel);
        treeVersion++;
      } else {
        callbacks.onLog(et('wizardFileFailed', { path: rel, error: String(res.error) }));
      }
    }
    if (!this.isRunning) return;

    // ---------------------------------------------------------------------
    // Initial task message (static for the whole run)
    // ---------------------------------------------------------------------
    const taskParts: string[] = [];
    // The earlier task comes first and is marked as done, so the TASK is the last word. Its request is
    // shown only when the new task continues it; the old run's own summary is never shown (a 7B model
    // copied it as its first thought and went back to that work).
    const previous = runOptions.previousTask;
    if (previous) {
      const files = previous.changedFiles.length > 0 ? previous.changedFiles.join(', ') : 'none';
      if (continuesPreviousTask(goal)) {
        taskParts.push(
          `EARLIER IN THIS SESSION (background; the new TASK below continues it):\nThe user asked: "${previous.request.trim().slice(0, 1200)}"\nThat task ${previous.finished ? 'was completed' : 'was not finished'}. Files it changed: ${files}.`
        );
      } else {
        taskParts.push(
          `EARLIER IN THIS SESSION: another task changed these files: ${files}. That task is over; do not continue it. Work only on the new TASK below.`
        );
      }
    }
    taskParts.push(`TASK:\n${goal}`);
    if (/[çğıöşüÇĞİÖŞÜ]|\b(?:ve|bir|için|ile|olsun|yap|oluştur|ekle|düzelt|sayfa|dosya)\b/i.test(goal)) {
      taskParts.push('LANGUAGE: the user writes in Turkish. Write "thought" and "summary" in Turkish; page text follows the request.');
    }
    if (menuPage && namedMenuLinks.length >= 2) {
      const lines = namedMenuLinks.map((l) => l.line);
      taskParts.push(
        `REFERENCED ELEMENTS: ${namedMenuLinks.map((l) => `"${l.text}"`).join(', ')} in the TASK are the menu links of "${menuPage}" (lines ${Math.min(...lines)}-${Math.max(...lines)}, currently ${namedMenuLinks
          .map((l) => `href="${l.href ?? ''}"`)
          .filter((v, i, a) => a.indexOf(v) === i)
          .join(', ')}). The request is about these links.`
      );
    }
    if (subtasks.length > 1) {
      taskParts.push(
        `CHECKLIST (the items the user listed in the TASK above — parts of that one task, not separate tasks; complete every item):\n${subtasks
          .map((s, i) => `${i + 1}. ${s.description}`)
          .join('\n')}`
      );
    }
    if (contracts.length > 0) {
      const criteria = contracts.flatMap((c) => c.criteria.map((cr) => `- ${cr.description}`));
      taskParts.push(`ACCEPTANCE CHECKS (verified automatically after each change):\n${criteria.join('\n')}`);
    }
    if (projectFiles.length > 0) {
      const sorted = [...projectFiles].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
      const shown = sorted.slice(0, 60).map((f) => `- ${f}`).join('\n');
      const more = projectFiles.length > 60 ? `\n- ... and ${projectFiles.length - 60} more (use list_dir)` : '';
      taskParts.push(
        `PROJECT FILES (${projectFiles.length}):\n<<<WORKSPACE_SNAPSHOT_UNTRUSTED_DATA>>>\n${shown}${more}\n<<<END_WORKSPACE_SNAPSHOT>>>`
      );
    } else {
      taskParts.push('PROJECT FILES: the project folder is empty. Create the files the task needs.');
    }

    // Small projects (typically a single page): include the current file contents so follow-up
    // requests ("stilleri ekle", "düzelt") modify the real content instead of rewriting blindly.
    // Bounded to ~25 % of the context window; larger projects are read with read_file.
    const preloaded: Array<{ path: string; hash: string }> = [];
    // The design theme's stylesheet is not the model's work and would eat the context budget.
    const preloadable = projectFiles.filter((f) => !isThemeAsset(f) && !seeded.has(f));
    if (preloadable.length > 0 && preloadable.length <= 6) {
      const charBudget = Math.min(12000, Math.floor(requestProfile.numCtx * 0.25 * charsPerToken));
      let used = 0;
      const blocks: string[] = [];
      for (const rel of preloadable) {
        if (!/\.(html?|css|scss|js|jsx|ts|tsx|mjs|cjs|py|json|md|txt|ya?ml|toml|go|rs|java|cs|php|rb|sh|vue|svelte)$/i.test(rel)) continue;
        const res = await window.electronAPI?.readWorkspaceFile(rel);
        if (!res?.success || res.content === undefined) continue;
        let text = res.content;
        let note = '';
        if (looksJsonEscaped(text)) {
          text = sanitizeFileContent(rel, text).content;
          note = ' — WARNING: this file is stored with literal \\n and \\" escape sequences (it is broken in the browser). Shown decoded; rewrite it with write_file using real line breaks and quotes, keeping its content.';
        }
        if (used + text.length > charBudget) continue;
        used += text.length;
        blocks.push(`"${rel}" (${lineCount(text)} lines)${note}:\n${wrapUntrustedFileContent(rel, text)}`);
        preloaded.push({ path: rel, hash: res.hash || hashText(res.content) });
        ledger.knownFiles[rel] = { size: res.content.length, lastAction: 'okundu' };
      }
      if (blocks.length > 0) {
        taskParts.push(`CURRENT FILE CONTENTS (already loaded — no need to read them again):\n${blocks.join('\n\n')}`);
      }
    }

    if (!gitAvailable) taskParts.push('Git is not available in this folder.');
    const taskEntry: ConversationEntry = { role: 'user', content: taskParts.join('\n\n'), meta: { kind: 'task' } };
    conversation.push(taskEntry);
    for (const file of preloaded) {
      seenActions.set(`read:${file.path}:${file.hash}:-`, { step: 0, entry: taskEntry });
    }

    stateMachine.transition('EXECUTING', et('stateExecuting'));
    callbacks.onStatusChange('thinking');

    const addSteeringDirective = (directive: string) => {
      consecutiveErrors = 0;
      repeatStreak = 0;
      stepsWithoutProgress = 0;
      finishPushbacks = 0;
      callbacks.onLog(et('steerLog', { directive }));
      callbacks.onStep({
        id: `step_steer_${Date.now()}`,
        timestamp: Date.now(),
        type: 'user_steering',
        title: et('steerTitle'),
        content: directive,
        status: 'success',
      });
      ledger.userDecisions.push({ question: 'Instruction sent during the run', answer: directive });
      if (contractsEnabled) {
        contracts = TaskCompiler.mergeDirective(contracts, directive, {
          projectFiles: ledger.projectTree,
          singleFile: synthesisStrategy === 'single_file',
          menuTexts: menuLinks.map((l) => l.text).filter(Boolean),
        });
      }
      ledger.subtasks.push({
        id: `task_steer_${Date.now()}`,
        description: et('steerChecklistItem', { directive }),
        status: ledger.subtasks.some((t) => t.status === 'in_progress') ? 'pending' : 'in_progress',
      });
      callbacks.onSubtasksUpdated?.(ledger.subtasks);
      conversation.push({
        role: 'user',
        content: `[USER UPDATE — highest priority]: ${directive}\nAdjust your plan to this instruction now. The task is not finished until it is done.\n\n${stateLine()}`,
        meta: { kind: 'steer', step: stepCount },
      });
    };

    const finalize = (
      summary: string,
      status: 'finished' | 'error',
      rawOutput?: string,
      warnings: string[] = [],
      note?: string
    ) => {
      finished = true;
      if (status === 'finished') {
        moveTo(['VALIDATING', 'COMPLETED', 'DONE'], et('stateCompleted'));
        for (const t of ledger.subtasks) {
          t.status = 'completed';
          if (!t.completedAt) t.completedAt = Date.now();
        }
        callbacks.onSubtasksUpdated?.(ledger.subtasks);
      } else {
        moveTo(['RETRYING', 'FAILED'], et('stateNotVerified'));
        releaseSubtasks(ledger);
      }
      const changed = Array.from(new Set(ledger.appliedChanges.map((c) => c.match(/"([^"]+)"/)?.[1]).filter(Boolean)));
      let content = summary.trim() || et('taskCompleted');
      if (changed.length > 0) content += `\n\n${et('changedFiles', { files: changed.join(', ') })}`;
      if (warnings.length > 0) content += `\n\n${et('unverifiedItems')}\n${warnings.map((w) => `• ${w}`).join('\n')}`;
      if (note) content += `\n\nℹ️ ${note}`;
      callbacks.onStep({
        id: `step_fin_${Date.now()}`,
        timestamp: Date.now(),
        type: 'final_answer',
        title: status === 'finished' ? et('finishedTitle') : et('finishedIncompleteTitle'),
        content,
        status: status === 'finished' ? 'success' : 'failed',
        rawOutput,
      });
      callbacks.onStatusChange(status);
    };

    /**
     * When the model gets stuck AFTER the work is verifiably done (acceptance checks pass and no
     * file problems are open), end the task as completed with a note instead of failing it.
     * Without acceptance checks (scripts) the evidence is the program itself: a file the model wrote
     * ran with exit code 0 after its last change, and no command failed since. Anything else keeps the
     * honest failure status.
     */
    const tryGracefulCompletion = async (why: string): Promise<boolean> => {
      if (mutationCount === 0) return false;
      if (Array.from(openSanityIssues.values()).some((list) => list.some((i) => i.severity === 'error'))) return false;
      if (contracts.length === 0) {
        // No acceptance checks (a script): the evidence is the program. When a file the model wrote ran
        // with exit code 0 after its last change and no command failed since, a model that then loops
        // (re-runs it, re-writes the same content) has finished its work, not failed it.
        // Code is proven by running it; pages, styles and texts (nothing to run) by the model
        // re-sending a change that is already in the file.
        const programRan = programOkAt === mutationCount;
        if (!programRan && (wroteRunnableFile || noopResends < 2)) return false;
        await applyDesignTheme();
        finalize(
          et('taskCompleted'),
          'finished',
          undefined,
          [],
          `${why} ${programRan ? et('gracefulProgramRan') : et('gracefulResent')}`
        );
        return true;
      }
      const { missing } = await runAcceptanceChecks();
      if (missing.length > 0) return false;
      await applyDesignTheme();
      finalize(
        et('taskCompleted'),
        'finished',
        undefined,
        [],
        `${why} ${et('gracefulChecksPassed')}`
      );
      return true;
    };

    const stopWithError = (message: string, state: AgentState = 'FAILED') => {
      finished = true;
      if (state === 'BLOCKED') moveTo(['BLOCKED'], message);
      else moveTo(['RETRYING', 'FAILED'], message);
      releaseSubtasks(ledger);
      notice(message, 'failed');
      callbacks.onStatusChange('error');
    };
    // The run as the tool handlers (./run/*) see it; `let` members are live views of the variables above.
    const ctx: RunContext = {
      engine: this,
      MAX_READ_CHARS,
      acceptanceNote,
      afterMutation,
      appliedEdits,
      appliedRuns,
      applyDesignTheme,
      applyMutation,
      baseName,
      callbacks,
      commandOutputs,
      commandRuns,
      get consecutiveErrors() {
        return consecutiveErrors;
      },
      set consecutiveErrors(value: number) {
        consecutiveErrors = value;
      },
      countRefusal,
      editFailures,
      finalize,
      get finishPushbacks() {
        return finishPushbacks;
      },
      set finishPushbacks(value: number) {
        finishPushbacks = value;
      },
      goal,
      issueExcerpt,
      ledger,
      moveTo,
      get mutationCount() {
        return mutationCount;
      },
      set mutationCount(value: number) {
        mutationCount = value;
      },
      get noopResends() {
        return noopResends;
      },
      set noopResends(value: number) {
        noopResends = value;
      },
      notice,
      openProblemsFor,
      openSanityIssues,
      originalSnapshots,
      pauseTimer,
      problemExcerpt,
      get programOkAt() {
        return programOkAt;
      },
      set programOkAt(value: number) {
        programOkAt = value;
      },
      pushExchange,
      rejectedWrites,
      repeatNudge,
      get repeatStreak() {
        return repeatStreak;
      },
      set repeatStreak(value: number) {
        repeatStreak = value;
      },
      repeatedRefusalHelp,
      requestApproval,
      resumeTimer,
      runAcceptanceChecks,
      runOptions,
      securityProfile,
      seenActions,
      get stepCount() {
        return stepCount;
      },
      set stepCount(value: number) {
        stepCount = value;
      },
      get stepsWithoutProgress() {
        return stepsWithoutProgress;
      },
      set stepsWithoutProgress(value: number) {
        stepsWithoutProgress = value;
      },
      stillVisible,
      get treeVersion() {
        return treeVersion;
      },
      set treeVersion(value: number) {
        treeVersion = value;
      },
      userRequestText,
      writtenByModel,
      writtenFiles,
      get wroteRunnableFile() {
        return wroteRunnableFile;
      },
      set wroteRunnableFile(value: boolean) {
        wroteRunnableFile = value;
      },
    };


    // ---------------------------------------------------------------------
    // Main loop
    // ---------------------------------------------------------------------
    while (this.isRunning && stepCount < MAX_STEPS && !finished) {
      if (this.pendingInterruptDirective) {
        const directive = this.pendingInterruptDirective;
        this.pendingInterruptDirective = null;
        addSteeringDirective(directive);
      }

      stepCount++;

      // Circuit Breaker: Max Active Time Check (ignoring paused user confirmation time)
      if (getActiveExecutionTime() > MAX_TASK_TIME_MS) {
        notice(et('limitTime', { minutes: effectiveMinutes }), 'failed');
        releaseSubtasks(ledger);
        callbacks.onStatusChange('idle');
        break;
      }

      // Circuit Breaker: Max Tool Calls Check
      if (toolCallCount >= MAX_TOOL_CALLS) {
        notice(et('limitToolCalls', { count: MAX_TOOL_CALLS }), 'failed');
        releaseSubtasks(ledger);
        callbacks.onStatusChange('idle');
        break;
      }

      if (repeatStreak >= MAX_REPEAT_STREAK) {
        if (await tryGracefulCompletion(et('whyRepeating'))) break;
        stopWithError(
          et('stoppedLoop', { count: repeatStreak }),
          'BLOCKED'
        );
        break;
      }
      if (stepsWithoutProgress >= MAX_STEPS_WITHOUT_PROGRESS) {
        if (await tryGracefulCompletion(et('whyNoProgress'))) break;
        stopWithError(
          et('stoppedNoProgress', { count: stepsWithoutProgress }),
          'BLOCKED'
        );
        break;
      }

      // Circuit Breaker: Consecutive Failures Check
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        if (securityProfile === 'autonomous') {
          if (autonomousRecoveries >= 2) {
            if (await tryGracefulCompletion(et('whyErrorsAfterWork'))) break;
            stopWithError(et('stoppedErrors', { count: autonomousRecoveries }));
            break;
          }
          autonomousRecoveries++;
          consecutiveErrors = 0;
          callbacks.onLog(et('errorsAutonomousLog'));
          conversation.push({
            role: 'user',
            content: `[RECOVERY]: Several steps in a row failed. Re-read the task and the latest results, then choose a different approach (for example, rewrite the whole file with write_file instead of repeating a failing edit). If everything requested is done, call finish.\n\n${stateLine()}`,
            meta: { kind: 'steer', step: stepCount },
          });
        } else {
          callbacks.onLog(et('errorsAskLog'));
          pauseTimer();
          let userGuidance = '';
          try {
            userGuidance = await callbacks.onRequestClarification({
              id: `clar_err_${Date.now()}`,
              question: et('errorsQuestion'),
              options: [et('errorsTryOther'), et('errorsStop')],
            });
          } finally {
            resumeTimer();
          }
          if (userGuidance === et('errorsStop')) {
            releaseSubtasks(ledger);
            callbacks.onStatusChange('idle');
            break;
          }
          consecutiveErrors = 0;
          conversation.push({
            role: 'user',
            content: `[USER GUIDANCE]: ${userGuidance}. Several steps failed; take a different approach.\n\n${stateLine()}`,
            meta: { kind: 'steer', step: stepCount },
          });
        }
      }

      try {
        // ---- Context budget: keep system + history + expected answer inside num_ctx ----
        const numCtx = requestProfile.numCtx;
        const systemTokens = estimateTokens(systemPrompt, charsPerToken);
        const historyTokens = () =>
          conversation.reduce((sum, m) => sum + estimateTokens(m.content, charsPerToken) + 8, 0);
        let promptTokens = systemTokens + historyTokens();
        const budget = numCtx - Math.min(desiredPredict, Math.floor(numCtx / 2)) - 256;
        if (promptTokens > budget) {
          for (const keep of [4, 2, 1]) {
            const compacted = compressConversationContext(conversation, keep);
            conversation.splice(0, conversation.length, ...compacted);
            promptTokens = systemTokens + historyTokens();
            if (promptTokens <= budget * 0.7) break;
          }
          // Still too big: drop the oldest exchanges (keep the task message and recent work)
          const isSummaryNote = (m: ConversationEntry) => m.meta?.kind === 'steer' && m.content.startsWith('[EARLIER STEPS');
          let dropped = false;
          while (promptTokens > budget && conversation.length > 5) {
            const firstNote = conversation.findIndex((m, i) => i > 0 && isSummaryNote(m));
            if (firstNote !== -1) {
              conversation.splice(firstNote - 1, 2); // previous summary + its placeholder reply
            } else {
              conversation.splice(1, 2);
            }
            dropped = true;
            promptTokens = systemTokens + historyTokens();
          }
          if (dropped) {
            const changedFiles = Array.from(
              new Set(ledger.appliedChanges.map((c) => c.match(/"([^"]+)"/)?.[1]).filter(Boolean))
            );
            conversation.splice(
              1,
              0,
              {
                role: 'assistant',
                content: JSON.stringify({ thought: 'Continuing the task.', action: 'noop' }),
                meta: { kind: 'action', compacted: true },
              },
              {
                role: 'user',
                content: `[EARLIER STEPS were removed to fit the context window. Files changed so far: ${
                  changedFiles.join(', ') || 'none'
                }. Read a file again if you need its exact content.]`,
                meta: { kind: 'steer', compacted: true },
              }
            );
            promptTokens = systemTokens + historyTokens();
          }
          callbacks.onLog(et('contextCompressed', { tokens: promptTokens, window: numCtx }));
        }
        const numPredict = Math.max(512, Math.min(desiredPredict, numCtx - promptTokens - 256));

        callbacks.onLog(et('stepWaiting', { step: stepCount, max: MAX_STEPS, tokens: promptTokens }));
        const stepStart = Date.now();

        const messages: OllamaChatMessage[] = conversation.map((m) => ({ role: m.role, content: m.content }));
        let attempt = 0;
        let outcome: StreamOutcome;
        while (true) {
          const options: GenerationOptions = {
            ...(attempt > 0 ? buildAgentSamplingOptions(runtime, attempt) : requestProfile.sampling),
            num_ctx: numCtx,
            num_predict: numPredict,
          };
          try {
            outcome = await this.streamOnce({
              model,
              system: systemPrompt,
              messages,
              options,
              format: formatSupported ? actionSchema : undefined,
              think,
              callbacks,
            });
          } catch (streamErr: any) {
            const msg = String(streamErr?.message || '');
            const aborted = streamErr?.name === 'AbortError' || this.abortController?.signal.aborted;
            const cloudCode = isCloudRequestError(streamErr) ? streamErr.code : null;
            if (!aborted && formatSupported && (cloudCode === 'format_unsupported' || (!cloudCode && /format|schema|grammar/i.test(msg)))) {
              formatSupported = false;
              callbacks.onLog(et('schemaUnsupported', { error: msg }));
              continue;
            }
            if (!aborted && think !== undefined && (cloudCode === 'think_unsupported' || (!cloudCode && /think/i.test(msg)))) {
              think = undefined;
              callbacks.onLog(et('thinkUnsupportedLog', { error: msg }));
              continue;
            }
            throw streamErr;
          }
          if (outcome.repetition && attempt < 1) {
            attempt++;
            callbacks.onLog(et('retryRepetition'));
            continue;
          }
          // An empty write_file is a failed generation rather than a decision (gemma2:2b sometimes
          // closes the "content" string at once): sample once more before spending a step on it.
          if (
            attempt < 1 &&
            !EMPTY_FILE_INTENT.test(userRequestText()) &&
            isEmptyWrite(ToolDispatcher.parseActionFromResponse(outcome.text))
          ) {
            attempt++;
            callbacks.onLog(et('retryEmptyFile'));
            continue;
          }
          break;
        }

        if (!this.isRunning) break;

        const done = outcome.done as DoneInfo | null;
        if (done) {
          const secs = Math.round((Date.now() - stepStart) / 100) / 10;
          const tps = done.evalDurationNs > 0 ? Math.round((done.evalCount / (done.evalDurationNs / 1e9)) * 10) / 10 : 0;
          // Where the time goes: loading the model, reading the prompt (only its new part when Ollama
          // reuses its cache) and writing the answer.
          const seconds = (ns: number) => Math.round(ns / 1e8) / 10;
          callbacks.onLog(
            et('stepTiming', {
              step: stepCount,
              tokens: done.evalCount,
              rate: tps,
              seconds: secs,
              promptTokens: done.promptEvalCount,
              promptSeconds: seconds(done.promptEvalDurationNs),
              loadSeconds: seconds(done.loadDurationNs),
            })
          );
          if (done.promptEvalCount > 50) {
            const promptChars = systemPrompt.length + conversation.reduce((s, m) => s + m.content.length, 0);
            const observed = promptChars / done.promptEvalCount;
            charsPerToken = Math.min(5, Math.max(2.2, charsPerToken * 0.5 + observed * 0.5));
          }
        }

        const fullResponse = outcome.text;

        // ---- Degenerate output that kept looping even after the retry ----
        if (outcome.repetition) {
          consecutiveErrors++;
          stepsWithoutProgress++;
          notice(et('repetitionDiscarded'), 'rejected');
          conversation.push({
            role: 'user',
            content: `[ERROR]: Your previous reply got stuck repeating the same text and was discarded. Keep "thought" short. If you are writing a big file, write a complete but more compact version.\n\n${stateLine()}`,
            meta: { kind: 'observation', step: stepCount },
          });
          continue;
        }

        const parsed: ParsedAction = ToolDispatcher.parseActionFromResponse(fullResponse, {
          expectedArtifacts: !formatSupported && contracts.length > 0 ? [contracts[0].criteria[0].target] : undefined,
        });

        // ---- Output cut off by the token limit ----
        if (done?.doneReason === 'length' && parsed.type === 'unknown') {
          const ceiling = Math.max(desiredPredict, Math.floor(numCtx * 0.6));
          if (desiredPredict < ceiling) {
            desiredPredict = Math.min(ceiling, desiredPredict * 2);
            callbacks.onLog(et('outputLimitRaised', { tokens: desiredPredict }));
            stepCount--;
            continue;
          }
          consecutiveErrors++;
          notice(et('outputCutOff', { tokens: done.evalCount }), 'rejected');
          conversation.push({
            role: 'user',
            content: `[ERROR]: Your reply was cut off after ${done.evalCount} tokens (the output limit) before the JSON was complete, so nothing was executed. Make the next reply smaller: write a more compact version of the file, or split the work (create the file first, then extend it with edit_file in the next steps).\n\n${stateLine()}`,
            meta: { kind: 'observation', step: stepCount },
          });
          continue;
        }

        const thought = String(parsed.rawJson?.thought || '').trim() ||
          (fullResponse.match(/<thought>([\s\S]*?)<\/thought>/i)?.[1] || '').trim();
        if (thought) {
          callbacks.onStep({
            id: `step_th_${Date.now()}`,
            timestamp: Date.now(),
            type: 'thought',
            content: thought,
            rawOutput: fullResponse.length > 4000 ? `${fullResponse.slice(0, 4000)}…` : fullResponse,
            metadata: { step: stepCount, model },
          });
        }

        // ---- Unparseable / unknown action ----
        if (parsed.type === 'unknown' || !parsed.payload) {
          consecutiveErrors++;
          stepsWithoutProgress++;
          const unknownName = parsed.rawJson?.action ? `"${parsed.rawJson.action}" is not a tool. ` : '';
          notice(et('invalidToolCall', { detail: parsed.error || et('unknownFormat') }), 'rejected');
          conversation.push({ role: 'assistant', content: fullResponse.slice(0, 1500) || '(empty reply)', meta: { kind: 'action', step: stepCount } });
          conversation.push({
            role: 'user',
            content: `[ERROR]: ${unknownName}Your reply was not a valid tool call. Reply with exactly one JSON object such as {"thought": "...", "action": "read_file", "path": "..."} using one of the listed tools.\n\n${stateLine()}`,
            meta: { kind: 'observation', step: stepCount },
          });
          continue;
        }

        const validationError = ToolDispatcher.validateAction(parsed);
        if (validationError) {
          consecutiveErrors++;
          stepsWithoutProgress++;
          notice(et('missingToolParameter', { detail: validationError }), 'rejected');
          pushExchange(compactActionForHistory(parsed.rawJson), parsed.rawJson, `[ERROR]: ${validationError} Nothing was executed.`);
          continue;
        }

        markChecklist(parsed.rawJson);
        toolCallCount++;
        const payload = parsed.payload;
        const assistantText = fullResponse.trim() || JSON.stringify(parsed.rawJson);

        // =========================================================
        // Environment guards
        // =========================================================
        if ((parsed.type === 'read_git_status' || parsed.type === 'read_git_diff') && ledger.unavailableBinaries.includes('git')) {
          consecutiveErrors++;
          notice(et('blockedGit'), 'failed');
          pushExchange(assistantText, parsed.rawJson, `[BLOCKED]: git is not available in this folder. Continue with the file tools.`);
          continue;
        }
        if ((parsed.type === 'web_search' || parsed.type === 'fetch_url') &&
            !ToolDispatcher.isWebAccessAllowed('coding', useSettingsStore.getState().settings.webAccess)) {
          consecutiveErrors++;
          notice(et('blockedWeb', { action: parsed.type }), 'rejected');
          callbacks.onLog(et('blockedWebLog', { action: describeAction(parsed.type, payload) }));
          pushExchange(assistantText, parsed.rawJson, `[BLOCKED]: web access is turned off by the user. Complete the task with the local project files.`);
          continue;
        }
        if (parsed.type === 'propose_command' && ledger.unavailableBinaries.includes(payload.binary)) {
          consecutiveErrors++;
          notice(et('blockedCommand', { binary: String(payload.binary) }), 'failed');
          pushExchange(assistantText, parsed.rawJson, `[BLOCKED]: "${payload.binary}" is not available here. Do not call it again.`);
          continue;
        }
        if (['propose_create', 'propose_edit', 'propose_delete', 'read_file'].includes(parsed.type) && !isSafePath(payload.path)) {
          consecutiveErrors++;
          notice(et('blockedPath', { path: String(payload.path) }), 'failed');
          pushExchange(assistantText, parsed.rawJson, `[BLOCKED]: "${payload.path}" is not a valid path inside the project. Use a relative path such as "src/app.js".`);
          continue;
        }
        if ((parsed.type === 'propose_create' || parsed.type === 'propose_edit') && isScriptOutput(payload.path)) {
          consecutiveErrors++;
          repeatStreak++;
          notice(et('blockedScriptOutput', { path: String(payload.path) }), 'rejected');
          pushExchange(
            assistantText,
            parsed.rawJson,
            `[BLOCKED]: "${payload.path}" is written by the script itself (its log / backups). Never create or fix it by hand: run the script, and if the file is missing or wrong, fix the script.${repeatNudge()}`
          );
          continue;
        }

        // =========================================================
        // finish
        // =========================================================
        if (parsed.type === 'finish') {
          const flow = await handleFinish(ctx, { assistantText, fullResponse, parsed, payload });
          if (flow === 'continue') continue;
          if (flow === 'break') break;
          if (flow === 'return') return;
        }

        // =========================================================
        // Repetition guard for read-only actions
        // =========================================================
        const readOnlySignature = (() => {
          switch (parsed.type) {
            case 'read_directory':
              return `ls:${payload.path}:${treeVersion}`;
            case 'search_code':
              return `search:${payload.query}:${treeVersion}:${mutationCount}`;
            case 'web_search':
              return `web:${payload.query}`;
            case 'fetch_url':
              return `fetch:${payload.url}`;
            case 'read_git_status':
            case 'read_git_diff':
              return `${parsed.type}:${mutationCount}`;
            default:
              return null;
          }
        })();
        if (readOnlySignature) {
          const seen = seenActions.get(readOnlySignature);
          if (seen && stillVisible(seen.entry)) {
            repeatStreak++;
            stepsWithoutProgress++;
            notice(et('repeatedAction', { action: describeAction(parsed.type, payload), step: seen.step }), 'rejected');
            pushExchange(
              assistantText,
              parsed.rawJson,
              `[REPEATED]: you already did ${describeAction(parsed.type, payload)} at step ${seen.step}; its result is above and nothing has changed since.${repeatNudge() || ' Do the next step of the task instead.'}`
            );
            continue;
          }
        }

        // =========================================================
        // Read-only tools
        // =========================================================
        if (parsed.type === 'read_directory') {
          const flow = await handleListDir(ctx, { assistantText, parsed, payload, readOnlySignature });
          if (flow === 'continue') continue;
          if (flow === 'break') break;
          if (flow === 'return') return;
        }

        if (parsed.type === 'read_file') {
          const flow = await handleReadFile(ctx, { assistantText, parsed, payload });
          if (flow === 'continue') continue;
          if (flow === 'break') break;
          if (flow === 'return') return;
        }

        if (parsed.type === 'search_code') {
          const flow = await handleSearchCode(ctx, { assistantText, parsed, payload, readOnlySignature });
          if (flow === 'continue') continue;
          if (flow === 'break') break;
          if (flow === 'return') return;
        }

        if (parsed.type === 'read_git_status' || parsed.type === 'read_git_diff') {
          const flow = await handleGit(ctx, { assistantText, parsed, readOnlySignature });
          if (flow === 'continue') continue;
          if (flow === 'break') break;
          if (flow === 'return') return;
        }

        if (parsed.type === 'web_search') {
          const flow = await handleWebSearch(ctx, { assistantText, parsed, payload, readOnlySignature });
          if (flow === 'continue') continue;
          if (flow === 'break') break;
          if (flow === 'return') return;
        }

        if (parsed.type === 'fetch_url') {
          const flow = await handleFetchUrl(ctx, { assistantText, parsed, payload, readOnlySignature });
          if (flow === 'continue') continue;
          if (flow === 'break') break;
          if (flow === 'return') return;
        }

        // =========================================================
        // Mutations (human-in-the-loop approval)
        // =========================================================
        if (parsed.type === 'propose_create') {
          const flow = await handleWriteFile(ctx, { assistantText, parsed, payload });
          if (flow === 'continue') continue;
          if (flow === 'break') break;
          if (flow === 'return') return;
        }

        if (parsed.type === 'propose_edit') {
          const flow = await handleEditFile(ctx, { assistantText, parsed, payload });
          if (flow === 'continue') continue;
          if (flow === 'break') break;
          if (flow === 'return') return;
        }

        if (parsed.type === 'propose_delete') {
          const flow = await handleDeleteFile(ctx, { assistantText, parsed, payload });
          if (flow === 'continue') continue;
          if (flow === 'break') break;
          if (flow === 'return') return;
        }

        if (parsed.type === 'propose_command') {
          const flow = await handleRunCommand(ctx, { assistantText, parsed, payload });
          if (flow === 'continue') continue;
          if (flow === 'break') break;
          if (flow === 'return') return;
        }

        if (parsed.type === 'ask_question') {
          const flow = await handleAskUser(ctx, { assistantText, parsed, payload });
          if (flow === 'continue') continue;
          if (flow === 'break') break;
          if (flow === 'return') return;
        }
      } catch (err: any) {
        if (this.pendingInterruptDirective) {
          // User interrupted the current step/stream with an active steering directive
          const directive = this.pendingInterruptDirective;
          this.pendingInterruptDirective = null;
          callbacks.onStreamChunk?.('', '');
          addSteeringDirective(directive);
          callbacks.onStatusChange('thinking');
          continue;
        }

        if (err?.name === 'AbortError' || this.abortController?.signal.aborted || !this.isRunning) {
          callbacks.onLog(et('stoppedByUser'));
          releaseSubtasks(ledger);
          callbacks.onStatusChange('idle');
          break;
        }

        const rawMessage = String(err?.message || err || 'Bilinmeyen hata');
        const cloudText = cloudErrorText(err, model, getTranslations(useSettingsStore.getState().settings.language).cloud);
        let friendly = rawMessage;
        if (cloudText) {
          friendly = cloudText;
        } else if (/Failed to fetch|NetworkError|ECONNREFUSED|fetch failed/i.test(rawMessage)) {
          friendly = et('ollamaUnreachable', { endpoint: ollamaClient.getEndpoint() });
        } else if (/not found|pull/i.test(rawMessage) && /model/i.test(rawMessage)) {
          friendly = et('modelMissing', { model, error: rawMessage });
        } else if (/memory|out of memory|runner.*(terminated|stopped)/i.test(rawMessage)) {
          friendly = et('modelOutOfMemory', { error: rawMessage });
        }
        callbacks.onStep({
          id: `step_err_${Date.now()}`,
          timestamp: Date.now(),
          type: 'system_notice',
          content: et('agentError', { error: friendly }),
          status: 'failed',
        });
        moveTo(['RETRYING', 'FAILED'], rawMessage);
        releaseSubtasks(ledger);
        callbacks.onStatusChange('error');
        break;
      }
    }

    if (!finished && this.isRunning && stepCount >= MAX_STEPS) {
      if (!(await tryGracefulCompletion(et('limitSteps', { count: MAX_STEPS })))) {
        releaseSubtasks(ledger);
        notice(et('limitSteps', { count: MAX_STEPS }), 'failed');
        callbacks.onStatusChange('idle');
      }
    }

    this.isRunning = false;
    this.stepAbortController = null;
    this.pendingInterruptDirective = null;
  }
}

export const agentEngine = new AgentEngine();
