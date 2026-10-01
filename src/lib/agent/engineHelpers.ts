/**
 * engineHelpers.ts
 * The parts of the coding agent that do not depend on a running task: the types of its options and
 * callbacks, request splitting, prompt helpers, edit application and the patterns it checks
 * requests and files with. AgentEngine.ts re-exports all of it.
 */
import { ollamaClient } from '../ollama/OllamaClient';
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
import { format, getTranslations } from '../localization/i18n';
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
import { DesignCategory, categoryLabel, getTheme } from '../design/themes';
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

export interface AgentEngineCallbacks {
  onStep: (step: AgentStep) => void;
  onStatusChange: (status: AgentStatus) => void;
  onLog: (msg: string) => void;
  onStreamChunk?: (chunk: string, fullResponseSoFar: string) => void;
  onRequestChangesetApproval: (items: ChangesetItem[]) => Promise<boolean>;
  onRequestDeleteApproval: (item: ChangesetItem) => Promise<boolean>;
  onRequestCommandApproval: (item: CommandApprovalItem) => Promise<boolean>;
  onRequestClarification: (item: ClarificationItem) => Promise<string>;
  onTransactionApplied?: (tx: AppliedTransaction) => void;
  onSubtasksUpdated?: (subtasks: TaskChecklistItem[]) => void;
}

export interface PreviousTask {
  request: string;
  /** Whether it ended as completed. */
  finished: boolean;
  changedFiles: string[];
}

export interface RunGoalOptions {
  /**
   * The previous task of the same session. The model always learns which files it changed; the
   * request itself only when the new one continues it ("devam", "bunları da düzelt").
   */
  previousTask?: PreviousTask;
  /** Short title shown instead of a long generated request (site wizard). */
  displayGoal?: string;
  /**
   * An explicit checklist (site wizard: one item per page). Given = used as is, the request is not
   * split; fewer than two items = one task.
   */
  checklist?: string[];
  /** The user's design theme choice for this run (site wizard). */
  design?: DesignOverride;
  /**
   * false = no automatic web page checks. Script requests mention HTML or "sayfa" (an HTML report,
   * a page number) without being a web page, and a web contract would demand an index.html.
   */
  contracts?: boolean;
  /**
   * Files the app writes before the model's first step when they do not exist yet (script wizard:
   * the tested starting code). They reach the model as current file contents, so it edits one
   * function instead of copying a long skeleton — a 7B model spent its whole first reply copying
   * 166 lines and left the function empty. Strict profile: the user approves them like any change.
   */
  seedFiles?: Array<{ path: string; content: string }>;
  /**
   * Files only the generated program may create (script wizard: its action log and backup
   * folders; "name*" = any path part starting with name). A 7B model told to check that the log
   * exists wrote the log by hand; writing these is refused and the model is sent back to the script.
   */
  scriptOutputs?: string[];
  /**
   * The flag that makes the generated script change files (script wizard: --uygula / --apply). The same
   * command with it is not run twice without a file change in between: a 7B model applied its rename
   * script to the sample folder five times, renaming the renamed files on every run.
   */
  applyFlag?: string;
}

export function findClosestPath(requestedPath: string, projectFiles: string[]): string | null {
  if (!projectFiles || projectFiles.length === 0) return null;
  const cleanReq = requestedPath.replace(/\\/g, '/').trim().toLowerCase();
  const baseReq = cleanReq.split('/').pop() || '';
  const nameWithoutExt = baseReq.replace(/\.[^/.]+$/, '');

  // 1. Exact relative path match (case-insensitive)
  for (const file of projectFiles) {
    const cleanFile = file.replace(/\\/g, '/').toLowerCase();
    if (cleanFile === cleanReq) return file;
  }

  // 2. Exact basename match (e.g. "App.tsx" matches "src/App.tsx")
  for (const file of projectFiles) {
    const cleanFile = file.replace(/\\/g, '/').toLowerCase();
    const baseFile = cleanFile.split('/').pop() || '';
    if (baseFile === baseReq) return file;
  }

  // 3. Basename without extension match (e.g. "App.js" matches "src/App.tsx")
  for (const file of projectFiles) {
    const cleanFile = file.replace(/\\/g, '/').toLowerCase();
    const baseFile = cleanFile.split('/').pop() || '';
    const fileWithoutExt = baseFile.replace(/\.[^/.]+$/, '');
    if (fileWithoutExt === nameWithoutExt) return file;
  }

  // 4. Substring match (e.g. "AgentEngine" matches "src/lib/agent/AgentEngine.ts")
  if (nameWithoutExt.length >= 3) {
    for (const file of projectFiles) {
      const cleanFile = file.replace(/\\/g, '/').toLowerCase();
      if (cleanFile.includes(nameWithoutExt)) {
        return file;
      }
    }
  }

  return null;
}

/** A clause that asks for something (Turkish or English verb, or a requirement such as "olsun"). */
export const ACTION_WORD = new RegExp(
  '(?:^|[\\s,(\'"])(?:' +
    'ekle|yaz|oluştur|güncelle|düzelt|sil|kaldır|çalıştır|yap|derle|kur|gönder|taşı|değiştir|ayarla|tasarla|hazırla|' +
    'üret|incele|kontrol\\s+et|test\\s+et|bağla|çevir|dönüştür|göster|gizle|getir|kullan|uygula|koy|ayır|birleştir|' +
    'sırala|listele|hesapla|doğrula|yönlendir|olsun|olmalı|olacak|olmasın|commit|push|' +
    'add|create|make|build|fix|write|update|change|remove|delete|implement|get|set|move|link|style|test|run|' +
    'ensure|use|show|hide|replace|rename|refactor|convert|display|include|should|must|need' +
    ')',
  'i'
);
/** A clause that only makes sense together with the previous one ("Get these working"). */
export const REFERS_BACK = /^(?:ve\s+|and\s+)?(?:these|those|them|it|this|that|bunlar|bunları|bunu|bunun|onlar|onları|onu|şunları|şunu|hepsi|hepsini|tümünü)\b/i;

/**
 * A request that continues the previous task of the session ("devam", "kaldığın yerden", "finish
 * it", "bunları da düzelt"). Only then does the model see what that task was; otherwise a 7B model
 * took the previous request for its own and resumed it (in-app report and E2E replay).
 */
export const CONTINUES_PREVIOUS =
  /^(?:devam|devam\s+et|kald[ıi]ğ[ıi]n\s+yerden|tamamla|bitir|aynen|evet|olur|continue|go\s+on|keep\s+going|carry\s+on|finish(?:\s+it)?|proceed|yes|ok(?:ay)?)\b|(?<![\p{L}])(?:bunu|bunları|şunu|şunları|onu|onları|aynısını|aynı\s+şeyi|önceki|az\s+önceki|kalan(?:ı|ları)?|eksik\s+kalan|the\s+rest|same\s+(?:thing|way)|previous|that\s+one|these|those|it\s+again)(?![\p{L}])/iu;

export function continuesPreviousTask(goal: string): boolean {
  const text = goal.trim();
  return CONTINUES_PREVIOUS.test(text) || REFERS_BACK.test(text);
}

/**
 * Splits a request into a checklist only where the user clearly listed separate items: numbered
 * or bulleted lines, or clauses joined by sequencing words ("…, sonra …", "then"). Sentences,
 * commas, semicolons and line breaks alone never split a request — "Home About Services
 * Contact\n\nGet these working." is ONE task about those menu items. A split that would leave a
 * fragment without an action or a clause that points back ("these", "bunları") is not made.
 */
export function decomposeGoalIntoSubtasks(goal: string): TaskChecklistItem[] {
  const trimmed = goal.trim();
  if (!trimmed) return [];
  const single = (): TaskChecklistItem[] => [{ id: 'task_1', description: trimmed, status: 'in_progress' }];

  const clean = (text: string) => text.replace(/^[,;.:\s]+|[,;.\s]+$/g, '').trim();
  let items: string[] = [];
  let explicitList = false;

  const numbered = trimmed.split(/\n(?=\s*\d+[.)]\s+)/);
  const bulleted = trimmed.split(/\n(?=\s*[-*•]\s+)/);
  if (numbered.filter((p) => /^\s*\d+[.)]\s+/.test(p)).length >= 2) {
    // "Şunları yap:\n1. …\n2. …" — the lead-in line stays context, the numbered lines are the items
    items = numbered.filter((p) => /^\s*\d+[.)]\s+/.test(p)).map((p) => clean(p.replace(/^\s*\d+[.)]\s+/, '')));
    explicitList = true;
  } else if (bulleted.filter((p) => /^\s*[-*•]\s+/.test(p)).length >= 2) {
    items = bulleted.filter((p) => /^\s*[-*•]\s+/.test(p)).map((p) => clean(p.replace(/^\s*[-*•]\s+/, '')));
    explicitList = true;
  } else if (/^(?:[^\n]*:\s*)?1[.)]\s+\S/.test(trimmed) && /\s2[.)]\s+\S/.test(trimmed)) {
    // One-line list: "1) footer ekle 2) başlıkları mavi yap"
    items = trimmed
      .split(/\s(?=\d+[.)]\s+\S)/)
      .filter((p) => /^\d+[.)]\s+/.test(p))
      .map((p) => clean(p.replace(/^\d+[.)]\s+/, '')));
    explicitList = true;
  } else {
    // Only explicit sequencing words split running text; parentheses are never split.
    const masked = trimmed.replace(/\([^()]*\)/g, (m) => m.replace(/[,.]/g, (c) => (c === ',' ? '\u0001' : '\u0002')));
    // A comma or sentence end is required before "sonra": "5 saniye sonra kapansın" is one clause.
    const marked = masked
      .replace(/,\s*(?:ve\s+)?(?:daha\s+sonra|ardından|sonrasında|en\s+son(?:unda)?|son\s+olarak|sonra|and\s+then|then|after\s+that|finally)\s+/gi, '\u0000')
      .replace(/\s+(?:ve\s+(?:daha\s+sonra|sonra|en\s+son(?:unda)?|son\s+olarak)|and\s+then|and\s+finally)\s+/gi, '\u0000')
      .replace(/[.!]\s+(?=(?:daha\s+sonra|ardından|sonrasında|en\s+son(?:unda)?|son\s+olarak|sonra|then|after\s+that|afterwards|finally)[\s,])/gi, '\u0000');
    items = marked
      .split('\u0000')
      .map((s) =>
        clean(
          s
            .replace(/\u0001/g, ',')
            .replace(/\u0002/g, '.')
            .replace(/^(?:daha\s+sonra|ardından|sonrasında|en\s+son(?:unda)?|son\s+olarak|sonra|then|after\s+that|afterwards|finally),?\s+/i, '')
        )
      );
  }
  items = items.filter((s) => s.length >= 2);

  // A clause that points back belongs to the previous one.
  const merged: string[] = [];
  for (const item of items) {
    if (merged.length > 0 && REFERS_BACK.test(item)) merged[merged.length - 1] += `. ${item}`;
    else merged.push(item);
  }
  if (merged.length < 2) return single();
  // Split running text only when every part is an instruction of its own.
  if (!explicitList && !merged.every((item) => ACTION_WORD.test(item))) return single();

  return merged.map((description, idx) => ({
    id: `task_${idx + 1}`,
    description,
    status: idx === 0 ? 'in_progress' : 'pending',
  }));
}

/**
 * Small models (<= ~4.5B parameters) get the leanest prompt and tool set.
 * The size is read from the tag (":1.5b", ":2b", ":30b-a3b" ...); the old substring checks
 * flagged 12b / 32b / 72b models ("2b") and every "coder" model as small.
 */
export function isSmallLanguageModel(modelName: string): boolean {
  if (!modelName) return false;
  const size = parameterSizeFromName(modelName);
  if (size !== null) return size <= 4.5;
  return /tinyllama|smollm|phi3:mini|phi-3-mini|qwen2\.5:0\.5b/i.test(modelName);
}

export function toolsetFrom(
  gitAvailable: boolean,
  securityProfile: SecurityProfile,
  webAccessOrCapabilities: boolean | AgentCapabilities,
  checklist = false
): AgentToolset {
  const web =
    typeof webAccessOrCapabilities === 'object'
      ? !!(webAccessOrCapabilities.webSearch || webAccessOrCapabilities.webFetch)
      : !!webAccessOrCapabilities;
  const git =
    typeof webAccessOrCapabilities === 'object' && webAccessOrCapabilities.git !== undefined
      ? !!webAccessOrCapabilities.git
      : gitAvailable;
  return { web, git, ask: securityProfile !== 'autonomous', commands: true, checklist };
}

/** Compact variant for small models (fewer tools, same rules). */
export function buildCompactSystemPrompt(
  gitAvailable: boolean,
  securityProfile: SecurityProfile = 'strict',
  webAccessOrCapabilities: boolean | AgentCapabilities = false,
  webSynthesisStrategy: WebSynthesisStrategy = 'auto',
  modificationStrategy: ModificationStrategy = 'smart_injection'
): string {
  return buildAgentSystemPrompt({
    securityProfile,
    toolset: toolsetFrom(gitAvailable, securityProfile, webAccessOrCapabilities),
    webSynthesisStrategy,
    modificationStrategy,
    compact: true,
  });
}

export function buildSystemPrompt(
  gitAvailable: boolean,
  securityProfile: SecurityProfile = 'strict',
  webAccessOrCapabilities: boolean | AgentCapabilities = false,
  webSynthesisStrategy: WebSynthesisStrategy = 'auto',
  modificationStrategy: ModificationStrategy = 'smart_injection'
): string {
  return buildAgentSystemPrompt({
    securityProfile,
    toolset: toolsetFrom(gitAvailable, securityProfile, webAccessOrCapabilities),
    webSynthesisStrategy,
    modificationStrategy,
    compact: false,
  });
}

export interface LedgerExtras {
  step?: number;
  maxSteps?: number;
  acceptance?: { passed: number; total: number } | null;
}

/**
 * OTURUM HAFIZA DEFTERİ (session memory ledger).
 * A short state line appended to each tool result instead of a large block inside the system
 * prompt: the system prompt stays byte-identical between steps, so Ollama can reuse its KV cache.
 */
export function formatLedgerBlock(ledger: AgentMemoryLedger, extras: LedgerExtras = {}): string {
  const parts: string[] = [];
  if (extras.step) parts.push(`step ${extras.step}/${extras.maxSteps ?? '?'}`);

  const changed = Array.from(
    new Set(ledger.appliedChanges.map((c) => c.match(/"([^"]+)"/)?.[1]).filter(Boolean) as string[])
  );
  parts.push(changed.length > 0 ? `changed files: ${changed.slice(-8).join(', ')}` : 'no files changed yet');

  if (ledger.subtasks && ledger.subtasks.length > 1) {
    const done = ledger.subtasks.filter((t) => t.status === 'completed').length;
    const current = ledger.subtasks.find((t) => t.status !== 'completed');
    parts.push(
      `checklist ${done}/${ledger.subtasks.length} done${current ? ` (next: #${ledger.subtasks.indexOf(current) + 1})` : ''}`
    );
  }
  if (extras.acceptance && extras.acceptance.total > 0) {
    parts.push(`acceptance checks ${extras.acceptance.passed}/${extras.acceptance.total} passing`);
  }
  if (ledger.userDecisions.length > 0) {
    const last = ledger.userDecisions[ledger.userDecisions.length - 1];
    parts.push(`last user decision: "${last.answer.slice(0, 80)}"`);
  }
  if (ledger.unavailableBinaries.length > 0) {
    parts.push(`unavailable commands: ${ledger.unavailableBinaries.join(', ')}`);
  }
  if (ledger.invalidPaths.length > 0) {
    parts.push(`missing paths: ${ledger.invalidPaths.slice(-5).join(', ')}`);
  }
  return `[STATE] ${parts.join(' · ')}`;
}

export interface ConversationEntry extends OllamaChatMessage {
  meta?: {
    kind: 'task' | 'action' | 'observation' | 'steer';
    step?: number;
    /** Replacement text used when the entry is compacted to save context. */
    summary?: string;
    compacted?: boolean;
    raw?: any;
  };
}

/**
 * Shrinks old tool results / big file bodies once the prompt exceeds the context budget.
 * Only entries older than the last `maxRecentVerbatim` exchanges are touched, and compaction
 * happens in one batch, so the prompt prefix stays stable (KV-cache friendly) for many steps.
 */
export function compressConversationContext<T extends OllamaChatMessage>(
  messages: T[],
  maxRecentVerbatim: number = 4
): T[] {
  const protectFrom = Math.max(1, messages.length - maxRecentVerbatim * 2);
  return messages.map((msg, index) => {
    if (index === 0 || index >= protectFrom) return msg;
    const entry = msg as unknown as ConversationEntry;
    if (entry.meta?.compacted) return msg;
    if (typeof msg.content !== 'string' || msg.content.length <= 600) return msg;

    if (msg.role === 'assistant') {
      const compacted = entry.meta?.raw ? summarizeActionForHistory(entry.meta.raw) : msg.content.slice(0, 400);
      return { ...msg, content: compacted, meta: { ...(entry.meta || { kind: 'action' }), compacted: true } } as T;
    }
    const summary =
      entry.meta?.summary ||
      `${msg.content.slice(0, 240)}\n[... older result shortened to save context ...]`;
    return { ...msg, content: summary, meta: { ...(entry.meta || { kind: 'observation' }), compacted: true } } as T;
  });
}

/** Locates the region of `content` that most resembles `find` (used to explain failed edits). */
export function findBestMatchRegion(
  content: string,
  find: string
): { startLine: number; endLine: number; text: string } | null {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const findLines = find
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (findLines.length === 0 || lines.length === 0) return null;

  const window = Math.min(findLines.length, 30);
  const findSet = new Set(findLines);
  let bestIndex = -1;
  let bestScore = 0;
  for (let i = 0; i < lines.length; i++) {
    let score = 0;
    for (let j = 0; j < window && i + j < lines.length; j++) {
      const t = lines[i + j].trim();
      if (t && findSet.has(t)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  if (bestIndex === -1) {
    const probe = findLines[0].slice(0, 24);
    bestIndex = lines.findIndex((l) => probe.length >= 6 && l.includes(probe));
    if (bestIndex === -1) return null;
  }
  const start = Math.max(0, bestIndex - 2);
  const end = Math.min(lines.length, bestIndex + window + 2);
  return { startLine: start + 1, endLine: end, text: lines.slice(start, end).join('\n') };
}

export function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

/** Index-based splice: String.replace would interpret "$&", "$$", "$'" inside code. */
export function spliceReplace(haystack: string, needle: string, replacement: string): string {
  const idx = haystack.indexOf(needle);
  if (idx === -1) return haystack;
  return haystack.slice(0, idx) + replacement + haystack.slice(idx + needle.length);
}

export function applyChunkEdit(
  currentContent: string,
  originalChunk: string,
  newChunk: string
): { success: boolean; newContent: string; method: string; error?: string } {
  if (!currentContent) {
    return { success: true, newContent: newChunk, method: 'empty_current' };
  }
  if (!originalChunk) {
    return { success: false, newContent: currentContent, method: 'no_find', error: '"find" is empty' };
  }

  const hasCRLF = currentContent.includes('\r\n');
  const toFileEol = (text: string) => (hasCRLF ? text.replace(/\r?\n/g, '\r\n') : text);
  const normCurrent = currentContent.replace(/\r\n/g, '\n');
  const normOriginal = originalChunk.replace(/\r\n/g, '\n');
  const normNew = (newChunk ?? '').replace(/\r\n/g, '\n');

  // Tier 1-2: exact match (after line-ending normalization); must be unique
  const exactCount = countOccurrences(normCurrent, normOriginal);
  if (exactCount === 1) {
    return {
      success: true,
      newContent: toFileEol(spliceReplace(normCurrent, normOriginal, normNew)),
      method: hasCRLF ? 'crlf_normalized' : 'exact_verbatim',
    };
  }
  if (exactCount > 1) {
    return {
      success: false,
      newContent: currentContent,
      method: 'ambiguous',
      error: `the "find" text occurs ${exactCount} times; include more surrounding lines so it is unique`,
    };
  }

  // Tier 3: trimmed match (extra blank lines / spaces around the snippet)
  const trimmedOrig = normOriginal.trim();
  if (trimmedOrig && countOccurrences(normCurrent, trimmedOrig) === 1) {
    return {
      success: true,
      newContent: toFileEol(spliceReplace(normCurrent, trimmedOrig, normNew.trim())),
      method: 'trimmed_match',
    };
  }

  // Tier 4: line-by-line match ignoring indentation and blank lines
  const curLines = normCurrent.split('\n');
  const origLines = normOriginal
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (origLines.length > 0) {
    const matches: Array<{ start: number; end: number }> = [];
    for (let i = 0; i < curLines.length; i++) {
      if (curLines[i].trim() !== origLines[0]) continue;
      let j = i;
      let k = 0;
      while (j < curLines.length && k < origLines.length) {
        const t = curLines[j].trim();
        if (!t) {
          j++;
          continue;
        }
        if (t !== origLines[k]) break;
        j++;
        k++;
      }
      if (k === origLines.length) matches.push({ start: i, end: j });
    }
    if (matches.length === 1) {
      const { start, end } = matches[0];
      const baseIndent = curLines[start].match(/^\s*/)?.[0] || '';
      let newLines = normNew.split('\n');
      const firstNonEmpty = newLines.find((l) => l.trim().length > 0) || '';
      const newIndent = firstNonEmpty.match(/^\s*/)?.[0] || '';
      if (!newIndent && baseIndent) {
        newLines = newLines.map((l) => (l.trim() ? baseIndent + l : l));
      }
      const replaced = [...curLines.slice(0, start), ...newLines, ...curLines.slice(end)].join('\n');
      return { success: true, newContent: toFileEol(replaced), method: 'line_by_line_trimmed' };
    }
    if (matches.length > 1) {
      return {
        success: false,
        newContent: currentContent,
        method: 'ambiguous',
        error: `the "find" text matches ${matches.length} places; include more surrounding lines so it is unique`,
      };
    }
  }

  // Tier 5: the replacement is a complete HTML document -> full rewrite
  if (/<!doctype\s+html/i.test(normNew) && /<\/html>/i.test(normNew) && /<html[\s>]/i.test(normCurrent)) {
    return { success: true, newContent: toFileEol(normNew), method: 'full_document_replacement' };
  }

  // Tier 6: a complete <style> / <script> block that should be added to an HTML page
  if (/^\s*<style[\s>][\s\S]*<\/style>\s*$/i.test(normNew)) {
    const idx = normCurrent.toLowerCase().lastIndexOf('</head>');
    if (idx !== -1) {
      const replaced = normCurrent.slice(0, idx) + normNew.trim() + '\n' + normCurrent.slice(idx);
      return { success: true, newContent: toFileEol(replaced), method: 'smart_head_injection' };
    }
  }
  if (/^\s*<script[\s>][\s\S]*<\/script>\s*$/i.test(normNew)) {
    const idx = normCurrent.toLowerCase().lastIndexOf('</body>');
    if (idx !== -1) {
      const replaced = normCurrent.slice(0, idx) + normNew.trim() + '\n' + normCurrent.slice(idx);
      return { success: true, newContent: toFileEol(replaced), method: 'smart_body_injection' };
    }
  }

  return {
    success: false,
    newContent: currentContent,
    method: 'not_found',
    error: 'the "find" text was not found in the file',
  };
}

/** Removes "  53| " prefixes when a model copied them from a numbered excerpt (all lines must have one). */
export function stripLineNumberPrefixes(text: string): string {
  const lines = (text ?? '').split('\n');
  const nonEmpty = lines.filter((l) => l.trim());
  if (nonEmpty.length === 0 || !nonEmpty.every((l) => /^\s*\d+\s?\|\s?/.test(l))) return text;
  return lines.map((l) => l.replace(/^\s*\d+\s?\|\s?/, '')).join('\n');
}

/** Numbered view of a line range, for edit hints that point at line numbers. */
export function numberedLines(content: string, start = 1, end = Number.MAX_SAFE_INTEGER): string {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const from = Math.max(1, start);
  const to = Math.min(lines.length, end);
  const out: string[] = [];
  for (let n = from; n <= to; n++) out.push(`${String(n).padStart(4)}| ${lines[n - 1]}`);
  return out.join('\n');
}

/** replace_lines: replaces lines [startLine, endLine] (1-based, inclusive), keeping the file's line endings. */
export function applyLineRangeEdit(
  currentContent: string,
  startLine: number,
  endLine: number,
  newText: string
): { success: boolean; newContent: string; method: string; error?: string } {
  const hasCRLF = currentContent.includes('\r\n');
  const lines = currentContent.replace(/\r\n/g, '\n').split('\n');
  const realCount = currentContent.endsWith('\n') ? lines.length - 1 : lines.length;
  if (startLine < 1 || startLine > realCount + 1) {
    return {
      success: false,
      newContent: currentContent,
      method: 'line_range',
      error: `start_line ${startLine} is outside the file (it has ${realCount} lines)`,
    };
  }
  const end = Math.min(Math.max(endLine, startLine), realCount);
  const replacement = stripLineNumberPrefixes((newText ?? '').replace(/\r\n/g, '\n')).replace(/\n$/, '');
  const replacementLines = replacement === '' ? [] : replacement.split('\n');
  let text = [...lines.slice(0, startLine - 1), ...replacementLines, ...lines.slice(end)].join('\n');
  if (hasCRLF) text = text.replace(/\n/g, '\r\n');
  return { success: true, newContent: text, method: `lines ${startLine}-${end}` };
}

/**
 * The replace_lines block shifted so its first line has the indentation of the first line it replaces,
 * or null when it already has it or cannot be shifted as a whole. In the app, qwen2.5-coder:7b sent
 * "    def add_options(parser):" for a top-level function, then re-sent the same edit three times.
 */
export function alignReplacementIndent(content: string, startLine: number, endLine: number, replacement: string): string | null {
  const original = content.replace(/\r\n/g, '\n').split('\n').slice(startLine - 1, endLine).find((l) => l.trim());
  const lines = stripLineNumberPrefixes((replacement ?? '').replace(/\r\n/g, '\n')).split('\n');
  const first = lines.find((l) => l.trim());
  if (original === undefined || first === undefined) return null;
  const target = original.match(/^[ \t]*/)![0];
  const current = first.match(/^[ \t]*/)![0];
  if (current === target) return null;
  if (current.length > target.length) {
    const cut = current.length - target.length;
    if (!lines.every((l) => !l.trim() || /^[ \t]*$/.test(l.slice(0, cut)))) return null;
    return lines.map((l) => (l.trim() ? l.slice(cut) : l)).join('\n');
  }
  const add = target.startsWith(current) ? target.slice(current.length) : ' '.repeat(target.length - current.length);
  return lines.map((l) => (l.trim() ? add + l : l)).join('\n');
}

/** Lines around the part of the file that changed, so the model sees the result of its edit. */
export function changedRegionExcerpt(before: string, after: string, context = 3, maxLines = 40): string {
  const a = before.replace(/\r\n/g, '\n').split('\n');
  const b = after.replace(/\r\n/g, '\n').split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA--;
    endB--;
  }
  const from = Math.max(0, start - context);
  const to = Math.min(b.length - 1, Math.max(endB, start) + context);
  // Numbered like the other excerpts, so a follow-up replace_lines uses the current numbers.
  let lines = b.slice(from, to + 1).map((l, i) => `${String(from + 1 + i).padStart(4)}| ${l}`);
  if (lines.length > maxLines) {
    lines = [...lines.slice(0, maxLines - 1), `... (${lines.length - maxLines + 1} more lines)`];
  }
  return `lines ${from + 1}-${to + 1} now read:\n${lines.join('\n')}`;
}

/**
 * How many lines a change added when every one of them was already in the file (blank lines and
 * indentation ignored); 0 when it added anything new. A 7B model "fixed" a page 16 times by appending
 * the same empty <script> block: each append was a real change, but no progress.
 */
export function copiedLinesAdded(before: string, after: string): number {
  const lines = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const a = lines(before);
  const b = lines(after);
  if (b.length <= a.length) return 0;
  const known = new Set(a);
  return b.every((l) => known.has(l)) ? b.length - a.length : 0;
}

export function hashText(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function formatKb(chars: number): string {
  return chars >= 1024 ? `${(chars / 1024).toFixed(1)} KB` : `${chars} B`;
}

export function isSafePath(p: string): boolean {
  if (!p) return false;
  if (/^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\')) return false;
  return !p.split(/[\\/]/).includes('..');
}

/**
 * The request asks for a change. Besides the verbs, Turkish requests are often written as the
 * wanted result ("başlık ortalanacak", "menü altta dursun", "mavi olmalı"): a 7B model answered such
 * a request with finish at step 1 ("already centered") and nothing objected.
 */
export const GOAL_REQUIRES_CHANGES =
  /oluştur|yap|ekle|düzelt|değiştir|güncelle|yaz|kur|sil|kaldır|taşı|ortala|hizala|refactor|create|build|make|add|fix|change|update|write|implement|remove|delete|rename|generate|center|centre|align|move|replace|convert|\p{L}{2,}(?:[ae]c[ae]k|s[ıiuü]n|m[ae]l[ıi])(?!\p{L})/iu;
/** The user asked to remove something, so a rewrite that drops keys/definitions may be intended. */
export const REMOVAL_INTENT = /\bsil|kaldır|çıkar|temizle|sadeleştir|remove|delete|drop|strip|clean\s*up|get\s+rid/i;
/** The user asked for a rewrite / a much shorter file. */
export const REWRITE_INTENT = /baştan|sıfırdan|yeniden\s+yaz|tekrar\s+yaz|kısalt|küçült|minimal|rewrite|from\s+scratch|start\s+over|shorten|simplify/i;
/** Files that are legitimately empty; any other empty write_file is a failed generation. */
export const EMPTY_FILE_OK = /(?:^|[\\/])(?:__init__\.py|py\.typed|\.gitkeep|\.keep|\.nojekyll)$/i;
export const EMPTY_FILE_INTENT = /\bboş\b[^.\n]{0,30}\bdosya|\bempty\s+(?:\w+\s+)?file/i;

/** A write_file whose content is empty or whitespace (small models sometimes close the string at once). */
export function isEmptyWrite(parsed: ParsedAction): boolean {
  return (
    parsed.type === 'propose_create' &&
    typeof parsed.payload?.path === 'string' &&
    !String(parsed.payload?.content ?? '').trim() &&
    !EMPTY_FILE_OK.test(parsed.payload.path)
  );
}

export const TEST_FILE =
  /(?:^|[\\/])(?:tests?|__tests__|specs?)[\\/]|\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|[\\/])test_[^\\/]*\.py$|_test\.(?:py|go)$|Tests?\.(?:java|cs|kt)$/i;
export const TEST_CHANGE_INTENT =
  /test(?:lerini|leri|ler|ini|i)?\s+(?:düzelt|güncelle|ekle|yaz|değiştir|sil|kaldır)|(?:fix|update|add|write|change|remove|delete|adjust)\s+(?:the\s+|a\s+|new\s+|more\s+)?(?:unit\s+)?tests?\b|\btests?\s+for\b/i;

/**
 * Files whose content runs when a test or build command runs: code, and the settings that decide
 * what those commands execute (package.json scripts, pytest and cargo settings, build scripts).
 * Without an isolated environment, a test command after such a write would run what the model just
 * wrote, so it is not started without the user's approval.
 */
export const RUNS_WITH_COMMANDS =
  /\.(?:[cm]?[jt]sx?|py|pyw|rs|go|rb|php|java|kt|cs|sh|bat|cmd|ps1)$|(?:^|[\\/])(?:package\.json|conftest\.py|pytest\.ini|tox\.ini|setup\.cfg|setup\.py|pyproject\.toml|Cargo\.toml|build\.rs|Makefile)$/i;

export function runsWithCommands(path: string): boolean {
  return RUNS_WITH_COMMANDS.test(path);
}

/**
 * An existing test file the user did not ask to change. Tests define the expected behaviour: a
 * model that cannot fix the code must not "pass" by rewriting the assertions (seen in E2E).
 */
export function isProtectedTestFile(path: string, userRequest: string): boolean {
  return TEST_FILE.test(path) && !TEST_CHANGE_INTENT.test(userRequest);
}

export const STATUS_WORDS =
  /(?<!\p{L})(?:hazırlandı|oluşturuldu|tamamlandı|eklendi|güncellendi|yazıldı|kaydedildi|düzeltildi|değiştirildi|yapıldı|bitti|created|completed|done|added|updated|saved|written|finished|ready)(?:\s+successfully)?\s*[.!]*$/iu;

/**
 * A short completion report written as file content ("Alışveriş listesi hazırlandı.", "File
 * created."). gemma2:2b "informed the user" this way and overwrote the list it had just written.
 */
export function looksLikeStatusMessage(content: string, userRequest = ''): boolean {
  const text = content.trim();
  if (!text || text.length > 160 || text.split('\n').length > 2) return false;
  if (userRequest.toLocaleLowerCase('tr').includes(text.toLocaleLowerCase('tr').replace(/[.!\s]+$/, ''))) return false;
  return /\s/.test(text) && STATUS_WORDS.test(text);
}

/**
 * Output of a command-line program that printed its usage/help text ("usage: todo.py ...",
 * "Kullanım: python todo.py <komut>"). Tolerates a mis-decoded "ı" in "Kullanım".
 */
export function looksLikeUsageText(output: string): boolean {
  return /(?:^|[\s.:!>])(?:usage|kullan\S{1,2}m|kullanim)\s*:/im.test(output) || /the following arguments are required/i.test(output);
}

/**
 * The project file and line an error output points at: the innermost Python traceback frame
 * (`File "...", line 12`) or the first `path/file.js:12:5` style location that is a project file.
 */
export function findErrorLocation(output: string, projectFiles: string[]): { path: string; line: number } | null {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  const files = projectFiles.map((f) => ({ rel: f, key: norm(f) })).sort((a, b) => b.key.length - a.key.length);
  const resolve = (raw: string) => {
    const p = norm(raw.trim());
    return files.find((f) => p === f.key || p.endsWith(`/${f.key}`))?.rel ?? null;
  };
  const python = [...output.matchAll(/File "([^"\n]+)", line (\d+)/g)]
    .map((m) => ({ path: resolve(m[1]), line: Number(m[2]) }))
    .filter((l): l is { path: string; line: number } => !!l.path);
  if (python.length > 0) return python[python.length - 1];
  for (const m of output.matchAll(/((?:[A-Za-z]:)?[\w.\\/ -]*?[\w-]+\.(?:m?js|cjs|jsx?|tsx?|py|rs|go|java|cs|rb|php|kt|swift|c|cc|cpp|h)):(\d+)/g)) {
    const path = resolve(m[1]);
    if (path) return { path, line: Number(m[2]) };
  }
  return null;
}

export interface DoneInfo {
  doneReason?: string;
  evalCount: number;
  promptEvalCount: number;
  evalDurationNs: number;
  promptEvalDurationNs: number;
  /** Time Ollama spent loading the model for this call (0 when it was loaded already). */
  loadDurationNs: number;
}

export interface StreamOutcome {
  text: string;
  thinking: string;
  done: DoneInfo | null;
  repetition: boolean;
}

/** The operating system, for the command rules (the Windows command line needs extra care). */
export function hostPlatform(): NodeJS.Platform {
  if (typeof process !== 'undefined' && process.platform) return process.platform;
  return typeof navigator !== 'undefined' && /windows/i.test(navigator.userAgent) ? 'win32' : 'linux';
}
