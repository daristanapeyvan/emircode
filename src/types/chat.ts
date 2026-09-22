import { GenerationOptions } from './ollama';
import { AgentStep, AppliedTransaction } from './agent';

export interface Attachment {
  id: string;
  name: string;
  size: number;
  type: string;
  content: string; // text content or base64 image data
  isImage?: boolean;
}

export interface GenerationMetadata {
  evalCount?: number;
  evalDurationNs?: number;
  totalDurationNs?: number;
  loadDurationNs?: number;
  promptEvalCount?: number;
  tokensPerSecond?: number;
  durationSeconds?: number;
}

export interface Message {
  id: string;
  chatId: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  thinking?: string; // model's reasoning trace
  createdAt: number;
  model?: string;
  metadata?: GenerationMetadata;
  attachments?: Attachment[];
  error?: string;
}

export interface Chat {
  id: string;
  title: string;
  model: string;
  mode?: 'chat' | 'agent';
  agentGoal?: string;
  workspaceRoot?: string;
  workspaceName?: string;
  agentSteps?: AgentStep[];
  executionLogs?: string[];
  appliedTransactions?: AppliedTransaction[];
  systemPrompt?: string;
  presetId?: string;
  options?: GenerationOptions;
  createdAt: number;
  updatedAt: number;
}

