import React from 'react';
import { Select } from '@/components/common/Select';
import { useSiteWizardStore } from '@/stores/siteWizardStore';
import { SITE_TYPE_SUGGESTIONS, TONES, CATEGORY_OPTIONS, resolveCategory, Tone } from '@/lib/wizard/siteWizard';
import { DesignCategory } from '@/lib/design/themes';
import { Field, StepHeader, Segmented, Chip, inputClass, textareaClass, fill } from './wizardUi';
import type { WizardText } from './SiteWizard';

const TONE_LABEL: Record<Tone, keyof WizardText> = {
  samimi: 'toneSamimi',
  profesyonel: 'toneProfesyonel',
  eglenceli: 'toneEglenceli',
  zarif: 'toneZarif',
  sade: 'toneSade',
};

export const StepSite: React.FC<{ w: WizardText; showErrors: boolean }> = ({ w, showErrors }) => {
  const { data, update, updateContact } = useSiteWizardStore();
  const detailed = data.mode === 'detailed';
  const detected = resolveCategory({ ...data, category: 'auto' });

  return (
    <div className="space-y-5">
      <StepHeader title={w.stepSite} description={w.stepSiteDesc} />

      <div className="grid gap-5 md:grid-cols-2">
        <Field label={w.siteName} htmlFor="wz-name" required error={showErrors && !data.siteName.trim() ? w.siteNameRequired : undefined}>
          <input
            id="wz-name"
            autoFocus
            className={inputClass}
            value={data.siteName}
            maxLength={80}
            placeholder={w.siteNamePlaceholder}
            onChange={(e) => update({ siteName: e.target.value })}
          />
        </Field>
        <Field label={w.siteType} htmlFor="wz-type">
          <input
            id="wz-type"
            className={inputClass}
            value={data.siteType}
            maxLength={80}
            placeholder={w.siteTypePlaceholder}
            onChange={(e) => update({ siteType: e.target.value })}
          />
        </Field>
      </div>

      <div className="flex flex-wrap gap-1.5 -mt-2">
        {SITE_TYPE_SUGGESTIONS.map((type) => (
          <Chip key={type} selected={data.siteType.trim().toLocaleLowerCase('tr') === type.toLocaleLowerCase('tr')} onClick={() => update({ siteType: type })}>
            {type}
          </Chip>
        ))}
      </div>

      <Field label={w.description} htmlFor="wz-desc">
        <textarea
          id="wz-desc"
          rows={3}
          className={textareaClass}
          value={data.description}
          maxLength={1200}
          placeholder={w.descriptionPlaceholder}
          onChange={(e) => update({ description: e.target.value })}
        />
      </Field>

      <Field
        label={w.category}
        htmlFor="wz-cat"
        hint={data.category === 'auto' ? fill(w.categoryDetected, { name: w.categories[detected] }) : undefined}
      >
        <Select
          id="wz-cat"
          ariaLabel={w.category}
          className="w-full max-w-xs"
          value={data.category}
          onChange={(v) => update({ category: v as DesignCategory | 'auto' })}
          options={CATEGORY_OPTIONS.map((c) => ({
            value: c,
            label: c === 'auto' ? `${w.categoryAuto} (${w.categories[detected]})` : w.categories[c],
          }))}
        />
      </Field>

      {detailed ? (
        <div className="grid gap-5 md:grid-cols-2 pt-1">
          <Field label={w.slogan} htmlFor="wz-slogan">
            <input id="wz-slogan" className={inputClass} value={data.slogan} maxLength={140} placeholder={w.sloganPlaceholder} onChange={(e) => update({ slogan: e.target.value })} />
          </Field>
          <Field label={w.audience} htmlFor="wz-audience">
            <input id="wz-audience" className={inputClass} value={data.audience} maxLength={200} placeholder={w.audiencePlaceholder} onChange={(e) => update({ audience: e.target.value })} />
          </Field>
          <Field label={w.language}>
            <div>
              <Segmented
                ariaLabel={w.language}
                value={data.language}
                onChange={(language) => update({ language })}
                options={[
                  { value: 'tr', label: 'Türkçe' },
                  { value: 'en', label: 'English' },
                ]}
              />
            </div>
          </Field>
          <Field label={w.tone}>
            <div className="flex flex-wrap gap-1.5">
              {TONES.map((tone) => (
                <Chip key={tone} selected={data.tone === tone} onClick={() => update({ tone })}>
                  {w[TONE_LABEL[tone]] as string}
                </Chip>
              ))}
            </div>
          </Field>
        </div>
      ) : (
        <details className="group rounded-md border border-zinc-800 px-3.5 py-2.5">
          <summary className="cursor-pointer text-xs font-medium text-zinc-300 select-none">{w.optionalContact}</summary>
          <p className="text-[11px] text-zinc-500 mt-1.5">{w.optionalContactHint}</p>
          <div className="grid gap-4 md:grid-cols-3 mt-3">
            <Field label={w.phone} htmlFor="wz-s-phone">
              <input id="wz-s-phone" className={inputClass} value={data.contact.phone} maxLength={40} onChange={(e) => updateContact({ phone: e.target.value })} />
            </Field>
            <Field label={w.email} htmlFor="wz-s-email">
              <input id="wz-s-email" type="email" className={inputClass} value={data.contact.email} maxLength={120} onChange={(e) => updateContact({ email: e.target.value })} />
            </Field>
            <Field label={w.address} htmlFor="wz-s-address">
              <input id="wz-s-address" className={inputClass} value={data.contact.address} maxLength={240} onChange={(e) => updateContact({ address: e.target.value })} />
            </Field>
          </div>
        </details>
      )}
    </div>
  );
};
