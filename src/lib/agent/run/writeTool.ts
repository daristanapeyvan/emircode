import { detectLazyPlaceholder, lineCount, sanitizeFileContent } from '../AgentProtocol';
import { EMPTY_FILE_INTENT, REMOVAL_INTENT, REWRITE_INTENT, formatKb, hashText, isEmptyWrite, isProtectedTestFile, looksLikeStatusMessage } from '../engineHelpers';
import { damageFromChange, definitionLoss, detectDestructiveRewrite, formatSanityIssues, jsonKeyLoss, mergeJsonPreservingKeys, strictFormatError } from '../FileSanity';
import { wrapUntrustedFileContent } from '../UntrustedData';
import { ChangesetItem } from '@/types/agent';
import { et } from '../engineText';
import type { RunContext, StepVars, LoopFlow } from './context';

/** The "propose_create" step of the agent loop. */
export async function handleWriteFile(ctx: RunContext, { assistantText, parsed, payload }: Pick<StepVars, 'assistantText' | 'parsed' | 'payload'>): Promise<LoopFlow> {
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
    const previousStep = ctx.rejectedWrites.get(rejectionSig);
    ctx.rejectedWrites.set(rejectionSig, ctx.stepCount);
    ctx.stepsWithoutProgress++;
    let text = observation;
    if (previousStep !== undefined) {
      ctx.repeatStreak++;
      text += ` You already sent exactly this content at step ${previousStep} and it was rejected for the same reason.${ctx.repeatNudge()}`;
    } else {
      ctx.consecutiveErrors++;
    }
    ctx.notice(noticeText, 'rejected', et('fileCheckTitle'));
    ctx.pushExchange(assistantText, parsed.rawJson, text);
  };

  if (exists && isProtectedTestFile(filePath, ctx.userRequestText())) {
    rejectWrite(
      et('writeRefusedTests', { path: filePath }),
      `[NOT WRITTEN]: "${filePath}" is an existing test file. The tests define the expected behaviour — change the code so that they pass; do not rewrite the tests (only the user may ask for that).`
    );
    return 'continue';
  }

  if (isEmptyWrite(parsed) && !EMPTY_FILE_INTENT.test(ctx.userRequestText())) {
    const pageHint = /\.html?$/i.test(filePath)
      ? ' — the whole page: <!DOCTYPE html>, <head> with <meta name="viewport"> and a <style> block with the CSS, <body> with the real content, and a <script> with the JavaScript it needs'
      : '';
    rejectWrite(
      et('writeRefusedEmpty', { path: filePath }),
      `[NOT WRITTEN]: "content" was empty. write_file must contain the COMPLETE text of "${filePath}"${pageHint}. Send write_file again with the full content.${ctx.acceptanceNote()}`
    );
    return 'continue';
  }

  if (
    currentContent !== null &&
    currentContent.trim() !== '' &&
    currentContent.trim() !== content.trim() &&
    looksLikeStatusMessage(content, ctx.userRequestText())
  ) {
    const message = content.trim().slice(0, 120);
    rejectWrite(
      et('writeRefusedStatus', { path: filePath, message }),
      `[NOT WRITTEN]: "${message}" is a status message for the user, not content of "${filePath}"; the file keeps its current content. If the task is done, reply with finish and put this message in "summary".`
    );
    return 'continue';
  }

  const lazy = detectLazyPlaceholder(content, currentContent);
  if (lazy) {
    rejectWrite(
      et('writeRefusedPlaceholder', { path: filePath, placeholder: lazy }),
      `[NOT WRITTEN]: the content contains the placeholder "${lazy}" instead of real code. Send the COMPLETE file content in write_file.`
    );
    return 'continue';
  }

  const formatError = strictFormatError(filePath, content);
  if (formatError && (currentContent === null || strictFormatError(filePath, currentContent) === null)) {
    rejectWrite(
      et('writeRefusedJson', { path: filePath, error: formatError }),
      `[NOT WRITTEN]: the new content of "${filePath}" is not valid JSON — ${formatError}. The file was left unchanged. Fix that line and send the complete, valid JSON document.`
    );
    return 'continue';
  }

  // Config rewrites that forget existing keys ("scripts.test", "name") are merged additively,
  // so even small models can "add a script" without destroying package.json.
  if (exists && currentContent !== null && !REMOVAL_INTENT.test(ctx.userRequestText())) {
    const merged = mergeJsonPreservingKeys(filePath, currentContent, content);
    if (merged) {
      content = merged.content;
      sanitized.notes.push(`kept existing keys the rewrite had dropped (${merged.kept.slice(0, 10).join(', ')})`);
    }
  }

  if (exists && currentContent !== null && !REMOVAL_INTENT.test(ctx.userRequestText()) && !REWRITE_INTENT.test(ctx.userRequestText())) {
    const destructive = detectDestructiveRewrite(filePath, currentContent, content);
    if (destructive) {
      rejectWrite(
        et('writeRefusedDestructive', { path: filePath, detail: destructive }),
        `[NOT WRITTEN]: write_file replaces the WHOLE file, and ${destructive}. To add or change a part, use edit_file: put an existing anchor line in "find" (for example "</body>" or the end of a function) and the anchor plus your new code in "replace". Otherwise send the complete updated file.`
      );
      return 'continue';
    }
  }

  if (exists && currentContent !== null && !REMOVAL_INTENT.test(ctx.userRequestText())) {
    const dropped = jsonKeyLoss(filePath, ctx.originalSnapshots.get(filePath) ?? currentContent, content);
    if (dropped.length > 0) {
      rejectWrite(
        et('writeRefusedKeys', { path: filePath, keys: dropped.join(', ') }),
        `[NOT WRITTEN]: this rewrite of "${filePath}" would delete existing keys: ${dropped.join(', ')}. Keep everything that is already there and only add or change what the task needs. Current content:\n${wrapUntrustedFileContent(filePath, currentContent.slice(0, 6000))}\nUse edit_file for a small change, or write_file with the complete merged document.`
      );
      return 'continue';
    }
  }

  if (exists && currentContent !== null && currentContent !== content) {
    const damage = damageFromChange(filePath, currentContent, content);
    if (damage.length > 0) {
      const times = ctx.countRefusal(filePath, damage);
      // rejectWrite counts an identical resend; a different version with the same fault counts here.
      if (times >= 2 && !ctx.rejectedWrites.has(rejectionSig)) ctx.repeatStreak++;
      rejectWrite(
        et('writeRefusedDamage', { path: filePath, problem: damage[0].message.slice(0, 160) }),
        `[NOT WRITTEN]: the new content would break "${filePath}", so the file is unchanged. The automatic check would report:\n${formatSanityIssues(damage)}${ctx.issueExcerpt(content, damage, 'Your version would read at')}\nSend the complete file again with these problems fixed.${
          times >= 2 ? ctx.repeatedRefusalHelp(filePath, currentContent, damage, times, 'write') : ''
        }`
      );
      return 'continue';
    }
  }

  if (exists && currentContent === content) {
    ctx.repeatStreak++;
    ctx.stepsWithoutProgress++;
    if (ctx.mutationCount > 0) ctx.noopResends++;
    ctx.notice(et('writeNoChange', { path: filePath }), 'rejected');
    ctx.pushExchange(
      assistantText,
      parsed.rawJson,
      `[NO CHANGE]: "${filePath}" already contains exactly this content.${ctx.acceptanceNote()}${ctx.repeatNudge() || ' Continue with the next part of the task or finish.'}`
    );
    return 'continue';
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
  const approved = await ctx.requestApproval(
    changesetItem,
    exists ? et('rewriteAutoTitle') : et('createAutoTitle'),
    exists ? et('rewriteProposalTitle') : et('createProposalTitle'),
    `${et(exists ? 'rewriteDetail' : 'createDetail', { path: filePath, lines: lineCount(content) })}${
      sanitized.notes.length ? et('autoFixed', { notes: sanitized.notes.join(', ') }) : ''
    }`
  );
  if (!approved) {
    ctx.stepsWithoutProgress++;
    ctx.callbacks.onStep({
      id: `step_rej_${Date.now()}`,
      timestamp: Date.now(),
      type: 'tool_result',
      toolName: 'propose_create',
      content: et('writeRejectedByUser'),
      status: 'rejected',
    });
    ctx.pushExchange(assistantText, parsed.rawJson, `[REJECTED BY USER]: the user did not approve writing "${filePath}". Choose a different approach or ask the user.`);
    return 'continue';
  }

  const result = await ctx.applyMutation({ filePath, exists, baseHash: readRes?.hash || '', newContent: content });
  if (!result.ok) {
    ctx.consecutiveErrors++;
    ctx.callbacks.onStep({
      id: `step_apply_fail_${Date.now()}`,
      timestamp: Date.now(),
      type: 'tool_result',
      toolName: 'propose_create',
      content: et('writeFailed', { error: String(result.error) }),
      status: 'failed',
    });
    ctx.pushExchange(assistantText, parsed.rawJson, `[ERROR]: could not write "${filePath}": ${result.error}`);
    return 'continue';
  }

  ctx.consecutiveErrors = 0;
  ctx.repeatStreak = 0;
  ctx.ledger.appliedChanges.push(`${exists ? 'Rewritten' : 'Created'}: "${filePath}"`);
  ctx.ledger.milestones.push({
    id: `m_cr_${Date.now()}`,
    description: `${exists ? 'File rewritten' : 'File created'}: ${filePath}`,
    status: 'done',
    timestamp: Date.now(),
  });
  ctx.callbacks.onStep({
    id: `step_apply_${Date.now()}`,
    timestamp: Date.now(),
    type: 'tool_result',
    toolName: 'propose_create',
    content: et(exists ? 'fileRewritten' : 'fileCreated', { path: filePath, lines: lineCount(content), size: formatKb(content.length) }),
    status: 'success',
  });
  if (!ctx.originalSnapshots.has(filePath)) ctx.originalSnapshots.set(filePath, currentContent);
  // A full rewrite starts the file's edit history over.
  for (const sig of Array.from(ctx.appliedEdits.keys())) if (sig.startsWith(`${filePath}:`)) ctx.appliedEdits.delete(sig);
  const verdict = await ctx.afterMutation(filePath, content, currentContent);
  const baseline = ctx.originalSnapshots.get(filePath);
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
  ctx.pushExchange(assistantText, parsed.rawJson, observation);
  return 'continue';
}
