import React from 'react';
import { useSiteWizardStore } from '@/stores/siteWizardStore';
import { FEATURE_KEYS, FeatureKey, WizardContact } from '@/lib/wizard/siteWizard';
import { Toggle } from '@/components/common/Toggle';
import { Field, StepHeader, Segmented, SettingRow, inputClass, textareaClass } from './wizardUi';
import type { WizardText } from './SiteWizard';

const FEATURE_LABELS: Record<FeatureKey, [keyof WizardText, keyof WizardText]> = {
  contactForm: ['featureContactForm', 'featureContactFormDesc'],
  mobileMenu: ['featureMobileMenu', 'featureMobileMenuDesc'],
  smoothScroll: ['featureSmoothScroll', 'featureSmoothScrollDesc'],
  faqAccordion: ['featureFaqAccordion', 'featureFaqAccordionDesc'],
  backToTop: ['featureBackToTop', 'featureBackToTopDesc'],
  revealAnimations: ['featureRevealAnimations', 'featureRevealAnimationsDesc'],
  darkModeToggle: ['featureDarkModeToggle', 'featureDarkModeToggleDesc'],
  whatsappButton: ['featureWhatsappButton', 'featureWhatsappButtonDesc'],
  mapEmbed: ['featureMapEmbed', 'featureMapEmbedDesc'],
  galleryLightbox: ['featureGalleryLightbox', 'featureGalleryLightboxDesc'],
  newsletter: ['featureNewsletter', 'featureNewsletterDesc'],
};

export const StepContact: React.FC<{ w: WizardText }> = ({ w }) => {
  const { data, updateContact } = useSiteWizardStore();
  const c = data.contact;
  const input = (key: keyof WizardContact, label: string, opts: { type?: string; placeholder?: string; max?: number } = {}) => (
    <Field label={label} htmlFor={`wz-c-${key}`}>
      <input
        id={`wz-c-${key}`}
        type={opts.type || 'text'}
        className={inputClass}
        value={c[key]}
        maxLength={opts.max || 160}
        placeholder={opts.placeholder}
        onChange={(e) => updateContact({ [key]: e.target.value } as Partial<WizardContact>)}
      />
    </Field>
  );
  return (
    <div className="space-y-5">
      <StepHeader title={w.stepContact} description={w.optionalContactHint} />
      <div className="grid gap-5 md:grid-cols-2">
        <Field label={w.address} htmlFor="wz-c-address">
          <textarea id="wz-c-address" rows={2} className={textareaClass} value={c.address} maxLength={300} onChange={(e) => updateContact({ address: e.target.value })} />
        </Field>
        <Field label={w.hours} htmlFor="wz-c-hours">
          <textarea id="wz-c-hours" rows={2} className={textareaClass} value={c.hours} maxLength={300} placeholder={w.hoursPlaceholder} onChange={(e) => updateContact({ hours: e.target.value })} />
        </Field>
        {input('phone', w.phone, { type: 'tel', max: 40 })}
        {input('email', w.email, { type: 'email', max: 120 })}
      </div>
      <div className="pt-1">
        <p className="text-xs font-medium text-zinc-300">{w.social}</p>
        <p className="text-[11px] text-zinc-500 mt-0.5 mb-3">{w.socialHint}</p>
        <div className="grid gap-4 md:grid-cols-3">
          {input('whatsapp', 'WhatsApp', { type: 'tel', max: 40 })}
          {input('instagram', 'Instagram')}
          {input('facebook', 'Facebook')}
          {input('x', 'X (Twitter)')}
          {input('linkedin', 'LinkedIn')}
          {input('youtube', 'YouTube')}
        </div>
      </div>
    </div>
  );
};

export const StepFeatures: React.FC<{ w: WizardText }> = ({ w }) => {
  const { data, update, setFeature } = useSiteWizardStore();
  return (
    <div className="space-y-6">
      <StepHeader title={w.stepFeatures} description={w.stepFeaturesDesc} />

      <div>
        <p className="text-xs font-medium text-zinc-300 mb-2.5">{w.features}</p>
        <div>
          {FEATURE_KEYS.map((key) => {
            const [label, desc] = FEATURE_LABELS[key];
            return (
              <SettingRow key={key} label={w[label] as string} description={w[desc] as string}>
                <Toggle checked={!!data.features[key]} onChange={(checked) => setFeature(key, checked)} />
              </SettingRow>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium text-zinc-300">{w.images}</span>
        <Segmented
          ariaLabel={w.images}
          value={data.images}
          onChange={(images) => update({ images })}
          options={[
            { value: 'placeholders', label: w.imagesPlaceholders, title: w.imagesPlaceholdersDesc },
            { value: 'photos', label: w.imagesPhotos, title: w.imagesPhotosDesc },
          ]}
        />
        <span className="text-[11px] text-zinc-500">{data.images === 'photos' ? w.imagesPhotosDesc : w.imagesPlaceholdersDesc}</span>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Field label={w.seoTitle} htmlFor="wz-seo-title">
          <input id="wz-seo-title" className={inputClass} value={data.seoTitle} maxLength={70} onChange={(e) => update({ seoTitle: e.target.value })} />
        </Field>
        <Field label={w.seoDescription} htmlFor="wz-seo-desc">
          <input id="wz-seo-desc" className={inputClass} value={data.seoDescription} maxLength={170} onChange={(e) => update({ seoDescription: e.target.value })} />
        </Field>
      </div>
    </div>
  );
};
