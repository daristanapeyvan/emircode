/**
 * composer.ts — how a wizard's result reaches the agent: the generated request is put into the
 * composer as plain text, the user reads or edits it and presses send. The run options that came
 * with it (short title, page checklist, theme, contract checks) travel with the text until then.
 */
import type { DesignOverride } from '../design/DesignTheme';

/** Extras of a run started from a wizard (a request typed by hand sends none). */
export interface WizardRunOptions {
  /** Short title for the timeline and the session list instead of the long generated request. */
  displayGoal?: string;
  /** Explicit checklist (one item per page / step); [] = one task, the request is not split. */
  checklist?: string[];
  /** Design theme chosen for this run. */
  design?: DesignOverride;
  /** false = no automatic web page checks (scripts: the request mentions HTML without being a page). */
  contracts?: boolean;
  /** Files written before the first step when missing (scripts: the tested safety module). */
  seedFiles?: Array<{ path: string; content: string }>;
  /** Files only the generated program may create (scripts: its log and backups). */
  scriptOutputs?: string[];
  /** The flag with which the generated script changes files (scripts: --uygula / --apply). */
  applyFlag?: string;
}

export type WizardKind = 'site' | 'mini' | 'script';

export interface WizardDraft {
  kind: WizardKind;
  /** The tool of a mini app / script wizard, so "open wizard" returns to its settings page. */
  toolId?: string;
  /** Badge text above the composer. */
  label: string;
  /** The request as it was put into the composer. */
  prompt: string;
  options: WizardRunOptions;
  /** Changes on every confirm, so the same request can be put into the composer again. */
  nonce: number;
}

/** The file an item is about: "about.html — Hakkımızda: ..." → "about.html". */
const itemFile = (item: string) => item.split(' — ')[0].trim();

/**
 * The checklist items that still belong to the text: pages the user removed from the request in
 * the composer are dropped; fewer than two left = one task.
 */
export function checklistForText(checklist: string[] | undefined, text: string): string[] | undefined {
  if (!checklist) return undefined;
  const kept = checklist.filter((item) => {
    const file = itemFile(item);
    return !file || text.includes(file);
  });
  return kept.length >= 2 ? kept : [];
}

/** The run options to send with the composer text (undefined = a normal request). */
export function composerRunOptions(draft: WizardDraft | null, text: string): WizardRunOptions | undefined {
  if (!draft || !text.trim()) return undefined;
  return { ...draft.options, checklist: checklistForText(draft.options.checklist, text) };
}
