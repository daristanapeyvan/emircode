import React, { useState, useEffect } from 'react';
import { ShieldCheck, Cpu, HardDrive, Terminal, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTranslations } from '@/lib/localization/i18n';
import { AppLogo } from '../common/AppLogo';
import { Button } from '../common/Button';
import { version as appVersion } from '../../../package.json';

export const AboutSettings: React.FC = () => {
  const { settings, hardware } = useSettingsStore();
  const t = getTranslations(settings.language);

  const [platform, setPlatform] = useState<'win32' | 'linux' | 'darwin'>('win32');
  const [isLinuxIntegrated, setIsLinuxIntegrated] = useState<boolean | null>(null);
  const [isIntegrating, setIsIntegrating] = useState(false);
  const [integrationMessage, setIntegrationMessage] = useState<string | null>(null);

  useEffect(() => {
    if (window.electronAPI?.getPlatform) {
      window.electronAPI.getPlatform().then((p) => {
        setPlatform(p);
        if (p === 'linux' && window.electronAPI?.isLinuxIntegrated) {
          window.electronAPI.isLinuxIntegrated().then(setIsLinuxIntegrated);
        }
      });
    }
  }, []);

  const handleIntegrateLinux = async () => {
    if (!window.electronAPI?.integrateLinuxDesktop) return;
    setIsIntegrating(true);
    setIntegrationMessage(null);
    try {
      const res = await window.electronAPI.integrateLinuxDesktop();
      if (res.success) {
        setIsLinuxIntegrated(true);
        setIntegrationMessage(res.message || t.settings.linuxIntegrationSuccess);
      } else {
        setIntegrationMessage(res.error || 'Integration failed');
      }
    } catch (err: any) {
      setIntegrationMessage(err.message);
    } finally {
      setIsIntegrating(false);
    }
  };

  const platformLabel = platform === 'linux'
    ? 'Linux Native Client (x64)'
    : platform === 'darwin'
    ? 'macOS Native Client'
    : 'Windows Native Client (x64)';

  return (
    <div className="space-y-4 text-xs">
      {/* App Header */}
      <div className="p-4 rounded-lg border border-zinc-800/40 bg-zinc-950/60 flex items-center gap-3.5">
        <AppLogo size={32} />
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">{t.settings.aboutTitle}</h3>
          <p className="text-zinc-500 text-[11px] font-mono mt-0.5">{t.settings.version} {appVersion} · {platformLabel}</p>
        </div>
      </div>

      {/* Linux Desktop Integration Card */}
      {platform === 'linux' && (
        <div className="p-3.5 rounded-lg border border-zinc-800/40 bg-zinc-950/40 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Terminal size={14} className="text-blue-400" strokeWidth={1.5} />
              <span className="text-zinc-200 font-medium">{t.settings.linuxIntegrationTitle}</span>
            </div>
            {isLinuxIntegrated !== null && (
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium ${
                isLinuxIntegrated ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/50' : 'bg-zinc-800 text-zinc-400'
              }`}>
                {isLinuxIntegrated ? (
                  <>
                    <CheckCircle2 size={11} />
                    {t.settings.linuxIntegratedBadge}
                  </>
                ) : (
                  <>
                    <AlertCircle size={11} />
                    {t.settings.linuxNotIntegratedBadge}
                  </>
                )}
              </span>
            )}
          </div>

          <p className="text-zinc-400 text-[11px] leading-relaxed">
            {t.settings.linuxIntegrationDesc}
          </p>

          <div className="flex items-center gap-3 pt-1">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleIntegrateLinux}
              disabled={isIntegrating}
              icon={<RefreshCw size={12} className={isIntegrating ? 'animate-spin' : ''} />}
            >
              {t.settings.linuxIntegrationButton}
            </Button>
            {integrationMessage && (
              <span className="text-[11px] text-emerald-400 font-mono">
                {integrationMessage}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Hardware info */}
      {hardware && (
        <div className="p-3.5 rounded-lg border border-zinc-800/40 bg-zinc-950/40 space-y-2.5">
          <span className="text-zinc-400 font-medium block">{t.settings.detectedHardware}</span>
          <div className="space-y-1.5 font-mono text-[11px] text-zinc-300">
            <div className="flex items-center gap-2">
              <Cpu size={13} className="text-zinc-500 shrink-0" strokeWidth={1.5} />
              <span className="truncate">{hardware.cpu.model} ({hardware.cpu.logicalProcessors} {t.settings.logicalCores})</span>
            </div>
            <div className="flex items-center gap-2">
              <HardDrive size={13} className="text-zinc-500 shrink-0" strokeWidth={1.5} />
              <span>{hardware.ram.totalGb} GB {t.settings.totalRam} ({hardware.ram.availableGb} GB {t.settings.availableRam})</span>
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
          <span className="font-medium text-zinc-200">{t.settings.privacyGuarantee}</span>
          <p className="text-zinc-400 text-[11px] leading-relaxed">
            {t.settings.privacyNote}
          </p>
        </div>
      </div>
    </div>
  );
};
