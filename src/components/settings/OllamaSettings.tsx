import React, { useState } from 'react';
import { RefreshCw, CheckCircle, AlertTriangle, AlertCircle, ExternalLink } from 'lucide-react';
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

  const isRemoteHttp =
    endpointInput.startsWith('http://') &&
    !endpointInput.includes('localhost') &&
    !endpointInput.includes('127.0.0.1');

  return (
    <div className="space-y-4 text-xs">
      {/* Endpoint row */}
      <SettingsRow
        label={t.settings.endpoint}
        description={t.settings.endpointDesc}
      >
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={endpointInput}
            onChange={(e) => setEndpointInput(e.target.value)}
            placeholder="http://localhost:11434"
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
      </SettingsRow>

      {/* Remote warning */}
      {isRemoteHttp && (
        <div className="p-3 rounded bg-amber-950/40 border border-amber-800/50 text-amber-300 flex items-start gap-2">
          <AlertTriangle size={15} className="shrink-0 mt-0.5 text-amber-400" strokeWidth={1.5} />
          <p className="leading-relaxed text-[11px]">{t.settings.remoteWarning}</p>
        </div>
      )}

      {/* Connection Status Card */}
      <div className="p-3.5 rounded-lg border border-zinc-800 bg-zinc-950/60 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {connectionStatus === 'connected' ? (
            <CheckCircle size={16} className="text-emerald-400" strokeWidth={1.5} />
          ) : (
            <AlertCircle size={16} className="text-rose-400" strokeWidth={1.5} />
          )}

          <div>
            <span className="font-medium text-zinc-200 block">
              {connectionStatus === 'connected' ? t.common.connected : t.common.disconnected}
            </span>
            {connectionError && (
              <span className="text-[11px] text-zinc-500 font-mono mt-0.5 block">
                {connectionError}
              </span>
            )}
          </div>
        </div>

        {connectionStatus !== 'connected' && (
          <a
            href="https://ollama.com/download"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-blue-400 hover:text-blue-300 transition-colors"
          >
            <span>Download Ollama</span>
            <ExternalLink size={12} strokeWidth={1.5} />
          </a>
        )}
      </div>

      {/* Keep Alive & Timeout */}
      <SettingsRow
        label={t.settings.keepAlive}
        description={t.settings.keepAliveDesc}
      >
        <select
          value={settings.keepAlive}
          onChange={(e) => updateSettings({ keepAlive: e.target.value })}
          className="h-8 px-3 rounded bg-zinc-900 border border-zinc-750 text-xs text-zinc-200 focus:outline-none focus:border-zinc-600"
        >
          <option value="0">0 (Immediate unload)</option>
          <option value="5m">5 minutes</option>
          <option value="15m">15 minutes</option>
          <option value="30m">30 minutes</option>
          <option value="1h">1 hour</option>
          <option value="-1">Infinite (-1)</option>
        </select>
      </SettingsRow>
    </div>
  );
};
