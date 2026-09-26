import React from 'react';
import { ArrowUp, ArrowDown, X, Plus, FileText } from 'lucide-react';
import { useSiteWizardStore, PAGE_TEMPLATES } from '@/stores/siteWizardStore';
import { SECTION_KINDS, SECTION_INFO, SectionKind, pageFiles } from '@/lib/wizard/siteWizard';
import { StepHeader, Segmented, Chip, IconAction, MenuButton, inputClass } from './wizardUi';
import type { WizardText } from './SiteWizard';

export const sectionLabel = (kind: SectionKind, lang: 'tr' | 'en') => (lang === 'en' ? SECTION_INFO[kind].en : SECTION_INFO[kind].tr);

/** Simple mode: one page with section toggles, or a page list built from templates. */
export const StepStructure: React.FC<{ w: WizardText; lang: 'tr' | 'en' }> = ({ w, lang }) => {
  const { data, setMultiPage, toggleSection, moveSection, removeSection, addPage, removePage, renamePage, movePage } = useSiteWizardStore();
  const multi = data.pages.length > 1;
  const first = data.pages[0];
  const files = pageFiles(data.pages);

  return (
    <div className="space-y-5">
      <StepHeader title={w.stepStructure} description={w.stepStructureDesc} />

      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          ariaLabel={w.stepStructure}
          value={multi ? 'multi' : 'single'}
          onChange={(v) => setMultiPage(v === 'multi')}
          options={[
            { value: 'single', label: w.singlePage },
            { value: 'multi', label: w.multiPage },
          ]}
        />
        <span className="text-[11px] text-zinc-500">{multi ? w.multiPageHint : w.singlePageHint}</span>
      </div>

      {!multi ? (
        <>
          <div>
            <p className="text-xs font-medium text-zinc-300 mb-1">{w.sections}</p>
            <p className="text-[11px] text-zinc-500 mb-2.5">{w.sectionsHint}</p>
            <div className="flex flex-wrap gap-1.5">
              {SECTION_KINDS.filter((k) => k !== 'custom').map((kind) => (
                <Chip key={kind} selected={first.sections.some((s) => s.kind === kind)} onClick={() => toggleSection(kind)}>
                  {sectionLabel(kind, lang)}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-zinc-300 mb-2">{w.order}</p>
            {first.sections.length === 0 ? (
              <p className="text-xs text-zinc-500 italic">{w.noSections}</p>
            ) : (
              <ol className="space-y-1.5 max-w-lg">
                {first.sections.map((s, i) => (
                  <li key={s.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-950/50 border border-zinc-800/80">
                    <span className="w-5 text-[11px] font-mono text-zinc-600">{i + 1}</span>
                    <span className="flex-1 text-[13px] text-zinc-200">{s.title.trim() || sectionLabel(s.kind, lang)}</span>
                    <IconAction label={w.moveUp} disabled={i === 0} onClick={() => moveSection(first.id, s.id, -1)}>
                      <ArrowUp size={13} />
                    </IconAction>
                    <IconAction label={w.moveDown} disabled={i === first.sections.length - 1} onClick={() => moveSection(first.id, s.id, 1)}>
                      <ArrowDown size={13} />
                    </IconAction>
                    <IconAction label={w.removeSection} danger onClick={() => removeSection(first.id, s.id)}>
                      <X size={13} />
                    </IconAction>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-medium text-zinc-300">{w.pages}</p>
          <ol className="space-y-2">
            {data.pages.map((page, i) => (
              <li key={page.id} className="rounded-lg bg-zinc-950/50 border border-zinc-800/80 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <FileText size={14} className="text-zinc-500 shrink-0" />
                  <input
                    aria-label={w.pageName}
                    className={`${inputClass} h-8 max-w-[220px]`}
                    value={page.name}
                    maxLength={40}
                    onChange={(e) => renamePage(page.id, e.target.value)}
                  />
                  <span className="text-[11px] font-mono text-zinc-600 truncate">{files[i]}</span>
                  <span className="ml-auto flex items-center">
                    <IconAction label={w.moveUp} disabled={i <= 1} onClick={() => movePage(page.id, -1)}>
                      <ArrowUp size={13} />
                    </IconAction>
                    <IconAction label={w.moveDown} disabled={i === 0 || i === data.pages.length - 1} onClick={() => movePage(page.id, 1)}>
                      <ArrowDown size={13} />
                    </IconAction>
                    <IconAction label={w.removePage} danger disabled={i === 0} onClick={() => removePage(page.id)}>
                      <X size={13} />
                    </IconAction>
                  </span>
                </div>
                <div className="flex flex-wrap gap-1 mt-2 pl-6">
                  {page.sections.map((s) => (
                    <span key={s.id} className="text-[10.5px] px-2 py-0.5 rounded-full bg-zinc-800/70 text-zinc-400 border border-zinc-700/60">
                      {s.title.trim() || sectionLabel(s.kind, lang)}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ol>
          <MenuButton
            label={w.addPage}
            icon={<Plus size={12} />}
            items={PAGE_TEMPLATES.map((t) => ({ id: t.id, label: lang === 'en' ? t.en : t.tr, hint: t.sections.map((k) => sectionLabel(k, lang)).join(', ') }))}
            onPick={addPage}
          />
        </div>
      )}
    </div>
  );
};
