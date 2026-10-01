import { GOAL_REQUIRES_CHANGES, continuesPreviousTask } from '../engineHelpers';
import { et } from '../engineText';
import type { RunContext, StepVars, LoopFlow } from './context';

/** The "finish" step of the agent loop. */
export async function handleFinish(ctx: RunContext, { assistantText, fullResponse, parsed, payload }: Pick<StepVars, 'assistantText' | 'fullResponse' | 'parsed' | 'payload'>): Promise<LoopFlow> {
  const { missing, missingUi } = await ctx.runAcceptanceChecks();
  const sanityProblems = Array.from(ctx.openSanityIssues.entries()).flatMap(([file, issues]) =>
    issues.filter((i) => i.severity === 'error').map((i) => `${file}: ${i.message}`)
  );
  const problems = [...missing, ...sanityProblems];
  const problemsUi = [...missingUi, ...sanityProblems];

  if (problems.length > 0 && ctx.finishPushbacks < 2) {
    ctx.finishPushbacks++;
    ctx.consecutiveErrors = 0;
    ctx.moveTo(['VALIDATING', 'RETRYING', 'EXECUTING'], et('stateChecksFailing'));
    ctx.notice(`${et('finishRefused', { count: problems.length })}\n${problemsUi.map((p) => `• ${p}`).join('\n')}`, 'rejected');
    ctx.pushExchange(
      assistantText,
      parsed.rawJson,
      `[CANNOT FINISH YET]: automatic verification found problems:\n${problems.map((p) => `- ${p}`).join('\n')}\nFix them with the file tools, then call finish again.`
    );
    return 'continue';
  }

  const looksLikeChangeTask =
    GOAL_REQUIRES_CHANGES.test(ctx.goal) || (ctx.runOptions.previousTask && continuesPreviousTask(ctx.goal) ? GOAL_REQUIRES_CHANGES.test(ctx.runOptions.previousTask.request) : false);
  if (ctx.mutationCount === 0 && ctx.finishPushbacks === 0 && looksLikeChangeTask && ctx.stepCount <= 3) {
    ctx.finishPushbacks++;
    ctx.notice(et('finishTooEarly'), 'rejected');
    ctx.pushExchange(
      assistantText,
      parsed.rawJson,
      `[CHECK]: You have not changed any file yet, but the task asks for changes. Do the work first. If the task really needs no change (for example it was only a question), call finish again and put the answer in "summary".`
    );
    return 'continue';
  }

  await ctx.applyDesignTheme();
  if (problems.length > 0) {
    ctx.finalize(payload.summary, 'error', fullResponse, problemsUi);
  } else {
    ctx.finalize(payload.summary, 'finished', fullResponse);
  }
  return 'break';
}
