/**
 * Experimental native tool mode (Settings › Cloud models): the agent's actions go to Claude and GPT
 * as the provider's own tools instead of a JSON answer schema.
 *
 * The agent does not change: its answer schema (one `anyOf` variant per action) becomes one tool
 * per action, the provider's tool call comes back as the same JSON action text the agent already
 * parses, and the agent's history (JSON actions, then the result as the next user message) is
 * rewritten as tool calls and tool results. Approval, file checks and the sandbox stay in the
 * agent's handlers, exactly as with the JSON protocol.
 */
import { sanitizeSchema } from './schema';

export interface ActionTool {
  name: string;
  description: string;
  /** JSON Schema of the tool's input: the action's fields with "thought" first. */
  schema: Record<string, any>;
}

const DESCRIPTIONS: Record<string, string> = {
  list_dir: 'List a folder of the project ("" = the project root).',
  read_file: 'Read a file of the project, optionally a line range.',
  read_files: 'Read several files of the project in one step.',
  write_file: 'Create a file or replace a whole file with its complete content.',
  edit_file: 'Replace one exact, unique snippet of a file.',
  replace_lines: 'Replace a range of lines of a file.',
  search_code: 'Find text in the project files.',
  delete_file: 'Delete a file (the user approves).',
  run_command: 'Run a test or build command in the project folder.',
  git_status: 'Show the uncommitted changes (git status).',
  git_diff: 'Show the uncommitted changes (git diff).',
  web_search: 'Search the web for current documentation.',
  fetch_url: 'Read a web page.',
  ask_user: 'Ask the user a question whose answer only they can give.',
  finish: 'End the task with a summary for the user.',
};

const isObject = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);

/** One tool per action of the agent's answer schema, or null when the format is not such a schema. */
export function actionTools(format: unknown): ActionTool[] | null {
  if (!isObject(format) || !Array.isArray(format.anyOf)) return null;
  const tools: ActionTool[] = [];
  for (const variant of format.anyOf) {
    const name = variant?.properties?.action?.const;
    if (!isObject(variant) || !isObject(variant.properties) || typeof name !== 'string' || !/^[a-z_]{1,64}$/.test(name)) return null;
    const properties = { ...variant.properties };
    delete properties.action;
    const required = Array.isArray(variant.required) ? variant.required.filter((r: string) => r !== 'action') : [];
    tools.push({
      name,
      description: DESCRIPTIONS[name] || `The agent action "${name}".`,
      schema: sanitizeSchema({ type: 'object', properties, required }) as Record<string, any>,
    });
  }
  return tools.length ? tools : null;
}

/** The agent's JSON action of an assistant message, when it names one of the tools. */
export function parseActionMessage(content: unknown, toolNames: string[]): { name: string; input: Record<string, any> } | null {
  if (typeof content !== 'string') return null;
  const text = content.trim();
  if (!text.startsWith('{') || !text.endsWith('}')) return null;
  try {
    const value = JSON.parse(text);
    if (!isObject(value) || typeof value.action !== 'string' || !toolNames.includes(value.action)) return null;
    const { action, ...input } = value;
    return { name: action, input };
  } catch {
    return null;
  }
}

/** Puts a streamed tool call together and writes it as the agent's JSON action. */
export class ActionToolCollector {
  private name: string | null = null;
  private args = '';
  private text = '';

  get active(): boolean {
    return this.name !== null;
  }

  /** The first tool call counts; the agent does one action per step. */
  start(name: string): void {
    if (this.name === null) this.name = name;
  }

  addArguments(chunk: string): void {
    if (this.name !== null) this.args += chunk;
  }

  /** Text the model wrote around its tool call (used as the thought when the call has none). */
  addText(chunk: string): void {
    this.text += chunk;
  }

  get bufferedText(): string {
    return this.text;
  }

  /** `{"thought": …, "action": name, …input}`, or null without a tool call. */
  actionText(): string | null {
    if (this.name === null) return null;
    const raw = this.args.trim() || '{}';
    try {
      const input = JSON.parse(raw);
      const { thought, ...rest } = isObject(input) ? input : {};
      return JSON.stringify({ thought: typeof thought === 'string' && thought ? thought : this.text.trim(), action: this.name, ...rest });
    } catch {
      // Cut off (output limit): hand the agent what there is; its repair of cut JSON takes over.
      const body = raw.startsWith('{') ? raw.slice(1) : raw;
      return `{"action":${JSON.stringify(this.name)}${body.trim() ? `,${body}` : '}'}`;
    }
  }
}

type AnyMessage = Record<string, any>;

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n');
}

/**
 * OpenAI Chat Completions history: an assistant JSON action becomes a tool call, the user message
 * after it (the action's result) becomes the tool's message. Images of a result follow as a user
 * message (tool messages take text only).
 */
export function toOpenAIToolMessages<T extends AnyMessage>(messages: T[], toolNames: string[]): T[] {
  const out: AnyMessage[] = [];
  let n = 0;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const action = m.role === 'assistant' ? parseActionMessage(m.content, toolNames) : null;
    if (!action) {
      out.push(m);
      continue;
    }
    const id = `call_${++n}`;
    out.push({ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name: action.name, arguments: JSON.stringify(action.input) } }] });
    const next = messages[i + 1];
    if (next && next.role === 'user') {
      out.push({ role: 'tool', tool_call_id: id, content: textOf(next.content) || '(no output)' });
      const images = Array.isArray(next.content) ? next.content.filter((p: any) => p?.type === 'image_url') : [];
      if (images.length) out.push({ role: 'user', content: images });
      i++;
    } else {
      out.push({ role: 'tool', tool_call_id: id, content: '(no output)' });
    }
  }
  return out as T[];
}

/**
 * Anthropic Messages history: an assistant JSON action becomes a tool_use block, the user message
 * after it becomes the tool_result (text and images).
 */
export function toAnthropicToolMessages<T extends AnyMessage>(messages: T[], toolNames: string[]): T[] {
  const out: AnyMessage[] = [];
  let n = 0;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const action = m.role === 'assistant' ? parseActionMessage(m.content, toolNames) : null;
    if (!action) {
      out.push(m);
      continue;
    }
    const id = `toolu_${String(++n).padStart(4, '0')}`;
    out.push({ role: 'assistant', content: [{ type: 'tool_use', id, name: action.name, input: action.input }] });
    const next = messages[i + 1];
    if (next && next.role === 'user') {
      const content = Array.isArray(next.content)
        ? next.content.filter((b: any) => b?.type === 'text' || b?.type === 'image')
        : [{ type: 'text', text: String(next.content || '') || '(no output)' }];
      out.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] });
      i++;
    } else {
      out.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: '(no output)' }] }] });
    }
  }
  return out as T[];
}
