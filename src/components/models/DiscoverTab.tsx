import React, { useState } from 'react';
import { Download, Search, Check, Sparkles, AlertCircle } from 'lucide-react';
import { CURATED_DISCOVER_MODELS } from '@/lib/ollama/ModelService';
import { useModelStore } from '@/stores/modelStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTranslations } from '@/lib/localization/i18n';
import { getHardwareGuidance } from '@/types/hardware';
import { Button } from '../common/Button';
import { cn } from '@/lib/utils/cn';

export const DiscoverTab: React.FC = () => {
  const [search, setSearch] = useState('');
  const [customTag, setCustomTag] = useState('');
  const [isPullingCustom, setIsPullingCustom] = useState(false);

  const { installedModels, downloads, pullModel } = useModelStore();
  const { settings, hardware } = useSettingsStore();
  const t = getTranslations(settings.language);

  const installedSet = new Set(installedModels.map((m) => m.name));
  const ramGb = hardware?.ram.totalGb || 16;

  const filtered = CURATED_DISCOVER_MODELS.filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase().trim()) ||
      m.id.toLowerCase().includes(search.toLowerCase().trim()) ||
      m.family.toLowerCase().includes(search.toLowerCase().trim())
  );

  const handlePullCustom = async () => {
    if (!customTag.trim()) return;
    setIsPullingCustom(true);
    try {
      await pullModel(customTag.trim());
      setCustomTag('');
    } catch (err: any) {
      alert(`Download error: ${err.message}`);
    } finally {
      setIsPullingCustom(false);
    }
  };

  const handlePull = async (id: string) => {
    try {
      await pullModel(id);
    } catch (err: any) {
      alert(`Download error: ${err.message}`);
    }
  };

  return (
    <div className="space-y-4 text-xs">
      {/* Search & Custom Pull Bar */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-2.5 text-zinc-500 pointer-events-none" strokeWidth={1.5} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.models.searchDiscoverPlaceholder}
            className="w-full h-8 pl-8 pr-3 rounded bg-zinc-950/60 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-700"
          />
        </div>

        {/* Custom model tag puller */}
        <div className="flex gap-1.5">
          <input
            type="text"
            value={customTag}
            onChange={(e) => setCustomTag(e.target.value)}
            placeholder="Pull any Ollama model (e.g. mistral-nemo)..."
            className="flex-1 h-8 px-3 rounded bg-zinc-950/60 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-700 font-mono"
            onKeyDown={(e) => e.key === 'Enter' && handlePullCustom()}
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={!customTag.trim() || isPullingCustom}
            icon={<Download size={13} strokeWidth={1.5} />}
            onClick={handlePullCustom}
          >
            {t.models.downloadAction}
          </Button>
        </div>
      </div>

      {/* Catalog Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {filtered.map((item) => {
          const isInstalled = installedSet.has(item.id);
          const isDownloading = !!downloads[item.id];
          const guidance = getHardwareGuidance(item.parameterSize, ramGb);

          return (
            <div
              key={item.id}
              className="p-3.5 rounded-lg border border-zinc-800/40 bg-zinc-950/40 hover:border-zinc-700/50 flex flex-col justify-between transition-colors space-y-2.5"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h4 className="font-semibold text-zinc-100 text-sm">{item.name}</h4>
                    <div className="flex items-center gap-1.5 text-zinc-500 text-[11px] font-mono mt-0.5">
                      <span>{item.parameterSize}</span>
                      <span>·</span>
                      <span>{item.approxSize}</span>
                    </div>
                  </div>

                  {/* Hardware Guidance Tag */}
                  {guidance.category === 'recommended' && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-950 border border-emerald-800/60 text-emerald-400 font-medium shrink-0">
                      {t.models.recommendedForSystem}
                    </span>
                  )}
                  {guidance.category === 'lightweight' && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-950 border border-blue-800/60 text-blue-400 font-medium shrink-0">
                      {t.models.lightweight}
                    </span>
                  )}
                  {guidance.category === 'demanding' && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-950 border border-amber-800/60 text-amber-400 font-medium shrink-0">
                      {t.models.larger}
                    </span>
                  )}
                </div>

                <p className="text-zinc-400 text-xs mt-2 leading-relaxed">
                  {item.description}
                </p>

                {/* Capabilities tags */}
                <div className="flex flex-wrap gap-1 mt-2.5">
                  {item.capabilities.map((cap) => (
                    <span
                      key={cap}
                      className="px-1.5 py-0.2 rounded bg-zinc-800/60 text-zinc-400 text-[10px] font-mono"
                    >
                      {cap}
                    </span>
                  ))}
                </div>
              </div>

              {/* Action Button */}
              <div className="pt-2 border-t border-zinc-800/40 flex items-center justify-between">
                <span className="text-[11px] text-zinc-500 font-mono">
                  {item.id}
                </span>

                {isInstalled ? (
                  <div className="flex items-center gap-1 text-emerald-400 text-xs font-medium">
                    <Check size={14} strokeWidth={1.5} />
                    <span>Installed</span>
                  </div>
                ) : isDownloading ? (
                  <div className="flex items-center gap-1 text-blue-400 text-xs font-medium animate-pulse">
                    <Download size={13} strokeWidth={1.5} />
                    <span>{downloads[item.id].percentage}%</span>
                  </div>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<Download size={13} strokeWidth={1.5} />}
                    onClick={() => handlePull(item.id)}
                  >
                    {t.models.downloadAction}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
