/**
 * agentLimits.ts
 * How much work one agent run may do and how much it hands the model at once, by model tier.
 *
 * The defaults were tuned on 2-8B local models with 8-16K windows: few steps, small reads, a short
 * kept history. A large model (>= 24B locally, or any cloud model with a 64K+ window) wastes steps
 * and tokens under those limits: it re-reads files cut at 16 000 characters, reads one file per
 * round trip and loses its own recent work to compaction. Large models therefore get more steps,
 * reads sized to their window, several files per read step and more kept exchanges. Every value is
 * still bounded by the context window, so a large local model with an 8K window stays safe.
 */
import type { ModelTier } from '../ollama/ModelRuntime';

export interface AgentLimits {
  maxSteps: number;
  maxToolCalls: number;
  maxStepsWithoutProgress: number;
  /** Characters of one file shown by read_file (the rest needs a line range). */
  maxReadChars: number;
  /** Characters all files of one read_files step may show together. */
  maxReadFilesChars: number;
  /** Paths one read_files step may name; 0 = the tool is not offered. */
  readFilesMax: number;
  /** Projects with at most this many files have their files in the task message. */
  preloadFiles: number;
  /** Characters of file content in the task message. */
  preloadChars: number;
  /** Exchanges kept verbatim when the history is compacted, tried in this order. */
  compactionKeeps: number[];
  /** Compaction shrinks the history to this share of the budget, so it happens rarely (cache-friendly). */
  compactionTarget: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Math.floor(value)));

export function agentLimitsFor(tier: ModelTier, numCtx: number, charsPerToken = 3.2): AgentLimits {
  const windowChars = Math.max(4096, numCtx) * charsPerToken;
  if (tier !== 'large') {
    return {
      maxSteps: 35,
      maxToolCalls: 50,
      maxStepsWithoutProgress: 10,
      maxReadChars: 16000,
      maxReadFilesChars: 0,
      readFilesMax: 0,
      preloadFiles: 6,
      preloadChars: Math.min(12000, Math.floor(windowChars * 0.25)),
      compactionKeeps: [4, 2, 1],
      compactionTarget: 0.7,
    };
  }
  return {
    maxSteps: 60,
    maxToolCalls: 90,
    maxStepsWithoutProgress: 14,
    maxReadChars: clamp(windowChars * 0.15, 16000, 60000),
    maxReadFilesChars: clamp(windowChars * 0.3, 16000, 120000),
    readFilesMax: 8,
    preloadFiles: 12,
    preloadChars: clamp(windowChars * 0.3, 12000, 48000),
    compactionKeeps: [8, 4, 2, 1],
    compactionTarget: 0.6,
  };
}
