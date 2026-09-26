import React, { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTranslations } from '@/lib/localization/i18n';
import { AppLogo } from '../common/AppLogo';
import { Button } from '../common/Button';
import { SettingsRow } from './SettingsRow';
import { version as appVersion } from '../../../package.json';

const Fact: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-start justify-between gap-4 py-3 border-b border-zinc-800/60 text-xs">
    <span className="text-zinc-400 shrink-0">{label}</span>
    <span className="text-zinc-200 text-right min-w-0">{value}</span>
  </div>
);

export const AboutSettings: React.FC = () => {
  const { settings, hardware, refreshHardware } = useSettingsStore();
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
        setIntegrationMessage(res.error || t.settings.linuxIntegrationFailed);
      }
    } catch (err: any) {
      setIntegrationMessage(err.message);
    } finally {
      setIsIntegrating(false);
    }
  };

  const platformLabel = platform === 'linux' ? 'Linux (x64)' : platform === 'darwin' ? 'macOS' : 'Windows (x64)';

  return (
    <div>
      <div className="flex items-center gap-3 py-4 border-b border-zinc-800/60">
        <AppLogo size={28} />
        <div>
          <p className="text-sm font-semibold text-zinc-100">Emir Code</p>
          <p className="text-[11px] text-zinc-500">
            {t.settings.version} {appVersion} · {platformLabel}
          </p>
        </div>
      </div>

      {hardware && (
        <>
          <Fact label="CPU" value={`${hardware.cpu.model} · ${hardware.cpu.logicalProcessors} ${t.settings.logicalCores}`} />
          <Fact label="RAM" value={`${hardware.ram.totalGb} GB · ${hardware.ram.availableGb} GB ${t.settings.availableRam}`} />
          <Fact label="GPU" value={hardware.gpu ? `${hardware.gpu.model}${hardware.gpu.vramMb ? ` · ${Math.round(hardware.gpu.vramMb / 1024)} GB VRAM` : ''}` : '—'} />
          <div className="flex justify-end py-2">
            <Button variant="ghost" size="sm" icon={<RefreshCw size={12} strokeWidth={1.5} />} onClick={() => refreshHardware()}>
              {t.settings.rescanHardware}
            </Button>
          </div>
        </>
      )}

      {platform === 'linux' && (
        <SettingsRow
          label={t.settings.linuxIntegrationTitle}
          description={
            integrationMessage ||
            (isLinuxIntegrated === null ? t.settings.linuxIntegrationDesc : isLinuxIntegrated ? t.settings.linuxIntegratedBadge : t.settings.linuxNotIntegratedBadge)
          }
        >
          <Button
            variant="secondary"
            size="sm"
            onClick={handleIntegrateLinux}
            disabled={isIntegrating}
            icon={<RefreshCw size={12} className={isIntegrating ? 'animate-spin' : ''} />}
          >
            {t.settings.linuxIntegrationButton}
          </Button>
        </SettingsRow>
      )}

      <p className="py-3 text-[11px] text-zinc-500 leading-relaxed">{t.settings.privacyNote}</p>
    </div>
  );
};
