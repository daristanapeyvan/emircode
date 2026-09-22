import { WorkspaceFileInfo } from '../../electron/preload';

export type AgentStatus =
  | 'idle'
  | 'thinking'
  | 'waiting_changeset_approval'
  | 'waiting_delete_approval'
  | 'waiting_command_approval'
  | 'waiting_clarification'
  | 'running_command'
  | 'finished'
  | 'error';

export type MutationOperation = 'create' | 'edit' | 'delete';

export interface ChangesetItem {
  id: string;
  operation: MutationOperation;
  relativePath: string;
  baseHash: string;
  proposedContentHash: string;
  originalContent: string;
  newContent?: string;
  reason: string;
  selected: boolean;
  token?: string;
  status: 'pending' | 'applied' | 'rejected' | 'conflict';
  error?: string;
}

export interface CommandApprovalItem {
  id: string;
  binary: string;
  args: string[];
  reason: string;
}

export interface ClarificationItem {
  id: string;
  question: string;
  options?: string[];
}

export interface AgentStep {
  id: string;
  timestamp: number;
  type:
    | 'thought'
    | 'tool_call'
    | 'tool_result'
    | 'changeset_proposal'
    | 'delete_warning'
    | 'command_proposal'
    | 'clarification'
    | 'system_notice'
    | 'final_answer';
  title?: string;
  content: string;
  toolName?: string;
  toolArgs?: any;
  rawOutput?: string;
  metadata?: Record<string, any>;
  status?: 'pending' | 'approved' | 'rejected' | 'success' | 'failed';
}

export interface AppliedTransaction {
  transactionId: string;
  relativePath: string;
  operation: MutationOperation;
  timestamp: number;
  approvedHash: string;
  baseHash: string;
}

export interface MilestoneItem {
  id: string;
  description: string;
  status: 'done' | 'in_progress';
  timestamp: number;
}

export interface AgentMemoryLedger {
  goal: string;
  projectTree: string[];
  knownFiles: Record<string, { size?: number; lastAction?: string }>;
  appliedChanges: string[];
  userDecisions: { question: string; answer: string }[];
  discoveredFacts: string[];
  unavailableBinaries: string[];
  invalidPaths: string[];
  milestones: MilestoneItem[];
  currentPhase: 'investigation' | 'modification' | 'verification' | 'completion';
}

