import React, { useState, useMemo } from 'react';
import { Search, Plus, Trash2, Edit3, MessageSquare, Code2, Check, X } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { useAgentStore } from '@/stores/agentStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUIStore } from '@/stores/uiStore';
import { storageService } from '@/lib/storage/StorageService';
import { getTranslations } from '@/lib/localization/i18n';
import { Chat } from '@/types/chat';
import { cn } from '@/lib/utils/cn';

export const HistorySidebar: React.FC = () => {
  const { chats, activeChatId, selectChat, deleteChat, updateChatTitle, createNewChat } = useChatStore();
  const { isSidebarOpen, activeAppMode, setActiveAppMode } = useUIStore();
  const { settings } = useSettingsStore();
  const t = getTranslations(settings.language);

  const [searchQuery, setSearchQuery] = useState('');
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [chatToDelete, setChatToDelete] = useState<{ id: string; title: string } | null>(null);

  // Group chats by date
  const groupedChats = useMemo(() => {
    if (searchQuery.trim()) {
      return null; // When searching, display search results directly
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 86400000;
    const past7DaysStart = todayStart - 86400000 * 7;

    const today: Chat[] = [];
    const yesterday: Chat[] = [];
    const past7Days: Chat[] = [];
    const older: Chat[] = [];

    for (const chat of chats) {
      const time = chat.updatedAt || chat.createdAt;
      if (time >= todayStart) {
        today.push(chat);
      } else if (time >= yesterdayStart) {
        yesterday.push(chat);
      } else if (time >= past7DaysStart) {
        past7Days.push(chat);
      } else {
        older.push(chat);
      }
    }

    return { today, yesterday, past7Days, older };
  }, [chats, searchQuery]);

  // Search results
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return storageService.searchChats(searchQuery);
  }, [searchQuery, chats]);

  if (!isSidebarOpen) return null;

  const handleStartRename = (chat: Chat, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingChatId(chat.id);
    setEditingTitle(chat.title);
  };

  const handleSaveRename = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    updateChatTitle(id, editingTitle);
    setEditingChatId(null);
  };

  const handleDeleteClick = (chat: Chat, e: React.MouseEvent) => {
    e.stopPropagation();
    if (settings.confirmDestructive) {
      setChatToDelete({ id: chat.id, title: chat.title });
    } else {
      if (chat.id === activeChatId && chat.mode === 'agent') {
        useAgentStore.getState().clearSession();
      }
      deleteChat(chat.id);
    }
  };

  const handleConfirmDelete = () => {
    if (chatToDelete) {
      if (chatToDelete.id === activeChatId) {
        useAgentStore.getState().clearSession();
      }
      deleteChat(chatToDelete.id);
      setChatToDelete(null);
    }
  };

  const handleSelectChat = async (chat: Chat) => {
    if (chat.mode === 'agent') {
      setActiveAppMode('agent');
      selectChat(chat.id);
      await useAgentStore.getState().loadSession(chat.id);
    } else {
      setActiveAppMode('chat');
      selectChat(chat.id);
    }
  };

  const handleCreateNew = () => {
    if (activeAppMode === 'agent') {
      useAgentStore.getState().clearSession();
    } else {
      createNewChat(undefined, 'chat');
    }
  };

  function renderGroup(title: string, items: Chat[]) {
    if (items.length === 0) return null;

    return (
      <div key={title} className="space-y-0.5">
        <div className="px-2.5 py-1 text-[10px] font-medium text-zinc-500 uppercase tracking-wider">
          {title}
        </div>
        {items.map((chat) => {
          const isActive = chat.id === activeChatId;
          const isEditing = editingChatId === chat.id;

          return (
            <div
              key={chat.id}
              onClick={() => !isEditing && handleSelectChat(chat)}
              className={cn(
                'group relative flex items-center justify-between px-2.5 py-1.5 rounded transition-colors cursor-pointer text-xs',
                isActive
                  ? 'bg-zinc-800 text-zinc-100 font-medium'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
              )}
            >
              {isEditing ? (
                <div className="flex items-center gap-1 w-full" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="text"
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-100 focus:outline-none"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveRename(chat.id, e as any);
                      if (e.key === 'Escape') setEditingChatId(null);
                    }}
                  />
                  <button
                    type="button"
                    onClick={(e) => handleSaveRename(chat.id, e)}
                    className="text-emerald-400 hover:text-emerald-300 p-0.5 cursor-pointer"
                  >
                    <Check size={12} strokeWidth={1.5} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingChatId(null)}
                    className="text-zinc-500 hover:text-zinc-300 p-0.5 cursor-pointer"
                  >
                    <X size={12} strokeWidth={1.5} />
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 truncate flex-1 min-w-0 mr-1">
                    {chat.mode === 'agent' ? (
                      <Code2 size={13} className="shrink-0 text-cyan-400" strokeWidth={1.5} />
                    ) : (
                      <MessageSquare size={13} className="shrink-0 text-zinc-500" strokeWidth={1.5} />
                    )}
                    <span className="truncate">{chat.title}</span>
                  </div>

                  <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => handleStartRename(chat, e)}
                      title={t.history.renameChat}
                      className="p-1 text-zinc-500 hover:text-zinc-200 rounded cursor-pointer"
                    >
                      <Edit3 size={11} strokeWidth={1.5} />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleDeleteClick(chat, e)}
                      title={t.history.deleteChat}
                      className="p-1 text-zinc-500 hover:text-rose-400 rounded cursor-pointer"
                    >
                      <Trash2 size={11} strokeWidth={1.5} />
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <>
      <div className="w-64 bg-zinc-950/70 border-r border-zinc-800/50 flex flex-col shrink-0 select-none text-xs">
        {/* Top Header: Mode Switcher, New Chat & Search */}
        <div className="p-2.5 border-b border-zinc-800/50 space-y-2 shrink-0">
          {/* Segmented Mode Switcher: [Sohbet] [Emir Code] */}
          <div className="grid grid-cols-2 p-0.5 bg-zinc-900 border border-zinc-800 rounded-lg">
            <button
              type="button"
              onClick={() => setActiveAppMode('chat')}
              className={cn(
                "flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer select-none",
                activeAppMode === 'chat'
                  ? "bg-zinc-800 text-zinc-100 shadow-sm font-semibold"
                  : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              <MessageSquare size={13} strokeWidth={1.5} />
              <span>{t.mode?.chat || 'Sohbet'}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveAppMode('agent')}
              className={cn(
                "flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer select-none",
                activeAppMode === 'agent'
                  ? "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shadow-sm font-semibold"
                  : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              <Code2 size={13} strokeWidth={1.5} />
              <span>{t.mode?.agent || 'Emir Code'}</span>
            </button>
          </div>

          {/* New Chat / New Task button */}
          <button
            type="button"
            onClick={handleCreateNew}
            className="w-full h-8 px-2.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800/50 flex items-center justify-between transition-colors cursor-pointer"
          >
            <span className="font-medium text-xs">
              {activeAppMode === 'agent' ? (t.agent?.newSession || 'Yeni Görev') : t.titleBar.newChat}
            </span>
            <Plus size={14} className="text-zinc-400" strokeWidth={1.5} />
          </button>

          {/* Search bar */}
          <div className="relative flex items-center">
            <Search size={13} className="absolute left-2.5 text-zinc-500 pointer-events-none" strokeWidth={1.5} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.history.searchPlaceholder}
              className="w-full h-7 pl-7 pr-7 rounded bg-zinc-900/60 border border-zinc-800/50 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-700/80"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 text-zinc-500 hover:text-zinc-300 cursor-pointer"
              >
                <X size={12} strokeWidth={1.5} />
              </button>
            )}
          </div>
        </div>

        {/* Chat List */}
        <div className="flex-1 overflow-y-auto px-1.5 py-2 space-y-4">
          {searchQuery.trim() ? (
            /* Search Results */
            <div>
              <div className="px-2 py-1 text-[11px] font-medium text-zinc-500 uppercase tracking-wider">
                {t.common.search} ({searchResults.length})
              </div>
              {searchResults.length === 0 ? (
                <div className="px-2 py-4 text-center text-zinc-500 text-[11px]">
                  {t.history.noChatsFound}
                </div>
              ) : (
                searchResults.map(({ chat, snippet }) => (
                  <button
                    key={chat.id}
                    type="button"
                    onClick={() => handleSelectChat(chat)}
                    className={cn(
                      'w-full text-left px-2.5 py-2 rounded transition-colors mb-1 cursor-pointer block',
                      activeChatId === chat.id
                        ? 'bg-zinc-800/80 text-white'
                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
                    )}
                  >
                    <div className="flex items-center gap-2 font-medium truncate text-xs">
                      {chat.mode === 'agent' ? (
                        <Code2 size={13} className="shrink-0 text-cyan-400" strokeWidth={1.5} />
                      ) : (
                        <MessageSquare size={13} className="shrink-0 text-zinc-500" strokeWidth={1.5} />
                      )}
                      <span className="truncate">{chat.title}</span>
                    </div>
                    {snippet && (
                      <div className="text-[10px] text-zinc-500 truncate mt-0.5 font-sans pl-5">
                        {snippet}
                      </div>
                    )}
                  </button>
                ))
              )}
            </div>
          ) : groupedChats ? (
            /* Grouped Chats */
            <>
              {renderGroup(t.history.today, groupedChats.today)}
              {renderGroup(t.history.yesterday, groupedChats.yesterday)}
              {renderGroup(t.history.previous7Days, groupedChats.past7Days)}
              {renderGroup(t.history.older, groupedChats.older)}
            </>
          ) : null}
        </div>
      </div>

      {/* Modern Dark Mode Delete Confirmation Modal */}
      {chatToDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setChatToDelete(null)}
        >
          <div
            className="w-full max-w-sm mx-4 bg-zinc-900 border border-zinc-800/80 rounded-xl shadow-2xl p-5 space-y-4 animate-in zoom-in-95 duration-150 select-none"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 shrink-0">
                <Trash2 size={20} strokeWidth={1.5} />
              </div>
              <div className="space-y-1 min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-zinc-100">
                  {t.history.deleteConfirmTitle}
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  <span className="font-medium text-zinc-300 break-words">"{chatToDelete.title}"</span>{' '}
                  {t.history.deleteConfirmDesc}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-zinc-800/60">
              <button
                type="button"
                onClick={() => setChatToDelete(null)}
                className="px-3.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700/80 text-zinc-300 text-xs font-medium transition-colors cursor-pointer"
              >
                {t.common.cancel}
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium transition-colors cursor-pointer shadow-sm shadow-rose-950/50"
              >
                {t.common.delete}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
