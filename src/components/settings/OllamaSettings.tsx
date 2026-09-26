import React, { useState } from 'react';
import { Select } from '@/components/common/Select';
import { RefreshCw, AlertTriangle, ExternalLink } from 'lucide-react';
import { SettingsRow } from './SettingsRow';
import { Button } from '../common/Button';
import { useSettingsStore } from '@/stores/settingsStore';
import { useModelStore } from '@/stores/modelStore';
import { getTranslations } from '@/lib/localization/i18n';

export const OllamaSettings: React.FC = () => {
  const { settings, updateSettings, setOllamaEndpoint } = useSettingsStore();
  const { connectionStatus, connectionError, checkConnection } = useModelStore();
  const t = getTranslations(settings.language);

  const [endpointInput, setEndpointInput] = useState(settings.ollamaEndpoint);
  const [isTesting, setIsTesting] = useState(false);

  const handleTest = async () => {
    setIsTesting(true);
    setOllamaEndpoint(endpointInput);
    await checkConnection(endpointInput);
    setIsTesting(false);
  };

  const isRemoteHttp = endpointInput.startsWith('http://') && !endpointInput.includes('localhost') && !endpointInput.includes('127.0.0.1');
  const connected = connectionStatus === 'connected';

  return (
    <div className="text-xs">
      <div className="py-3.5 border-b border-zinc-800/60 space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <label className="text-xs font-medium text-zinc-200">{t.settings.endpoint}</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={endpointInput}
              onChange={(e) => setEndpointInput(e.target.value)}
              placeholder="http://localhost:11434"
              aria-label={t.settings.endpoint}
              className="w-56 h-8 px-2.5 rounded bg-zinc-900 border border-zinc-750 text-xs text-zinc-200 font-mono focus:outline-none focus:border-zinc-600"
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={isTesting}
              icon={<RefreshCw size={12} className={isTesting ? 'animate-spin' : ''} strokeWidth={1.5} />}
              onClick={handleTest}
            >
              {t.settings.testConnection}
            </Button>
          </div>
        </div>

        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
          <span className={connected ? 'text-emerald-400' : 'text-red-400'}>{connected ? t.common.connected : t.common.disconnected}</span>
          {!connected && connectionError && <span className="text-zinc-500 font-mono">{connectionError}</span>}
          {!connected && (
            <a
              href="https://ollama.com/download"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-zinc-200 underline underline-offset-2 hover:text-zinc-50 transition-colors"
            >
              {t.settings.downloadOllama}
              <ExternalLink size={11} strokeWidth={1.5} />
            </a>
          )}
        </p>

        {isRemoteHttp && (
          <p className="flex items-start gap-1.5 text-[11px] text-amber-400/90 leading-relaxed">
            <AlertTriangle size={13} className="shrink-0 mt-px" strokeWidth={1.5} />
            {t.settings.remoteWarning}
          </p>
        )}
      </div>

      <SettingsRow label={t.settings.keepAlive} description={t.settings.keepAliveDesc}>
        <Select
          ariaLabel={t.settings.keepAlive}
          value={settings.keepAlive}
          onChange={(v) => updateSettings({ keepAlive: v })}
          options={[
            { value: '0', label: t.settings.keepAliveNone },
            { value: '5m', label: t.settings.keepAlive5m },
            { value: '15m', label: t.settings.keepAlive15m },
            { value: '30m', label: t.settings.keepAlive30m },
            { value: '1h', label: t.settings.keepAlive1h },
            { value: '-1', label: t.settings.keepAliveForever },
          ]}
        />
      </SettingsRow>
    </div>
  );
};
