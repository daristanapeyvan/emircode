import React from 'react';
import { ArrowUp, ArrowDown, X, Plus, FileText, PenLine, Bot } from 'lucide-react';
import { useSiteWizardStore, PAGE_TEMPLATES } from '@/stores/siteWizardStore';
import { SECTION_KINDS, pageFiles, sectionAnchors } from '@/lib/wizard/siteWizard';
import { RichTextArea } from '@/components/common/RichTextArea';
import { StepHeader, Segmented, IconAction, MenuButton, Field, inputClass, editorLabels } from './wizardUi';
import { sectionLabel } from './StepStructure';
import { cn } from '@/lib/utils/cn';
import type { WizardText } from './SiteWizard';

/** Detailed mode: pages, their sections and the text of every section. */
export const StepPages: React.FC<{ w: WizardText; lang: 'tr' | 'en' }> = ({ w, lang }) => {
  const {
    data,
    selectedPageId,
    selectedSectionId,
    select,
    setMultiPage,
    addPage,
    removePage,
    renamePage,
    movePage,
    addSection,
    removeSection,
    moveSection,
    updateSection,
  } = useSiteWizardStore();
  const multi = data.pages.length > 1;
  const files = pageFiles(data.pages);
  const pageIndex = Math.max(0, data.pages.findIndex((p) => p.id === selectedPageId));
  const page = data.pages[pageIndex];
  const anchors = sectionAnchors(page, data.language);
  const section = page.sections.find((s) => s.id === selectedSectionId) || null;
  const sectionIndex = section ? page.sections.indexOf(section) : -1;

  return (
    <div className="space-y-4">
      <StepHeader title={w.stepPages} description={w.sectionContentHint} />

      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          ariaLabel={w.stepPages}
          value={multi ? 'multi' : 'single'}
          onChange={(v) => setMultiPage(v === 'multi')}
          options={[
            { value: 'single', label: w.singlePage },
            { value: 'multi', label: w.multiPage },
          ]}
        />
        <span className="text-[11px] text-zinc-500">{multi ? w.multiPageHint : w.singlePageHint}</span>
      </div>

      <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* Left: pages and sections */}
        <div className="space-y-4 min-w-0">
          {multi && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-zinc-400">{w.pages}</p>
              <ul className="space-y-1" role="listbox" aria-label={w.pages}>
                {data.pages.map((p, i) => (
                  <li key={p.id}>
                    <div
                      role="option"
                      aria-selected={i === pageIndex}
                      aria-label={`${p.name.trim() || files[i]} (${files[i]})`}
                      tabIndex={0}
                      onClick={() => select(p.id, p.sections[0]?.id ?? null)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          select(p.id, p.sections[0]?.id ?? null);
                        }
                      }}
                      className={cn(
                        'flex items-center gap-2 px-2.5 py-1.5 rounded border cursor-pointer transition-colors',
                        i === pageIndex ? 'bg-zinc-800/70 border-zinc-700 text-zinc-100' : 'bg-zinc-950/40 border-zinc-800/70 text-zinc-400 hover:text-zinc-200'
                      )}
                    >
                      <FileText size={13} className="shrink-0 opacity-70" />
                      <span className="flex-1 min-w-0">
                        <span className="block text-[13px] truncate">{p.name.trim() || files[i]}</span>
                        <span className="block text-[11px] font-mono text-zinc-600 truncate">{files[i]}</span>
                      </span>
                      <IconAction label={w.moveUp} disabled={i <= 1} onClick={() => movePage(p.id, -1)}>
                        <ArrowUp size={12} />
                      </IconAction>
                      <IconAction label={w.moveDown} disabled={i === 0 || i === data.pages.length - 1} onClick={() => movePage(p.id, 1)}>
                        <ArrowDown size={12} />
                      </IconAction>
                      <IconAction label={w.removePage} danger disabled={i === 0} onClick={() => removePage(p.id)}>
                        <X size={12} />
                      </IconAction>
                    </div>
                  </li>
                ))}
              </ul>
              <MenuButton
                label={w.addPage}
                icon={<Plus size={12} />}
                items={PAGE_TEMPLATES.map((t) => ({ id: t.id, label: lang === 'en' ? t.en : t.tr, hint: t.sections.map((k) => sectionLabel(k, lang)).join(', ') }))}
                onPick={addPage}
              />
            </div>
          )}

          <div className="space-y-1.5">
            {multi && (
              <Field label={w.pageName} htmlFor="wz-page-name">
                <input
                  id="wz-page-name"
                  className={`${inputClass} h-8`}
                  value={page.name}
                  maxLength={40}
                  onChange={(e) => renamePage(page.id, e.target.value)}
                />
              </Field>
            )}
            <p className="text-xs font-medium text-zinc-400 pt-1">
              {w.sections} · <span className="font-mono normal-case tracking-normal text-zinc-600">{files[pageIndex]}</span>
            </p>
            {page.sections.length === 0 && <p className="text-xs text-zinc-500 italic">{w.noSections}</p>}
            <ul className="space-y-1" role="listbox" aria-label={w.sections}>
              {page.sections.map((s, i) => {
                const own = !!s.content.trim();
                return (
                  <li key={s.id}>
                    <div
                      role="option"
                      aria-selected={s.id === selectedSectionId}
                      aria-label={`${s.title.trim() || sectionLabel(s.kind, lang)} — ${own ? w.yourText : w.agentWrites}`}
                      tabIndex={0}
                      onClick={() => select(page.id, s.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          select(page.id, s.id);
                        }
                      }}
                      className={cn(
                        'flex items-center gap-2 px-2.5 py-1.5 rounded border cursor-pointer transition-colors',
                        s.id === selectedSectionId ? 'bg-zinc-800 border-zinc-600 text-zinc-100' : 'bg-zinc-900 border-zinc-800/70 text-zinc-400 hover:text-zinc-200'
                      )}
                    >
                      <span className={cn('shrink-0', own ? 'text-zinc-200' : 'text-zinc-600')} title={own ? w.yourText : w.agentWrites}>
                        {own ? <PenLine size={12} /> : <Bot size={12} />}
                      </span>
                      <span className="flex-1 min-w-0 text-[13px] truncate">{s.title.trim() || sectionLabel(s.kind, lang)}</span>
                      <IconAction label={w.moveUp} disabled={i === 0} onClick={() => moveSection(page.id, s.id, -1)}>
                        <ArrowUp size={12} />
                      </IconAction>
                      <IconAction label={w.moveDown} disabled={i === page.sections.length - 1} onClick={() => moveSection(page.id, s.id, 1)}>
                        <ArrowDown size={12} />
                      </IconAction>
                      <IconAction label={w.removeSection} danger onClick={() => removeSection(page.id, s.id)}>
                        <X size={12} />
                      </IconAction>
                    </div>
                  </li>
                );
              })}
            </ul>
            <MenuButton
              label={w.addSection}
              icon={<Plus size={12} />}
              items={SECTION_KINDS.map((k) => ({ id: k, label: sectionLabel(k, lang) }))}
              onPick={(kind) => addSection(page.id, kind as (typeof SECTION_KINDS)[number])}
            />
          </div>
        </div>

        {/* Right: the selected section */}
        <div className="min-w-0 rounded-md border border-zinc-800/80 bg-zinc-900 p-4">
          {section ? (
            <div className="space-y-4">
              <div className="flex items-baseline justify-between gap-3">
                <h4 className="text-sm font-semibold text-zinc-100">
                  {sectionLabel(section.kind, lang)}
                  <span className="ml-2 font-mono text-[11px] font-normal text-zinc-500">#{anchors[sectionIndex]}</span>
                </h4>
                <span className={cn('text-[11px] px-2 py-0.5 rounded border', section.content.trim() ? 'text-zinc-200 border-zinc-600 bg-zinc-800' : 'text-zinc-400 border-zinc-700 bg-zinc-800/50')}>
                  {section.content.trim() ? w.yourText : w.agentWrites}
                </span>
              </div>
              <Field label={w.sectionTitle} htmlFor="wz-sec-title">
                <input
                  id="wz-sec-title"
                  className={inputClass}
                  value={section.title}
                  maxLength={120}
                  placeholder={w.sectionTitlePlaceholder}
                  onChange={(e) => updateSection(page.id, section.id, { title: e.target.value })}
                />
              </Field>
              <Field label={w.sectionContent} hint={w.sectionContentHint}>
                <RichTextArea
                  key={section.id}
                  ariaLabel={w.sectionContent}
                  value={section.content}
                  onChange={(content) => updateSection(page.id, section.id, { content })}
                  placeholder={w.editorPlaceholder}
                  labels={editorLabels(w)}
                />
              </Field>
              <Field label={w.sectionNotes} htmlFor="wz-sec-notes">
                <input
                  id="wz-sec-notes"
                  className={inputClass}
                  value={section.notes}
                  maxLength={300}
                  placeholder={w.sectionNotesPlaceholder}
                  onChange={(e) => updateSection(page.id, section.id, { notes: e.target.value })}
                />
              </Field>
            </div>
          ) : (
            <p className="text-xs text-zinc-500 italic py-10 text-center">{w.selectSection}</p>
          )}
        </div>
      </div>
    </div>
  );
};
