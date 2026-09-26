import React, { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { ParamField, ParamValue, ParamValues, Lang, tx, valueOf, isVisible } from '@/lib/wizard/params';
import { Toggle } from '@/components/common/Toggle';
import { inputClass, textareaClass, Segmented, SettingRow } from './wizardUi';
import { cn } from '@/lib/utils/cn';

/** A number box that accepts free typing and stores the clamped value when it is complete. */
const NumberInput: React.FC<{
  id: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}> = ({ id, value, min, max, step, onChange }) => {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = (raw: string) => {
    const n = Number(raw.replace(',', '.'));
    if (raw.trim() === '' || !Number.isFinite(n)) {
      setText(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, n));
    setText(String(clamped));
    if (clamped !== value) onChange(clamped);
  };
  return (
    <input
      id={id}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      step={step ?? 1}
      value={text}
      title={`${min}–${max}`}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() !== '' && Number.isFinite(n) && n >= min && n <= max) onChange(n);
      }}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
      }}
      className={cn(inputClass, 'w-20 text-right tabular-nums')}
    />
  );
};

/** One parameter of a tool as a settings row, rendered from its schema. */
const ParamRow: React.FC<{
  field: ParamField;
  value: ParamValue;
  lang: Lang;
  idPrefix: string;
  listHint: string;
  onChange: (value: ParamValue) => void;
}> = ({ field, value, lang, idPrefix, listHint, onChange }) => {
  const id = `${idPrefix}-${field.key}`;
  const label = tx(field.label, lang);
  const hint = field.hint ? tx(field.hint, lang) : undefined;

  switch (field.type) {
    case 'toggle':
      return (
        <SettingRow label={label} description={hint}>
          <Toggle checked={value as boolean} onChange={onChange} />
        </SettingRow>
      );

    case 'choice': {
      const compact = field.options.length <= 4 && field.options.every((o) => tx(o.label, lang).length <= 14);
      return (
        <SettingRow label={label} htmlFor={compact ? undefined : id} description={hint}>
          {compact ? (
            <Segmented
              size="sm"
              ariaLabel={label}
              value={value as string}
              onChange={(v) => onChange(v)}
              options={field.options.map((o) => ({ value: o.value, label: tx(o.label, lang) }))}
            />
          ) : (
            <select id={id} value={value as string} onChange={(e) => onChange(e.target.value)} className={cn(inputClass, 'w-48 cursor-pointer')}>
              {field.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {tx(o.label, lang)}
                </option>
              ))}
            </select>
          )}
        </SettingRow>
      );
    }

    case 'multi': {
      const selected = value as string[];
      const min = field.min ?? 0;
      return (
        <SettingRow label={label} description={hint} stacked>
          <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
            {field.options.map((o) => {
              const active = selected.includes(o.value);
              const locked = active && selected.length <= min;
              return (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={active}
                  aria-disabled={locked}
                  onClick={() => {
                    if (locked) return;
                    onChange(active ? selected.filter((v) => v !== o.value) : field.options.filter((x) => x.value === o.value || selected.includes(x.value)).map((x) => x.value));
                  }}
                  className={cn(
                    'inline-flex items-center gap-1 h-7 px-2.5 rounded border text-xs transition-colors',
                    active ? 'bg-zinc-700/80 border-zinc-600 text-zinc-100' : 'bg-transparent border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700',
                    locked ? 'cursor-default' : 'cursor-pointer'
                  )}
                >
                  {active && <Check size={12} strokeWidth={2} />}
                  {tx(o.label, lang)}
                </button>
              );
            })}
          </div>
        </SettingRow>
      );
    }

    case 'number':
      return (
        <SettingRow label={label} htmlFor={id} description={hint}>
          <NumberInput id={id} value={value as number} min={field.min} max={field.max} step={field.step} onChange={onChange} />
          {field.unit && <span className="text-xs text-zinc-500 w-6">{tx(field.unit, lang)}</span>}
        </SettingRow>
      );

    case 'text':
      return (
        <SettingRow label={label} htmlFor={id} description={hint}>
          <input
            id={id}
            type="text"
            value={value as string}
            maxLength={field.maxLength}
            placeholder={field.placeholder ? tx(field.placeholder, lang) : undefined}
            onChange={(e) => onChange(e.target.value)}
            className={cn(inputClass, 'w-56')}
          />
        </SettingRow>
      );

    case 'list':
      return (
        <SettingRow label={label} htmlFor={id} description={hint || listHint} stacked>
          <textarea
            id={id}
            rows={4}
            value={value as string}
            placeholder={field.placeholder ? tx(field.placeholder, lang) : undefined}
            onChange={(e) => onChange(e.target.value)}
            className={cn(textareaClass, 'font-mono')}
          />
        </SettingRow>
      );
  }
};

/**
 * The settings of a tool: visible fields in schema order, one row each. Labels follow the app's
 * language; default values follow `valueLang` (a mini app in English gets English sample lists).
 */
export const ParamRows: React.FC<{
  fields: ParamField[];
  values: ParamValues;
  lang: Lang;
  valueLang?: Lang;
  idPrefix: string;
  listHint: string;
  onChange: (key: string, value: ParamValue) => void;
}> = ({ fields, values, lang, valueLang = lang, idPrefix, listHint, onChange }) => (
  <div>
    {fields
      .filter((f) => isVisible(f, fields, values, valueLang))
      .map((field) => (
        <ParamRow
          key={field.key}
          field={field}
          value={valueOf(field, values, valueLang)}
          lang={lang}
          idPrefix={idPrefix}
          listHint={listHint}
          onChange={(v) => onChange(field.key, v)}
        />
      ))}
  </div>
);
