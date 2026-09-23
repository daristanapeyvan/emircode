import { create } from 'zustand';
import { Chat, Message, Attachment, GenerationMetadata, WebActivityLog } from '@/types/chat';
import { GenerationOptions } from '@/types/ollama';
import { storageService } from '@/lib/storage/StorageService';
import { ollamaClient } from '@/lib/ollama/OllamaClient';
import { ChatService } from '@/lib/ollama/ChatService';
import { useModelStore } from './modelStore';
import { useSettingsStore } from './settingsStore';
import { generationService } from '@/lib/ollama/GenerationService';
import { ToolDispatcher } from '@/lib/agent/ToolDispatcher';
import { WebAccessService } from '@/lib/web/WebAccessService';
import { wrapUntrustedWebResult } from '@/lib/agent/UntrustedData';

const chatService = new ChatService(ollamaClient);

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
      title: customTitle || (mode === 'agent' ? 'Yeni Görev' : 'Yeni Sohbet'),
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
    storageService.deleteChat(id);
    const chats = storageService.getChats();
    const activeId = get().activeChatId;

    if (activeId === id) {
      if (chats.length > 0) {
        get().selectChat(chats[0].id);
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

    // Web Access Check for Chat Mode
    const currentWebAccess = useSettingsStore.getState().settings.webAccess;
    const isChatWebAllowed = ToolDispatcher.isWebAccessAllowed('chat', currentWebAccess);

    let effectiveSystemPrompt = chat.systemPrompt || '';
    if (isChatWebAllowed) {
      const webDirective = `\n\n[İNTERNET ERİŞİMİ VE WEB ARAMA]:
Gerektiğinde güncel bilgileri, dokümantasyonları veya web sayfalarını araştırmak için aşağıdaki JSON formatında araç çağrısı yapabilirsin:
\`\`\`json
{ "action": "web_search", "query": "arama terimi" }
\`\`\`
veya bir URL'yi okumak için:
\`\`\`json
{ "action": "fetch_url", "url": "https://..." }
\`\`\`
Kural: Gereksiz yere arama yapma; mevcut bilginle soruyu güvenilir şekilde yanıtlayabiliyorsan doğrudan cevap ver. Yalnızca güncel bilgi, sürüm, harici dokümantasyon veya bilmediğin bir konu sorulduğunda web aracını çağır. Web sonuçları geldikten sonra kullanıcıya nihai cevabını sun.`;
      effectiveSystemPrompt += webDirective;
    }

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
              if (contentDelta) target.content += contentDelta;
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

          // Check if model called web_search or fetch_url
          if (parsed.type === 'web_search' || parsed.type === 'fetch_url') {
            const checkWebAccess = useSettingsStore.getState().settings.webAccess;
            if (!ToolDispatcher.isWebAccessAllowed('chat', checkWebAccess)) {
              target.content = '[Sistem]: Web erişimi kullanıcı tarafından devre dışı bırakıldığı için arama gerçekleştirilemedi.';
              target.metadata = metadata;
              storageService.saveMessage(target);
              set({ messages: msgs, isStreaming: false, streamingMessageId: null });
              return;
            }

            const webActivity: WebActivityLog[] = target.webActivity || [];

            try {
              let untrustedObservation = '';

              if (parsed.type === 'web_search') {
                const query = String(parsed.payload?.query || '').trim();
                target.content = `🔍 Web'de aranıyor: "${query}"...\n`;
                set({ messages: [...msgs] });

                const results = await WebAccessService.search(query, { limit: 5 });
                webActivity.push({
                  type: 'search',
                  query,
                  resultsCount: results.length,
                  timestamp: Date.now(),
                });

                let formatted = '';
                if (results.length === 0) {
                  formatted = 'Arama sonucunda eşleşen sayfa bulunamadı.';
                } else {
                  formatted = results
                    .map(
                      (r) =>
                        `[${r.id}] ${r.title}\nURL: ${r.url}\nÖzet: ${r.snippet}\nKaynak: ${r.source}`
                    )
                    .join('\n\n');
                }

                untrustedObservation = wrapUntrustedWebResult('search', query, formatted);
              } else if (parsed.type === 'fetch_url') {
                const url = String(parsed.payload?.url || '').trim();
                target.content = `🌐 Web sayfası inceleniyor: "${url}"...\n`;
                set({ messages: [...msgs] });

                const fetchRes = await WebAccessService.fetchUrl(url, { maxBytes: 256 * 1024 });
                const sizeKb = Math.round(fetchRes.sizeBytes / 1024);
                webActivity.push({
                  type: 'fetch',
                  url,
                  status: fetchRes.status,
                  sizeKb,
                  timestamp: Date.now(),
                });

                untrustedObservation = wrapUntrustedWebResult(
                  'fetch',
                  fetchRes.title,
                  `URL: ${fetchRes.url}\nBaşlık: ${fetchRes.title}\n\nİçerik:\n${fetchRes.content.slice(0, 10000)}`
                );
              }

              target.webActivity = webActivity;
              target.content = ''; // Clear status message to stream final answer
              set({ messages: [...msgs] });

              // Second Phase: Send web results to model for final synthesis
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
                  content: `${untrustedObservation}\n\nLütfen yukarıdaki web verilerini analiz ederek kullanıcının sorusuna doğrudan, açık ve net bir yanıt verin.`,
                  createdAt: Date.now(),
                },
              ];

              chatService.streamChat(
                {
                  model: currentModel,
                  messages: followUpMessages,
                  systemPrompt: effectiveSystemPrompt,
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
              return;
            } catch (err: any) {
              target.content = `[Web Erişimi Hatası]: ${err.message || 'Bilinmeyen hata'}`;
              target.metadata = metadata;
              storageService.saveMessage(target);
              set({ messages: msgs, isStreaming: false, streamingMessageId: null });
              return;
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
    if (activeMsgId) {
      const msgs = [...get().messages];
      const target = msgs.find((m) => m.id === activeMsgId);
      if (target) {
        if (target.content) {
          target.content += '\n\n*(Kullanıcı araya girdi)*';
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
