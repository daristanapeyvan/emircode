import { checkCommand } from '../../../../electron/commandPolicy';
import { findErrorLocation, hostPlatform, looksLikeUsageText, numberedLines } from '../engineHelpers';
import { format, getTranslations } from '../../localization/i18n';
import { useSettingsStore } from '@/stores/settingsStore';
import { en } from '../../localization/translations/en';
import { CommandApprovalItem } from '@/types/agent';
import { et } from '../engineText';
import type { RunContext, StepVars, LoopFlow } from './context';

/** The "propose_command" step of the agent loop. */
export async function handleRunCommand(ctx: RunContext, { assistantText, parsed, payload }: Pick<StepVars, 'assistantText' | 'parsed' | 'payload'>): Promise<LoopFlow> {
  const binary: string = payload.binary;
  const args: string[] = payload.args || [];
  const cmdKey = `${binary}:${args.join(' ')}`;
  // The main process enforces the same rules; checking here first means the user is never
  // asked to approve a command that would be refused anyway.
  const policy = checkCommand(binary, args, {
    hasPackageJson: ctx.ledger.projectTree.includes('package.json'),
    platform: hostPlatform(),
  });
  if (!policy.ok) {
    ctx.consecutiveErrors++;
    ctx.stepsWithoutProgress++;
    if (policy.code === 'no_package_json') {
      if (!ctx.ledger.unavailableBinaries.includes(binary)) ctx.ledger.unavailableBinaries.push(binary);
      ctx.pushExchange(
        assistantText,
        parsed.rawJson,
        `[NOT APPLICABLE]: this project has no package.json, so npm has nothing to run here. That is fine — do NOT create a package.json just to run commands. Continue with the task, or finish if it is done.`
      );
      return 'continue';
    }
    ctx.notice(et('commandRefused', { reason: format(getTranslations(useSettingsStore.getState().settings.language).main[policy.key], policy.params) }), 'rejected');
    ctx.pushExchange(
      assistantText,
      parsed.rawJson,
      `[NOT ALLOWED]: ${format(en.main[policy.key], policy.params)} Nothing was run.${ctx.repeatNudge()}`
    );
    return 'continue';
  }
  const previousFailure = ctx.seenActions.get(`cmdfail:${cmdKey}:${ctx.mutationCount}`);
  if (previousFailure) {
    ctx.repeatStreak++;
    ctx.stepsWithoutProgress++;
    ctx.notice(et('commandFailedBefore', { command: `${binary} ${args.join(' ')}` }), 'rejected');
    ctx.pushExchange(
      assistantText,
      parsed.rawJson,
      `[REPEATED]: "${binary} ${args.join(' ')}" already failed at step ${previousFailure.step} and no file changed since. Fix the code first or take another approach.${ctx.repeatNudge()}`
    );
    return 'continue';
  }
  // Running a CLI program without arguments always prints its usage text; models took that
  // for a bug and kept "fixing" working code until they broke it.
  const usageRun = ctx.seenActions.get(`usage:${cmdKey}`);
  if (usageRun) {
    ctx.repeatStreak++;
    ctx.stepsWithoutProgress++;
    ctx.notice(et('commandUsageAgain', { command: `${binary} ${args.join(' ')}` }), 'rejected');
    ctx.pushExchange(
      assistantText,
      parsed.rawJson,
      `[ALREADY TESTED]: "${binary} ${args.join(' ')}" was run at step ${usageRun.step} and printed its usage text. That is the correct behaviour of a command-line program started without arguments, so running it again shows nothing new. Run it WITH arguments that match its usage line to test a feature, or finish if the task is complete.${ctx.repeatNudge()}`
    );
    return 'continue';
  }
  // A script that changes files does it again on every run: in the app, qwen2.5-coder:7b applied
  // its rename script to the sample folder five times ("deniz_001_001_001_001_001.JPG"), each time
  // calling it a preview. The same apply command is not run again until a file changes.
  // Its preview of the same folder afterwards is misleading too: it proposes renaming the renamed
  // files, which the model took for "not done yet" and started over in ornek_veri2, ornek_veri3...
  const applyFlag = ctx.runOptions.applyFlag;
  const applyKey = applyFlag ? `${binary}:${args.filter((a) => a !== applyFlag).join(' ')}:${ctx.mutationCount}` : '';
  const earlierApply = applyFlag ? ctx.appliedRuns.get(applyKey) : undefined;
  if (earlierApply) {
    ctx.repeatStreak++;
    ctx.stepsWithoutProgress++;
    const again = args.includes(applyFlag!);
    ctx.notice(
      again
        ? et('commandApplyAgain', { command: `${binary} ${args.join(' ')}` })
        : et('commandPreviewAfterApply', { step: earlierApply.step, flag: String(applyFlag) }),
      'rejected'
    );
    const shown = earlierApply.output.length > 1500 ? `...\n${earlierApply.output.slice(-1500)}` : earlierApply.output;
    ctx.pushExchange(
      assistantText,
      parsed.rawJson,
      `[NOT RUN]: ${
        again
          ? `"${binary} ${args.join(' ')}" already ran successfully with ${applyFlag} and no file changed since. Running it again would change the files again (a rename renames the renamed files), so it was not run.`
          : `"${binary} ${args.join(' ')}" previews a folder that the same command with ${applyFlag} already changed at step ${earlierApply.step}, and no file changed since. A preview now would only propose changing the changed files again (renaming the renamed files), so it was not run.`
      } The run with ${applyFlag} printed:\n${shown || '(no output)'}\nIf that is what the task expects, mark the checklist item done and finish now. If not, fix the script and test it on a fresh copy of the sample data.${ctx.repeatNudge()}`
    );
    return 'continue';
  }

  // What "npm test" / "npm run build" really runs is the script in package.json: the user sees it.
  let script: string | undefined;
  if (binary === 'npm') {
    const scriptName = args[0] === 'run' ? args[1] : 'test';
    const pkgRes = await window.electronAPI?.readWorkspaceFile('package.json');
    if (pkgRes?.success && pkgRes.content) {
      try {
        const value = JSON.parse(pkgRes.content)?.scripts?.[scriptName];
        if (typeof value === 'string') script = value.slice(0, 500);
      } catch {
        // an invalid package.json: npm reports it when it runs
      }
    }
  }
  // Where it will run: in the isolated environment (only the project folder, no network unless
  // allowed) or not, and why not.
  const isolation = useSettingsStore.getState().settings.commandIsolation || { enabled: true, network: false };
  const isolationPlan = await Promise.resolve(window.electronAPI?.planCommand?.(binary, args, isolation)).catch(() => undefined);
  const isolated = !!isolationPlan?.isolated;
  const cmdItem: CommandApprovalItem = {
    id: `cmd_${Date.now()}`,
    binary,
    args,
    reason: String(parsed.rawJson?.thought || payload.reason || '').slice(0, 300),
    script,
    isolated,
    isolationNote: isolated ? et(isolation.network ? 'isolatedWithNetwork' : 'isolatedNoNetwork') : isolationPlan?.reasonText,
  };
  const isSafeCommand =
    (binary === 'npm' && (args[0] === 'test' || (args[0] === 'run' && args[1] === 'test'))) ||
    binary === 'pytest' ||
    (binary === 'cargo' && args[0] === 'test');
  // In the autonomous profile a command that runs isolated starts on its own. Outside the isolated
  // environment only a test command does, and only while this run has written no code or command
  // settings (the test would run what the model just wrote); otherwise the user decides.
  const isAutoApprove = ctx.securityProfile === 'autonomous' && (isolated || (isSafeCommand && !ctx.wroteRunnableFile));
  let approved = false;
  if (isAutoApprove) {
    approved = true;
    ctx.callbacks.onStep({
      id: `step_cmd_pr_${Date.now()}`,
      timestamp: Date.now(),
      type: 'command_proposal',
      title: et('commandAutoTitle'),
      content: `${et('commandAutoApproved', { command: `${binary} ${args.join(' ')}` })}${cmdItem.isolationNote ? ` ${cmdItem.isolationNote}` : ''}`,
      status: 'approved',
    });
  } else {
    ctx.callbacks.onStep({
      id: `step_cmd_pr_${Date.now()}`,
      timestamp: Date.now(),
      type: 'command_proposal',
      title: et('commandApprovalTitle'),
      content: `${et('commandApprovalRequest', { command: `${binary} ${args.join(' ')}` })}${cmdItem.reason ? et('reasonSuffix', { reason: cmdItem.reason }) : ''}`,
      status: 'pending',
    });
    ctx.callbacks.onStatusChange('waiting_command_approval');
    ctx.pauseTimer();
    try {
      approved = await ctx.callbacks.onRequestCommandApproval(cmdItem);
    } finally {
      ctx.resumeTimer();
    }
  }

  if (!approved) {
    ctx.callbacks.onStatusChange('thinking');
    ctx.callbacks.onStep({
      id: `step_cmd_rej_${Date.now()}`,
      timestamp: Date.now(),
      type: 'tool_result',
      toolName: 'propose_command',
      content: et('commandRejectedByUser'),
      status: 'rejected',
    });
    ctx.pushExchange(assistantText, parsed.rawJson, `[REJECTED BY USER]: permission to run "${binary} ${args.join(' ')}" was not given. Continue without it.`);
    return 'continue';
  }

  ctx.callbacks.onStatusChange('running_command');
  ctx.callbacks.onLog(et(isolated ? 'commandRunningIsolated' : 'commandRunning', { command: `${binary} ${args.join(' ')}` }));
  const cmdRes = await window.electronAPI?.runApprovedCommand({ binary, args, timeoutMs: 60000, isolation });
  ctx.callbacks.onStatusChange('thinking');
  const output = `${cmdRes?.output || ''}${cmdRes?.error ? `\n${cmdRes.error}` : ''}`.trim();
  const tail = output.length > 4000 ? `...\n${output.slice(-4000)}` : output;
  let observation: string;
  if (cmdRes?.success) {
    // The same command printing exactly the same thing, with no file changed since, is no
    // progress (a 7B model re-ran a finished script again and again instead of finishing).
    const okKey = `cmdok:${cmdKey}:${ctx.mutationCount}`;
    const sameOutput = ctx.commandOutputs.get(okKey) === output;
    ctx.commandOutputs.set(okKey, output);
    if (applyFlag && args.includes(applyFlag)) ctx.appliedRuns.set(applyKey, { step: ctx.stepCount, output });
    // A script that changes files prints something new on every run, so the output alone does
    // not catch a model that re-applies it over and over (one renamed its test files 30 times).
    const runs = (ctx.commandRuns.get(okKey) || 0) + 1;
    ctx.commandRuns.set(okKey, runs);
    const rerun = runs >= 3;
    ctx.consecutiveErrors = 0;
    // Evidence that the work runs only when the command runs a file the model wrote (not `dir`).
    if ([binary, ...args].some((a) => ctx.writtenByModel.has(ctx.baseName(String(a))))) ctx.programOkAt = ctx.mutationCount;
    if (sameOutput || rerun) {
      ctx.repeatStreak++;
      ctx.stepsWithoutProgress++;
    } else {
      ctx.repeatStreak = 0;
      ctx.stepsWithoutProgress = 0;
    }
    observation = `[COMMAND OK] (exit code 0):\n${tail || '(no output)'}${
      sameOutput
        ? `\n[SAME OUTPUT]: the same command printed exactly this before and no file changed since.${ctx.repeatNudge()}`
        : rerun
          ? `\n[ALREADY RUN]: you have run exactly this command ${runs} times since your last file change. Running it again only repeats it (a script that changes files changes them again). If the result is what the task expects, mark the checklist item done and finish now.${ctx.repeatNudge()}`
          : ''
    }`;
    ctx.ledger.milestones.push({
      id: `m_cmd_${Date.now()}`,
      description: `Command ran: ${binary} ${args.join(' ')}`,
      status: 'done',
      timestamp: Date.now(),
    });
    ctx.callbacks.onStep({
      id: `step_cmd_ok_${Date.now()}`,
      timestamp: Date.now(),
      type: 'tool_result',
      toolName: 'propose_command',
      content: tail.slice(0, 2000) || et('commandSucceeded'),
      status: 'success',
    });
  } else {
    const usageText = looksLikeUsageText(output);
    const operands = args.filter((a) => !a.startsWith('-'));
    const bareUsage = usageText && (binary === 'python' || binary === 'node') && operands.length <= 1;
    if (!bareUsage) {
      ctx.consecutiveErrors++;
      ctx.programOkAt = -1;
    }
    ctx.seenActions.set(`cmdfail:${cmdKey}:${ctx.mutationCount}`, { step: ctx.stepCount });
    // The main process says why (cmdRes.code); its texts are in the interface language.
    const notFound =
      (cmdRes?.code === 'spawn_failed' && /ENOENT|not found/i.test(cmdRes?.error || '')) ||
      (cmdRes?.code === 'exit' &&
        output.length < 600 &&
        /is not recognized as an internal or external command|command not found|Python was not found/i.test(output));
    const policyBlocked = cmdRes?.code === 'policy';
    if (cmdRes?.code === 'no_package_json') {
      // A static site or a non-Node project: there is nothing to run, and inventing a
      // package.json just to run "npm test" sent models into long detours.
      if (!ctx.ledger.unavailableBinaries.includes(binary)) ctx.ledger.unavailableBinaries.push(binary);
      observation = `[NOT APPLICABLE]: this project has no package.json, so npm has nothing to run here. That is fine — do NOT create a package.json just to run commands. Continue with the task, or finish if it is done.`;
    } else if (notFound || policyBlocked) {
      if (!ctx.ledger.unavailableBinaries.includes(binary) && notFound) ctx.ledger.unavailableBinaries.push(binary);
      observation = `[COMMAND UNAVAILABLE]: "${binary} ${args.join(' ')}" cannot run here (${(cmdRes?.error || 'not installed').trim().slice(0, 200)}). Do not call it again; continue without it.`;
    } else if (bareUsage) {
      ctx.seenActions.set(`usage:${cmdKey}`, { step: ctx.stepCount });
      observation = `[PROGRAM PRINTED ITS USAGE TEXT] (exit code ${cmdRes?.exitCode ?? '?'}):\n${tail}\nThis is NOT a bug: the program was started without arguments, so it printed how to use it. Do not change the code because of this. To test it, run it with arguments that match the usage line above (one feature per run), or finish if the task is complete.`;
    } else if (usageText) {
      observation = `[PROGRAM PRINTED ITS USAGE TEXT] (exit code ${cmdRes?.exitCode ?? '?'}):\n${tail}\nThe program did not accept the arguments "${operands.slice(1).join(' ')}". If they are valid for this task, fix the argument handling in the code; otherwise run it again with arguments that match the usage line.`;
    } else {
      // Numbered lines at the failing location let the model fix it with replace_lines.
      let excerpt = '';
      const location = findErrorLocation(output, ctx.ledger.projectTree);
      if (location) {
        const fileRes = await window.electronAPI?.readWorkspaceFile(location.path);
        if (fileRes?.success && fileRes.content !== undefined) {
          excerpt = `\nThe error points at line ${location.line} of "${location.path}":\n${numberedLines(fileRes.content, location.line - 3, location.line + 5)}\nFix it with replace_lines (use these line numbers) or edit_file.`;
        }
      }
      observation = `[COMMAND FAILED] (exit code ${cmdRes?.exitCode ?? '?'}):\n${tail}${excerpt}\nRead the errors, fix the code, then run it again.`;
    }
    ctx.callbacks.onStep({
      id: `step_cmd_fail_${Date.now()}`,
      timestamp: Date.now(),
      type: 'tool_result',
      toolName: 'propose_command',
      content: tail.slice(0, 2000) || et('commandFailed'),
      status: 'failed',
    });
  }
  ctx.pushExchange(assistantText, parsed.rawJson, observation, `[run_command "${binary} ${args.join(' ')}" output shortened]`);
  return 'continue';
}
