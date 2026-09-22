import { OllamaClient } from './OllamaClient';
import { OllamaChatMessage, GenerationOptions } from '@/types/ollama';
import { Message, GenerationMetadata } from '@/types/chat';

export interface StreamCallbacks {
  onToken: (contentDelta: string, thinkingDelta: string) => void;
  onComplete: (metadata: GenerationMetadata) => void;
  onError: (error: Error) => void;
}

export class ChatService {
  private client: OllamaClient;
  private currentAbortController: AbortController | null = null;

  constructor(client: OllamaClient) {
    this.client = client;
  }

  streamChat(
    params: {
      model: string;
      messages: Message[];
      systemPrompt?: string;
      options?: GenerationOptions;
      keepAlive?: string;
    },
    callbacks: StreamCallbacks
  ): () => void {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
    }

    const controller = new AbortController();
    this.currentAbortController = controller;

    // Convert internal messages to OllamaChatMessage
    const ollamaMessages: OllamaChatMessage[] = params.messages.map((m) => {
      const msg: OllamaChatMessage = {
        role: m.role,
        content: m.content,
      };
      if (m.attachments && m.attachments.length > 0) {
        const images: string[] = [];
        let extraText = '';

        for (const att of m.attachments) {
          if (att.isImage) {
            // Strip data:image/...;base64, prefix if present
            const base64Data = att.content.includes(',') ? att.content.split(',')[1] : att.content;
            images.push(base64Data);
          } else {
            extraText += `\n\n[Attached File: ${att.name}]\n\`\`\`\n${att.content}\n\`\`\``;
          }
        }

        if (images.length > 0) {
          msg.images = images;
        }
        if (extraText) {
          msg.content += extraText;
        }
      }
      return msg;
    });

    // Stream from client
    (async () => {
      let isInsideInlineThink = false;

      try {
        await this.client.chatStream(
          {
            model: params.model,
            messages: ollamaMessages,
            options: params.options,
            system: params.systemPrompt,
            keep_alive: params.keepAlive,
          },
          (chunk) => {
            let contentDelta = '';
            let thinkingDelta = '';

            // Handle native thinking chunk (Ollama 0.5+ thinking models like qwen3)
            if (chunk.message?.thinking) {
              thinkingDelta += chunk.message.thinking;
            }

            // Handle content chunk
            if (chunk.message?.content) {
              let rawContent = chunk.message.content;

              // Parse inline <think> tags if model emits them directly
              if (rawContent.includes('<think>')) {
                isInsideInlineThink = true;
                const parts = rawContent.split('<think>');
                contentDelta += parts[0];
                rawContent = parts[1] || '';
              }

              if (isInsideInlineThink) {
                if (rawContent.includes('</think>')) {
                  const parts = rawContent.split('</think>');
                  thinkingDelta += parts[0];
                  contentDelta += parts[1] || '';
                  isInsideInlineThink = false;
                } else {
                  thinkingDelta += rawContent;
                }
              } else {
                contentDelta += rawContent;
              }
            }

            if (contentDelta || thinkingDelta) {
              callbacks.onToken(contentDelta, thinkingDelta);
            }

            // If done chunk, compute measured metadata
            if (chunk.done) {
              const evalCount = chunk.eval_count || 0;
              const evalDurationNs = chunk.eval_duration || 0;
              const totalDurationNs = chunk.total_duration || 0;
              const loadDurationNs = chunk.load_duration || 0;
              const promptEvalCount = chunk.prompt_eval_count || 0;

              let tokensPerSecond = 0;
              if (evalCount > 0 && evalDurationNs > 0) {
                tokensPerSecond = Math.round((evalCount / (evalDurationNs / 1_000_000_000)) * 10) / 10;
              }

              const durationSeconds = totalDurationNs > 0
                ? Math.round((totalDurationNs / 1_000_000_000) * 10) / 10
                : undefined;

              const metadata: GenerationMetadata = {
                evalCount,
                evalDurationNs,
                totalDurationNs,
                loadDurationNs,
                promptEvalCount,
                tokensPerSecond,
                durationSeconds,
              };

              callbacks.onComplete(metadata);
            }
          },
          controller.signal
        );
      } catch (err: any) {
        if (err.name === 'AbortError' || controller.signal.aborted) {
          // Stopped by user, cleanly finish
          callbacks.onComplete({});
        } else {
          callbacks.onError(err);
        }
      } finally {
        if (this.currentAbortController === controller) {
          this.currentAbortController = null;
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }

  stopGeneration() {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
  }

  isGenerating(): boolean {
    return this.currentAbortController !== null;
  }
}
