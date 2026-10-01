import { REMOVAL_INTENT, alignReplacementIndent, applyChunkEdit, applyLineRangeEdit, changedRegionExcerpt, findBestMatchRegion, hashText, isProtectedTestFile, numberedLines, stripLineNumberPrefixes } from '../engineHelpers';
import { detectLazyPlaceholder, sanitizeFileContent } from '../AgentProtocol';
import { checkFileSanity, damageFromChange, definitionLoss, formatSanityIssues, jsonKeyLoss, mergeJsonPreservingKeys, strictFormatError } from '../FileSanity';
import { wrapUntrustedFileContent } from '../UntrustedData';
import { ChangesetItem } from '@/types/agent';
import { et } from '../engineText';
import type { RunContext, StepVars, LoopFlow } from './context';

/** The "propose_edit" step of the agent loop. */
export async function handleEditFile(ctx: RunContext, { assistantText, parsed, payload }: Pick<StepVars, 'assistantText' | 'parsed' | 'payload'>): Promise<LoopFlow> {
  const filePath: string = payload.path;
  const readRes = await window.electronAPI?.readWorkspaceFile(filePath);
  if (!(readRes?.success && readRes.content !== undefined)) {
    ctx.consecutiveErrors++;
    ctx.stepsWithoutProgress++;
    ctx.notice(et('editMissingFile', { path: filePath }), 'rejected');
    ctx.pushExchange(assistantText, parsed.rawJson, `[ERROR]: "${filePath}" does not exist, so it cannot be edited. Create it with write_file and its complete content.`);
    return 'continue';
  }
  const currentContent = readRes.content;
  if (isProtectedTestFile(filePath, ctx.userRequestText())) {
    ctx.consecutiveErrors++;
    ctx.stepsWithoutProgress++;
    ctx.notice(et('editRefusedTests', { path: filePath }), 'rejected', et('testProtectionTitle'));
    ctx.pushExchange(
      assistantText,
      parsed.rawJson,
      `[NOT APPLIED]: "${filePath}" is an existing test file. The tests define the expected behaviour — change the code so that they pass; do not change the tests (only the user may ask for that). Read the failing assertion (expected vs actual) and fix the implementation.`
    );
    return 'continue';
  }
  let replaceText: string = payload.new_chunk;
  const replaceSanitized = sanitizeFileContent(filePath, replaceText);
  if (replaceSanitized.notes.some((n) => n.includes('escape'))) replaceText = replaceSanitized.content;

  // Re-applying an identical edit is never progress: replace_lines changes the file again on
  // every call (gemma2:2b deleted a CSS line per step this way) and insertions duplicate.
  const editSig = `${filePath}:${
    payload.lineRange ? `L${payload.startLine}-${payload.endLine}` : hashText(String(payload.original_chunk ?? ''))
  }:${hashText(String(replaceText ?? ''))}`;
  const appliedAt = ctx.appliedEdits.get(editSig);
  if (appliedAt !== undefined) {
    ctx.repeatStreak++;
    ctx.stepsWithoutProgress++;
    ctx.notice(et('editRepeated', { path: filePath, step: appliedAt }), 'rejected');
    const around = payload.lineRange
      ? `\nCurrent lines ${Math.max(1, payload.startLine - 3)}-${payload.endLine + 3} of "${filePath}":\n${numberedLines(currentContent, payload.startLine - 3, payload.endLine + 3)}`
      : '';
    // Re-sending the edit while the file is still broken means the model cannot see the fix:
    // the whole file and a complete rewrite are the way out (patching failed already).
    const openErrors = (ctx.openSanityIssues.get(filePath) || []).filter((i) => i.severity === 'error');
    const help =
      openErrors.length === 0
        ? `${around}${ctx.openProblemsFor(filePath)}`
        : `\n"${filePath}" still has this error:\n${formatSanityIssues(openErrors)}\nDo not send this edit again. ${
            currentContent.length <= 6000
              ? `Rewrite the WHOLE file correctly with write_file (its complete content). The current file:\n${wrapUntrustedFileContent(filePath, numberedLines(currentContent))}`
              : `Read the reported lines and fix them with a different edit.${ctx.problemExcerpt(filePath)}`
          }`;
    ctx.pushExchange(
      assistantText,
      parsed.rawJson,
      `[REPEATED]: exactly this edit was already applied at step ${appliedAt}. Applying it again would change "${filePath}" again (line numbers shift after every edit), so nothing was changed.${help}${ctx.acceptanceNote()}${ctx.repeatNudge() || ' Do a different, necessary step or finish.'}`
    );
    return 'continue';
  }

  const editResult = payload.lineRange
    ? applyLineRangeEdit(currentContent, payload.startLine, payload.endLine, replaceText)
    : applyChunkEdit(currentContent, stripLineNumberPrefixes(payload.original_chunk), stripLineNumberPrefixes(replaceText));
  if (!editResult.success) {
    ctx.consecutiveErrors++;
    ctx.stepsWithoutProgress++;
    const failures = (ctx.editFailures.get(filePath) || 0) + 1;
    ctx.editFailures.set(filePath, failures);
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
    ctx.notice(et('editNoMatch', { path: filePath, error: String(editResult.error) }), 'rejected', et('editNoMatchTitle'));
    const failureEntry = ctx.pushExchange(
      assistantText,
      parsed.rawJson,
      `[EDIT FAILED]: ${editResult.error}. Nothing was changed.\n${hint}\nEasiest fix: replace_lines with the line numbers above (start_line, end_line, content). Or copy "find" exactly (same characters and indentation, without the "NN| " prefixes).${rewriteAdvice}`,
      `[edit_file "${filePath}" failed; the file content shown then was removed from history; read it again if you need it]`
    );
    if (currentContent.length <= 6000) {
      // The full file is in this result, so an immediate read_file would only repeat it.
      ctx.seenActions.set(`read:${filePath}:${readRes.hash || hashText(currentContent)}:-`, { step: ctx.stepCount, entry: failureEntry });
    }
    return 'continue';
  }

  let newFullContent = editResult.newContent;
  let editMergeNote = '';
  // Python: a block indented differently from the lines it replaces is aligned to them when
  // that removes errors (small models cannot see the stray indentation they keep re-sending).
  if (payload.lineRange && /\.pyw?$/i.test(filePath)) {
    const aligned = alignReplacementIndent(currentContent, payload.startLine, payload.endLine, replaceText);
    const alignedResult = aligned === null ? null : applyLineRangeEdit(currentContent, payload.startLine, payload.endLine, aligned);
    const errorCount = (content: string) => checkFileSanity(filePath, content).filter((i) => i.severity === 'error').length;
    if (alignedResult?.success && errorCount(alignedResult.newContent) < errorCount(newFullContent)) {
      newFullContent = alignedResult.newContent;
      editMergeNote = 'Auto-fixed: your lines were indented differently from the lines they replace; they were aligned to them.';
    }
  }
  if (!REMOVAL_INTENT.test(ctx.userRequestText())) {
    const merged = mergeJsonPreservingKeys(filePath, currentContent, newFullContent);
    if (merged) {
      newFullContent = merged.content;
      editMergeNote = `Kept existing keys the edit had dropped: ${merged.kept.slice(0, 10).join(', ')}.`;
    }
  }
  const editFormatError = strictFormatError(filePath, newFullContent);
  if (editFormatError && strictFormatError(filePath, currentContent) === null) {
    ctx.consecutiveErrors++;
    ctx.stepsWithoutProgress++;
    ctx.notice(et('editRefusedJson', { path: filePath, error: editFormatError }), 'rejected', et('fileCheckTitle'));
    ctx.pushExchange(
      assistantText,
      parsed.rawJson,
      `[NOT APPLIED]: after this edit "${filePath}" would no longer be valid JSON (${editFormatError}). The file is unchanged. Check commas, quotes and brackets in "replace".`
    );
    return 'continue';
  }
  if (!REMOVAL_INTENT.test(ctx.userRequestText())) {
    const dropped = jsonKeyLoss(filePath, ctx.originalSnapshots.get(filePath) ?? currentContent, newFullContent);
    if (dropped.length > 0) {
      ctx.consecutiveErrors++;
      ctx.stepsWithoutProgress++;
      ctx.notice(et('editRefusedKeys', { path: filePath, keys: dropped.join(', ') }), 'rejected', et('fileCheckTitle'));
      ctx.pushExchange(
        assistantText,
        parsed.rawJson,
        `[NOT APPLIED]: this edit would delete existing keys from "${filePath}": ${dropped.join(', ')}. Keep them; only add or change what the task needs.`
      );
      return 'continue';
    }
  }
  if (newFullContent === currentContent) {
    ctx.repeatStreak++;
    ctx.stepsWithoutProgress++;
    if (ctx.mutationCount > 0) ctx.noopResends++;
    ctx.notice(et('editNoChange', { path: filePath }), 'rejected');
    ctx.pushExchange(
      assistantText,
      parsed.rawJson,
      `[NO CHANGE]: this edit leaves "${filePath}" unchanged — it is already applied.${ctx.acceptanceNote()}${ctx.repeatNudge() || ' Continue with the next part of the task.'}`
    );
    return 'continue';
  }
  const lazy = detectLazyPlaceholder(replaceText, payload.original_chunk);
  if (lazy) {
    ctx.consecutiveErrors++;
    ctx.stepsWithoutProgress++;
    ctx.notice(et('editRefusedPlaceholder', { path: filePath, placeholder: lazy }), 'rejected');
    ctx.pushExchange(assistantText, parsed.rawJson, `[NOT APPLIED]: "replace" contains the placeholder "${lazy}" instead of real code. Write the actual code.`);
    return 'continue';
  }

  // Do no harm: an edit that breaks a working file (or makes a broken one worse) is not
  // applied, so the model never has to patch its own breakage line by line.
  const damage = damageFromChange(filePath, currentContent, newFullContent);
  if (damage.length > 0) {
    const times = ctx.countRefusal(filePath, damage);
    ctx.consecutiveErrors++;
    ctx.stepsWithoutProgress++;
    // The same fault again: the edit loops (a 7B model sent one breaking CSS edit six times).
    if (times >= 2) ctx.repeatStreak++;
    ctx.notice(et('editRefusedDamage', { path: filePath, problem: damage[0].message.slice(0, 160) }), 'rejected', et('fileCheckTitle'));
    const rangeHint = payload.lineRange
      ? 'replace_lines replaces EVERY line from start_line to end_line with "content": include each line of that range that must stay (to insert a line, repeat the original line in content) and keep the range as small as possible.'
      : '"replace" must keep every tag, bracket and quote of the text it replaces that is still needed.';
    ctx.pushExchange(
      assistantText,
      parsed.rawJson,
      times >= 2
        ? `[NOT APPLIED]: this edit would break "${filePath}" again, for the same reason as before, so the file is unchanged:\n${formatSanityIssues(damage)}${ctx.repeatedRefusalHelp(filePath, currentContent, damage, times, 'edit')}`
        : `[NOT APPLIED]: this edit would break "${filePath}", so the file is unchanged. With your edit the automatic check would report:\n${formatSanityIssues(damage)}${ctx.issueExcerpt(newFullContent, damage, 'Your version would read at')}\n${rangeHint} Send a corrected edit.`
    );
    return 'continue';
  }

  // An edit that deletes a function or class the file still uses leaves it valid but broken: in the
  // app, qwen2.5-coder:7b filled add_options() over a range that also held "def plan(...)", while
  // run_tool(..., plan) stayed. Removing one on purpose removes its uses too, so this holds for
  // any request (variables are left out: a removed local may share its name with a property).
  const definedAt = (name: string) => new RegExp(`\\b(?:def|class|function\\*?)\\s+${name}\\b`);
  const stillUsed = definitionLoss(filePath, currentContent, newFullContent).filter(
    (name) => definedAt(name).test(currentContent) && new RegExp(`\\b${name}\\b`).test(newFullContent)
  );
  if (stillUsed.length > 0) {
    ctx.consecutiveErrors++;
    ctx.stepsWithoutProgress++;
    const useLine = newFullContent.split('\n').findIndex((l) => new RegExp(`\\b${stillUsed[0]}\\b`).test(l)) + 1;
    const defLine = currentContent.split('\n').findIndex((l) => definedAt(stillUsed[0]).test(l)) + 1;
    ctx.notice(et('editRefusedDefinition', { path: filePath, names: stillUsed.join('", "') }), 'rejected', et('fileCheckTitle'));
    ctx.pushExchange(
      assistantText,
      parsed.rawJson,
      `[NOT APPLIED]: this edit deletes the definition of ${stillUsed.join(', ')}${defLine > 0 ? ` (line ${defLine})` : ''}, but "${filePath}" still uses it (line ${useLine} after your edit), so the file is unchanged. ${
        payload.lineRange
          ? `replace_lines replaces EVERY line from start_line to end_line: choose a range that ends before line ${defLine || 'of that definition'}, or repeat the lines that must stay in "content".`
          : '"find" must not include that definition, or "replace" must repeat it.'
      }${payload.lineRange ? `\nCurrent lines ${Math.max(1, payload.startLine - 1)}-${payload.endLine + 2} of "${filePath}":\n${numberedLines(currentContent, payload.startLine - 1, payload.endLine + 2)}` : ''}`
    );
    return 'continue';
  }

  const changesetItem: ChangesetItem = {
    id: `cs_edit_${Date.now()}`,
    operation: 'edit',
    relativePath: filePath,
    baseHash: readRes.hash || '',
    proposedContentHash: '',
    originalContent: currentContent,
    newContent: newFullContent,
    reason: String(parsed.rawJson?.thought || payload.reason || '').slice(0, 300),
    selected: true,
    status: 'pending',
  };
  const approved = await ctx.requestApproval(
    changesetItem,
    et('editAutoTitle'),
    et('editProposalTitle'),
    et('editDetail', { path: filePath, method: String(editResult.method) })
  );
  if (!approved) {
    ctx.stepsWithoutProgress++;
    ctx.callbacks.onStep({
      id: `step_edit_rej_${Date.now()}`,
      timestamp: Date.now(),
      type: 'tool_result',
      toolName: 'propose_edit',
      content: et('editRejectedByUser'),
      status: 'rejected',
    });
    ctx.pushExchange(assistantText, parsed.rawJson, `[REJECTED BY USER]: the user did not approve this edit of "${filePath}". Choose a different approach.`);
    return 'continue';
  }

  const result = await ctx.applyMutation({ filePath, exists: true, baseHash: readRes.hash || '', newContent: newFullContent });
  if (!result.ok) {
    ctx.consecutiveErrors++;
    ctx.callbacks.onStep({
      id: `step_edit_fail_${Date.now()}`,
      timestamp: Date.now(),
      type: 'tool_result',
      toolName: 'propose_edit',
      content: et('editApplyFailed', { error: String(result.error) }),
      status: 'failed',
    });
    ctx.pushExchange(assistantText, parsed.rawJson, `[ERROR]: the edit could not be applied: ${result.error}. Read the file again before retrying.`);
    return 'continue';
  }

  ctx.appliedEdits.set(editSig, ctx.stepCount);
  ctx.consecutiveErrors = 0;
  ctx.repeatStreak = 0;
  ctx.ledger.appliedChanges.push(`Edited: "${filePath}"`);
  ctx.ledger.milestones.push({
    id: `m_ed_${Date.now()}`,
    description: `Edit applied: ${filePath}`,
    status: 'done',
    timestamp: Date.now(),
  });
  ctx.callbacks.onStep({
    id: `step_edit_ok_${Date.now()}`,
    timestamp: Date.now(),
    type: 'tool_result',
    toolName: 'propose_edit',
    content: et('editApplied', { path: filePath, method: String(editResult.method) }),
    status: 'success',
  });
  if (!ctx.originalSnapshots.has(filePath)) ctx.originalSnapshots.set(filePath, currentContent);
  const verdict = await ctx.afterMutation(filePath, newFullContent, currentContent);
  const editLostKeys = jsonKeyLoss(filePath, ctx.originalSnapshots.get(filePath) || currentContent, newFullContent);
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
  ctx.pushExchange(assistantText, parsed.rawJson, observation);
  return 'continue';
}
