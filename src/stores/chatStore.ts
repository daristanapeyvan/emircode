import { create } from 'zustand';
import { Chat, Message, Attachment, GenerationMetadata, WebActivityLog } from '@/types/chat';
import { GenerationOptions } from '@/types/ollama';
import { storageService } from '@/lib/storage/StorageService';
import { ollamaClient } from '@/lib/ollama/OllamaClient';
import { ChatService } from '@/lib/ollama/ChatService';
import { useModelStore } from './modelStore';
import { useSettingsStore } from './settingsStore';
import { generationService } from '@/lib/ollama/GenerationService';
import { getModelRuntimeInfo, resolveContextLength } from '@/lib/ollama/ModelRuntime';
import { ToolDispatcher } from '@/lib/agent/ToolDispatcher';
import { WebAccessService, WebSearchResult } from '@/lib/web/WebAccessService';
import { format, getTranslations } from '@/lib/localization/i18n';
import { wrapUntrustedWebResult } from '@/lib/agent/UntrustedData';
import {
  detectWebSearchIntent,
  detectKnowledgeRefusal,
  isExplicitWebRequest,
  extractSearchQuery,
  cleanChatContent,
} from '@/lib/web/WebIntentDetector';

const chatService = new ChatService(ollamaClient);
/** The chat texts in the interface language. */
const tChatNow = () => getTranslations(useSettingsStore.getState().settings.language).chat;

/** A task title the app gave by default (in any interface language, and the older Turkish one). */
export function isDefaultTaskTitle(title: string): boolean {
  return [getTranslations('en').chat.defaultTaskTitle, getTranslations('tr').chat.defaultTaskTitle, 'Yeni Görev'].includes(title);
}

/** The web requests of the message being answered; Stop and the next message end them. */
let chatWebController: AbortController | null = null;

interface ChatState {
  chats: Chat[];
  activeChatId: string | null;
  messages: Message[];
  isStreaming: boolean;
  streamingMessageId: string | null;
  attachments: Attachment[];
  searchQuery: string;

  init: () => Promise<void>;
  selectChat: (id: string) => void;
  createNewChat: (model?: string, mode?: 'chat' | 'agent', customTitle?: string) => string;
  deleteChat: (id: string) => void;
  updateChatTitle: (id: string, title: string) => void;
  updateChatOptions: (id: string, options: GenerationOptions) => void;
  updateChatSystemPrompt: (id: string, prompt: string) => void;

  sendMessage: (content: string) => Promise<void>;
  stopStreaming: () => void;
  interruptAndSend: (content: string) => Promise<void>;
  regenerateResponse: () => Promise<void>;

  addAttachment: (attachment: Attachment) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  setSearchQuery: (query: string) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  chats: [],
  activeChatId: null,
  messages: [],
  isStreaming: false,
  streamingMessageId: null,
  attachments: [],
  searchQuery: '',

  init: async () => {
    await storageService.init();
    const chats = storageService.getChats();
    if (chats.length > 0 && chats[0].model) {
      useModelStore.getState().selectModel(chats[0].model);
    }
    // Clean slate on startup: do not pre-select or highlight any conversation
    set({ chats, activeChatId: null, messages: [] });
  },

  selectChat: (id: string) => {
    const chat = storageService.getChat(id);
    if (!chat) return;
    const messages = storageService.getMessages(id);
    set({ activeChatId: id, messages, attachments: [] });
    if (chat.model) {
      useModelStore.getState().selectModel(chat.model);
    }
  },

  createNewChat: (model, mode = 'chat', customTitle) => {
    const currentModel = model || useModelStore.getState().selectedModel || 'qwen3:8b';
    const id = `${mode === 'agent' ? 'agent' : 'chat'}_${Date.now()}`;
    const newChat: Chat = {
      id,
      title: customTitle || (mode === 'agent' ? tChatNow().defaultTaskTitle : tChatNow().defaultChatTitle),
      model: currentModel,
      mode,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    storageService.saveChat(newChat);
    const chats = storageService.getChats();
    set({ chats, activeChatId: id, messages: [], attachments: [] });
    return id;
  },

  deleteChat: (id: string) => {
    const deletedMode = storageService.getChat(id)?.mode ?? 'chat';
    storageService.deleteChat(id);
    const chats = storageService.getChats();
    const activeId = get().activeChatId;

    if (activeId === id) {
      // The next conversation of the same list (Sohbet and Emir Code list different things).
      const next = chats.find((c) => (c.mode ?? 'chat') === deletedMode);
      if (next) {
        set({ chats });
        get().selectChat(next.id);
      } else if (deletedMode === 'agent') {
        set({ chats, activeChatId: null, messages: [] });
      } else {
        get().createNewChat();
      }
    } else {
      set({ chats });
    }
  },

  updateChatTitle: (id: string, title: string) => {
    const chat = storageService.getChat(id);
    if (!chat) return;
    chat.title = title.trim() || 'Conversation';
    storageService.saveChat(chat);
    set({ chats: storageService.getChats() });
  },

  updateChatOptions: (id: string, options: GenerationOptions) => {
    const chat = storageService.getChat(id);
    if (!chat) return;
    chat.options = options;
    storageService.saveChat(chat);
    set({ chats: storageService.getChats() });
  },

  updateChatSystemPrompt: (id: string, systemPrompt: string) => {
    const chat = storageService.getChat(id);
    if (!chat) return;
    chat.systemPrompt = systemPrompt;
    storageService.saveChat(chat);
    set({ chats: storageService.getChats() });
  },

  sendMessage: async (content: string) => {
    let activeId = get().activeChatId;
    if (!activeId) {
      activeId = get().createNewChat();
    }

    let chat = storageService.getChat(activeId);
    if (!chat) return;

    const currentModel = useModelStore.getState().selectedModel || chat.model;
    if (chat.model !== currentModel) {
      chat.model = currentModel;
      storageService.saveChat(chat);
    }

    const currentAttachments = [...get().attachments];
    get().clearAttachments();

    // User Message
    const userMsgId = `msg_${Date.now()}_u`;
    const userMsg: Message = {
      id: userMsgId,
      chatId: activeId,
      role: 'user',
      content: content.trim(),
      attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
      createdAt: Date.now(),
    };

    storageService.saveMessage(userMsg);

    // Auto title if first message
    const isFirstUserMsg = get().messages.filter((m) => m.role === 'user').length === 0;
    if (isFirstUserMsg && useSettingsStore.getState().settings.autoGenerateTitles) {
      const generatedTitle = content.trim().slice(0, 32) + (content.length > 32 ? '...' : '');
      get().updateChatTitle(activeId, generatedTitle);
    }

    // Assistant Message Placeholder
    const assistantMsgId = `msg_${Date.now() + 1}_a`;
    const assistantMsg: Message = {
      id: assistantMsgId,
      chatId: activeId,
      role: 'assistant',
      content: '',
      thinking: '',
      createdAt: Date.now(),
      model: currentModel,
    };

    storageService.saveMessage(assistantMsg);

    const updatedMessages = storageService.getMessages(activeId);
    set({
      messages: updatedMessages,
      isStreaming: true,
      streamingMessageId: assistantMsgId,
    });

    // Resolve generation options
    const resolvedOptions = generationService.resolveOptions(chat.presetId, chat.options);
    const keepAlive = useSettingsStore.getState().settings.keepAlive || '5m';

    // Chat and agent share one context window: an explicit num_ctx avoids Ollama's small default
    // (older turns were silently dropped) and switching modes no longer reloads the model.
    if (!resolvedOptions.num_ctx) {
      try {
        const info = await getModelRuntimeInfo(currentModel);
        const settingsState = useSettingsStore.getState();
        resolvedOptions.num_ctx = resolveContextLength({
          configured: settingsState.settings.agentOptimization?.contextLength,
          profile: settingsState.settings.agentOptimization?.hardwareProfile,
          hardware: settingsState.hardware,
          nativeContext: info.nativeContext,
        });
      } catch {
        // Fall back to the server default when the model cannot be inspected
      }
    }

    // ---- Web access in the chat ----
    const settingsNow = useSettingsStore.getState().settings;
    const tChat = getTranslations(settingsNow.language).chat;
    const isChatWebAllowed = ToolDispatcher.isWebAccessAllowed('chat', settingsNow.webAccess);
    const hasWebIntent = detectWebSearchIntent(content);
    // Stop (or a new message) ends this message's web requests too.
    chatWebController?.abort();
    const webController = new AbortController();
    chatWebController = webController;
    const stillCurrent = () => !webController.signal.aborted && get().streamingMessageId === assistantMsgId;

    let effectiveSystemPrompt = chat.systemPrompt || '';

    // The user asked for a web search, but web access is off: say how to turn it on.
    if (!isChatWebAllowed && isExplicitWebRequest(content)) {
      const msgs = [...get().messages];
      const target = msgs.find((m) => m.id === assistantMsgId);
      if (target) {
        target.content = tChat.webOffExplain;
        storageService.saveMessage(target);
      }
      set({ messages: msgs, isStreaming: false, streamingMessageId: null });
      return;
    }

    const baseSystemPrompt = chat.systemPrompt || '';
    let preflightSearched = false;

    /** A status line in the reply while the app searches or reads a page. */
    const showStatus = (text: string) => {
      if (!stillCurrent()) return;
      set((state) => ({
        messages: state.messages.map((m) => (m.id === assistantMsgId ? { ...m, content: text } : m)),
      }));
    };

    const formatSearchResults = (results: WebSearchResult[]) =>
      results.length === 0
        ? 'The search found no matching pages.'
        : results.map((r) => `[${r.id}] ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet}\nSource: ${r.source}`).join('\n\n');

    /**
     * Searches, then reads the first result page that has text: the answer then rests on a page and
     * not only on two-line snippets. Returns what the model gets, wrapped as untrusted web data.
     */
    const searchAndRead = async (query: string, webActivity: WebActivityLog[]): Promise<string> => {
      showStatus(format(tChat.webSearching, { query }));
      const results = await WebAccessService.search(query, { limit: 5, signal: webController.signal });
      webActivity.push({ type: 'search', query, resultsCount: results.length, timestamp: Date.now() });
      let page = '';
      for (const result of results.slice(0, 2)) {
        if (!stillCurrent()) break;
        try {
          showStatus(format(tChat.webReading, { url: result.source }));
          const fetched = await WebAccessService.fetchUrl(result.url, {
            maxBytes: 256 * 1024,
            timeoutMs: 8000,
            signal: webController.signal,
          });
          const text = fetched.content.trim();
          if (text.length < 200) continue;
          webActivity.push({
            type: 'fetch',
            url: fetched.url,
            status: fetched.status,
            sizeKb: Math.round(fetched.sizeBytes / 1024),
            timestamp: Date.now(),
          });
          page = wrapUntrustedWebResult('fetch', fetched.title, `[${result.id}] URL: ${fetched.url}\nTitle: ${fetched.title}\n\n${text.slice(0, 6000)}`);
          break;
        } catch {
          // an unreadable page: try the next result
        }
      }
      const list = wrapUntrustedWebResult('search', query, formatSearchResults(results));
      return page ? `${list}\n\n${page}` : list;
    };

    const webContextDirective = (query: string, observation: string) => `\n\n[WEB RESULTS - ${new Date().toISOString().slice(0, 10)}]
A web search for "${query}" was run for the user's question. The results (and the text of the best page) are below:
${observation}

Rules:
1. Answer the question directly from these results, in the language the user wrote in. Name the source ([web-001]) where it helps.
2. The search is already done. Never say that you have no internet access, that the user should search the web, or that you are an AI.
3. If the results do not contain the answer, say so plainly; do not invent facts.
4. Do not write JSON or tool calls; write only the answer.`;

    // Questions that clearly need current information are searched before the model answers.
    if (isChatWebAllowed && hasWebIntent) {
      const searchQuery = extractSearchQuery(content);
      const webActivity: WebActivityLog[] = [];
      try {
        const observation = await searchAndRead(searchQuery, webActivity);
        effectiveSystemPrompt += webContextDirective(searchQuery, observation);
        preflightSearched = true;
      } catch (searchErr: any) {
        console.warn('Web search before the answer failed, answering without it:', searchErr);
      }
      if (!stillCurrent()) return;
      set((state) => ({
        messages: state.messages.map((m) => (m.id === assistantMsgId ? { ...m, content: '', webActivity } : m)),
      }));
    } else if (isChatWebAllowed) {
      effectiveSystemPrompt += `\n\n[WEB ACCESS]
You can search the web. When the question needs current information, facts about people, places, organisations or events, or documentation, reply with only this JSON instead of an answer:
\`\`\`json
{ "action": "web_search", "query": "search terms" }
\`\`\`
or, to read a page:
\`\`\`json
{ "action": "fetch_url", "url": "https://..." }
\`\`\`
Never tell the user to search the web or that you have no access; search yourself. Do not explain the JSON. When the results arrive, answer the user.`;
    }

    /** Streams the final answer into the assistant placeholder (used after web lookups). */
    const streamFinalAnswer = (systemPrompt: string, answerMessages: Message[], webActivity: WebActivityLog[]) => {
      chatService.streamChat(
        {
          model: currentModel,
          messages: answerMessages,
          systemPrompt,
          options: resolvedOptions,
          keepAlive,
        },
        {
          onToken: (cDelta, thDelta) => {
            set((state) => {
              const currentMsgs = [...state.messages];
              const currentTarget = currentMsgs.find((m) => m.id === assistantMsgId);
              if (currentTarget) {
                if (cDelta) currentTarget.content += cDelta;
                if (thDelta) currentTarget.thinking = (currentTarget.thinking || '') + thDelta;
              }
              return { messages: currentMsgs };
            });
          },
          onComplete: (finalMetadata: GenerationMetadata) => {
            set((state) => {
              const currentMsgs = [...state.messages];
              const currentTarget = currentMsgs.find((m) => m.id === assistantMsgId);
              if (currentTarget) {
                currentTarget.content = cleanChatContent(currentTarget.content);
                currentTarget.metadata = finalMetadata;
                currentTarget.webActivity = webActivity;
                storageService.saveMessage(currentTarget);
              }
              return {
                messages: currentMsgs,
                isStreaming: false,
                streamingMessageId: null,
              };
            });
            useModelStore.getState().fetchRunning();
          },
          onError: (streamErr: Error) => {
            set((state) => {
              const currentMsgs = [...state.messages];
              const currentTarget = currentMsgs.find((m) => m.id === assistantMsgId);
              if (currentTarget) {
                currentTarget.error = streamErr.message;
                storageService.saveMessage(currentTarget);
              }
              return {
                messages: currentMsgs,
                isStreaming: false,
                streamingMessageId: null,
              };
            });
          },
        }
      );
    };

    // Stream
    chatService.streamChat(
      {
        model: currentModel,
        messages: updatedMessages.filter((m) => m.id !== assistantMsgId),
        systemPrompt: effectiveSystemPrompt,
        options: resolvedOptions,
        keepAlive,
      },
      {
        onToken: (contentDelta, thinkingDelta) => {
          set((state) => {
            const msgs = [...state.messages];
            const target = msgs.find((m) => m.id === assistantMsgId);
            if (target) {
              if (contentDelta) {
                target.content += contentDelta;
                // If model starts generating action JSON, suppress raw JSON from stream
                if (target.content.includes('```json') && target.content.includes('"action"')) {
                  const cleaned = cleanChatContent(target.content);
                  target.content = cleaned || tChat.webSearchingGeneric;
                }
              }
              if (thinkingDelta) target.thinking = (target.thinking || '') + thinkingDelta;
            }
            return { messages: msgs };
          });
        },
        onComplete: async (metadata: GenerationMetadata) => {
          const msgs = [...get().messages];
          const target = msgs.find((m) => m.id === assistantMsgId);
          if (!target) return;

          const rawResponse = target.content;
          const parsed = ToolDispatcher.parseActionFromResponse(rawResponse);
          target.content = cleanChatContent(target.content);

          // The model asked for a web search or a page (web access on, no search before the answer).
          if (parsed.type === 'web_search' || parsed.type === 'fetch_url') {
            if (!ToolDispatcher.isWebAccessAllowed('chat', useSettingsStore.getState().settings.webAccess)) {
              target.content = tChat.webTurnedOff;
              target.metadata = metadata;
              storageService.saveMessage(target);
              set({ messages: msgs, isStreaming: false, streamingMessageId: null });
              return;
            }

            const webActivity: WebActivityLog[] = [...(target.webActivity || [])];
            try {
              let observation = '';
              if (parsed.type === 'web_search') {
                const query = String(parsed.payload?.query || '').trim() || extractSearchQuery(content);
                observation = await searchAndRead(query, webActivity);
              } else {
                const url = String(parsed.payload?.url || '').trim();
                showStatus(format(tChat.webReading, { url }));
                const page = await WebAccessService.fetchUrl(url, { maxBytes: 256 * 1024, signal: webController.signal });
                webActivity.push({
                  type: 'fetch',
                  url: page.url,
                  status: page.status,
                  sizeKb: Math.round(page.sizeBytes / 1024),
                  timestamp: Date.now(),
                });
                observation = wrapUntrustedWebResult('fetch', page.title, `URL: ${page.url}\nTitle: ${page.title}\n\n${page.content.slice(0, 10000)}`);
              }
              if (!stillCurrent()) return;
              set((state) => ({
                messages: state.messages.map((m) => (m.id === assistantMsgId ? { ...m, content: '', webActivity } : m)),
              }));

              // Second phase: the model answers from the web data.
              const followUpMessages: Message[] = [
                ...updatedMessages.filter((m) => m.id !== assistantMsgId),
                {
                  id: `tool_call_${Date.now()}`,
                  chatId: activeId,
                  role: 'assistant',
                  content: rawResponse,
                  createdAt: Date.now(),
                },
                {
                  id: `tool_res_${Date.now()}`,
                  chatId: activeId,
                  role: 'user',
                  content: `${observation}\n\nAnswer my question from the web data above, directly and clearly, in the language I wrote in.`,
                  createdAt: Date.now(),
                },
              ];
              streamFinalAnswer(effectiveSystemPrompt, followUpMessages, webActivity);
              return;
            } catch (err: any) {
              if (!stillCurrent()) return;
              set((state) => {
                const messages = state.messages.map((m) =>
                  m.id === assistantMsgId ? { ...m, content: format(tChat.webFailed, { error: err?.message || String(err) }), metadata, webActivity } : m
                );
                const saved = messages.find((m) => m.id === assistantMsgId);
                if (saved) storageService.saveMessage(saved);
                return { messages, isStreaming: false, streamingMessageId: null };
              });
              return;
            }
          }

          // The model refused or told the user to search online although web access is on:
          // run the search ourselves and answer again with the results.
          const webStillAllowed = ToolDispatcher.isWebAccessAllowed(
            'chat',
            useSettingsStore.getState().settings.webAccess
          );
          if (webStillAllowed && !preflightSearched && detectKnowledgeRefusal(target.content, content)) {
            const query = extractSearchQuery(content);
            const webActivity: WebActivityLog[] = [...(target.webActivity || [])];
            try {
              const observation = await searchAndRead(query, webActivity);
              if (!stillCurrent()) return;
              set((state) => ({
                messages: state.messages.map((m) => (m.id === assistantMsgId ? { ...m, content: '', thinking: '', webActivity } : m)),
              }));
              streamFinalAnswer(
                baseSystemPrompt + webContextDirective(query, observation),
                updatedMessages.filter((m) => m.id !== assistantMsgId),
                webActivity
              );
              return;
            } catch (searchErr: any) {
              console.warn('Web search after a refused answer failed:', searchErr);
              if (!stillCurrent()) return;
              // The refused answer stays (msgs still holds it).
            }
          }

          // Normal response without web tool calls
          target.metadata = metadata;
          storageService.saveMessage(target);
          set({
            messages: msgs,
            isStreaming: false,
            streamingMessageId: null,
          });
          useModelStore.getState().fetchRunning();
        },
        onError: (error: Error) => {
          set((state) => {
            const msgs = [...state.messages];
            const target = msgs.find((m) => m.id === assistantMsgId);
            if (target) {
              target.error = error.message;
              if (!target.content) {
                target.content = `Error: ${error.message}`;
              }
              storageService.saveMessage(target);
            }
            return {
              messages: msgs,
              isStreaming: false,
              streamingMessageId: null,
            };
          });
        },
      }
    );
  },

  stopStreaming: () => {
    chatService.stopGeneration();
    chatWebController?.abort();
    const activeMsgId = get().streamingMessageId;
    if (activeMsgId) {
      const msgs = [...get().messages];
      const target = msgs.find((m) => m.id === activeMsgId);
      if (target) {
        storageService.saveMessage(target);
      }
    }
    set({ isStreaming: false, streamingMessageId: null });
  },

  interruptAndSend: async (content: string) => {
    const activeMsgId = get().streamingMessageId;
    chatService.stopGeneration();
    chatWebController?.abort();
    if (activeMsgId) {
      const msgs = [...get().messages];
      const target = msgs.find((m) => m.id === activeMsgId);
      if (target) {
        if (target.content) {
          target.content += `\n\n${tChatNow().interruptedMark}`;
        }
        storageService.saveMessage(target);
      }
    }
    set({ isStreaming: false, streamingMessageId: null });
    await get().sendMessage(content);
  },

  regenerateResponse: async () => {
    const activeId = get().activeChatId;
    if (!activeId) return;

    const msgs = [...get().messages];
    if (msgs.length === 0) return;

    const lastMsg = msgs[msgs.length - 1];
    if (lastMsg.role === 'assistant') {
      // Remove last assistant message
      storageService.deleteMessage(lastMsg.id);
      msgs.pop();
    }

    const lastUserMsg = msgs[msgs.length - 1];
    if (lastUserMsg && lastUserMsg.role === 'user') {
      // Re-send
      set({ messages: msgs });
      const prompt = lastUserMsg.content;
      // Temporarily remove user message so sendMessage doesn't duplicate
      storageService.deleteMessage(lastUserMsg.id);
      await get().sendMessage(prompt);
    }
  },

  addAttachment: (attachment: Attachment) => {
    set((state) => ({ attachments: [...state.attachments, attachment] }));
  },

  removeAttachment: (id: string) => {
    set((state) => ({
      attachments: state.attachments.filter((a) => a.id !== id),
    }));
  },

  clearAttachments: () => {
    set({ attachments: [] });
  },

  setSearchQuery: (searchQuery: string) => {
    set({ searchQuery });
  },
}));
