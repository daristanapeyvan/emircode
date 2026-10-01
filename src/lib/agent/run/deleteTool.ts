import { ChangesetItem } from '@/types/agent';
import { et } from '../engineText';
import type { RunContext, StepVars, LoopFlow } from './context';

/** The "propose_delete" step of the agent loop. */
export async function handleDeleteFile(ctx: RunContext, { assistantText, parsed, payload }: Pick<StepVars, 'assistantText' | 'parsed' | 'payload'>): Promise<LoopFlow> {
  const filePath: string = payload.path;
  const readRes = await window.electronAPI?.readWorkspaceFile(filePath);
  if (!readRes?.success) {
    ctx.consecutiveErrors++;
    ctx.pushExchange(assistantText, parsed.rawJson, `[ERROR]: "${filePath}" does not exist.`);
    return 'continue';
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
  ctx.callbacks.onStep({
    id: `step_del_warn_${Date.now()}`,
    timestamp: Date.now(),
    type: 'delete_warning',
    title: et('deleteWarningTitle'),
    content: `${et('deleteWarning', { path: filePath })}${deleteItem.reason ? et('reasonSuffix', { reason: deleteItem.reason }) : ''}`,
    status: 'pending',
  });

  // Deletes ALWAYS require user approval in all security profiles
  ctx.callbacks.onStatusChange('waiting_delete_approval');
  ctx.pauseTimer();
  let approved = false;
  try {
    approved = await ctx.callbacks.onRequestDeleteApproval(deleteItem);
  } finally {
    ctx.resumeTimer();
  }
  ctx.callbacks.onStatusChange('thinking');

  if (!approved) {
    ctx.callbacks.onStep({
      id: `step_del_rej_${Date.now()}`,
      timestamp: Date.now(),
      type: 'tool_result',
      toolName: 'propose_delete',
      content: et('deleteRejectedByUser'),
      status: 'rejected',
    });
    ctx.pushExchange(assistantText, parsed.rawJson, `[REJECTED BY USER]: "${filePath}" was not deleted.`);
    return 'continue';
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
    ctx.consecutiveErrors = 0;
    ctx.repeatStreak = 0;
    ctx.stepsWithoutProgress = 0;
    ctx.mutationCount++;
    ctx.treeVersion++;
    ctx.callbacks.onTransactionApplied?.({
      transactionId: tokenRes.token,
      relativePath: filePath,
      operation: 'delete',
      timestamp: Date.now(),
      approvedHash: '',
      baseHash: authenticBaseHash,
    });
    ctx.ledger.projectTree = ctx.ledger.projectTree.filter((p) => p !== filePath);
    ctx.writtenFiles.delete(filePath);
    ctx.ledger.appliedChanges.push(`Deleted: "${filePath}"`);
    delete ctx.ledger.knownFiles[filePath];
    ctx.openSanityIssues.delete(filePath);
    ctx.callbacks.onStep({
      id: `step_del_ok_${Date.now()}`,
      timestamp: Date.now(),
      type: 'tool_result',
      toolName: 'propose_delete',
      content: et('fileDeleted', { path: filePath }),
      status: 'success',
    });
    ctx.pushExchange(assistantText, parsed.rawJson, `[OK]: deleted "${filePath}".`);
  } else {
    ctx.consecutiveErrors++;
    ctx.pushExchange(assistantText, parsed.rawJson, `[ERROR]: could not delete "${filePath}": ${applyRes?.error || tokenRes?.error || 'unknown error'}`);
  }
  return 'continue';
}
