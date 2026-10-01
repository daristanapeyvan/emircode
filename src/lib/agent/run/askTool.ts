import { et } from '../engineText';
import type { RunContext, StepVars, LoopFlow } from './context';

/** The "ask_question" step of the agent loop. */
export async function handleAskUser(ctx: RunContext, { assistantText, parsed, payload }: Pick<StepVars, 'assistantText' | 'parsed' | 'payload'>): Promise<LoopFlow> {
  const { question, options } = payload;
  if (ctx.securityProfile === 'autonomous') {
    const chosenOption = options && options.length > 0 ? options[0] : 'the default, most suitable engineering approach';
    ctx.callbacks.onLog(et('autoDecisionLog', { option: chosenOption }));
    ctx.callbacks.onStep({
      id: `step_q_auto_${Date.now()}`,
      timestamp: Date.now(),
      type: 'clarification',
      title: et('autoDecisionTitle'),
      content: et('autoDecisionContent', { option: chosenOption, question }),
      status: 'approved',
      metadata: { options, autoAnswer: chosenOption },
    });
    ctx.ledger.userDecisions.push({ question, answer: chosenOption });
    ctx.pushExchange(assistantText, parsed.rawJson, `[AUTONOMOUS MODE]: questions are disabled; "${chosenOption}" was chosen. Continue the work without asking.`);
    return 'continue';
  }

  const previous = ctx.ledger.userDecisions.find((d) => d.question.trim().toLowerCase() === String(question).trim().toLowerCase());
  if (previous) {
    ctx.repeatStreak++;
    ctx.pushExchange(
      assistantText,
      parsed.rawJson,
      `[ALREADY ANSWERED]: the user answered this question before: "${previous.answer}". Continue with that decision.${ctx.repeatNudge()}`
    );
    return 'continue';
  }

  ctx.callbacks.onStep({
    id: `step_q_${Date.now()}`,
    timestamp: Date.now(),
    type: 'clarification',
    title: et('askingTitle'),
    content: question,
    status: 'pending',
    metadata: { options },
  });
  ctx.callbacks.onStatusChange('waiting_clarification');
  ctx.pauseTimer();
  let answer = '';
  try {
    answer = await ctx.callbacks.onRequestClarification({ id: `q_${Date.now()}`, question, options });
  } finally {
    ctx.resumeTimer();
  }
  // Recorded in the ledger, so the model does not ask the same question again.
  ctx.ledger.userDecisions.push({ question, answer });
  ctx.callbacks.onStatusChange('thinking');
  ctx.callbacks.onStep({
    id: `step_ans_${Date.now()}`,
    timestamp: Date.now(),
    type: 'tool_result',
    toolName: 'ask_question',
    content: et('userAnswer', { answer }),
    status: 'success',
  });
  ctx.consecutiveErrors = 0;
  ctx.repeatStreak = 0;
  ctx.stepsWithoutProgress = 0;
  ctx.pushExchange(assistantText, parsed.rawJson, `[USER ANSWER]: ${answer}`);
  return 'continue';
}
