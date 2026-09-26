/**
 * siteWizardStore.ts — state of the "Website Oluştur" wizard. The draft survives closing the
 * wizard and restarting the app (localStorage), so long texts are never lost.
 */
import { create } from 'zustand';
import {
  SiteWizardData,
  WizardMode,
  WizardPage,
  WizardSection,
  WizardContact,
  SectionKind,
  FeatureKey,
  SECTION_KINDS,
  createWizardData,
  defaultPages,
  newSection,
  newId,
  resolveCategory,
} from '@/lib/wizard/siteWizard';

const DRAFT_KEY = 'emir-code.site-wizard.draft.v1';

/** Page templates offered by "Sayfa ekle". */
export const PAGE_TEMPLATES: Array<{ id: string; tr: string; en: string; sections: SectionKind[] }> = [
  { id: 'about', tr: 'Hakkımızda', en: 'About', sections: ['about', 'team'] },
  { id: 'services', tr: 'Hizmetler', en: 'Services', sections: ['services', 'faq'] },
  { id: 'menu', tr: 'Menü', en: 'Menu', sections: ['menu'] },
  { id: 'products', tr: 'Ürünler', en: 'Products', sections: ['products'] },
  { id: 'gallery', tr: 'Galeri', en: 'Gallery', sections: ['gallery'] },
  { id: 'pricing', tr: 'Fiyatlar', en: 'Pricing', sections: ['pricing', 'faq'] },
  { id: 'blog', tr: 'Blog', en: 'Blog', sections: ['blog'] },
  { id: 'faq', tr: 'SSS', en: 'FAQ', sections: ['faq'] },
  { id: 'contact', tr: 'İletişim', en: 'Contact', sections: ['contact'] },
  { id: 'blank', tr: 'Boş sayfa', en: 'Blank page', sections: ['custom'] },
];

function loadDraft(): SiteWizardData | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    const base = createWizardData();
    if (!saved || !Array.isArray(saved.pages)) return null;
    return {
      ...base,
      ...saved,
      contact: { ...base.contact, ...(saved.contact || {}) },
      features: { ...base.features, ...(saved.features || {}) },
      pages: saved.pages.length > 0 ? saved.pages : base.pages,
    };
  } catch {
    return null;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function saveDraft(data: SiteWizardData) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
    } catch {
      // storage full / unavailable: the draft lives in memory for this session
    }
  }, 300);
}

/** True when the draft holds something the user typed. */
export function isDraftStarted(data: SiteWizardData): boolean {
  return !!(
    data.siteName.trim() ||
    data.description.trim() ||
    data.siteType.trim() ||
    data.pagesTouched ||
    data.pages.some((p) => p.sections.some((s) => s.content.trim() || s.title.trim()))
  );
}

interface SiteWizardState {
  open: boolean;
  step: number;
  data: SiteWizardData;
  selectedPageId: string | null;
  selectedSectionId: string | null;

  openWizard: () => void;
  closeWizard: () => void;
  reset: () => void;
  setStep: (step: number) => void;
  setMode: (mode: WizardMode) => void;
  update: (partial: Partial<SiteWizardData>) => void;
  updateContact: (partial: Partial<WizardContact>) => void;
  setFeature: (key: FeatureKey, value: boolean) => void;
  setMultiPage: (multi: boolean) => void;
  toggleSection: (kind: SectionKind) => void;
  addPage: (templateId: string) => void;
  removePage: (pageId: string) => void;
  renamePage: (pageId: string, name: string) => void;
  movePage: (pageId: string, delta: -1 | 1) => void;
  addSection: (pageId: string, kind: SectionKind) => void;
  removeSection: (pageId: string, sectionId: string) => void;
  moveSection: (pageId: string, sectionId: string, delta: -1 | 1) => void;
  updateSection: (pageId: string, sectionId: string, partial: Partial<WizardSection>) => void;
  select: (pageId: string | null, sectionId: string | null) => void;
}

const move = <T,>(list: T[], index: number, delta: number): T[] => {
  const target = index + delta;
  if (index < 0 || target < 0 || target >= list.length) return list;
  const copy = [...list];
  const [item] = copy.splice(index, 1);
  copy.splice(target, 0, item);
  return copy;
};

export const useSiteWizardStore = create<SiteWizardState>((set, get) => {
  const initial = loadDraft() || createWizardData();

  /** Applies a data change; the draft is saved. */
  const commit = (next: SiteWizardData, extra: Partial<SiteWizardState> = {}) => {
    saveDraft(next);
    set({ data: next, ...extra });
  };

  const withPages = (pages: WizardPage[], touched = true) => {
    const data = get().data;
    commit({ ...data, pages, pagesTouched: data.pagesTouched || touched, multiPage: pages.length > 1 });
  };

  return {
    open: false,
    step: 0,
    data: initial,
    selectedPageId: initial.pages[0]?.id ?? null,
    selectedSectionId: initial.pages[0]?.sections[0]?.id ?? null,

    openWizard: () => set({ open: true }),
    closeWizard: () => set({ open: false }),

    reset: () => {
      const mode = get().data.mode;
      const fresh = createWizardData(mode);
      commit(fresh, {
        step: 0,
        selectedPageId: fresh.pages[0].id,
        selectedSectionId: fresh.pages[0].sections[0]?.id ?? null,
      });
    },

    setStep: (step) => set({ step: Math.max(0, step) }),

    setMode: (mode) => {
      const data = get().data;
      commit({ ...data, mode }, { step: 0 });
    },

    update: (partial) => {
      const data = get().data;
      const next: SiteWizardData = { ...data, ...partial };
      // New topic or language: untouched pages follow the typical structure of the new topic.
      const topicChanged = resolveCategory(next) !== resolveCategory(data) || next.language !== data.language;
      if (topicChanged && !data.pagesTouched) {
        next.pages = defaultPages(resolveCategory(next), data.multiPage, next.language);
        commit(next, { selectedPageId: next.pages[0].id, selectedSectionId: next.pages[0].sections[0]?.id ?? null });
        return;
      }
      commit(next);
    },

    updateContact: (partial) => {
      const data = get().data;
      commit({ ...data, contact: { ...data.contact, ...partial } });
    },

    setFeature: (key, value) => {
      const data = get().data;
      commit({ ...data, features: { ...data.features, [key]: value } });
    },

    setMultiPage: (multi) => {
      const data = get().data;
      if (multi === data.pages.length > 1 && multi === data.multiPage) return;
      const category = resolveCategory(data);
      let pages: WizardPage[];
      if (!data.pagesTouched) {
        pages = defaultPages(category, multi, data.language);
      } else if (multi) {
        // The typical page set; sections the user already has move (with their texts) to the
        // page they belong on, the rest stays on the home page.
        const remaining = [...data.pages[0].sections];
        const take = (kind: SectionKind): WizardSection => {
          const idx = remaining.findIndex((s) => s.kind === kind);
          return idx === -1 ? newSection(kind) : remaining.splice(idx, 1)[0];
        };
        const typical = defaultPages(category, true, data.language);
        const others = typical.slice(1).map((page) => ({ ...page, sections: page.sections.map((s) => take(s.kind)) }));
        // Home: the typical home sections (the user's own where they exist), then what is left
        // of the user's sections, before a closing call-to-action band.
        const homeSections = typical[0].sections.map((s) => take(s.kind));
        const ctaIdx = homeSections.findIndex((s) => s.kind === 'cta');
        homeSections.splice(ctaIdx === -1 ? homeSections.length : ctaIdx, 0, ...remaining);
        pages = [{ ...data.pages[0], sections: homeSections }, ...others];
      } else {
        // one page: every section of the other pages moves to the first page (no duplicates)
        const first = data.pages[0];
        const kinds = new Set(first.sections.map((s) => s.kind));
        const merged = [...first.sections];
        for (const page of data.pages.slice(1)) {
          for (const s of page.sections) {
            if (s.kind === 'custom' || !kinds.has(s.kind) || s.content.trim()) {
              merged.push(s);
              kinds.add(s.kind);
            }
          }
        }
        pages = [{ ...first, sections: merged }];
      }
      commit(
        { ...data, multiPage: multi, pages },
        { selectedPageId: pages[0].id, selectedSectionId: pages[0].sections[0]?.id ?? null }
      );
    },

    toggleSection: (kind) => {
      const data = get().data;
      const first = data.pages[0];
      const has = first.sections.some((s) => s.kind === kind);
      let sections: WizardSection[];
      if (has) {
        sections = first.sections.filter((s) => s.kind !== kind);
      } else {
        // insert at the position of the catalog order
        const order = (k: SectionKind) => SECTION_KINDS.indexOf(k);
        const index = first.sections.findIndex((s) => order(s.kind) > order(kind));
        sections = [...first.sections];
        sections.splice(index === -1 ? sections.length : index, 0, newSection(kind));
        // the contact section stays last, the hero first
        sections.sort((a, b) => (a.kind === 'hero' ? -1 : b.kind === 'hero' ? 1 : 0));
        const contactIdx = sections.findIndex((s) => s.kind === 'contact');
        if (contactIdx !== -1 && contactIdx !== sections.length - 1 && kind !== 'contact') {
          const [c] = sections.splice(contactIdx, 1);
          sections.push(c);
        }
      }
      withPages([{ ...first, sections }, ...data.pages.slice(1)]);
    },

    addPage: (templateId) => {
      const data = get().data;
      const template = PAGE_TEMPLATES.find((t) => t.id === templateId) || PAGE_TEMPLATES[PAGE_TEMPLATES.length - 1];
      const page: WizardPage = {
        id: newId('page'),
        name: data.language === 'en' ? template.en : template.tr,
        sections: template.sections.map(newSection),
      };
      // a new page goes before a trailing contact page
      const pages = [...data.pages];
      const last = pages[pages.length - 1];
      const beforeContact = pages.length > 1 && last.sections.length === 1 && last.sections[0].kind === 'contact' && templateId !== 'contact';
      pages.splice(beforeContact ? pages.length - 1 : pages.length, 0, page);
      withPages(pages);
      set({ selectedPageId: page.id, selectedSectionId: page.sections[0]?.id ?? null });
    },

    removePage: (pageId) => {
      const data = get().data;
      if (data.pages.length <= 1) return;
      const pages = data.pages.filter((p) => p.id !== pageId);
      withPages(pages);
      if (get().selectedPageId === pageId) set({ selectedPageId: pages[0].id, selectedSectionId: pages[0].sections[0]?.id ?? null });
    },

    renamePage: (pageId, name) => {
      const data = get().data;
      withPages(data.pages.map((p) => (p.id === pageId ? { ...p, name } : p)));
    },

    movePage: (pageId, delta) => {
      const data = get().data;
      withPages(move(data.pages, data.pages.findIndex((p) => p.id === pageId), delta));
    },

    addSection: (pageId, kind) => {
      const data = get().data;
      const section = newSection(kind);
      withPages(data.pages.map((p) => (p.id === pageId ? { ...p, sections: [...p.sections, section] } : p)));
      set({ selectedPageId: pageId, selectedSectionId: section.id });
    },

    removeSection: (pageId, sectionId) => {
      const data = get().data;
      const pages = data.pages.map((p) => (p.id === pageId ? { ...p, sections: p.sections.filter((s) => s.id !== sectionId) } : p));
      withPages(pages);
      if (get().selectedSectionId === sectionId) {
        const page = pages.find((p) => p.id === pageId);
        set({ selectedSectionId: page?.sections[0]?.id ?? null });
      }
    },

    moveSection: (pageId, sectionId, delta) => {
      const data = get().data;
      withPages(
        data.pages.map((p) =>
          p.id === pageId ? { ...p, sections: move(p.sections, p.sections.findIndex((s) => s.id === sectionId), delta) } : p
        )
      );
    },

    updateSection: (pageId, sectionId, partial) => {
      const data = get().data;
      withPages(
        data.pages.map((p) =>
          p.id === pageId ? { ...p, sections: p.sections.map((s) => (s.id === sectionId ? { ...s, ...partial } : s)) } : p
        )
      );
    },

    select: (pageId, sectionId) => set({ selectedPageId: pageId, selectedSectionId: sectionId }),
  };
});
