import React from 'react';
import { ShieldCheck, Cpu, HardDrive } from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTranslations } from '@/lib/localization/i18n';
import { AppLogo } from '../common/AppLogo';

export const AboutSettings: React.FC = () => {
  const { settings, hardware } = useSettingsStore();
  const t = getTranslations(settings.language);

  return (
    <div className="space-y-4 text-xs">
      {/* App Header */}
      <div className="p-4 rounded-lg border border-zinc-800/40 bg-zinc-950/60 flex items-center gap-3.5">
        <AppLogo size={32} />
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">{t.settings.aboutTitle}</h3>
          <p className="text-zinc-500 text-[11px] font-mono mt-0.5">{t.settings.version} 1.0.0 · Windows Native Client</p>
        </div>
      </div>

      {/* Hardware info */}
      {hardware && (
        <div className="p-3.5 rounded-lg border border-zinc-800/40 bg-zinc-950/40 space-y-2.5">
          <span className="text-zinc-400 font-medium block">Detected Host Hardware</span>
          <div className="space-y-1.5 font-mono text-[11px] text-zinc-300">
            <div className="flex items-center gap-2">
              <Cpu size={13} className="text-zinc-500 shrink-0" strokeWidth={1.5} />
              <span className="truncate">{hardware.cpu.model} ({hardware.cpu.logicalProcessors} logical cores)</span>
            </div>
            <div className="flex items-center gap-2">
              <HardDrive size={13} className="text-zinc-500 shrink-0" strokeWidth={1.5} />
              <span>{hardware.ram.totalGb} GB Total RAM ({hardware.ram.availableGb} GB Available)</span>
            </div>
            {hardware.gpu && (
              <div className="flex items-center gap-2 text-zinc-400">
                <span className="w-3 h-3 flex items-center justify-center text-[10px] font-bold text-zinc-500">GPU</span>
                <span>{hardware.gpu.model}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Privacy Notice */}
      <div className="p-3.5 rounded-lg border border-zinc-800/40 bg-zinc-950/40 flex items-start gap-2.5">
        <ShieldCheck size={16} className="text-emerald-400 shrink-0 mt-0.5" strokeWidth={1.5} />
        <div className="space-y-1">
          <span className="font-medium text-zinc-200">Local-First Privacy Guarantee</span>
          <p className="text-zinc-400 text-[11px] leading-relaxed">
            {t.settings.privacyNote}
          </p>
        </div>
      </div>
    </div>
  );
};
