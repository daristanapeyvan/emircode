/**
 * context.ts
 * What the tool handlers of a run (the modules in this folder) share with AgentEngine.runGoal: the
 * run's state and helpers. The object is built once per run in runGoal; its `let` members are live
 * getters and setters over runGoal's own variables, so a handler that writes `ctx.repeatStreak++`
 * changes the value the main loop reads.
 */
import type { AgentMemoryLedger, AgentStep, ChangesetItem } from '@/types/agent';
import type { SecurityProfile } from '@/types/settings';
import type { ParsedAction } from '../ToolDispatcher';
import type { AgentState } from '../AgentStateMachine';
import type { ValidationReport } from '../TaskValidator';
import type { SanityIssue } from '../FileSanity';
import type { AgentEngineCallbacks, ConversationEntry, RunGoalOptions } from '../engineHelpers';
import type { AgentEngine } from '../AgentEngine';

export type LoopFlow = 'continue' | 'break' | 'return' | 'next';

export interface RunContext {
  engine: AgentEngine;
  MAX_READ_CHARS: 16000;
  acceptanceNote: () => string;
  afterMutation: (filePath: string, finalContent: string, previousContent?: string | null) => Promise<string>;
  appliedEdits: Map<string, number>;
  appliedRuns: Map<string, { step: number; output: string; }>;
  applyDesignTheme: () => Promise<void>;
  applyMutation: (params: { filePath: string; exists: boolean; baseHash: string; newContent: string; }) => Promise<{ ok: boolean; error?: string; }>;
  baseName: (p: string) => string;
  callbacks: AgentEngineCallbacks;
  commandOutputs: Map<string, string>;
  commandRuns: Map<string, number>;
  consecutiveErrors: number;
  countRefusal: (filePath: string, damage: SanityIssue[]) => number;
  editFailures: Map<string, number>;
  finalize: (summary: string, status: "finished" | "error", rawOutput?: string, warnings?: string[], note?: string) => void;
  finishPushbacks: number;
  goal: string;
  issueExcerpt: (content: string, issues: SanityIssue[], label: string) => string;
  ledger: AgentMemoryLedger;
  moveTo: (path: AgentState[], reason?: string) => void;
  mutationCount: number;
  noopResends: number;
  notice: (content: string, status: AgentStep["status"], title?: string) => void;
  openProblemsFor: (filePath: string) => string;
  openSanityIssues: Map<string, SanityIssue[]>;
  originalSnapshots: Map<string, string | null>;
  pauseTimer: () => void;
  problemExcerpt: (filePath: string) => string;
  programOkAt: number;
  pushExchange: (assistantText: string, raw: any, observation: string, summary?: string) => ConversationEntry;
  rejectedWrites: Map<string, number>;
  repeatNudge: () => string;
  repeatStreak: number;
  repeatedRefusalHelp: (filePath: string, current: string, damage: SanityIssue[], times: number, kind: "edit" | "write") => string;
  requestApproval: (item: ChangesetItem, autoTitle: string, pendingTitle: string, detail: string) => Promise<boolean>;
  resumeTimer: () => void;
  runAcceptanceChecks: () => Promise<{ report: ValidationReport | null; missing: string[]; missingUi: string[]; }>;
  runOptions: RunGoalOptions;
  securityProfile: SecurityProfile;
  seenActions: Map<string, { step: number; entry?: ConversationEntry; }>;
  stepCount: number;
  stepsWithoutProgress: number;
  stillVisible: (entry?: ConversationEntry) => boolean;
  treeVersion: number;
  userRequestText: () => string;
  writtenByModel: Set<string>;
  writtenFiles: Set<string>;
  wroteRunnableFile: boolean;
}

/** The values of the current step a handler reads. */
export interface StepVars {
  assistantText: string;
  fullResponse: string;
  parsed: ParsedAction;
  payload: any;
  readOnlySignature: string | null;
}
