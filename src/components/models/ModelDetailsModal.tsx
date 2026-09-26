import React, { useState, useEffect } from 'react';
import { ChevronRight } from 'lucide-react';
import { Modal } from '../common/Modal';
import { useUIStore } from '@/stores/uiStore';
import { useModelStore } from '@/stores/modelStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTranslations } from '@/lib/localization/i18n';
import { OllamaShowResponse } from '@/types/ollama';
import { formatBytes } from '@/lib/utils/formatters';
import { cn } from '@/lib/utils/cn';

/** A value from model_info whatever the architecture prefix is ("qwen3.context_length", "llama.context_length"). */
function modelInfoValue(info: Record<string, any> | undefined, suffix: string): string | undefined {
  if (!info) return undefined;
  const key = Object.keys(info).find((k) => k === suffix || k.endsWith(`.${suffix}`));
  const value = key ? info[key] : undefined;
  return value === undefined || value === null ? undefined : String(value);
}

const Row: React.FC<{ label: string; value?: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-start justify-between gap-4 px-3 py-2.5">
    <span className="text-xs text-zinc-400 shrink-0">{label}</span>
    <span className="text-xs text-zinc-200 font-mono text-right min-w-0 break-words">{value || '—'}</span>
  </div>
);

const Folded: React.FC<{ label: string; content: string }> = ({ label, content }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
      >
        <ChevronRight size={13} className={cn('transition-transform', open && 'rotate-90')} />
        {label}
      </button>
      {open && (
        <pre className="mt-2 p-3 max-h-60 overflow-auto rounded-md bg-zinc-950 border border-zinc-800 font-mono text-[11px] text-zinc-400 whitespace-pre-wrap select-text">
          {content}
        </pre>
      )}
    </div>
  );
};

export const ModelDetailsModal: React.FC = () => {
  const { isModelDetailsOpen, closeModelDetails, inspectingModelName } = useUIStore();
  const { inspectModel, installedModels } = useModelStore();
  const { settings } = useSettingsStore();
  const t = getTranslations(settings.language);

  const [details, setDetails] = useState<OllamaShowResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isModelDetailsOpen && inspectingModelName) {
      setIsLoading(true);
      inspectModel(inspectingModelName).then((res) => {
        setDetails(res);
        setIsLoading(false);
      });
    }
  }, [isModelDetailsOpen, inspectingModelName]);

  if (!isModelDetailsOpen) return null;

  const installedMeta = installedModels.find((m) => m.name === inspectingModelName);
  const info = details?.model_info as Record<string, any> | undefined;

  return (
    <Modal
      isOpen={isModelDetailsOpen}
      onClose={closeModelDetails}
      title={inspectingModelName}
      subtitle={installedMeta ? formatBytes(installedMeta.size) : undefined}
      width="max-w-lg"
    >
      {isLoading ? (
        <p className="py-10 text-center text-xs text-zinc-500">{t.common.loading}</p>
      ) : !details ? (
        <p className="py-10 text-center text-xs text-zinc-500">{t.modelDetails.noInfo}</p>
      ) : (
        <div className="space-y-4">
          <div className="rounded-md border border-zinc-800 divide-y divide-zinc-800">
            <Row label={t.modelDetails.family} value={details.details?.family} />
            <Row label={t.models.parameters} value={details.details?.parameter_size} />
            <Row label={t.models.quantization} value={details.details?.quantization_level} />
            <Row label={t.modelDetails.format} value={details.details?.format} />
            <Row label={t.modelDetails.contextLength} value={modelInfoValue(info, 'context_length')} />
            <Row label={t.modelDetails.embeddingLength} value={modelInfoValue(info, 'embedding_length')} />
            <Row label={t.common.capabilities} value={details.capabilities?.length ? details.capabilities.join(', ') : undefined} />
            <Row label={t.modelDetails.modified} value={details.modified_at ? new Date(details.modified_at).toLocaleString() : undefined} />
          </div>

          {details.parameters && <Folded label={t.modelDetails.parametersRaw} content={details.parameters} />}
          {details.template && <Folded label={t.modelDetails.template} content={details.template} />}
        </div>
      )}
    </Modal>
  );
};
