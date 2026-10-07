import { WorkspaceFileInfo } from '../../../../electron/preload';
import { findClosestPath, formatKb, hashText, isSafePath } from '../engineHelpers';
import { lineCount, lineRangeExcerpt, sanitizeFileContent } from '../AgentProtocol';
import { looksJsonEscaped } from '../TaskValidator';
import { wrapUntrustedFileContent, wrapUntrustedGitOutput, wrapUntrustedSearchResults } from '../UntrustedData';
import { et } from '../engineText';
import type { RunContext, StepVars, LoopFlow } from './context';

/** The "read_directory" step of the agent loop. */
export async function handleListDir(ctx: RunContext, { assistantText, parsed, payload, readOnlySignature }: Pick<StepVars, 'assistantText' | 'parsed' | 'payload' | 'readOnlySignature'>): Promise<LoopFlow> {
  const dirPath = payload.path || '';
  ctx.callbacks.onStep({
    id: `step_dir_${Date.now()}`,
    timestamp: Date.now(),
    type: 'tool_call',
    toolName: 'read_directory',
    toolArgs: { path: dirPath },
    content: et('listingDir', { path: dirPath || et('rootFolder') }),
  });
  const listRes = await window.electronAPI?.listWorkspaceFiles({ subPath: dirPath, maxDepth: 2 });
  let observation: string;
  if (listRes?.success && listRes.files) {
    ctx.consecutiveErrors = 0;
    ctx.repeatStreak = 0;
    const flat: string[] = [];
    const walk = (items: WorkspaceFileInfo[]) => {
      for (const f of items) {
        flat.push(f.isDirectory ? `${f.relativePath}/` : `${f.relativePath}${f.size !== undefined ? ` (${formatKb(f.size)})` : ''}`);
        if (!f.isDirectory && !ctx.ledger.projectTree.includes(f.relativePath)) ctx.ledger.projectTree.push(f.relativePath);
        if (f.children) walk(f.children);
      }
    };
    walk(listRes.files);
    observation = flat.length === 0
      ? `Folder "${dirPath || '.'}" is empty.`
      : `Contents of "${dirPath || '.'}" (${flat.length} entries):\n${flat.slice(0, 200).join('\n')}${flat.length > 200 ? '\n... (truncated)' : ''}`;
    ctx.callbacks.onStep({
      id: `step_dir_res_${Date.now()}`,
      timestamp: Date.now(),
      type: 'tool_result',
      toolName: 'read_directory',
      content: et('listedItems', { count: flat.length }),
      status: 'success',
    });
  } else {
    ctx.consecutiveErrors++;
    ctx.stepsWithoutProgress++;
    if (dirPath && !ctx.ledger.invalidPaths.includes(dirPath)) ctx.ledger.invalidPaths.push(dirPath);
    observation = `[ERROR]: cannot list "${dirPath}": ${listRes?.error || 'folder not found'}. Use "" for the project root.`;
    ctx.callbacks.onStep({
      id: `step_dir_fail_${Date.now()}`,
      timestamp: Date.now(),
      type: 'tool_result',
      toolName: 'read_directory',
      content: et('listFailed', { error: listRes?.error || et('notFound') }),
      status: 'failed',
    });
  }
  const entry = ctx.pushExchange(assistantText, parsed.rawJson, observation, `[list_dir "${dirPath || '.'}" result shortened]`);
  if (readOnlySignature) ctx.seenActions.set(readOnlySignature, { step: ctx.stepCount, entry });
  return 'continue';
}

/** The "read_file" step of the agent loop. */
export async function handleReadFile(ctx: RunContext, { assistantText, parsed, payload }: Pick<StepVars, 'assistantText' | 'parsed' | 'payload'>): Promise<LoopFlow> {
  const filePath: string = payload.path;
  ctx.callbacks.onStep({
    id: `step_read_${Date.now()}`,
    timestamp: Date.now(),
    type: 'tool_call',
    toolName: 'read_file',
    toolArgs: { path: filePath },
    content: et('readingFile', { path: filePath }),
  });
  const readRes = await window.electronAPI?.readWorkspaceFile(filePath);
  if (!(readRes?.success && readRes.content !== undefined)) {
    ctx.consecutiveErrors++;
    ctx.stepsWithoutProgress++;
    if (!ctx.ledger.invalidPaths.includes(filePath)) ctx.ledger.invalidPaths.push(filePath);
    const suggestion = findClosestPath(filePath, ctx.ledger.projectTree);
    const observation = `[ERROR]: "${filePath}" does not exist.${
      suggestion && suggestion !== filePath ? ` Did you mean "${suggestion}"?` : ''
    } If it is a new file, create it with write_file.`;
    ctx.callbacks.onStep({
      id: `step_read_fail_${Date.now()}`,
      timestamp: Date.now(),
      type: 'tool_result',
      toolName: 'read_file',
      content: `${et('fileNotFound', { path: filePath })}${suggestion ? et('didYouMean', { suggestion }) : ''}`,
      status: 'failed',
    });
    ctx.pushExchange(assistantText, parsed.rawJson, observation);
    return 'continue';
  }

  const content = readRes.content;
  const totalLines = lineCount(content);
  const hasRange = payload.startLine !== undefined || payload.endLine !== undefined;
  const signature = `read:${filePath}:${readRes.hash || hashText(content)}:${payload.startLine ?? ''}-${payload.endLine ?? ''}`;
  const seen = ctx.seenActions.get(signature);
  // A file preloaded into the task message (step 0) is served once when the model asks for it: a
  // 7B model that did not take it from the task message asked for it again and again and the task
  // stopped as a loop. After that the usual rule applies ("you already read it at step N").
  if (seen && seen.step !== 0 && ctx.stillVisible(seen.entry)) {
    ctx.repeatStreak++;
    ctx.stepsWithoutProgress++;
    ctx.notice(et('repeatedRead', { path: filePath, step: seen.step }), 'rejected');
    ctx.pushExchange(
      assistantText,
      parsed.rawJson,
      `[REPEATED]: you already read "${filePath}" at step ${seen.step} and it has not changed; its content is above.${ctx.openProblemsFor(
        filePath
      )}${ctx.acceptanceNote()}${ctx.repeatNudge() || ' Continue with the next step (for example edit_file or write_file).'}`
    );
    return 'continue';
  }

  ctx.consecutiveErrors = 0;
  ctx.repeatStreak = 0;
  ctx.stepsWithoutProgress = 0;
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
  if (shown.length > ctx.MAX_READ_CHARS) {
    const cut = shown.slice(0, ctx.MAX_READ_CHARS);
    const shownLines = lineCount(cut);
    shown = cut;
    header += ` — only the first ${shownLines} lines are shown; call read_file with start_line/end_line for the rest`;
  }
  ctx.ledger.knownFiles[filePath] = { size: content.length, lastAction: 'read' };
  const observation = `${header}:\n${wrapUntrustedFileContent(filePath, shown)}`;
  ctx.callbacks.onStep({
    id: `step_read_res_${Date.now()}`,
    timestamp: Date.now(),
    type: 'tool_result',
    toolName: 'read_file',
    content: et('fileRead', { lines: totalLines, size: formatKb(content.length) }),
    status: 'success',
    metadata: { filePath, size: content.length, hash: readRes.hash },
  });
  const entry = ctx.pushExchange(
    assistantText,
    parsed.rawJson,
    observation,
    `[read_file "${filePath}": ${totalLines} lines, content removed from history to save space; read it again if you need it]`
  );
  ctx.seenActions.set(signature, { step: ctx.stepCount, entry });
  return 'continue';
}

/**
 * The "read_files" step (large models): several files in one round trip. Each file follows the
 * read_file rules (decoded escapes, the per-file size limit, "already read and unchanged"); the
 * files together stay within MAX_READ_FILES_CHARS, and what does not fit is named so the model
 * can read it next.
 */
export async function handleReadFiles(ctx: RunContext, { assistantText, parsed, payload }: Pick<StepVars, 'assistantText' | 'parsed' | 'payload'>): Promise<LoopFlow> {
  const requested: string[] = Array.isArray(payload.paths) ? payload.paths : [];
  const limit = Math.max(1, ctx.READ_FILES_MAX || 1);
  const paths = requested.slice(0, limit);
  ctx.callbacks.onStep({
    id: `step_reads_${Date.now()}`,
    timestamp: Date.now(),
    type: 'tool_call',
    toolName: 'read_file',
    toolArgs: { paths },
    content: et('readingFiles', { count: paths.length, paths: paths.join(', ') }),
  });

  const blocks: string[] = [];
  const notes: string[] = [];
  const read: Array<{ path: string; signature: string; lines: number }> = [];
  const repeated: Array<{ path: string; step: number }> = [];
  let budget = Math.max(ctx.MAX_READ_CHARS, ctx.MAX_READ_FILES_CHARS || 0);
  let failed = 0;
  for (const filePath of paths) {
    if (!isSafePath(filePath)) {
      failed++;
      notes.push(`[BLOCKED]: "${filePath}" is not a valid path inside the project.`);
      continue;
    }
    const readRes = await window.electronAPI?.readWorkspaceFile(filePath);
    if (!(readRes?.success && readRes.content !== undefined)) {
      failed++;
      if (!ctx.ledger.invalidPaths.includes(filePath)) ctx.ledger.invalidPaths.push(filePath);
      const suggestion = findClosestPath(filePath, ctx.ledger.projectTree);
      notes.push(`[ERROR]: "${filePath}" does not exist.${suggestion && suggestion !== filePath ? ` Did you mean "${suggestion}"?` : ''}`);
      continue;
    }
    const content = readRes.content;
    const signature = `read:${filePath}:${readRes.hash || hashText(content)}:-`;
    const seen = ctx.seenActions.get(signature);
    if (seen && seen.step !== 0 && ctx.stillVisible(seen.entry)) {
      repeated.push({ path: filePath, step: seen.step });
      continue;
    }
    if (budget <= 0) {
      notes.push(`"${filePath}" was not read: this step's read limit is used up. Read it in the next step.`);
      continue;
    }
    const escaped = looksJsonEscaped(content);
    const source = escaped ? sanitizeFileContent(filePath, content).content : content;
    const sourceLines = lineCount(source);
    const cap = Math.min(ctx.MAX_READ_CHARS, budget);
    let shown = source;
    let header = `"${filePath}" (${sourceLines} lines, ${formatKb(content.length)})${
      escaped ? ' — WARNING: stored with literal \\n and \\" escape sequences; shown decoded. Rewrite it with write_file using real line breaks and quotes' : ''
    }`;
    if (shown.length > cap) {
      shown = shown.slice(0, cap);
      header += ` — only the first ${lineCount(shown)} lines are shown; call read_file with start_line/end_line for the rest`;
    }
    budget -= shown.length;
    ctx.ledger.knownFiles[filePath] = { size: content.length, lastAction: 'read' };
    blocks.push(`${header}:\n${wrapUntrustedFileContent(filePath, shown)}`);
    read.push({ path: filePath, signature, lines: sourceLines });
  }
  if (requested.length > paths.length) {
    notes.push(`Only the first ${paths.length} paths were read (at most ${limit} per step): ${requested.slice(paths.length).map((p) => `"${p}"`).join(', ')} still need reading.`);
  }
  if (repeated.length > 0) {
    notes.push(`Already read and unchanged (content above): ${repeated.map((r) => `"${r.path}" (step ${r.step})`).join(', ')}.`);
  }

  if (read.length === 0) {
    // Nothing new: the same bookkeeping as a failed or repeated read_file.
    if (repeated.length > 0 && failed === 0) {
      ctx.repeatStreak++;
      ctx.stepsWithoutProgress++;
      ctx.notice(et('repeatedRead', { path: repeated.map((r) => r.path).join(', '), step: repeated[0].step }), 'rejected');
      ctx.pushExchange(
        assistantText,
        parsed.rawJson,
        `[REPEATED]: ${notes.join(' ')}${ctx.acceptanceNote()}${ctx.repeatNudge() || ' Continue with the next step (for example edit_file or write_file).'}`
      );
    } else {
      ctx.consecutiveErrors++;
      ctx.stepsWithoutProgress++;
      ctx.callbacks.onStep({
        id: `step_reads_fail_${Date.now()}`,
        timestamp: Date.now(),
        type: 'tool_result',
        toolName: 'read_file',
        content: et('filesNotRead', { count: paths.length }),
        status: 'failed',
      });
      ctx.pushExchange(assistantText, parsed.rawJson, `${notes.join('\n')}\nIf a file is new, create it with write_file.`);
    }
    return 'continue';
  }

  ctx.consecutiveErrors = 0;
  ctx.repeatStreak = 0;
  ctx.stepsWithoutProgress = 0;
  const observation = [...blocks, ...notes].join('\n\n');
  ctx.callbacks.onStep({
    id: `step_reads_res_${Date.now()}`,
    timestamp: Date.now(),
    type: 'tool_result',
    toolName: 'read_file',
    content: et('filesRead', { count: read.length, lines: read.reduce((sum, r) => sum + r.lines, 0) }),
    status: failed > 0 ? 'failed' : 'success',
  });
  const entry = ctx.pushExchange(
    assistantText,
    parsed.rawJson,
    observation,
    `[read_files ${read.map((r) => `"${r.path}"`).join(', ')}: content removed from history to save space; read a file again if you need it]`
  );
  for (const r of read) ctx.seenActions.set(r.signature, { step: ctx.stepCount, entry });
  return 'continue';
}

/** The "search_code" step of the agent loop. */
export async function handleSearchCode(ctx: RunContext, { assistantText, parsed, payload, readOnlySignature }: Pick<StepVars, 'assistantText' | 'parsed' | 'payload' | 'readOnlySignature'>): Promise<LoopFlow> {
  const query: string = payload.query;
  ctx.callbacks.onStep({
    id: `step_srch_${Date.now()}`,
    timestamp: Date.now(),
    type: 'tool_call',
    toolName: 'search_code',
    toolArgs: { query },
    content: et('searchingCode', { query }),
  });
  // A failing search is a tool error the model can work around, never the end of the run
  // (the main process of v1.7.0 and earlier had no handler for it: every search_code crashed the task).
  const searchRes = await Promise.resolve(window.electronAPI?.searchWorkspaceCode(query)).catch((err: any) => ({
    success: false as const,
    matches: undefined,
    error: String(err?.message || err).replace(/^Error invoking remote method '[^']+': /, ''),
  }));
  let observation: string;
  if (searchRes?.success && searchRes.matches) {
    ctx.consecutiveErrors = 0;
    ctx.repeatStreak = 0;
    ctx.stepsWithoutProgress = 0;
    const lines = searchRes.matches
      .slice(0, 60)
      .map((m) => `${m.relativePath}:${m.lineNumber}: ${m.lineContent.trim().slice(0, 200)}`);
    observation = wrapUntrustedSearchResults(
      query,
      lines.length > 0
        ? `${lines.join('\n')}${searchRes.matches.length > 60 ? `\n... ${searchRes.matches.length - 60} more matches` : ''}`
        : 'No matches.'
    );
    ctx.callbacks.onStep({
      id: `step_srch_res_${Date.now()}`,
      timestamp: Date.now(),
      type: 'tool_result',
      toolName: 'search_code',
      content: et('matchesFound', { count: searchRes.matches.length }),
      status: 'success',
    });
  } else {
    ctx.consecutiveErrors++;
    ctx.stepsWithoutProgress++;
    observation = `[ERROR]: search failed: ${searchRes?.error || 'unknown error'}. Use list_dir and read_file instead.`;
  }
  const entry = ctx.pushExchange(assistantText, parsed.rawJson, observation, `[search_code "${query}" result shortened]`);
  if (readOnlySignature) ctx.seenActions.set(readOnlySignature, { step: ctx.stepCount, entry });
  return 'continue';
}

/** The "read_git_status" / "read_git_diff" step of the agent loop. */
export async function handleGit(ctx: RunContext, { assistantText, parsed, readOnlySignature }: Pick<StepVars, 'assistantText' | 'parsed' | 'readOnlySignature'>): Promise<LoopFlow> {
  const gitAction = parsed.type === 'read_git_status' ? 'status' : 'diff';
  ctx.callbacks.onStep({
    id: `step_git_${Date.now()}`,
    timestamp: Date.now(),
    type: 'tool_call',
    toolName: parsed.type,
    content: et('gitReading', { action: gitAction }),
  });
  const gitRes = await window.electronAPI?.readGit(gitAction);
  let observation: string;
  if (gitRes?.success) {
    ctx.consecutiveErrors = 0;
    ctx.repeatStreak = 0;
    observation = wrapUntrustedGitOutput(gitAction, (gitRes.output || '(clean working tree)').slice(0, 8000));
    ctx.callbacks.onStep({
      id: `step_git_res_${Date.now()}`,
      timestamp: Date.now(),
      type: 'tool_result',
      toolName: parsed.type,
      content: gitRes.output ? et('gitRead', { action: gitAction }) : et('gitClean'),
      status: 'success',
    });
  } else {
    ctx.consecutiveErrors++;
    if (!ctx.ledger.unavailableBinaries.includes('git')) ctx.ledger.unavailableBinaries.push('git');
    observation = `[ERROR]: git failed: ${gitRes?.error || 'unknown error'}. Do not call git tools again.`;
  }
  const entry = ctx.pushExchange(assistantText, parsed.rawJson, observation, `[git ${gitAction} result shortened]`);
  if (readOnlySignature) ctx.seenActions.set(readOnlySignature, { step: ctx.stepCount, entry });
  return 'continue';
}
