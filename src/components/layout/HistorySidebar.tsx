import React, { useState, useMemo, useEffect } from 'react';
import {
  Search,
  Plus,
  Trash2,
  Edit3,
  MessageSquare,
  Code2,
  Check,
  X,
  ChevronRight,
  Folder,
  FolderPlus,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { useAgentStore, isAgentBusy } from '@/stores/agentStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUIStore } from '@/stores/uiStore';
import { storageService } from '@/lib/storage/StorageService';
import { getTranslations, resolveLanguage } from '@/lib/localization/i18n';
import { formatAge, groupTasksByProject, projectKey, ProjectGroup } from '@/lib/utils/projects';
import { focusAgentComposer } from '@/components/agent/NewProjectDialog';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { Chat } from '@/types/chat';
import { cn } from '@/lib/utils/cn';

/** Tasks shown per project before "show more". */
const PROJECT_PREVIEW = 5;
const COLLAPSED_KEY = 'emir.sidebar.collapsedProjects';

function readCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeCollapsed(keys: Set<string>) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...keys]));
  } catch {
    /* a convenience only */
  }
}

export const HistorySidebar: React.FC = () => {
  const { chats, activeChatId, selectChat, deleteChat, updateChatTitle, createNewChat } = useChatStore();
  const { isSidebarOpen, activeAppMode, setActiveAppMode, openNewProject } = useUIStore();
  const workspaceRoot = useAgentStore((s) => s.workspaceRoot);
  const workspaceName = useAgentStore((s) => s.workspaceName);
  const sessionChatId = useAgentStore((s) => s.sessionChatId);
  const agentStatus = useAgentStore((s) => s.agentStatus);
  const { settings } = useSettingsStore();
  const t = getTranslations(settings.language);
  const p = t.projects;
  const locale = resolveLanguage(settings.language);

  const [searchQuery, setSearchQuery] = useState('');
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [chatToDelete, setChatToDelete] = useState<{ id: string; title: string } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsed);
  const [showAll, setShowAll] = useState<Set<string>>(() => new Set());
  const [missing, setMissing] = useState<Set<string>>(() => new Set());
  // Re-renders the "5m" ages now and then.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // Emir Code: tasks grouped by project folder
  const projects = useMemo(
    () => groupTasksByProject(chats, { root: workspaceRoot, name: workspaceName }),
    [chats, workspaceRoot, workspaceName]
  );
  const openKey = workspaceRoot ? projectKey(workspaceRoot) : null;

  // The open project is always expanded, also after it was collapsed earlier.
  useEffect(() => {
    if (!openKey) return;
    setCollapsed((prev) => {
      if (!prev.has(openKey)) return prev;
      const next = new Set(prev);
      next.delete(openKey);
      writeCollapsed(next);
      return next;
    });
  }, [openKey, activeChatId]);

  // Folders that were moved or deleted are shown dimmed (checked again when the window gets focus).
  const rootsSignature = projects
    .map((g) => g.root)
    .filter((r): r is string => !!r)
    .join('\n');
  useEffect(() => {
    const api = window.electronAPI;
    if (activeAppMode !== 'agent' || !api?.pathsExist || !rootsSignature) {
      setMissing(new Set());
      return;
    }
    let cancelled = false;
    const roots = rootsSignature.split('\n');
    const check = () => {
      api.pathsExist!(roots)
        .then((exists) => {
          if (!cancelled) setMissing(new Set(roots.filter((_, i) => !exists[i]).map(projectKey)));
        })
        .catch(() => {});
    };
    check();
    window.addEventListener('focus', check);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', check);
    };
  }, [rootsSignature, activeAppMode]);

  // Sohbet: conversations grouped by date
  const groupedChats = useMemo(() => {
    if (searchQuery.trim()) {
      return null; // When searching, display search results directly
    }

    const todayStart = new Date(new Date(now).setHours(0, 0, 0, 0)).getTime();
    const yesterdayStart = todayStart - 86400000;
    const past7DaysStart = todayStart - 86400000 * 7;

    const today: Chat[] = [];
    const yesterday: Chat[] = [];
    const past7Days: Chat[] = [];
    const older: Chat[] = [];

    for (const chat of chats) {
      if (chat.mode === 'agent') continue;
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
  }, [chats, searchQuery, now]);

  // Search results (both modes: opening one switches to its mode)
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return storageService.searchChats(searchQuery);
  }, [searchQuery, chats]);

  if (!isSidebarOpen) return null;

  const agentRunning = isAgentBusy(agentStatus);
  const ageLabels = { now: p.ageNow, minutes: p.ageMinutes, hours: p.ageHours, days: p.ageDays };

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

  const removeChat = (id: string) => {
    // The task open in Emir Code: its session goes too (a running one is stopped first).
    if (id === sessionChatId) {
      useAgentStore.getState().clearSession();
    }
    deleteChat(id);
  };

  const handleDeleteClick = (chat: Chat, e: React.MouseEvent) => {
    e.stopPropagation();
    if (settings.confirmDestructive) {
      setChatToDelete({ id: chat.id, title: chat.title });
    } else {
      removeChat(chat.id);
    }
  };

  const handleConfirmDelete = () => {
    if (chatToDelete) {
      removeChat(chatToDelete.id);
      setChatToDelete(null);
    }
  };

  const handleSelectChat = async (chat: Chat) => {
    if (chat.mode === 'agent') {
      setActiveAppMode('agent');
      // The task on screen (maybe running): just show it again.
      if (chat.id === sessionChatId) {
        useChatStore.setState({ activeChatId: chat.id });
        return;
      }
      if (!(await useAgentStore.getState().confirmLeaveRunningTask())) return;
      selectChat(chat.id);
      await useAgentStore.getState().loadSession(chat.id);
    } else {
      setActiveAppMode('chat');
      selectChat(chat.id);
    }
  };

  const handleCreateNew = () => {
    if (activeAppMode === 'agent') {
      openNewProject();
    } else {
      createNewChat(undefined, 'chat');
    }
  };

  const handleNewTaskIn = async (root: string) => {
    setActiveAppMode('agent');
    if (await useAgentStore.getState().startTaskInFolder(root)) focusAgentComposer();
  };

  const toggleCollapsed = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeCollapsed(next);
      return next;
    });
  };

  const toggleShowAll = (key: string) => {
    setShowAll((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  /** Rename / delete on hover; in a project the age shows otherwise. */
  function renderChatRow(chat: Chat, variant: 'date' | 'project') {
    const isActive = chat.id === activeChatId;
    const isEditing = editingChatId === chat.id;
    const isRunning = variant === 'project' && agentRunning && chat.id === sessionChatId;

    return (
      <div
        key={chat.id}
        onClick={() => !isEditing && handleSelectChat(chat)}
        title={variant === 'project' ? chat.title : undefined}
        className={cn(
          'group relative flex items-center justify-between h-8 rounded transition-colors cursor-pointer text-xs',
          variant === 'project' ? 'pl-7 pr-2' : 'px-2.5',
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
              className="flex-1 min-w-0 bg-zinc-950 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-100 focus:outline-none"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveRename(chat.id, e as any);
                if (e.key === 'Escape') setEditingChatId(null);
              }}
            />
            <button
              type="button"
              onClick={(e) => handleSaveRename(chat.id, e)}
              className="text-zinc-400 hover:text-zinc-100 p-0.5 cursor-pointer"
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
            <span className="truncate flex-1 min-w-0 mr-1">{chat.title}</span>

            {variant === 'project' && (
              <span className="shrink-0 text-[11px] text-zinc-600 tabular-nums group-hover:hidden">
                {isRunning ? (
                  <Loader2 size={11} className="animate-spin text-zinc-400" aria-label={p.running} />
                ) : (
                  formatAge(chat.updatedAt || chat.createdAt, ageLabels, locale, now)
                )}
              </span>
            )}
            <div
              className={cn(
                'items-center gap-0.5 shrink-0',
                variant === 'project'
                  ? 'hidden group-hover:flex'
                  : 'flex opacity-0 group-hover:opacity-100 transition-opacity'
              )}
            >
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
                className="p-1 text-zinc-500 hover:text-red-400 rounded cursor-pointer"
              >
                <Trash2 size={11} strokeWidth={1.5} />
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  function renderGroup(title: string, items: Chat[]) {
    if (items.length === 0) return null;

    return (
      <div key={title} className="space-y-0.5">
        <div className="px-2.5 py-1 text-[11px] font-medium text-zinc-500">{title}</div>
        {items.map((chat) => renderChatRow(chat, 'date'))}
      </div>
    );
  }

  function renderProject(group: ProjectGroup) {
    const isOpen = !!openKey && group.key === openKey;
    const isCollapsed = collapsed.has(group.key);
    const isMissing = missing.has(group.key);
    const name = group.root ? group.name : p.noFolder;
    const activeIndex = group.chats.findIndex((c) => c.id === activeChatId);
    const expanded = showAll.has(group.key) || activeIndex >= PROJECT_PREVIEW;
    const visible = expanded ? group.chats : group.chats.slice(0, PROJECT_PREVIEW);
    const hidden = group.chats.length - visible.length;

    return (
      <div key={group.key || 'no-folder'} className="space-y-0.5">
        <div className="group/project flex items-center h-8 pr-1 rounded hover:bg-zinc-900/60 transition-colors">
          <button
            type="button"
            onClick={() => toggleCollapsed(group.key)}
            aria-expanded={!isCollapsed}
            title={isMissing && group.root ? p.folderMissing.replace('{path}', group.root) : group.root || undefined}
            className="flex-1 min-w-0 h-full flex items-center gap-1.5 pl-2.5 text-left cursor-pointer"
          >
            <ChevronRight
              size={12}
              strokeWidth={1.5}
              className={cn('shrink-0 text-zinc-600 transition-transform duration-150', !isCollapsed && 'rotate-90')}
            />
            <Folder size={13} strokeWidth={1.5} className={cn('shrink-0', isOpen ? 'text-zinc-300' : 'text-zinc-500')} />
            <span
              className={cn(
                'truncate text-xs font-medium',
                isMissing ? 'text-zinc-600' : isOpen ? 'text-zinc-100' : 'text-zinc-400'
              )}
            >
              {name}
            </span>
            {isMissing && <AlertTriangle size={11} strokeWidth={1.5} className="shrink-0 text-amber-500/70" />}
            {isCollapsed && group.chats.length > 0 && (
              <span className="shrink-0 text-[11px] text-zinc-600 tabular-nums">{group.chats.length}</span>
            )}
          </button>
          {group.root && !isMissing && (
            <button
              type="button"
              onClick={() => handleNewTaskIn(group.root!)}
              title={p.newTaskIn.replace('{folder}', name)}
              aria-label={p.newTaskIn.replace('{folder}', name)}
              className={cn(
                'shrink-0 p-1 rounded text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer focus:opacity-100',
                isOpen ? 'opacity-100' : 'opacity-0 group-hover/project:opacity-100'
              )}
            >
              <Plus size={13} strokeWidth={1.5} />
            </button>
          )}
        </div>

        {!isCollapsed && (
          <>
            {visible.map((chat) => renderChatRow(chat, 'project'))}
            {group.chats.length === 0 && <div className="pl-7 py-1 text-[11px] text-zinc-600">{p.noTasksYet}</div>}
            {(hidden > 0 || (showAll.has(group.key) && group.chats.length > PROJECT_PREVIEW)) && (
              <button
                type="button"
                onClick={() => toggleShowAll(group.key)}
                className="w-full text-left pl-7 py-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
              >
                {hidden > 0 ? p.showMore.replace('{count}', String(hidden)) : p.showLess}
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="w-64 bg-zinc-950/70 border-r border-zinc-800/50 flex flex-col shrink-0 select-none text-xs">
        {/* Top Header: Mode Switcher, New Chat & Search */}
        <div className="p-2.5 border-b border-zinc-800/50 space-y-2 shrink-0">
          {/* Mode switcher: [Sohbet] [Kod] */}
          <div role="tablist" className="grid grid-cols-2 gap-0.5 p-0.5 bg-zinc-900 border border-zinc-800 rounded">
            <button
              type="button"
              role="tab"
              aria-selected={activeAppMode === 'chat'}
              onClick={() => setActiveAppMode('chat')}
              className={cn(
                'flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-sm transition-colors cursor-pointer select-none',
                activeAppMode === 'chat' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
              )}
            >
              <MessageSquare size={13} strokeWidth={1.5} />
              <span>{t.mode.chat}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeAppMode === 'agent'}
              onClick={() => setActiveAppMode('agent')}
              className={cn(
                'flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-sm transition-colors cursor-pointer select-none',
                activeAppMode === 'agent' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
              )}
            >
              <Code2 size={13} strokeWidth={1.5} />
              <span>{t.mode.agent}</span>
            </button>
          </div>

          {/* New Chat (Sohbet) / New Project (Kod); a task in a project: its "+" below */}
          <button
            type="button"
            onClick={handleCreateNew}
            title={activeAppMode === 'agent' ? p.newProjectTooltip : p.newChatTooltip}
            className="w-full h-8 px-2.5 rounded text-zinc-200 hover:bg-zinc-800/60 flex items-center gap-2 transition-colors cursor-pointer"
          >
            {activeAppMode === 'agent' ? (
              <FolderPlus size={14} className="text-zinc-400" strokeWidth={1.5} />
            ) : (
              <Plus size={14} className="text-zinc-400" strokeWidth={1.5} />
            )}
            <span className="font-medium text-xs">{activeAppMode === 'agent' ? p.newProject : p.newChat}</span>
          </button>

          {/* Search bar */}
          <div className="relative flex items-center">
            <Search size={14} className="absolute left-2.5 text-zinc-500 pointer-events-none" strokeWidth={1.5} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.history.searchPlaceholder}
              className="w-full h-8 pl-8 pr-7 rounded bg-zinc-900/60 border border-zinc-800/50 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-700/80"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                title={t.common.clear}
                aria-label={t.common.clear}
                className="absolute right-2 text-zinc-500 hover:text-zinc-300 cursor-pointer"
              >
                <X size={12} strokeWidth={1.5} />
              </button>
            )}
          </div>
        </div>

        {/* Chat List */}
        <div className={cn('flex-1 overflow-y-auto px-2.5 py-2', activeAppMode === 'agent' && !searchQuery.trim() ? 'space-y-2' : 'space-y-4')}>
          {searchQuery.trim() ? (
            /* Search Results */
            <div>
              <div className="px-2.5 py-1 text-[11px] font-medium text-zinc-500">
                {t.history.results.replace('{count}', String(searchResults.length))}
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
                        ? 'bg-zinc-800/80 text-zinc-100'
                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
                    )}
                  >
                    <div className="flex items-center gap-2 font-medium truncate text-xs">
                      {chat.mode === 'agent' ? (
                        <Code2 size={13} className="shrink-0 text-zinc-500" strokeWidth={1.5} />
                      ) : (
                        <MessageSquare size={13} className="shrink-0 text-zinc-500" strokeWidth={1.5} />
                      )}
                      <span className="truncate">{chat.title}</span>
                    </div>
                    {(snippet || (chat.mode === 'agent' && chat.workspaceName)) && (
                      <div className="text-[11px] text-zinc-500 truncate mt-0.5 pl-5">
                        {snippet || chat.workspaceName}
                      </div>
                    )}
                  </button>
                ))
              )}
            </div>
          ) : activeAppMode === 'agent' ? (
            /* Emir Code: projects */
            projects.length === 0 ? (
              <div className="px-2 py-4 text-center text-zinc-500 text-[11px]">{p.noTasksYet}</div>
            ) : (
              projects.map(renderProject)
            )
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

      <Modal
        isOpen={!!chatToDelete}
        onClose={() => setChatToDelete(null)}
        title={t.history.deleteConfirmTitle}
        width="max-w-sm"
        footer={
          <>
            <span className="flex-1" />
            <Button variant="secondary" onClick={() => setChatToDelete(null)}>
              {t.common.cancel}
            </Button>
            <Button variant="danger" onClick={handleConfirmDelete}>
              {t.common.delete}
            </Button>
          </>
        }
      >
        <p className="text-xs text-zinc-400 leading-relaxed break-words">
          {t.history.deleteConfirmDesc.replace('{title}', chatToDelete?.title || '')}
        </p>
      </Modal>
    </>
  );
};
