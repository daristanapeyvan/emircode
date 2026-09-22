import { Chat, Message } from '@/types/chat';
import { AppSettings, DEFAULT_SETTINGS } from '@/types/settings';
import { GenerationPreset, SystemPromptPreset, DEFAULT_PRESETS, DEFAULT_SYSTEM_PROMPTS } from '@/types/presets';

export interface StorageData {
  version: number;
  chats: Chat[];
  messages: Message[];
  presets: GenerationPreset[];
  systemPrompts: SystemPromptPreset[];
  settings: AppSettings;
  lastWorkspaceRoot?: string;
  lastWorkspaceName?: string;
}

const STORAGE_VERSION = 1;
const LOCAL_STORAGE_KEY = 'local_llm_desktop_data';

export class StorageService {
  private data: StorageData = {
    version: STORAGE_VERSION,
    chats: [],
    messages: [],
    presets: DEFAULT_PRESETS,
    systemPrompts: DEFAULT_SYSTEM_PROMPTS,
    settings: DEFAULT_SETTINGS,
  };

  private isLoaded = false;
  private saveDebounceTimer: any = null;

  async init(): Promise<StorageData> {
    if (this.isLoaded) return this.data;

    try {
      let rawJson: string | null = null;
      if (window.electronAPI?.loadStorage) {
        rawJson = await window.electronAPI.loadStorage();
      } else {
        rawJson = localStorage.getItem(LOCAL_STORAGE_KEY);
      }

      if (rawJson) {
        const parsed = JSON.parse(rawJson);
        this.data = {
          version: parsed.version || STORAGE_VERSION,
          chats: parsed.chats || [],
          messages: parsed.messages || [],
          presets: parsed.presets || DEFAULT_PRESETS,
          systemPrompts: parsed.systemPrompts || DEFAULT_SYSTEM_PROMPTS,
          settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
          lastWorkspaceRoot: parsed.lastWorkspaceRoot,
          lastWorkspaceName: parsed.lastWorkspaceName,
        };
      }
    } catch (err) {
      console.error('Failed to initialize storage:', err);
    }

    this.isLoaded = true;
    return this.data;
  }

  getLastWorkspace(): { rootPath?: string; folderName?: string } {
    return {
      rootPath: this.data.lastWorkspaceRoot,
      folderName: this.data.lastWorkspaceName,
    };
  }

  setLastWorkspace(rootPath?: string, folderName?: string) {
    this.data.lastWorkspaceRoot = rootPath;
    this.data.lastWorkspaceName = folderName;
    this.save();
  }


  getData(): StorageData {
    return this.data;
  }

  async save(): Promise<void> {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }

    this.saveDebounceTimer = setTimeout(async () => {
      try {
        const json = JSON.stringify(this.data);
        if (window.electronAPI?.saveStorage) {
          await window.electronAPI.saveStorage(json);
        } else {
          localStorage.setItem(LOCAL_STORAGE_KEY, json);
        }
      } catch (err) {
        console.error('Failed to persist storage:', err);
      }
    }, 250);
  }

  // Chats
  getChats(): Chat[] {
    return [...this.data.chats].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getChat(id: string): Chat | undefined {
    return this.data.chats.find((c) => c.id === id);
  }

  saveChat(chat: Chat) {
    const idx = this.data.chats.findIndex((c) => c.id === chat.id);
    if (idx >= 0) {
      this.data.chats[idx] = { ...chat, updatedAt: Date.now() };
    } else {
      this.data.chats.unshift({ ...chat, updatedAt: Date.now() });
    }
    this.save();
  }

  deleteChat(id: string) {
    this.data.chats = this.data.chats.filter((c) => c.id !== id);
    this.data.messages = this.data.messages.filter((m) => m.chatId !== id);
    this.save();
  }

  // Messages
  getMessages(chatId: string): Message[] {
    return this.data.messages
      .filter((m) => m.chatId === chatId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  saveMessage(message: Message) {
    const idx = this.data.messages.findIndex((m) => m.id === message.id);
    if (idx >= 0) {
      this.data.messages[idx] = message;
    } else {
      this.data.messages.push(message);
    }

    // Touch chat updatedAt
    const chat = this.data.chats.find((c) => c.id === message.chatId);
    if (chat) {
      chat.updatedAt = Date.now();
    }

    this.save();
  }

  deleteMessage(id: string) {
    this.data.messages = this.data.messages.filter((m) => m.id !== id);
    this.save();
  }

  clearChatMessages(chatId: string) {
    this.data.messages = this.data.messages.filter((m) => m.chatId !== chatId);
    this.save();
  }

  clearAllData() {
    this.data.chats = [];
    this.data.messages = [];
    this.save();
  }

  // Search
  searchChats(query: string): { chat: Chat; snippet?: string }[] {
    const q = query.toLowerCase().trim();
    if (!q) return this.getChats().map((c) => ({ chat: c }));

    const results: { chat: Chat; snippet?: string }[] = [];

    for (const chat of this.data.chats) {
      if (chat.title.toLowerCase().includes(q)) {
        results.push({ chat });
        continue;
      }

      // Check messages
      const msgs = this.data.messages.filter((m) => m.chatId === chat.id);
      const matchingMsg = msgs.find((m) => m.content.toLowerCase().includes(q));
      if (matchingMsg) {
        const idx = matchingMsg.content.toLowerCase().indexOf(q);
        const start = Math.max(0, idx - 40);
        const end = Math.min(matchingMsg.content.length, idx + q.length + 40);
        const snippet = (start > 0 ? '...' : '') + matchingMsg.content.slice(start, end).replace(/\n/g, ' ') + (end < matchingMsg.content.length ? '...' : '');
        results.push({ chat, snippet });
      }
    }

    return results;
  }

  // Export
  exportChatMarkdown(chatId: string): string {
    const chat = this.getChat(chatId);
    if (!chat) return '';
    const messages = this.getMessages(chatId);

    let md = `# ${chat.title}\n\n*Model: ${chat.model} | Date: ${new Date(chat.createdAt).toLocaleString()}*\n\n---\n\n`;

    for (const m of messages) {
      const sender = m.role === 'user' ? 'User' : 'Assistant';
      md += `### ${sender}\n\n`;
      if (m.thinking) {
        md += `> **Reasoning:**\n> ${m.thinking.replace(/\n/g, '\n> ')}\n\n`;
      }
      md += `${m.content}\n\n---\n\n`;
    }

    return md;
  }

  exportChatJson(chatId: string): string {
    const chat = this.getChat(chatId);
    if (!chat) return '{}';
    const messages = this.getMessages(chatId);
    return JSON.stringify({ chat, messages }, null, 2);
  }

  exportChatTxt(chatId: string): string {
    const chat = this.getChat(chatId);
    if (!chat) return '';
    const messages = this.getMessages(chatId);

    let txt = `CHAT: ${chat.title}\nMODEL: ${chat.model}\nDATE: ${new Date(chat.createdAt).toLocaleString()}\n\n`;
    for (const m of messages) {
      txt += `[${m.role.toUpperCase()} - ${new Date(m.createdAt).toLocaleTimeString()}]\n`;
      if (m.thinking) {
        txt += `(Reasoning: ${m.thinking})\n`;
      }
      txt += `${m.content}\n\n`;
    }
    return txt;
  }

  exportAllBackup(): string {
    return JSON.stringify(this.data, null, 2);
  }

  importAllBackup(jsonString: string): boolean {
    try {
      const parsed = JSON.parse(jsonString);
      if (!parsed.chats || !parsed.messages) {
        return false;
      }
      this.data = {
        version: parsed.version || STORAGE_VERSION,
        chats: parsed.chats,
        messages: parsed.messages,
        presets: parsed.presets || DEFAULT_PRESETS,
        systemPrompts: parsed.systemPrompts || DEFAULT_SYSTEM_PROMPTS,
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
      };
      this.save();
      return true;
    } catch (err) {
      console.error('Import failed:', err);
      return false;
    }
  }
}

export const storageService = new StorageService();
