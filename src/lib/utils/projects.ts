/**
 * projects.ts — the sidebar's project view: agent tasks grouped by their folder, the name rules
 * of a new project folder and the short "2h" style age of a task. Pure functions (no Electron),
 * so they are tested directly in test_projects.ts.
 */
import type { Chat } from '@/types/chat';
import type { Translations } from '@/lib/localization/i18n';

const WINDOWS_PATH = /^(?:[a-zA-Z]:(?:[\\/]|$)|\\\\)/;

/** One key per folder: Windows paths compare case-insensitively and with either slash. */
export function projectKey(root: string): string {
  const trimmed = root.trim();
  if (WINDOWS_PATH.test(trimmed)) {
    const key = trimmed.replace(/\//g, '\\').replace(/\\+$/, '');
    return (/^[a-zA-Z]:$/.test(key) ? `${key}\\` : key).toLowerCase();
  }
  return trimmed.replace(/\/+$/, '') || '/';
}

/** The last part of a folder path ("C:\Projeler\kafe" -> "kafe"). */
export function folderNameOf(root: string): string {
  const parts = root.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || root;
}

/** parent + name with the parent's own separator. */
export function joinPath(parent: string, name: string): string {
  const sep = WINDOWS_PATH.test(parent) ? '\\' : '/';
  return `${parent.replace(/[\\/]+$/, '')}${sep}${name}`;
}

/** "C:\a\b\c\d" -> "…\c\d": the end of a long path, where the project's name is. */
export function compactPath(path: string, keep = 2): string {
  const sep = WINDOWS_PATH.test(path) ? '\\' : '/';
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/);
  if (parts.length <= keep + 1) return path;
  return `…${sep}${parts.slice(-keep).join(sep)}`;
}

export type ProjectNameProblem = 'empty' | 'invalid' | 'reserved' | 'tooLong';

export const PROJECT_NAME_MAX = 80;
const INVALID_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/;
const RESERVED_WINDOWS_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Why a folder name cannot be used on any of the supported systems, or null when it can. */
export function checkProjectName(name: string): ProjectNameProblem | null {
  const value = name.trim();
  if (!value) return 'empty';
  if (value.length > PROJECT_NAME_MAX) return 'tooLong';
  if (INVALID_NAME_CHARS.test(value) || value === '.' || value === '..' || /[. ]$/.test(value)) return 'invalid';
  if (RESERVED_WINDOWS_NAME.test(value)) return 'reserved';
  return null;
}

/** The message for a name problem or for what the main process answered. */
export function describeProjectError(
  p: Translations['projects'],
  problem: ProjectNameProblem | 'invalid-name' | 'invalid-location' | 'exists' | 'error' | undefined,
  detail?: string
): string {
  switch (problem) {
    case 'empty':
      return p.errorEmpty;
    case 'tooLong':
      return p.errorTooLong;
    case 'reserved':
      return p.errorReserved;
    case 'invalid':
    case 'invalid-name':
      return p.errorInvalid;
    case 'invalid-location':
      return p.errorLocation;
    case 'exists':
      return p.errorExists;
    default:
      return p.errorCreate.replace('{error}', detail || '?');
  }
}

export interface ProjectGroup {
  /** projectKey of the folder; '' for tasks saved without a folder. */
  key: string;
  root: string | null;
  name: string;
  /** Newest first. */
  chats: Chat[];
  lastActive: number;
}

const activity = (chat: Chat) => chat.updatedAt || chat.createdAt || 0;

/**
 * Agent tasks by folder, the most recently used folder first; tasks without a folder come last.
 * The open folder is listed even before its first task, so a new project shows up right away.
 */
export function groupTasksByProject(
  chats: Chat[],
  open?: { root: string | null; name?: string | null },
  now: number = Date.now()
): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  const loose: Chat[] = [];

  for (const chat of chats) {
    if (chat.mode !== 'agent') continue;
    if (!chat.workspaceRoot) {
      loose.push(chat);
      continue;
    }
    const key = projectKey(chat.workspaceRoot);
    let group = groups.get(key);
    if (!group) {
      group = { key, root: chat.workspaceRoot, name: '', chats: [], lastActive: -1 };
      groups.set(key, group);
    }
    group.chats.push(chat);
    // The newest task decides how the folder is written (it may have been renamed on disk).
    if (activity(chat) > group.lastActive) {
      group.lastActive = activity(chat);
      group.root = chat.workspaceRoot;
      group.name = chat.workspaceName || folderNameOf(chat.workspaceRoot);
    }
  }

  if (open?.root) {
    const key = projectKey(open.root);
    const group = groups.get(key);
    if (!group) {
      groups.set(key, { key, root: open.root, name: open.name || folderNameOf(open.root), chats: [], lastActive: now });
    }
  }

  const byActivity = (a: Chat, b: Chat) => activity(b) - activity(a);
  const result = [...groups.values()];
  result.forEach((g) => g.chats.sort(byActivity));
  result.sort((a, b) => b.lastActive - a.lastActive);
  if (loose.length > 0) {
    loose.sort(byActivity);
    result.push({ key: '', root: null, name: '', chats: loose, lastActive: activity(loose[0]) });
  }
  return result;
}

export interface AgeLabels {
  now: string;
  minutes: string;
  hours: string;
  days: string;
}

/** "now", "5m", "3h", "2d", then a short date ("12 Sep"). */
export function formatAge(time: number, labels: AgeLabels, locale: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - time) / 1000));
  if (seconds < 60) return labels.now;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return labels.minutes.replace('{n}', String(minutes));
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return labels.hours.replace('{n}', String(hours));
  const days = Math.floor(hours / 24);
  if (days < 7) return labels.days.replace('{n}', String(days));
  const date = new Date(time);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(locale, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}
