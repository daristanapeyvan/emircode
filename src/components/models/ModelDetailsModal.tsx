import React, { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';
import { Tabs } from '../common/Tabs';
import { useUIStore } from '@/stores/uiStore';
import { useModelStore } from '@/stores/modelStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTranslations } from '@/lib/localization/i18n';
import { OllamaShowResponse } from '@/types/ollama';
import { formatBytes } from '@/lib/utils/formatters';

export const ModelDetailsModal: React.FC = () => {
  const { isModelDetailsOpen, closeModelDetails, inspectingModelName } = useUIStore();
  const { inspectModel, installedModels } = useModelStore();
  const { settings } = useSettingsStore();
  const t = getTranslations(settings.language);

  const [activeTab, setActiveTab] = useState('overview');
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

  const tabs = [
    { id: 'overview', label: t.common.overview },
    { id: 'capabilities', label: t.common.capabilities },
    { id: 'parameters', label: t.common.parameters },
    { id: 'runtime', label: t.common.runtime },
  ];

  return (
    <Modal
      isOpen={isModelDetailsOpen}
      onClose={closeModelDetails}
      title={inspectingModelName}
      subtitle={installedMeta ? formatBytes(installedMeta.size) : undefined}
      width="max-w-2xl"
    >
      <div className="space-y-4 text-xs">
        <Tabs
          tabs={tabs}
          activeTab={activeTab}
          onChange={setActiveTab}
        />

        {isLoading ? (
          <div className="py-12 text-center text-zinc-500">
            {t.common.loading}
          </div>
        ) : !details ? (
          <div className="py-12 text-center text-zinc-500">
            No information available from backend.
          </div>
        ) : (
          <div className="py-1">
            {/* Overview Tab */}
            {activeTab === 'overview' && (
              <div className="space-y-2.5">
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="p-3 bg-zinc-950/60 rounded border border-zinc-800/40">
                    <span className="text-zinc-500 block text-[11px] mb-0.5">{t.modelDetails.family}</span>
                    <span className="text-zinc-200 font-mono font-medium">{details.details?.family || 'Unknown'}</span>
                  </div>
                  <div className="p-3 bg-zinc-950/60 rounded border border-zinc-800/40">
                    <span className="text-zinc-500 block text-[11px] mb-0.5">{t.models.parameters}</span>
                    <span className="text-zinc-200 font-mono font-medium">{details.details?.parameter_size || 'N/A'}</span>
                  </div>
                  <div className="p-3 bg-zinc-950/60 rounded border border-zinc-800/40">
                    <span className="text-zinc-500 block text-[11px] mb-0.5">{t.models.quantization}</span>
                    <span className="text-zinc-200 font-mono font-medium">{details.details?.quantization_level || 'N/A'}</span>
                  </div>
                  <div className="p-3 bg-zinc-950/60 rounded border border-zinc-800/40">
                    <span className="text-zinc-500 block text-[11px] mb-0.5">{t.modelDetails.format}</span>
                    <span className="text-zinc-200 font-mono font-medium">{details.details?.format || 'gguf'}</span>
                  </div>
                </div>

                {details.modified_at && (
                  <div className="p-3 bg-zinc-950/60 rounded border border-zinc-800/40">
                    <span className="text-zinc-500 block text-[11px] mb-0.5">{t.modelDetails.modified}</span>
                    <span className="text-zinc-300 font-mono">{new Date(details.modified_at).toLocaleString()}</span>
                  </div>
                )}
              </div>
            )}

            {/* Capabilities Tab */}
            {activeTab === 'capabilities' && (
              <div className="space-y-3">
                <p className="text-zinc-400 leading-relaxed">
                  Capabilities reported directly by Ollama metadata:
                </p>
                <div className="flex flex-wrap gap-2">
                  {details.capabilities && details.capabilities.length > 0 ? (
                    details.capabilities.map((cap) => (
                      <div
                        key={cap}
                        className="px-3 py-1.5 rounded bg-zinc-800 border border-zinc-700/60 text-zinc-200 font-mono text-xs flex items-center gap-1.5"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                        <span>{cap}</span>
                      </div>
                    ))
                  ) : (
                    <span className="text-zinc-500">No explicit capabilities tags provided.</span>
                  )}
                </div>
              </div>
            )}

            {/* Parameters Tab */}
            {activeTab === 'parameters' && (
              <div className="space-y-3">
                {details.parameters ? (
                  <div className="p-3 bg-zinc-950/60 rounded border border-zinc-800/40 font-mono text-[11px] text-zinc-300 leading-relaxed whitespace-pre-wrap selectable-text">
                    {details.parameters}
                  </div>
                ) : (
                  <div className="text-zinc-500">No explicit parameters declared.</div>
                )}
              </div>
            )}

            {/* Runtime Tab */}
            {activeTab === 'runtime' && (
              <div className="space-y-2.5">
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="p-3 bg-zinc-950/60 rounded border border-zinc-800/40">
                    <span className="text-zinc-500 block text-[11px] mb-0.5">Context Length</span>
                    <span className="text-zinc-200 font-mono font-medium">
                      {details.model_info?.['qwen3.context_length'] || details.model_info?.['general.context_length'] || '4096'}
                    </span>
                  </div>
                  <div className="p-3 bg-zinc-950/60 rounded border border-zinc-800/40">
                    <span className="text-zinc-500 block text-[11px] mb-0.5">Embedding Length</span>
                    <span className="text-zinc-200 font-mono font-medium">
                      {details.model_info?.['qwen3.embedding_length'] || details.model_info?.['general.embedding_length'] || 'N/A'}
                    </span>
                  </div>
                </div>

                {details.template && (
                  <div className="space-y-1">
                    <span className="text-zinc-500 block text-[11px]">{t.modelDetails.template}</span>
                    <div className="p-3 bg-zinc-950/60 rounded border border-zinc-800/40 font-mono text-[10px] text-zinc-400 max-h-48 overflow-y-auto whitespace-pre-wrap selectable-text">
                      {details.template}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};
