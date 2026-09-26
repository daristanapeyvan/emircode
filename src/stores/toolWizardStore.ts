/**
 * toolWizardStore.ts — state of the "Mini Uygulama" and "Betik" wizards: which wizard is open,
 * whether the catalog or a tool's settings page is shown, and every tool's settings. The settings
 * are saved to localStorage, so going back to the catalog or restarting the app loses nothing.
 */
import { create } from 'zustand';
import { MINI_APPS, MINI_APP_CATEGORIES } from '@/lib/wizard/miniApps';
import { SCRIPTS, SCRIPT_CATEGORIES, ScriptLanguage } from '@/lib/wizard/scripts';
import type { Lang, ParamValue, ParamValues } from '@/lib/wizard/params';

export type ToolKind = 'mini' | 'script';

export interface ToolDraft {
  /** Category shown in the catalog. */
  categoryId: string;
  /** Parameter values per tool id (missing keys = defaults). */
  values: Record<string, ParamValues>;
  /** Mini app: the app title; script: the file name (per tool, '' = default). */
  names: Record<string, string>;
}

export interface MiniDraft extends ToolDraft {
  /** Interface language of the app; null = the language of Emir Code. */
  language: Lang | null;
  /** 'auto', 'none' or a theme id. */
  theme: string;
}

export interface ScriptDraft extends ToolDraft {
  language: ScriptLanguage;
  test: boolean;
}

const DRAFT_KEY = 'emir-code.tool-wizard.draft.v1';

const freshMini = (): MiniDraft => ({ categoryId: MINI_APP_CATEGORIES[0].id, values: {}, names: {}, language: null, theme: 'auto' });
const freshScript = (): ScriptDraft => ({ categoryId: SCRIPT_CATEGORIES[0].id, values: {}, names: {}, language: 'python', test: true });

const isRecord = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

const toolsOf = (kind: ToolKind) => (kind === 'mini' ? MINI_APPS : SCRIPTS);

function loadDraft(): { mini: MiniDraft; script: ScriptDraft } {
  const mini = freshMini();
  const script = freshScript();
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    const m = isRecord(saved?.mini) ? saved.mini : {};
    const s = isRecord(saved?.script) ? saved.script : {};
    if (MINI_APP_CATEGORIES.some((c) => c.id === m.categoryId)) mini.categoryId = m.categoryId;
    if (SCRIPT_CATEGORIES.some((c) => c.id === s.categoryId)) script.categoryId = s.categoryId;
    for (const [target, source] of [[mini, m], [script, s]] as const) {
      if (isRecord(source.values)) target.values = source.values;
      if (isRecord(source.names)) target.names = source.names;
    }
    if (m.language === 'tr' || m.language === 'en') mini.language = m.language;
    if (typeof m.theme === 'string') mini.theme = m.theme;
    if (s.language === 'python' || s.language === 'node') script.language = s.language;
    if (typeof s.test === 'boolean') script.test = s.test;
  } catch {
    // unreadable draft: start fresh
  }
  return { mini, script };
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function saveDraft(state: { mini: MiniDraft; script: ScriptDraft }) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ mini: state.mini, script: state.script }));
    } catch {
      // storage full / unavailable: the draft lives in memory for this session
    }
  }, 300);
}

interface ToolWizardState {
  /** Which wizard is open. */
  open: ToolKind | null;
  /** The tool whose settings page is shown; null = the catalog. */
  toolId: string | null;
  mini: MiniDraft;
  script: ScriptDraft;

  /** Opens a wizard on its catalog, or directly on a tool's settings page. */
  openWizard: (kind: ToolKind, toolId?: string | null) => void;
  closeWizard: () => void;
  openTool: (toolId: string) => void;
  showCatalog: () => void;
  selectCategory: (kind: ToolKind, categoryId: string) => void;
  setValue: (kind: ToolKind, toolId: string, key: string, value: ParamValue) => void;
  resetValues: (kind: ToolKind, toolId: string) => void;
  setName: (kind: ToolKind, toolId: string, name: string) => void;
  updateMini: (partial: Partial<Pick<MiniDraft, 'language' | 'theme'>>) => void;
  updateScript: (partial: Partial<Pick<ScriptDraft, 'language' | 'test'>>) => void;
}

export const useToolWizardStore = create<ToolWizardState>((set, get) => {
  const initial = loadDraft();

  /** Changes one wizard's draft and saves both. */
  const patch = (kind: ToolKind, change: (draft: ToolDraft) => Partial<ToolDraft> | Partial<MiniDraft> | Partial<ScriptDraft>) => {
    const state = get();
    const next = { mini: state.mini, script: state.script };
    if (kind === 'mini') next.mini = { ...state.mini, ...(change(state.mini) as Partial<MiniDraft>) };
    else next.script = { ...state.script, ...(change(state.script) as Partial<ScriptDraft>) };
    saveDraft(next);
    set(next);
  };

  /** The tool's page, with the catalog on the tool's category for the way back. */
  const showTool = (kind: ToolKind, toolId: string | null | undefined) => {
    const tool = toolsOf(kind).find((x) => x.id === toolId);
    if (!tool) {
      set({ toolId: null });
      return;
    }
    if (get()[kind].categoryId !== tool.category) patch(kind, () => ({ categoryId: tool.category }));
    set({ toolId: tool.id });
  };

  return {
    open: null,
    toolId: null,
    mini: initial.mini,
    script: initial.script,

    openWizard: (kind, toolId = null) => {
      set({ open: kind });
      showTool(kind, toolId);
    },

    closeWizard: () => set({ open: null, toolId: null }),

    openTool: (toolId) => {
      const kind = get().open;
      if (kind) showTool(kind, toolId);
    },

    showCatalog: () => set({ toolId: null }),

    selectCategory: (kind, categoryId) => patch(kind, () => ({ categoryId })),

    setValue: (kind, toolId, key, value) =>
      patch(kind, (d) => ({ values: { ...d.values, [toolId]: { ...(d.values[toolId] || {}), [key]: value } } })),

    resetValues: (kind, toolId) =>
      patch(kind, (d) => {
        const values = { ...d.values };
        delete values[toolId];
        return { values };
      }),

    setName: (kind, toolId, name) => patch(kind, (d) => ({ names: { ...d.names, [toolId]: name } })),

    updateMini: (partial) => patch('mini', () => partial),

    updateScript: (partial) => patch('script', () => partial),
  };
});
