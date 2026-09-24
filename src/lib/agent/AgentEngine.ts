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
import { useSettingsStore } from '@/stores/settingsStore';
import {
  getModelRuntimeInfo,
  resolveRequestProfile,
  buildAgentSamplingOptions,
  estimateTokens,
  parameterSizeFromName,
} from '../ollama/ModelRuntime';
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

export interface RunGoalOptions {
  /** Summary of the previous task in the same session, so follow-ups ("devam", "stil ekle") keep context. */
  previousContext?: string;
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
const ACTION_WORD = new RegExp(
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
const REFERS_BACK = /^(?:ve\s+|and\s+)?(?:these|those|them|it|this|that|bunlar|bunları|bunu|bunun|onlar|onları|onu|şunları|şunu|hepsi|hepsini|tümünü)\b/i;

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

function toolsetFrom(
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

function countOccurrences(haystack: string, needle: string): number {
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
function spliceReplace(haystack: string, needle: string, replacement: string): string {
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

/** Lines around the part of the file that changed, so the model sees the result of its edit. */
function changedRegionExcerpt(before: string, after: string, context = 3, maxLines = 40): string {
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

function hashText(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function formatKb(chars: number): string {
  return chars >= 1024 ? `${(chars / 1024).toFixed(1)} KB` : `${chars} B`;
}

function isSafePath(p: string): boolean {
  if (!p) return false;
  if (/^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\')) return false;
  return !p.split(/[\\/]/).includes('..');
}

const GOAL_REQUIRES_CHANGES = /oluştur|yap|ekle|düzelt|değiştir|güncelle|yaz|kur|sil|kaldır|taşı|refactor|create|build|make|add|fix|change|update|write|implement|remove|delete|rename|generate/i;
/** The user asked to remove something, so a rewrite that drops keys/definitions may be intended. */
const REMOVAL_INTENT = /\bsil|kaldır|çıkar|temizle|sadeleştir|remove|delete|drop|strip|clean\s*up|get\s+rid/i;
/** The user asked for a rewrite / a much shorter file. */
const REWRITE_INTENT = /baştan|sıfırdan|yeniden\s+yaz|tekrar\s+yaz|kısalt|küçült|minimal|rewrite|from\s+scratch|start\s+over|shorten|simplify/i;
/** Files that are legitimately empty; any other empty write_file is a failed generation. */
const EMPTY_FILE_OK = /(?:^|[\\/])(?:__init__\.py|py\.typed|\.gitkeep|\.keep|\.nojekyll)$/i;
const EMPTY_FILE_INTENT = /\bboş\b[^.\n]{0,30}\bdosya|\bempty\s+(?:\w+\s+)?file/i;

/** A write_file whose content is empty or whitespace (small models sometimes close the string at once). */
export function isEmptyWrite(parsed: ParsedAction): boolean {
  return (
    parsed.type === 'propose_create' &&
    typeof parsed.payload?.path === 'string' &&
    !String(parsed.payload?.content ?? '').trim() &&
    !EMPTY_FILE_OK.test(parsed.payload.path)
  );
}

const TEST_FILE =
  /(?:^|[\\/])(?:tests?|__tests__|specs?)[\\/]|\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|[\\/])test_[^\\/]*\.py$|_test\.(?:py|go)$|Tests?\.(?:java|cs|kt)$/i;
const TEST_CHANGE_INTENT =
  /test(?:lerini|leri|ler|ini|i)?\s+(?:düzelt|güncelle|ekle|yaz|değiştir|sil|kaldır)|(?:fix|update|add|write|change|remove|delete|adjust)\s+(?:the\s+|a\s+|new\s+|more\s+)?(?:unit\s+)?tests?\b|\btests?\s+for\b/i;

/**
 * An existing test file the user did not ask to change. Tests define the expected behaviour: a
 * model that cannot fix the code must not "pass" by rewriting the assertions (seen in E2E).
 */
export function isProtectedTestFile(path: string, userRequest: string): boolean {
  return TEST_FILE.test(path) && !TEST_CHANGE_INTENT.test(userRequest);
}

const STATUS_WORDS =
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

interface DoneInfo {
  doneReason?: string;
  evalCount: number;
  promptEvalCount: number;
  evalDurationNs: number;
  promptEvalDurationNs: number;
}

interface StreamOutcome {
  text: string;
  thinking: string;
  done: DoneInfo | null;
  repetition: boolean;
}

export class AgentEngine {
  private abortController: AbortController | null = null;
  private stepAbortController: AbortController | null = null;
  private isRunning: boolean = false;
  private pendingInterruptDirective: string | null = null;

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
      await ollamaClient.chatStream(
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
      callbacks.onLog(`[DURUM GEÇİŞİ]: ${from} ──► ${to} (${reason || 'Ajan döngüsü'})`);
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
    const requestProfile = resolveRequestProfile({ info: runtime, agentOpt, hardware: settingsState.hardware });
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

    stateMachine.transition('PLANNING', 'Hedef analiz ediliyor ve sözleşmeler derleniyor');
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
    let contracts: TaskContract[] = TaskCompiler.compile(goal, {
      projectFiles,
      singleFile: synthesisStrategy === 'single_file',
      menuTexts: menuLinks.map((l) => l.text).filter(Boolean),
    });
    const subtasks = decomposeGoalIntoSubtasks(goal);
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

    callbacks.onLog(
      `Model profili: ${model}${runtime.parameterSizeB ? ` (${runtime.parameterSizeB}B)` : ''} · bağlam ${requestProfile.numCtx} token · maks. çıktı ${requestProfile.numPredict} token (ayar: ${requestedMaxTokens}) · düşünme: ${think === undefined ? 'desteklenmiyor' : String(think)} · yapılandırılmış JSON çıktı`
    );

    if (subtasks.length > 1) {
      callbacks.onStep({
        id: `step_tasks_init_${Date.now()}`,
        timestamp: Date.now(),
        type: 'system_notice',
        content: `📋 İstekteki liste kontrol listesine alındı (${subtasks.length} madde):\n${subtasks
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

    const runAcceptanceChecks = async (): Promise<{ report: ValidationReport | null; missing: string[] }> => {
      if (contracts.length === 0) {
        lastAcceptance = null;
        return { report: null, missing: [] };
      }
      const missing: string[] = [];
      let passed = 0;
      let total = 0;
      let lastReport: ValidationReport | null = null;
      for (const contract of contracts) {
        const report = await TaskValidator.validate(contract, fileProvider);
        lastReport = report;
        total += report.criterionResults.length;
        passed += report.criterionResults.filter((r) => r.passed).length;
        missing.push(...report.missingEvidence);
      }
      lastAcceptance = { passed, total };
      lastMissing = missing;
      return { report: lastReport, missing };
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

    /** Restates a file's unresolved check failures where the model looks last (end of the context). */
    const openProblemsFor = (filePath: string) => {
      const issues = (openSanityIssues.get(filePath) || []).filter((i) => i.severity === 'error');
      if (issues.length === 0) return '';
      return `\nStill wrong in "${filePath}" — fix exactly this and change only the line(s) that are wrong (replace_lines with the line numbers below, or edit_file):\n${formatSanityIssues(issues)}${problemExcerpt(filePath)}\n`;
    };

    /** Firmer wording once the model starts repeating itself (small models need the explicit way out). */
    const repeatNudge = () =>
      repeatStreak >= 1
        ? ` Do NOT repeat this action again (repeat #${repeatStreak}). If the task is complete, reply with finish now; otherwise do a different, necessary step.`
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
    const afterMutation = async (filePath: string, finalContent: string): Promise<string> => {
      mutationCount++;
      editFailures.delete(filePath);
      ledger.currentPhase = 'modification';
      ledger.knownFiles[filePath] = { size: finalContent.length, lastAction: 'yazıldı' };
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
      if (stuck) stepsWithoutProgress++;
      else stepsWithoutProgress = 0;

      if (issues.length > 0) {
        parts.push(
          `Automatic check of ${filePath} found problems:\n${formatSanityIssues(issues)}${problemExcerpt(filePath)}\nFix them before finishing: change only the wrong line(s) with replace_lines (repeat the lines of the range that must stay), or rewrite the whole file with write_file.`
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
          `Otomatik denetim "${filePath}" dosyasında ${issues.length} sorun buldu:\n${issues.map((i) => `• ${i.message}`).join('\n')}`,
          issues.some((i) => i.severity === 'error') ? 'failed' : 'rejected',
          'Dosya Denetimi'
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
          content: `${detail} (${securityProfile === 'autonomous' ? 'Otonom' : 'Dengeli'} Profil)`,
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

    // ---------------------------------------------------------------------
    // Initial task message (static for the whole run)
    // ---------------------------------------------------------------------
    const taskParts: string[] = [`TASK:\n${goal}`];
    if (/[çğıöşüÇĞİÖŞÜ]|\b(?:ve|bir|için|ile|olsun|yap|oluştur|ekle|düzelt|sayfa|dosya)\b/i.test(goal)) {
      taskParts.push('LANGUAGE: the user writes in Turkish. Write "thought" and "summary" in Turkish; page text follows the request.');
    }
    if (runOptions.previousContext && runOptions.previousContext.trim()) {
      taskParts.push(
        `CONTEXT FROM THE PREVIOUS TASK IN THIS SESSION (for reference only — the new TASK above may refer to it; do exactly what the new TASK asks and do not resume unrelated work from before):\n${runOptions.previousContext.trim().slice(0, 2000)}`
      );
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
    if (projectFiles.length > 0 && projectFiles.length <= 6) {
      const charBudget = Math.min(12000, Math.floor(requestProfile.numCtx * 0.25 * charsPerToken));
      let used = 0;
      const blocks: string[] = [];
      for (const rel of projectFiles) {
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

    stateMachine.transition('EXECUTING', 'Ajan yürütme adımlarına başlandı');
    callbacks.onStatusChange('thinking');

    const addSteeringDirective = (directive: string) => {
      consecutiveErrors = 0;
      repeatStreak = 0;
      stepsWithoutProgress = 0;
      finishPushbacks = 0;
      callbacks.onLog(`[Kullanıcı Müdahalesi]: ${directive}`);
      callbacks.onStep({
        id: `step_steer_${Date.now()}`,
        timestamp: Date.now(),
        type: 'user_steering',
        title: 'Kullanıcı Müdahalesi (Araya Girildi)',
        content: directive,
        status: 'success',
      });
      ledger.userDecisions.push({ question: 'Kullanıcı Canlı Müdahalesi', answer: directive });
      contracts = TaskCompiler.mergeDirective(contracts, directive, {
        projectFiles: ledger.projectTree,
        singleFile: synthesisStrategy === 'single_file',
        menuTexts: menuLinks.map((l) => l.text).filter(Boolean),
      });
      ledger.subtasks.push({
        id: `task_steer_${Date.now()}`,
        description: `Kullanıcı talimatı: ${directive}`,
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
        moveTo(['VALIDATING', 'COMPLETED', 'DONE'], 'Görev tamamlandı');
        for (const t of ledger.subtasks) {
          t.status = 'completed';
          if (!t.completedAt) t.completedAt = Date.now();
        }
        callbacks.onSubtasksUpdated?.(ledger.subtasks);
      } else {
        moveTo(['RETRYING', 'FAILED'], 'Görev doğrulanamadı');
        releaseSubtasks(ledger);
      }
      const changed = Array.from(new Set(ledger.appliedChanges.map((c) => c.match(/"([^"]+)"/)?.[1]).filter(Boolean)));
      let content = summary.trim();
      if (changed.length > 0) content += `\n\nDeğiştirilen dosyalar: ${changed.join(', ')}`;
      if (warnings.length > 0) content += `\n\n⚠️ Doğrulanamayan maddeler:\n${warnings.map((w) => `• ${w}`).join('\n')}`;
      if (note) content += `\n\nℹ️ ${note}`;
      callbacks.onStep({
        id: `step_fin_${Date.now()}`,
        timestamp: Date.now(),
        type: 'final_answer',
        title: status === 'finished' ? 'Görev Tamamlandı' : 'Görev Eksik Tamamlandı',
        content,
        status: status === 'finished' ? 'success' : 'failed',
        rawOutput,
      });
      callbacks.onStatusChange(status);
    };

    /**
     * When the model gets stuck AFTER the work is verifiably done (acceptance checks pass and no
     * file problems are open), end the task as completed with a note instead of failing it.
     * Tasks without acceptance checks cannot be verified and keep the honest failure status.
     */
    const tryGracefulCompletion = async (why: string): Promise<boolean> => {
      if (mutationCount === 0 || contracts.length === 0) return false;
      if (Array.from(openSanityIssues.values()).some((list) => list.some((i) => i.severity === 'error'))) return false;
      const { missing } = await runAcceptanceChecks();
      if (missing.length > 0) return false;
      finalize(
        'Görev tamamlandı.',
        'finished',
        undefined,
        [],
        `${why} Tüm otomatik denetimler geçtiği için görev tamamlandı olarak işaretlendi; sonucu kontrol etmeniz önerilir.`
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
        notice(`Devre Kesici: Aktif çalışma süresi ${effectiveMinutes} dakikayı aştığı için durduruldu.`, 'failed');
        releaseSubtasks(ledger);
        callbacks.onStatusChange('idle');
        break;
      }

      // Circuit Breaker: Max Tool Calls Check
      if (toolCallCount >= MAX_TOOL_CALLS) {
        notice(`Devre Kesici: Maksimum araç çağrısı sınırına (${MAX_TOOL_CALLS}) ulaşıldı.`, 'failed');
        releaseSubtasks(ledger);
        callbacks.onStatusChange('idle');
        break;
      }

      if (repeatStreak >= MAX_REPEAT_STREAK) {
        if (await tryGracefulCompletion('Model son adımlarını tekrar etmeye başladı.')) break;
        stopWithError(
          `[DÖNGÜ TESPİT EDİLDİ]: Model aynı eylemleri art arda ${repeatStreak} kez tekrarladı ve ilerleme kaydetmedi. Zaman kaybını önlemek için görev durduruldu. İsteği daha net bir talimatla yeniden verebilir veya daha büyük bir model seçebilirsiniz.`,
          'BLOCKED'
        );
        break;
      }
      if (stepsWithoutProgress >= MAX_STEPS_WITHOUT_PROGRESS) {
        if (await tryGracefulCompletion('Model son adımlarda ilerleme kaydetmedi.')) break;
        stopWithError(
          `[İLERLEME YOK]: Son ${stepsWithoutProgress} adımda hiçbir dosya değişmedi ve yeni bilgi edinilmedi. Görev durduruldu.`,
          'BLOCKED'
        );
        break;
      }

      // Circuit Breaker: Consecutive Failures Check
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        if (securityProfile === 'autonomous') {
          if (autonomousRecoveries >= 2) {
            if (await tryGracefulCompletion('Model tamamlanmış işten sonra gereksiz ve hatalı adımlar denedi.')) break;
            stopWithError(`[GÖREV BAŞARISIZ]: Model art arda hatalı adımlar üretmeye devam etti (${autonomousRecoveries} kurtarma denemesi).`);
            break;
          }
          autonomousRecoveries++;
          consecutiveErrors = 0;
          callbacks.onLog('Art arda 3 hata oluştu; Otonom Mod gereği model yeni bir yaklaşıma yönlendiriliyor...');
          conversation.push({
            role: 'user',
            content: `[RECOVERY]: Several steps in a row failed. Re-read the task and the latest results, then choose a different approach (for example, rewrite the whole file with write_file instead of repeating a failing edit). If everything requested is done, call finish.\n\n${stateLine()}`,
            meta: { kind: 'steer', step: stepCount },
          });
        } else {
          callbacks.onLog('Art arda 3 hata oluştu; kullanıcıya danışılıyor...');
          pauseTimer();
          let userGuidance = '';
          try {
            userGuidance = await callbacks.onRequestClarification({
              id: `clar_err_${Date.now()}`,
              question: 'Art arda 3 işlemde hata ile karşılaşıldı. Ajan nasıl devam etsin?',
              options: ['Farklı bir yaklaşım dene', 'Görevi sonlandır'],
            });
          } finally {
            resumeTimer();
          }
          if (userGuidance === 'Görevi sonlandır') {
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
          callbacks.onLog(`Bağlam sıkıştırıldı: istem ≈${promptTokens} token (pencere ${numCtx}).`);
        }
        const numPredict = Math.max(512, Math.min(desiredPredict, numCtx - promptTokens - 256));

        callbacks.onLog(`Adım ${stepCount}/${MAX_STEPS}: Model yanıtı bekleniyor (istem ≈${promptTokens} token)...`);
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
            if (!aborted && formatSupported && /format|schema|grammar/i.test(msg)) {
              formatSupported = false;
              callbacks.onLog(`Sunucu JSON şema çıktısını desteklemiyor (${msg}); serbest metin ayrıştırmaya geçiliyor.`);
              continue;
            }
            if (!aborted && think !== undefined && /think/i.test(msg)) {
              think = undefined;
              callbacks.onLog(`Model düşünme parametresini desteklemiyor (${msg}); parametre kaldırıldı.`);
              continue;
            }
            throw streamErr;
          }
          if (outcome.repetition && attempt < 1) {
            attempt++;
            callbacks.onLog('Model aynı metni tekrar etmeye başladı; farklı örnekleme ayarlarıyla adım yeniden deneniyor...');
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
            callbacks.onLog('Model boş dosya içeriği üretti; adım farklı örnekleme ayarlarıyla yeniden deneniyor...');
            continue;
          }
          break;
        }

        if (!this.isRunning) break;

        const done = outcome.done as DoneInfo | null;
        if (done) {
          const secs = Math.round((Date.now() - stepStart) / 100) / 10;
          const tps = done.evalDurationNs > 0 ? Math.round((done.evalCount / (done.evalDurationNs / 1e9)) * 10) / 10 : 0;
          callbacks.onLog(`Adım ${stepCount}: ${done.evalCount} token üretildi (${tps} tok/sn), toplam ${secs} sn.`);
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
          notice('Model aynı metni tekrar ederek takıldı; yanıt iptal edildi.', 'rejected');
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
            callbacks.onLog(`Yanıt çıktı sınırında kesildi; sınır ${desiredPredict} tokene yükseltilip adım tekrarlanıyor.`);
            stepCount--;
            continue;
          }
          consecutiveErrors++;
          notice(`Model yanıtı ${done.evalCount} token sınırında kesildi; hiçbir şey uygulanmadı.`, 'rejected');
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
          notice(`Model geçerli bir araç çağrısı üretemedi (${parsed.error || 'bilinmeyen format'}).`, 'rejected');
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
          notice(`Eksik araç parametresi: ${validationError}`, 'rejected');
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
          notice('Engellendi: Git bu çalışma alanında kullanılamıyor.', 'failed');
          pushExchange(assistantText, parsed.rawJson, `[BLOCKED]: git is not available in this folder. Continue with the file tools.`);
          continue;
        }
        if ((parsed.type === 'web_search' || parsed.type === 'fetch_url') &&
            !ToolDispatcher.isWebAccessAllowed('coding', useSettingsStore.getState().settings.webAccess)) {
          consecutiveErrors++;
          notice(`Web Erişimi Engellendi: Web erişimi kapalı olduğu için '${parsed.type}' çağrısı reddedildi.`, 'rejected');
          callbacks.onLog(`[WEB REDDEDİLDİ]: Web erişimi kapalı - ${describeAction(parsed.type, payload)} engellendi.`);
          pushExchange(assistantText, parsed.rawJson, `[BLOCKED]: web access is turned off by the user. Complete the task with the local project files.`);
          continue;
        }
        if (parsed.type === 'propose_command' && ledger.unavailableBinaries.includes(payload.binary)) {
          consecutiveErrors++;
          notice(`Engellendi: '${payload.binary}' komutu kullanılamaz.`, 'failed');
          pushExchange(assistantText, parsed.rawJson, `[BLOCKED]: "${payload.binary}" is not available here. Do not call it again.`);
          continue;
        }
        if (['propose_create', 'propose_edit', 'propose_delete', 'read_file'].includes(parsed.type) && !isSafePath(payload.path)) {
          consecutiveErrors++;
          notice(`Engellendi: "${payload.path}" çalışma alanı dışında veya geçersiz bir yol.`, 'failed');
          pushExchange(assistantText, parsed.rawJson, `[BLOCKED]: "${payload.path}" is not a valid path inside the project. Use a relative path such as "src/app.js".`);
          continue;
        }

        // =========================================================
        // finish
        // =========================================================
        if (parsed.type === 'finish') {
          const { missing } = await runAcceptanceChecks();
          const sanityProblems = Array.from(openSanityIssues.entries()).flatMap(([file, issues]) =>
            issues.filter((i) => i.severity === 'error').map((i) => `${file}: ${i.message}`)
          );
          const problems = [...missing, ...sanityProblems];

          if (problems.length > 0 && finishPushbacks < 2) {
            finishPushbacks++;
            consecutiveErrors = 0;
            moveTo(['VALIDATING', 'RETRYING', 'EXECUTING'], 'Eksik kriterler mevcut');
            notice(`Bitiş Reddedildi: ${problems.length} doğrulama sorunu var.\n${problems.map((p) => `• ${p}`).join('\n')}`, 'rejected');
            pushExchange(
              assistantText,
              parsed.rawJson,
              `[CANNOT FINISH YET]: automatic verification found problems:\n${problems.map((p) => `- ${p}`).join('\n')}\nFix them with the file tools, then call finish again.`
            );
            continue;
          }

          const looksLikeChangeTask = GOAL_REQUIRES_CHANGES.test(goal) || (runOptions.previousContext ? GOAL_REQUIRES_CHANGES.test(runOptions.previousContext) : false);
          if (mutationCount === 0 && finishPushbacks === 0 && looksLikeChangeTask && stepCount <= 3) {
            finishPushbacks++;
            notice('Erken Bitirme Engellendi: henüz hiçbir dosya değiştirilmedi.', 'rejected');
            pushExchange(
              assistantText,
              parsed.rawJson,
              `[CHECK]: You have not changed any file yet, but the task asks for changes. Do the work first. If the task really needs no change (for example it was only a question), call finish again and put the answer in "summary".`
            );
            continue;
          }

          if (problems.length > 0) {
            finalize(payload.summary, 'error', fullResponse, problems);
          } else {
            finalize(payload.summary, 'finished', fullResponse);
          }
          break;
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
            notice(`Döngü Engellendi: ${describeAction(parsed.type, payload)} zaten adım ${seen.step}'de yapıldı.`, 'rejected');
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
          const dirPath = payload.path || '';
          callbacks.onStep({
            id: `step_dir_${Date.now()}`,
            timestamp: Date.now(),
            type: 'tool_call',
            toolName: 'read_directory',
            toolArgs: { path: dirPath },
            content: `"${dirPath || 'kök'}" dizini listeleniyor...`,
          });
          const listRes = await window.electronAPI?.listWorkspaceFiles({ subPath: dirPath, maxDepth: 2 });
          let observation: string;
          if (listRes?.success && listRes.files) {
            consecutiveErrors = 0;
            repeatStreak = 0;
            const flat: string[] = [];
            const walk = (items: WorkspaceFileInfo[]) => {
              for (const f of items) {
                flat.push(f.isDirectory ? `${f.relativePath}/` : `${f.relativePath}${f.size !== undefined ? ` (${formatKb(f.size)})` : ''}`);
                if (!f.isDirectory && !ledger.projectTree.includes(f.relativePath)) ledger.projectTree.push(f.relativePath);
                if (f.children) walk(f.children);
              }
            };
            walk(listRes.files);
            observation = flat.length === 0
              ? `Folder "${dirPath || '.'}" is empty.`
              : `Contents of "${dirPath || '.'}" (${flat.length} entries):\n${flat.slice(0, 200).join('\n')}${flat.length > 200 ? '\n... (truncated)' : ''}`;
            callbacks.onStep({
              id: `step_dir_res_${Date.now()}`,
              timestamp: Date.now(),
              type: 'tool_result',
              toolName: 'read_directory',
              content: `${flat.length} öğe listelendi.`,
              status: 'success',
            });
          } else {
            consecutiveErrors++;
            stepsWithoutProgress++;
            if (dirPath && !ledger.invalidPaths.includes(dirPath)) ledger.invalidPaths.push(dirPath);
            observation = `[ERROR]: cannot list "${dirPath}": ${listRes?.error || 'folder not found'}. Use "" for the project root.`;
            callbacks.onStep({
              id: `step_dir_fail_${Date.now()}`,
              timestamp: Date.now(),
              type: 'tool_result',
              toolName: 'read_directory',
              content: `Dizin listelenemedi: ${listRes?.error || 'bulunamadı'}`,
              status: 'failed',
            });
          }
          const entry = pushExchange(assistantText, parsed.rawJson, observation, `[list_dir "${dirPath || '.'}" result shortened]`);
          if (readOnlySignature) seenActions.set(readOnlySignature, { step: stepCount, entry });
          continue;
        }

        if (parsed.type === 'read_file') {
          const filePath: string = payload.path;
          callbacks.onStep({
            id: `step_read_${Date.now()}`,
            timestamp: Date.now(),
            type: 'tool_call',
            toolName: 'read_file',
            toolArgs: { path: filePath },
            content: `"${filePath}" dosyası okunuyor...`,
          });
          const readRes = await window.electronAPI?.readWorkspaceFile(filePath);
          if (!(readRes?.success && readRes.content !== undefined)) {
            consecutiveErrors++;
            stepsWithoutProgress++;
            if (!ledger.invalidPaths.includes(filePath)) ledger.invalidPaths.push(filePath);
            const suggestion = findClosestPath(filePath, ledger.projectTree);
            const observation = `[ERROR]: "${filePath}" does not exist.${
              suggestion && suggestion !== filePath ? ` Did you mean "${suggestion}"?` : ''
            } If it is a new file, create it with write_file.`;
            callbacks.onStep({
              id: `step_read_fail_${Date.now()}`,
              timestamp: Date.now(),
              type: 'tool_result',
              toolName: 'read_file',
              content: `"${filePath}" bulunamadı.${suggestion ? ` Öneri: ${suggestion}` : ''}`,
              status: 'failed',
            });
            pushExchange(assistantText, parsed.rawJson, observation);
            continue;
          }

          const content = readRes.content;
          const totalLines = lineCount(content);
          const hasRange = payload.startLine !== undefined || payload.endLine !== undefined;
          const signature = `read:${filePath}:${readRes.hash || hashText(content)}:${payload.startLine ?? ''}-${payload.endLine ?? ''}`;
          const seen = seenActions.get(signature);
          if (seen && stillVisible(seen.entry)) {
            repeatStreak++;
            stepsWithoutProgress++;
            notice(
              seen.step === 0
                ? `Döngü Engellendi: "${filePath}" içeriği görev mesajında zaten mevcut ve değişmedi.`
                : `Döngü Engellendi: "${filePath}" adım ${seen.step}'de okundu ve o zamandan beri değişmedi.`,
              'rejected'
            );
            pushExchange(
              assistantText,
              parsed.rawJson,
              `[REPEATED]: ${
                seen.step === 0
                  ? `the content of "${filePath}" is already in the task message above and it has not changed.`
                  : `you already read "${filePath}" at step ${seen.step} and it has not changed; its content is above.`
              }${openProblemsFor(filePath)}${acceptanceNote()}${repeatNudge() || ' Continue with the next step (for example edit_file or write_file).'}`
            );
            continue;
          }

          consecutiveErrors = 0;
          repeatStreak = 0;
          stepsWithoutProgress = 0;
          // Files broken by literal escape sequences are shown decoded so the model can repair
          // them while keeping their content.
          const escaped = looksJsonEscaped(content);
          const source = escaped ? sanitizeFileContent(filePath, content).content : content;
          const sourceLines = lineCount(source);
          let shown = source;
          let header = `"${filePath}" (${sourceLines} lines, ${formatKb(content.length)})${
            escaped
              ? ' — WARNING: stored with literal \\n and \\" escape sequences (broken in the browser); shown decoded. Rewrite it with write_file using real line breaks and quotes, keeping its content'
              : ''
          }`;
          if (hasRange) {
            const start = Math.max(1, payload.startLine ?? 1);
            const end = Math.min(sourceLines, payload.endLine ?? start + 200);
            shown = lineRangeExcerpt(source, start, end);
            header = `"${filePath}" lines ${start}-${end} of ${sourceLines}`;
          }
          if (shown.length > MAX_READ_CHARS) {
            const cut = shown.slice(0, MAX_READ_CHARS);
            const shownLines = lineCount(cut);
            shown = cut;
            header += ` — only the first ${shownLines} lines are shown; call read_file with start_line/end_line for the rest`;
          }
          ledger.knownFiles[filePath] = { size: content.length, lastAction: 'okundu' };
          const observation = `${header}:\n${wrapUntrustedFileContent(filePath, shown)}`;
          callbacks.onStep({
            id: `step_read_res_${Date.now()}`,
            timestamp: Date.now(),
            type: 'tool_result',
            toolName: 'read_file',
            content: `Dosya okundu (${totalLines} satır, ${formatKb(content.length)}).`,
            status: 'success',
            metadata: { filePath, size: content.length, hash: readRes.hash },
          });
          const entry = pushExchange(
            assistantText,
            parsed.rawJson,
            observation,
            `[read_file "${filePath}": ${totalLines} lines — content removed from history to save space; read it again if you need it]`
          );
          seenActions.set(signature, { step: stepCount, entry });
          continue;
        }

        if (parsed.type === 'search_code') {
          const query: string = payload.query;
          callbacks.onStep({
            id: `step_srch_${Date.now()}`,
            timestamp: Date.now(),
            type: 'tool_call',
            toolName: 'search_code',
            toolArgs: { query },
            content: `"${query}" terimi aranıyor...`,
          });
          const searchRes = await window.electronAPI?.searchWorkspaceCode(query);
          let observation: string;
          if (searchRes?.success && searchRes.matches) {
            consecutiveErrors = 0;
            repeatStreak = 0;
            stepsWithoutProgress = 0;
            const lines = searchRes.matches
              .slice(0, 60)
              .map((m) => `${m.relativePath}:${m.lineNumber}: ${m.lineContent.trim().slice(0, 200)}`);
            observation = wrapUntrustedSearchResults(
              query,
              lines.length > 0
                ? `${lines.join('\n')}${searchRes.matches.length > 60 ? `\n... ${searchRes.matches.length - 60} more matches` : ''}`
                : 'No matches.'
            );
            callbacks.onStep({
              id: `step_srch_res_${Date.now()}`,
              timestamp: Date.now(),
              type: 'tool_result',
              toolName: 'search_code',
              content: `${searchRes.matches.length} eşleşme bulundu.`,
              status: 'success',
            });
          } else {
            consecutiveErrors++;
            stepsWithoutProgress++;
            observation = `[ERROR]: search failed: ${searchRes?.error || 'unknown error'}`;
          }
          const entry = pushExchange(assistantText, parsed.rawJson, observation, `[search_code "${query}" result shortened]`);
          if (readOnlySignature) seenActions.set(readOnlySignature, { step: stepCount, entry });
          continue;
        }

        if (parsed.type === 'read_git_status' || parsed.type === 'read_git_diff') {
          const gitAction = parsed.type === 'read_git_status' ? 'status' : 'diff';
          callbacks.onStep({
            id: `step_git_${Date.now()}`,
            timestamp: Date.now(),
            type: 'tool_call',
            toolName: parsed.type,
            content: `Git ${gitAction} inceleniyor...`,
          });
          const gitRes = await window.electronAPI?.readGit(gitAction);
          let observation: string;
          if (gitRes?.success) {
            consecutiveErrors = 0;
            repeatStreak = 0;
            observation = wrapUntrustedGitOutput(gitAction, (gitRes.output || '(clean working tree)').slice(0, 8000));
            callbacks.onStep({
              id: `step_git_res_${Date.now()}`,
              timestamp: Date.now(),
              type: 'tool_result',
              toolName: parsed.type,
              content: gitRes.output ? `Git ${gitAction} okundu.` : 'Temiz çalışma alanı.',
              status: 'success',
            });
          } else {
            consecutiveErrors++;
            if (!ledger.unavailableBinaries.includes('git')) ledger.unavailableBinaries.push('git');
            observation = `[ERROR]: git failed: ${gitRes?.error || 'unknown error'}. Do not call git tools again.`;
          }
          const entry = pushExchange(assistantText, parsed.rawJson, observation, `[git ${gitAction} result shortened]`);
          if (readOnlySignature) seenActions.set(readOnlySignature, { step: stepCount, entry });
          continue;
        }

        if (parsed.type === 'web_search') {
          const query: string = payload.query;
          callbacks.onStep({
            id: `step_search_${Date.now()}`,
            timestamp: Date.now(),
            type: 'tool_call',
            toolName: 'web_search',
            toolArgs: { query },
            content: `Web'de aranıyor: "${query}"...`,
          });
          callbacks.onLog(`WEB SEARCH\nQuery: ${query}`);
          let observation: string;
          try {
            const results = await WebAccessService.search(query, { limit: 5, signal: this.abortController?.signal });
            consecutiveErrors = 0;
            repeatStreak = 0;
            stepsWithoutProgress = 0;
            const formatted = results.length === 0
              ? 'No results.'
              : results.map((r) => `[${r.id}] ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet}\nSource: ${r.source}`).join('\n\n');
            observation = `${wrapUntrustedWebResult('search', query, formatted)}\nUse fetch_url to read a page, or continue with the task.`;
            callbacks.onStep({
              id: `step_search_res_${Date.now()}`,
              timestamp: Date.now(),
              type: 'tool_result',
              toolName: 'web_search',
              content: `Web araması tamamlandı (${results.length} sonuç).`,
              status: 'success',
              metadata: { query, resultsCount: results.length },
            });
          } catch (err: any) {
            consecutiveErrors++;
            observation = `[ERROR]: web search failed: ${err?.message || 'unknown error'}`;
            callbacks.onLog(`[WEB HATA]: ${err?.message}`);
            callbacks.onStep({
              id: `step_search_fail_${Date.now()}`,
              timestamp: Date.now(),
              type: 'tool_result',
              toolName: 'web_search',
              content: `Web araması başarısız: ${err?.message || 'bilinmeyen hata'}`,
              status: 'failed',
            });
          }
          const entry = pushExchange(assistantText, parsed.rawJson, observation, `[web_search "${query}" result shortened]`);
          if (readOnlySignature) seenActions.set(readOnlySignature, { step: stepCount, entry });
          continue;
        }

        if (parsed.type === 'fetch_url') {
          const targetUrl: string = payload.url;
          callbacks.onStep({
            id: `step_fetch_${Date.now()}`,
            timestamp: Date.now(),
            type: 'tool_call',
            toolName: 'fetch_url',
            toolArgs: { url: targetUrl },
            content: `Web sayfası indiriliyor: "${targetUrl}"...`,
          });
          callbacks.onLog(`WEB FETCH\nURL: ${targetUrl}`);
          let observation: string;
          try {
            const fetchResult = await WebAccessService.fetchUrl(targetUrl, {
              maxBytes: 256 * 1024,
              signal: this.abortController?.signal,
            });
            consecutiveErrors = 0;
            repeatStreak = 0;
            stepsWithoutProgress = 0;
            const sizeKb = Math.round(fetchResult.sizeBytes / 1024);
            observation = wrapUntrustedWebResult(
              'fetch',
              fetchResult.title,
              `URL: ${fetchResult.url}\nTitle: ${fetchResult.title}\n\n${fetchResult.content.slice(0, 10000)}`
            );
            callbacks.onStep({
              id: `step_fetch_res_${Date.now()}`,
              timestamp: Date.now(),
              type: 'tool_result',
              toolName: 'fetch_url',
              content: `Web sayfası okundu: "${fetchResult.title}" (${sizeKb} KB).`,
              status: 'success',
              metadata: { url: fetchResult.url, status: fetchResult.status, sizeKb },
            });
          } catch (err: any) {
            consecutiveErrors++;
            observation = `[ERROR]: could not fetch the page: ${err?.message || 'unknown error'}`;
            callbacks.onLog(`[WEB FETCH HATA]: ${err?.message}`);
            callbacks.onStep({
              id: `step_fetch_fail_${Date.now()}`,
              timestamp: Date.now(),
              type: 'tool_result',
              toolName: 'fetch_url',
              content: `Web sayfası okunamadı: ${err?.message || 'bilinmeyen hata'}`,
              status: 'failed',
            });
          }
          const entry = pushExchange(assistantText, parsed.rawJson, observation, `[fetch_url "${targetUrl}" result shortened]`);
          if (readOnlySignature) seenActions.set(readOnlySignature, { step: stepCount, entry });
          continue;
        }

        // =========================================================
        // Mutations (human-in-the-loop approval)
        // =========================================================
        if (parsed.type === 'propose_create') {
          const filePath: string = payload.path;
          const sanitized = sanitizeFileContent(filePath, payload.content);
          let content = sanitized.content;
          const readRes = await window.electronAPI?.readWorkspaceFile(filePath);
          const exists = !!(readRes?.success && readRes.content !== undefined);
          const currentContent = exists ? readRes!.content! : null;

          // Rejections share one path; resending content that was already rejected counts as a
          // repeat (a model re-sending the same invalid package.json six times burned the run).
          const rejectionSig = `${filePath}:${hashText(content)}`;
          const rejectWrite = (noticeText: string, observation: string) => {
            const previousStep = rejectedWrites.get(rejectionSig);
            rejectedWrites.set(rejectionSig, stepCount);
            stepsWithoutProgress++;
            let text = observation;
            if (previousStep !== undefined) {
              repeatStreak++;
              text += ` You already sent exactly this content at step ${previousStep} and it was rejected for the same reason.${repeatNudge()}`;
            } else {
              consecutiveErrors++;
            }
            notice(noticeText, 'rejected', 'Dosya Denetimi');
            pushExchange(assistantText, parsed.rawJson, text);
          };

          if (exists && isProtectedTestFile(filePath, userRequestText())) {
            rejectWrite(
              `"${filePath}" yazılmadı: mevcut testler beklenen davranışı tanımlar, düzeltilmesi gereken koddur.`,
              `[NOT WRITTEN]: "${filePath}" is an existing test file. The tests define the expected behaviour — change the code so that they pass; do not rewrite the tests (only the user may ask for that).`
            );
            continue;
          }

          if (isEmptyWrite(parsed) && !EMPTY_FILE_INTENT.test(userRequestText())) {
            const pageHint = /\.html?$/i.test(filePath)
              ? ' — the whole page: <!DOCTYPE html>, <head> with <meta name="viewport"> and a <style> block with the CSS, <body> with the real content, and a <script> with the JavaScript it needs'
              : '';
            rejectWrite(
              `"${filePath}" yazılmadı: dosya içeriği boş gönderildi.`,
              `[NOT WRITTEN]: "content" was empty. write_file must contain the COMPLETE text of "${filePath}"${pageHint}. Send write_file again with the full content.${acceptanceNote()}`
            );
            continue;
          }

          if (
            currentContent !== null &&
            currentContent.trim() !== '' &&
            currentContent.trim() !== content.trim() &&
            looksLikeStatusMessage(content, userRequestText())
          ) {
            const message = content.trim().slice(0, 120);
            rejectWrite(
              `"${filePath}" yazılmadı: dosya içeriği yerine bir durum mesajı yazılıyordu ("${message}").`,
              `[NOT WRITTEN]: "${message}" is a status message for the user, not content of "${filePath}"; the file keeps its current content. If the task is done, reply with finish and put this message in "summary".`
            );
            continue;
          }

          const lazy = detectLazyPlaceholder(content, currentContent);
          if (lazy) {
            rejectWrite(
              `"${filePath}" yazılmadı: içerik gerçek kod yerine yer tutucu içeriyor ("${lazy}").`,
              `[NOT WRITTEN]: the content contains the placeholder "${lazy}" instead of real code. Send the COMPLETE file content in write_file.`
            );
            continue;
          }

          const formatError = strictFormatError(filePath, content);
          if (formatError && (currentContent === null || strictFormatError(filePath, currentContent) === null)) {
            rejectWrite(
              `"${filePath}" yazılmadı: içerik geçerli JSON değil (${formatError}).`,
              `[NOT WRITTEN]: the new content of "${filePath}" is not valid JSON — ${formatError}. The file was left unchanged. Fix that line and send the complete, valid JSON document.`
            );
            continue;
          }

          // Config rewrites that forget existing keys ("scripts.test", "name") are merged additively,
          // so even small models can "add a script" without destroying package.json.
          if (exists && currentContent !== null && !REMOVAL_INTENT.test(userRequestText())) {
            const merged = mergeJsonPreservingKeys(filePath, currentContent, content);
            if (merged) {
              content = merged.content;
              sanitized.notes.push(`kept existing keys the rewrite had dropped (${merged.kept.slice(0, 10).join(', ')})`);
            }
          }

          if (exists && currentContent !== null && !REMOVAL_INTENT.test(userRequestText()) && !REWRITE_INTENT.test(userRequestText())) {
            const destructive = detectDestructiveRewrite(filePath, currentContent, content);
            if (destructive) {
              rejectWrite(
                `"${filePath}" yazılmadı: yeniden yazım dosyanın çoğunu silecekti (${destructive}).`,
                `[NOT WRITTEN]: write_file replaces the WHOLE file, and ${destructive}. To add or change a part, use edit_file: put an existing anchor line in "find" (for example "</body>" or the end of a function) and the anchor plus your new code in "replace". Otherwise send the complete updated file.`
              );
              continue;
            }
          }

          if (exists && currentContent !== null && !REMOVAL_INTENT.test(userRequestText())) {
            const dropped = jsonKeyLoss(filePath, originalSnapshots.get(filePath) ?? currentContent, content);
            if (dropped.length > 0) {
              rejectWrite(
                `"${filePath}" yazılmadı: mevcut anahtarları siliyordu (${dropped.join(', ')}).`,
                `[NOT WRITTEN]: this rewrite of "${filePath}" would delete existing keys: ${dropped.join(', ')}. Keep everything that is already there and only add or change what the task needs. Current content:\n${wrapUntrustedFileContent(filePath, currentContent.slice(0, 6000))}\nUse edit_file for a small change, or write_file with the complete merged document.`
              );
              continue;
            }
          }

          if (exists && currentContent !== null && currentContent !== content) {
            const damage = damageFromChange(filePath, currentContent, content);
            if (damage.length > 0) {
              rejectWrite(
                `"${filePath}" yazılmadı: yeni içerik dosyayı bozacaktı (${damage[0].message.slice(0, 160)}).`,
                `[NOT WRITTEN]: the new content would break "${filePath}", so the file is unchanged. The automatic check would report:\n${formatSanityIssues(damage)}${issueExcerpt(content, damage, 'Your version would read at')}\nSend the complete file again with these problems fixed.`
              );
              continue;
            }
          }

          if (exists && currentContent === content) {
            repeatStreak++;
            stepsWithoutProgress++;
            notice(`"${filePath}" zaten bu içeriğe sahip; değişiklik yok.`, 'rejected');
            pushExchange(
              assistantText,
              parsed.rawJson,
              `[NO CHANGE]: "${filePath}" already contains exactly this content.${acceptanceNote()}${repeatNudge() || ' Continue with the next part of the task or finish.'}`
            );
            continue;
          }

          const changesetItem: ChangesetItem = {
            id: `cs_create_${Date.now()}`,
            operation: exists ? 'edit' : 'create',
            relativePath: filePath,
            baseHash: exists ? readRes?.hash || '' : '',
            proposedContentHash: '',
            originalContent: currentContent || '',
            newContent: content,
            reason: String(parsed.rawJson?.thought || payload.reason || '').slice(0, 300),
            selected: true,
            status: 'pending',
          };
          const approved = await requestApproval(
            changesetItem,
            exists ? 'Dosya Yeniden Yazıldı (Otomatik Onay)' : 'Yeni Dosya Oluşturma (Otomatik Onay)',
            exists ? 'Dosya Yeniden Yazma Teklifi' : 'Yeni Dosya Oluşturma Teklifi',
            `"${filePath}" ${exists ? 'baştan yazılıyor' : 'oluşturuluyor'} (${lineCount(content)} satır).${
              sanitized.notes.length ? ` Otomatik düzeltme: ${sanitized.notes.join(', ')}.` : ''
            }`
          );
          if (!approved) {
            stepsWithoutProgress++;
            callbacks.onStep({
              id: `step_rej_${Date.now()}`,
              timestamp: Date.now(),
              type: 'tool_result',
              toolName: 'propose_create',
              content: 'Kullanıcı dosya yazımını reddetti.',
              status: 'rejected',
            });
            pushExchange(assistantText, parsed.rawJson, `[REJECTED BY USER]: the user did not approve writing "${filePath}". Choose a different approach or ask the user.`);
            continue;
          }

          const result = await applyMutation({ filePath, exists, baseHash: readRes?.hash || '', newContent: content });
          if (!result.ok) {
            consecutiveErrors++;
            callbacks.onStep({
              id: `step_apply_fail_${Date.now()}`,
              timestamp: Date.now(),
              type: 'tool_result',
              toolName: 'propose_create',
              content: `Dosya yazılamadı: ${result.error}`,
              status: 'failed',
            });
            pushExchange(assistantText, parsed.rawJson, `[ERROR]: could not write "${filePath}": ${result.error}`);
            continue;
          }

          consecutiveErrors = 0;
          repeatStreak = 0;
          ledger.appliedChanges.push(`${exists ? 'Yeniden yazıldı' : 'Yeni dosya'}: "${filePath}"`);
          ledger.milestones.push({
            id: `m_cr_${Date.now()}`,
            description: `${exists ? 'Dosya yeniden yazıldı' : 'Yeni dosya oluşturuldu'}: ${filePath}`,
            status: 'done',
            timestamp: Date.now(),
          });
          callbacks.onStep({
            id: `step_apply_${Date.now()}`,
            timestamp: Date.now(),
            type: 'tool_result',
            toolName: 'propose_create',
            content: `"${filePath}" ${exists ? 'yeniden yazıldı' : 'oluşturuldu'} (${lineCount(content)} satır, ${formatKb(content.length)}).`,
            status: 'success',
          });
          if (!originalSnapshots.has(filePath)) originalSnapshots.set(filePath, currentContent);
          // A full rewrite starts the file's edit history over.
          for (const sig of Array.from(appliedEdits.keys())) if (sig.startsWith(`${filePath}:`)) appliedEdits.delete(sig);
          const verdict = await afterMutation(filePath, content);
          const baseline = originalSnapshots.get(filePath);
          const lostKeys = baseline ? jsonKeyLoss(filePath, baseline, content) : [];
          const lostDefinitions = baseline ? definitionLoss(filePath, baseline, content) : [];
          const observation = [
            `[OK]: wrote "${filePath}" (${lineCount(content)} lines, ${formatKb(content.length)})${exists ? ', replacing the previous version' : ''}.`,
            sanitized.notes.length ? `Auto-fixed: ${sanitized.notes.join('; ')}.` : '',
            lostKeys.length
              ? `Warning: the rewrite removed these existing keys: ${lostKeys.join(', ')}. Restore them unless the task asked to remove them.`
              : '',
            lostDefinitions.length
              ? `Warning: the rewrite removed these existing definitions: ${lostDefinitions.slice(0, 12).join(', ')}. Restore them unless removing them was intended.`
              : '',
            verdict,
          ]
            .filter(Boolean)
            .join('\n');
          pushExchange(assistantText, parsed.rawJson, observation);
          continue;
        }

        if (parsed.type === 'propose_edit') {
          const filePath: string = payload.path;
          const readRes = await window.electronAPI?.readWorkspaceFile(filePath);
          if (!(readRes?.success && readRes.content !== undefined)) {
            consecutiveErrors++;
            stepsWithoutProgress++;
            notice(`"${filePath}" henüz mevcut değil; düzenleme yerine write_file kullanılmalı.`, 'rejected');
            pushExchange(assistantText, parsed.rawJson, `[ERROR]: "${filePath}" does not exist, so it cannot be edited. Create it with write_file and its complete content.`);
            continue;
          }
          const currentContent = readRes.content;
          if (isProtectedTestFile(filePath, userRequestText())) {
            consecutiveErrors++;
            stepsWithoutProgress++;
            notice(`"${filePath}" değiştirilmedi: mevcut testler beklenen davranışı tanımlar, düzeltilmesi gereken koddur.`, 'rejected', 'Test Koruması');
            pushExchange(
              assistantText,
              parsed.rawJson,
              `[NOT APPLIED]: "${filePath}" is an existing test file. The tests define the expected behaviour — change the code so that they pass; do not change the tests (only the user may ask for that). Read the failing assertion (expected vs actual) and fix the implementation.`
            );
            continue;
          }
          let replaceText: string = payload.new_chunk;
          const replaceSanitized = sanitizeFileContent(filePath, replaceText);
          if (replaceSanitized.notes.some((n) => n.includes('escape'))) replaceText = replaceSanitized.content;

          // Re-applying an identical edit is never progress: replace_lines changes the file again on
          // every call (gemma2:2b deleted a CSS line per step this way) and insertions duplicate.
          const editSig = `${filePath}:${
            payload.lineRange ? `L${payload.startLine}-${payload.endLine}` : hashText(String(payload.original_chunk ?? ''))
          }:${hashText(String(replaceText ?? ''))}`;
          const appliedAt = appliedEdits.get(editSig);
          if (appliedAt !== undefined) {
            repeatStreak++;
            stepsWithoutProgress++;
            notice(`Döngü Engellendi: "${filePath}" dosyasına aynı düzenleme ${appliedAt}. adımda zaten uygulanmıştı.`, 'rejected');
            const around = payload.lineRange
              ? `\nCurrent lines ${Math.max(1, payload.startLine - 3)}-${payload.endLine + 3} of "${filePath}":\n${numberedLines(currentContent, payload.startLine - 3, payload.endLine + 3)}`
              : '';
            pushExchange(
              assistantText,
              parsed.rawJson,
              `[REPEATED]: exactly this edit was already applied at step ${appliedAt}. Applying it again would change "${filePath}" again (line numbers shift after every edit), so nothing was changed.${around}${openProblemsFor(filePath)}${acceptanceNote()}${repeatNudge() || ' Do a different, necessary step or finish.'}`
            );
            continue;
          }

          const editResult = payload.lineRange
            ? applyLineRangeEdit(currentContent, payload.startLine, payload.endLine, replaceText)
            : applyChunkEdit(currentContent, stripLineNumberPrefixes(payload.original_chunk), stripLineNumberPrefixes(replaceText));
          if (!editResult.success) {
            consecutiveErrors++;
            stepsWithoutProgress++;
            const failures = (editFailures.get(filePath) || 0) + 1;
            editFailures.set(filePath, failures);
            // Numbered lines let the model switch to replace_lines instead of re-copying text.
            let hint = '';
            if (currentContent.length <= 6000) {
              hint = `Current content of "${filePath}" with line numbers:\n${wrapUntrustedFileContent(filePath, numberedLines(currentContent))}`;
            } else {
              const region = findBestMatchRegion(currentContent, payload.original_chunk || '');
              hint = region
                ? `The most similar text is at lines ${region.startLine}-${region.endLine}:\n${wrapUntrustedFileContent(filePath, numberedLines(currentContent, region.startLine, region.endLine))}`
                : 'Read the file again to copy the exact text.';
            }
            const rewriteAdvice = failures >= 2 ? '\nEdits keep failing: rewrite the whole file with write_file and its complete updated content.' : '';
            notice(`"${filePath}" düzenlemesi uygulanamadı: ${editResult.error}.`, 'rejected', 'Diff Eşleşmedi');
            const failureEntry = pushExchange(
              assistantText,
              parsed.rawJson,
              `[EDIT FAILED]: ${editResult.error}. Nothing was changed.\n${hint}\nEasiest fix: replace_lines with the line numbers above (start_line, end_line, content). Or copy "find" exactly (same characters and indentation, without the "NN| " prefixes).${rewriteAdvice}`,
              `[edit_file "${filePath}" failed; the file content shown then was removed from history — read it again if you need it]`
            );
            if (currentContent.length <= 6000) {
              // The full file is in this result, so an immediate read_file would only repeat it.
              seenActions.set(`read:${filePath}:${readRes.hash || hashText(currentContent)}:-`, { step: stepCount, entry: failureEntry });
            }
            continue;
          }

          let newFullContent = editResult.newContent;
          let editMergeNote = '';
          if (!REMOVAL_INTENT.test(userRequestText())) {
            const merged = mergeJsonPreservingKeys(filePath, currentContent, newFullContent);
            if (merged) {
              newFullContent = merged.content;
              editMergeNote = `Kept existing keys the edit had dropped: ${merged.kept.slice(0, 10).join(', ')}.`;
            }
          }
          const editFormatError = strictFormatError(filePath, newFullContent);
          if (editFormatError && strictFormatError(filePath, currentContent) === null) {
            consecutiveErrors++;
            stepsWithoutProgress++;
            notice(`"${filePath}" düzenlemesi uygulanmadı: sonuç geçerli JSON olmazdı (${editFormatError}).`, 'rejected', 'Dosya Denetimi');
            pushExchange(
              assistantText,
              parsed.rawJson,
              `[NOT APPLIED]: after this edit "${filePath}" would no longer be valid JSON (${editFormatError}). The file is unchanged. Check commas, quotes and brackets in "replace".`
            );
            continue;
          }
          if (!REMOVAL_INTENT.test(userRequestText())) {
            const dropped = jsonKeyLoss(filePath, originalSnapshots.get(filePath) ?? currentContent, newFullContent);
            if (dropped.length > 0) {
              consecutiveErrors++;
              stepsWithoutProgress++;
              notice(`"${filePath}" düzenlemesi uygulanmadı: mevcut anahtarları siliyordu (${dropped.join(', ')}).`, 'rejected', 'Dosya Denetimi');
              pushExchange(
                assistantText,
                parsed.rawJson,
                `[NOT APPLIED]: this edit would delete existing keys from "${filePath}": ${dropped.join(', ')}. Keep them; only add or change what the task needs.`
              );
              continue;
            }
          }
          if (newFullContent === currentContent) {
            repeatStreak++;
            stepsWithoutProgress++;
            notice(`"${filePath}" için önerilen düzenleme dosyayı değiştirmiyor (zaten uygulanmış).`, 'rejected');
            pushExchange(
              assistantText,
              parsed.rawJson,
              `[NO CHANGE]: this edit leaves "${filePath}" unchanged — it is already applied.${acceptanceNote()}${repeatNudge() || ' Continue with the next part of the task.'}`
            );
            continue;
          }
          const lazy = detectLazyPlaceholder(replaceText, payload.original_chunk);
          if (lazy) {
            consecutiveErrors++;
            stepsWithoutProgress++;
            notice(`"${filePath}" düzenlemesi reddedildi: yer tutucu içeriyor ("${lazy}").`, 'rejected');
            pushExchange(assistantText, parsed.rawJson, `[NOT APPLIED]: "replace" contains the placeholder "${lazy}" instead of real code. Write the actual code.`);
            continue;
          }

          // Do no harm: an edit that breaks a working file (or makes a broken one worse) is not
          // applied, so the model never has to patch its own breakage line by line.
          const damage = damageFromChange(filePath, currentContent, newFullContent);
          if (damage.length > 0) {
            consecutiveErrors++;
            stepsWithoutProgress++;
            notice(`"${filePath}" düzenlemesi uygulanmadı: dosyayı bozacaktı (${damage[0].message.slice(0, 160)}).`, 'rejected', 'Dosya Denetimi');
            const rangeHint = payload.lineRange
              ? 'replace_lines replaces EVERY line from start_line to end_line with "content": include each line of that range that must stay (to insert a line, repeat the original line in content) and keep the range as small as possible.'
              : '"replace" must keep every tag, bracket and quote of the text it replaces that is still needed.';
            pushExchange(
              assistantText,
              parsed.rawJson,
              `[NOT APPLIED]: this edit would break "${filePath}", so the file is unchanged. With your edit the automatic check would report:\n${formatSanityIssues(damage)}${issueExcerpt(newFullContent, damage, 'Your version would read at')}\n${rangeHint} Send a corrected edit.`
            );
            continue;
          }

          const changesetItem: ChangesetItem = {
            id: `cs_edit_${Date.now()}`,
            operation: 'edit',
            relativePath: filePath,
            baseHash: readRes.hash || '',
            proposedContentHash: '',
            originalContent: currentContent,
            newContent: newFullContent,
            reason: String(parsed.rawJson?.thought || payload.reason || 'Kod güncellendi').slice(0, 300),
            selected: true,
            status: 'pending',
          };
          const approved = await requestApproval(
            changesetItem,
            'Kod Değişikliği (Otomatik Onay)',
            'Kod Değişikliği Teklifi',
            `"${filePath}" dosyasında değişiklik (${editResult.method}).`
          );
          if (!approved) {
            stepsWithoutProgress++;
            callbacks.onStep({
              id: `step_edit_rej_${Date.now()}`,
              timestamp: Date.now(),
              type: 'tool_result',
              toolName: 'propose_edit',
              content: 'Kullanıcı bu kod değişikliğini reddetti.',
              status: 'rejected',
            });
            pushExchange(assistantText, parsed.rawJson, `[REJECTED BY USER]: the user did not approve this edit of "${filePath}". Choose a different approach.`);
            continue;
          }

          const result = await applyMutation({ filePath, exists: true, baseHash: readRes.hash || '', newContent: newFullContent });
          if (!result.ok) {
            consecutiveErrors++;
            callbacks.onStep({
              id: `step_edit_fail_${Date.now()}`,
              timestamp: Date.now(),
              type: 'tool_result',
              toolName: 'propose_edit',
              content: `Uygulama hatası: ${result.error}`,
              status: 'failed',
            });
            pushExchange(assistantText, parsed.rawJson, `[ERROR]: the edit could not be applied: ${result.error}. Read the file again before retrying.`);
            continue;
          }

          appliedEdits.set(editSig, stepCount);
          consecutiveErrors = 0;
          repeatStreak = 0;
          ledger.appliedChanges.push(`Düzenlendi: "${filePath}"`);
          ledger.milestones.push({
            id: `m_ed_${Date.now()}`,
            description: `Kod değişikliği uygulandı: ${filePath}`,
            status: 'done',
            timestamp: Date.now(),
          });
          callbacks.onStep({
            id: `step_edit_ok_${Date.now()}`,
            timestamp: Date.now(),
            type: 'tool_result',
            toolName: 'propose_edit',
            content: `"${filePath}" değişikliği uygulandı (${editResult.method}).`,
            status: 'success',
          });
          if (!originalSnapshots.has(filePath)) originalSnapshots.set(filePath, currentContent);
          const verdict = await afterMutation(filePath, newFullContent);
          const editLostKeys = jsonKeyLoss(filePath, originalSnapshots.get(filePath) || currentContent, newFullContent);
          const observation = [
            `[OK]: edited "${filePath}" (${editResult.method}); ${changedRegionExcerpt(currentContent, newFullContent)}`,
            editMergeNote,
            editLostKeys.length
              ? `Warning: the edit removed these existing keys: ${editLostKeys.join(', ')}. Restore them unless the task asked to remove them.`
              : '',
            verdict,
          ]
            .filter(Boolean)
            .join('\n');
          pushExchange(assistantText, parsed.rawJson, observation);
          continue;
        }

        if (parsed.type === 'propose_delete') {
          const filePath: string = payload.path;
          const readRes = await window.electronAPI?.readWorkspaceFile(filePath);
          if (!readRes?.success) {
            consecutiveErrors++;
            pushExchange(assistantText, parsed.rawJson, `[ERROR]: "${filePath}" does not exist.`);
            continue;
          }
          const authenticBaseHash = readRes.hash || '';
          const deleteItem: ChangesetItem = {
            id: `cs_del_${Date.now()}`,
            operation: 'delete',
            relativePath: filePath,
            baseHash: authenticBaseHash,
            proposedContentHash: '',
            originalContent: readRes.content || '',
            reason: String(parsed.rawJson?.thought || payload.reason || '').slice(0, 300),
            selected: true,
            status: 'pending',
          };
          callbacks.onStep({
            id: `step_del_warn_${Date.now()}`,
            timestamp: Date.now(),
            type: 'delete_warning',
            title: 'Yüksek Riskli Dosya Silme Uyarısı',
            content: `"${filePath}" dosyasının kalıcı olarak silinmesi isteniyor. Gerekçe: ${deleteItem.reason}`,
            status: 'pending',
          });

          // Deletes ALWAYS require user approval in all security profiles
          callbacks.onStatusChange('waiting_delete_approval');
          pauseTimer();
          let approved = false;
          try {
            approved = await callbacks.onRequestDeleteApproval(deleteItem);
          } finally {
            resumeTimer();
          }
          callbacks.onStatusChange('thinking');

          if (!approved) {
            callbacks.onStep({
              id: `step_del_rej_${Date.now()}`,
              timestamp: Date.now(),
              type: 'tool_result',
              toolName: 'propose_delete',
              content: 'Kullanıcı dosya silme talebini reddetti.',
              status: 'rejected',
            });
            pushExchange(assistantText, parsed.rawJson, `[REJECTED BY USER]: "${filePath}" was not deleted.`);
            continue;
          }
          const tokenRes = await window.electronAPI?.requestMutationToken({
            relativePath: filePath,
            operation: 'delete',
            expectedBaseHash: authenticBaseHash,
            proposedContentHash: '',
          });
          const applyRes = tokenRes?.success && tokenRes.token
            ? await window.electronAPI?.applyApprovedMutation({ token: tokenRes.token, relativePath: filePath, operation: 'delete' })
            : null;
          if (tokenRes?.token && applyRes?.success) {
            consecutiveErrors = 0;
            repeatStreak = 0;
            stepsWithoutProgress = 0;
            mutationCount++;
            treeVersion++;
            callbacks.onTransactionApplied?.({
              transactionId: tokenRes.token,
              relativePath: filePath,
              operation: 'delete',
              timestamp: Date.now(),
              approvedHash: '',
              baseHash: authenticBaseHash,
            });
            ledger.projectTree = ledger.projectTree.filter((p) => p !== filePath);
            ledger.appliedChanges.push(`Silindi: "${filePath}"`);
            delete ledger.knownFiles[filePath];
            openSanityIssues.delete(filePath);
            callbacks.onStep({
              id: `step_del_ok_${Date.now()}`,
              timestamp: Date.now(),
              type: 'tool_result',
              toolName: 'propose_delete',
              content: `"${filePath}" başarıyla silindi.`,
              status: 'success',
            });
            pushExchange(assistantText, parsed.rawJson, `[OK]: deleted "${filePath}".`);
          } else {
            consecutiveErrors++;
            pushExchange(assistantText, parsed.rawJson, `[ERROR]: could not delete "${filePath}": ${applyRes?.error || tokenRes?.error || 'unknown error'}`);
          }
          continue;
        }

        if (parsed.type === 'propose_command') {
          const binary: string = payload.binary;
          const args: string[] = payload.args || [];
          const cmdKey = `${binary}:${args.join(' ')}`;
          const previousFailure = seenActions.get(`cmdfail:${cmdKey}:${mutationCount}`);
          if (previousFailure) {
            repeatStreak++;
            stepsWithoutProgress++;
            notice(`Döngü Engellendi: '${binary} ${args.join(' ')}' daha önce hata verdi ve o zamandan beri kod değişmedi.`, 'rejected');
            pushExchange(
              assistantText,
              parsed.rawJson,
              `[REPEATED]: "${binary} ${args.join(' ')}" already failed at step ${previousFailure.step} and no file changed since. Fix the code first or take another approach.${repeatNudge()}`
            );
            continue;
          }
          // Running a CLI program without arguments always prints its usage text; models took that
          // for a bug and kept "fixing" working code until they broke it.
          const usageRun = seenActions.get(`usage:${cmdKey}`);
          if (usageRun) {
            repeatStreak++;
            stepsWithoutProgress++;
            notice(`Döngü Engellendi: '${binary} ${args.join(' ')}' argümansız çalıştırıldığında her zaman kullanım metnini yazdırır.`, 'rejected');
            pushExchange(
              assistantText,
              parsed.rawJson,
              `[ALREADY TESTED]: "${binary} ${args.join(' ')}" was run at step ${usageRun.step} and printed its usage text. That is the correct behaviour of a command-line program started without arguments, so running it again shows nothing new. Run it WITH arguments that match its usage line to test a feature, or finish if the task is complete.${repeatNudge()}`
            );
            continue;
          }

          const cmdItem: CommandApprovalItem = {
            id: `cmd_${Date.now()}`,
            binary,
            args,
            reason: String(parsed.rawJson?.thought || payload.reason || '').slice(0, 300),
          };
          const isSafeCommand =
            (binary === 'npm' && (args[0] === 'test' || (args[0] === 'run' && args[1] === 'test'))) ||
            binary === 'pytest' ||
            (binary === 'cargo' && args[0] === 'test') ||
            (binary === 'git' && (args[0] === 'status' || args[0] === 'diff'));
          const isAutoApprove = securityProfile === 'autonomous' && isSafeCommand;
          let approved = false;
          if (isAutoApprove) {
            approved = true;
            callbacks.onStep({
              id: `step_cmd_pr_${Date.now()}`,
              timestamp: Date.now(),
              type: 'command_proposal',
              title: 'Komut Çalıştırılıyor (Otonom Profil)',
              content: `\`${binary} ${args.join(' ')}\` güvenli komutu otomatik onaylandı.`,
              status: 'approved',
            });
          } else {
            callbacks.onStep({
              id: `step_cmd_pr_${Date.now()}`,
              timestamp: Date.now(),
              type: 'command_proposal',
              title: 'Komut Çalıştırma Onayı',
              content: `\`${binary} ${args.join(' ')}\` komutunun çalıştırılması isteniyor. Gerekçe: ${cmdItem.reason}`,
              status: 'pending',
            });
            callbacks.onStatusChange('waiting_command_approval');
            pauseTimer();
            try {
              approved = await callbacks.onRequestCommandApproval(cmdItem);
            } finally {
              resumeTimer();
            }
          }

          if (!approved) {
            callbacks.onStatusChange('thinking');
            callbacks.onStep({
              id: `step_cmd_rej_${Date.now()}`,
              timestamp: Date.now(),
              type: 'tool_result',
              toolName: 'propose_command',
              content: 'Kullanıcı komut çalıştırma talebini reddetti.',
              status: 'rejected',
            });
            pushExchange(assistantText, parsed.rawJson, `[REJECTED BY USER]: permission to run "${binary} ${args.join(' ')}" was not given. Continue without it.`);
            continue;
          }

          callbacks.onStatusChange('running_command');
          callbacks.onLog(`İzole komut koşturuluyor: ${binary} ${args.join(' ')}`);
          const cmdRes = await window.electronAPI?.runApprovedCommand({ binary, args, timeoutMs: 60000 });
          callbacks.onStatusChange('thinking');
          const output = `${cmdRes?.output || ''}${cmdRes?.error ? `\n${cmdRes.error}` : ''}`.trim();
          const tail = output.length > 4000 ? `...\n${output.slice(-4000)}` : output;
          let observation: string;
          if (cmdRes?.success) {
            consecutiveErrors = 0;
            repeatStreak = 0;
            stepsWithoutProgress = 0;
            observation = `[COMMAND OK] (exit code 0):\n${tail || '(no output)'}`;
            ledger.milestones.push({
              id: `m_cmd_${Date.now()}`,
              description: `Komut çalıştırıldı: ${binary} ${args.join(' ')}`,
              status: 'done',
              timestamp: Date.now(),
            });
            callbacks.onStep({
              id: `step_cmd_ok_${Date.now()}`,
              timestamp: Date.now(),
              type: 'tool_result',
              toolName: 'propose_command',
              content: tail.slice(0, 2000) || 'Komut başarıyla çalıştı.',
              status: 'success',
            });
          } else {
            const usageText = looksLikeUsageText(output);
            const operands = args.filter((a) => !a.startsWith('-'));
            const bareUsage = usageText && (binary === 'python' || binary === 'node') && operands.length <= 1;
            if (!bareUsage) consecutiveErrors++;
            seenActions.set(`cmdfail:${cmdKey}:${mutationCount}`, { step: stepCount });
            const errText = `${cmdRes?.error || ''}\n${cmdRes?.output || ''}`;
            const notFound =
              /ENOENT|not found|not recognized|bulunamadı|izin verilmiyor/i.test(errText) &&
              (cmdRes?.exitCode === null || cmdRes?.exitCode === undefined || /ENOENT|izin verilmiyor/i.test(cmdRes?.error || ''));
            const policyBlocked = /Güvenlik Politikası|Güvenlik Koruması/i.test(cmdRes?.error || '');
            if (/package\.json/i.test(cmdRes?.error || '') && /mevcut değil|not found|missing/i.test(cmdRes?.error || '')) {
              // A static site or a non-Node project: there is nothing to run, and inventing a
              // package.json just to run "npm test" sent models into long detours.
              if (!ledger.unavailableBinaries.includes(binary)) ledger.unavailableBinaries.push(binary);
              observation = `[NOT APPLICABLE]: this project has no package.json, so npm has nothing to run here. That is fine — do NOT create a package.json just to run commands. Continue with the task, or finish if it is done.`;
            } else if (notFound || policyBlocked) {
              if (!ledger.unavailableBinaries.includes(binary) && notFound) ledger.unavailableBinaries.push(binary);
              observation = `[COMMAND UNAVAILABLE]: "${binary} ${args.join(' ')}" cannot run here (${(cmdRes?.error || 'not installed').trim().slice(0, 200)}). Do not call it again; continue without it.`;
            } else if (bareUsage) {
              seenActions.set(`usage:${cmdKey}`, { step: stepCount });
              observation = `[PROGRAM PRINTED ITS USAGE TEXT] (exit code ${cmdRes?.exitCode ?? '?'}):\n${tail}\nThis is NOT a bug: the program was started without arguments, so it printed how to use it. Do not change the code because of this. To test it, run it with arguments that match the usage line above (one feature per run), or finish if the task is complete.`;
            } else if (usageText) {
              observation = `[PROGRAM PRINTED ITS USAGE TEXT] (exit code ${cmdRes?.exitCode ?? '?'}):\n${tail}\nThe program did not accept the arguments "${operands.slice(1).join(' ')}". If they are valid for this task, fix the argument handling in the code; otherwise run it again with arguments that match the usage line.`;
            } else {
              // Numbered lines at the failing location let the model fix it with replace_lines.
              let excerpt = '';
              const location = findErrorLocation(output, ledger.projectTree);
              if (location) {
                const fileRes = await window.electronAPI?.readWorkspaceFile(location.path);
                if (fileRes?.success && fileRes.content !== undefined) {
                  excerpt = `\nThe error points at line ${location.line} of "${location.path}":\n${numberedLines(fileRes.content, location.line - 3, location.line + 5)}\nFix it with replace_lines (use these line numbers) or edit_file.`;
                }
              }
              observation = `[COMMAND FAILED] (exit code ${cmdRes?.exitCode ?? '?'}):\n${tail}${excerpt}\nRead the errors, fix the code, then run it again.`;
            }
            callbacks.onStep({
              id: `step_cmd_fail_${Date.now()}`,
              timestamp: Date.now(),
              type: 'tool_result',
              toolName: 'propose_command',
              content: tail.slice(0, 2000) || 'Komut başarısız oldu.',
              status: 'failed',
            });
          }
          pushExchange(assistantText, parsed.rawJson, observation, `[run_command "${binary} ${args.join(' ')}" output shortened]`);
          continue;
        }

        if (parsed.type === 'ask_question') {
          const { question, options } = payload;
          if (securityProfile === 'autonomous') {
            const chosenOption = options && options.length > 0 ? options[0] : 'Varsayılan ve en uygun mühendislik yaklaşımı';
            callbacks.onLog(`[Otonom Karar]: Soru sorulmadı, "${chosenOption}" seçeneği otonom tercih edilerek akış sürdürülüyor.`);
            callbacks.onStep({
              id: `step_q_auto_${Date.now()}`,
              timestamp: Date.now(),
              type: 'clarification',
              title: 'Otonom Karar (Soru Atlandı)',
              content: `Soru atlandı. Otonom profil gereği "${chosenOption}" tercihi ile devam ediliyor. (Soru: ${question})`,
              status: 'approved',
              metadata: { options, autoAnswer: chosenOption },
            });
            ledger.userDecisions.push({ question, answer: chosenOption });
            pushExchange(assistantText, parsed.rawJson, `[AUTONOMOUS MODE]: questions are disabled; "${chosenOption}" was chosen. Continue the work without asking.`);
            continue;
          }

          const previous = ledger.userDecisions.find((d) => d.question.trim().toLowerCase() === String(question).trim().toLowerCase());
          if (previous) {
            repeatStreak++;
            pushExchange(
              assistantText,
              parsed.rawJson,
              `[ALREADY ANSWERED]: the user answered this question before: "${previous.answer}". Continue with that decision.${repeatNudge()}`
            );
            continue;
          }

          callbacks.onStep({
            id: `step_q_${Date.now()}`,
            timestamp: Date.now(),
            type: 'clarification',
            title: 'Ajan Kullanıcıya Danışıyor',
            content: question,
            status: 'pending',
            metadata: { options },
          });
          callbacks.onStatusChange('waiting_clarification');
          pauseTimer();
          let answer = '';
          try {
            answer = await callbacks.onRequestClarification({ id: `q_${Date.now()}`, question, options });
          } finally {
            resumeTimer();
          }
          // RECORD IN LEDGER SO MODEL NEVER ASKS THIS AGAIN!
          ledger.userDecisions.push({ question, answer });
          callbacks.onStatusChange('thinking');
          callbacks.onStep({
            id: `step_ans_${Date.now()}`,
            timestamp: Date.now(),
            type: 'tool_result',
            toolName: 'ask_question',
            content: `Kullanıcı Yanıtı: ${answer}`,
            status: 'success',
          });
          consecutiveErrors = 0;
          repeatStreak = 0;
          stepsWithoutProgress = 0;
          pushExchange(assistantText, parsed.rawJson, `[USER ANSWER]: ${answer}`);
          continue;
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
          callbacks.onLog('Kullanıcı tarafından durduruldu.');
          releaseSubtasks(ledger);
          callbacks.onStatusChange('idle');
          break;
        }

        const rawMessage = String(err?.message || err || 'Bilinmeyen hata');
        let friendly = rawMessage;
        if (/Failed to fetch|NetworkError|ECONNREFUSED|fetch failed/i.test(rawMessage)) {
          friendly = `Ollama'ya bağlanılamadı (${ollamaClient.getEndpoint()}). Ollama'nın çalıştığından emin olun.`;
        } else if (/not found|pull/i.test(rawMessage) && /model/i.test(rawMessage)) {
          friendly = `Model bulunamadı: "${model}". Model Yöneticisi'nden indirin veya başka bir model seçin. (${rawMessage})`;
        } else if (/memory|out of memory|runner.*(terminated|stopped)/i.test(rawMessage)) {
          friendly = `Model belleğe sığmadı veya çalıştırıcı durdu (${rawMessage}). Ayarlar > Üretim bölümünden bağlam uzunluğunu düşürün veya daha küçük bir model seçin.`;
        }
        callbacks.onStep({
          id: `step_err_${Date.now()}`,
          timestamp: Date.now(),
          type: 'system_notice',
          content: `Ajan hatası: ${friendly}`,
          status: 'failed',
        });
        moveTo(['RETRYING', 'FAILED'], rawMessage);
        releaseSubtasks(ledger);
        callbacks.onStatusChange('error');
        break;
      }
    }

    if (!finished && this.isRunning && stepCount >= MAX_STEPS) {
      if (!(await tryGracefulCompletion(`Maksimum adım sınırına (${MAX_STEPS}) ulaşıldı.`))) {
        releaseSubtasks(ledger);
        notice(`Maksimum adım sınırına (${MAX_STEPS}) ulaşıldı.`, 'failed');
        callbacks.onStatusChange('idle');
      }
    }

    this.isRunning = false;
    this.stepAbortController = null;
    this.pendingInterruptDirective = null;
  }
}

export const agentEngine = new AgentEngine();
