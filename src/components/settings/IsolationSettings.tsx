import React, { useEffect, useState } from 'react';
import { SettingsRow } from './SettingsRow';
import { Toggle } from '@/components/common/Toggle';
import { Button } from '@/components/common/Button';
import { useSettingsStore } from '@/stores/settingsStore';
import { format, getTranslations } from '@/lib/localization/i18n';
import { DEFAULT_SETTINGS } from '@/types/settings';
import type { SandboxStatus } from '../../../electron/preload';

/** The isolated environment of the agent's commands: on/off, internet, and what this computer supports. */
export const IsolationSettings: React.FC = () => {
  const { settings, updateSettings } = useSettingsStore();
  const t = getTranslations(settings.language);
  const isolation = settings.commandIsolation || DEFAULT_SETTINGS.commandIsolation;
  const [status, setStatus] = useState<SandboxStatus | null>(null);
  const [allowing, setAllowing] = useState(false);
  const [allowError, setAllowError] = useState('');

  const refresh = async () => {
    const api = window.electronAPI?.getSandboxStatus;
    if (!api) return;
    try {
      setStatus(await api(isolation));
    } catch {
      setStatus(null);
    }
  };

  useEffect(() => {
    refresh();
    // The status depends only on the on/off setting; the language changes its texts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isolation.enabled, settings.language]);

  const set = (patch: Partial<typeof isolation>) => updateSettings({ commandIsolation: { ...isolation, ...patch } });

  // What this computer supports: a short note on the left, the state of each program on the right.
  const hereNote = !status
    ? t.settings.isolationChecking
    : !status.supported
      ? status.reasonText || ''
      : status.method === 'appcontainer'
        ? t.settings.isolationWindows
        : t.settings.isolationLinux;
  const stateOf = (item?: { isolated: boolean }) => (item?.isolated ? t.settings.isolationStateOn : t.settings.isolationStateOff);
  const hereState: string[] = !status
    ? []
    : !status.supported
      ? [t.settings.isolationUnavailable]
      : !isolation.enabled
        ? [t.settings.isolationOffShort]
        : status.method === 'appcontainer'
          ? [format(t.settings.isolationNodeState, { state: stateOf(status.node) }), format(t.settings.isolationPythonState, { state: stateOf(status.python) })]
          : [t.settings.isolationStateOn];

  const pythonBlocked = status?.python && !status.python.isolated && status.python.reason === 'isolationInterpreterUnreadable';

  const allowPython = async () => {
    setAllowing(true);
    setAllowError('');
    try {
      const res = await window.electronAPI?.allowPythonIsolation?.();
      if (res && !res.ok) setAllowError(format(t.settings.isolationAllowFailed, { error: res.error || '' }));
      await refresh();
    } finally {
      setAllowing(false);
    }
  };

  return (
    <>
      <SettingsRow label={t.settings.isolation} description={t.settings.isolationDesc}>
        <Toggle checked={isolation.enabled} onChange={(checked) => set({ enabled: checked })} />
      </SettingsRow>
      <SettingsRow label={t.settings.isolationHere} description={hereNote}>
        <span className="text-xs text-zinc-400 text-right leading-relaxed">
          {hereState.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </span>
      </SettingsRow>
      <SettingsRow label={t.settings.isolationNetwork} description={t.settings.isolationNetworkDesc}>
        <Toggle checked={isolation.network} disabled={!isolation.enabled || status?.supported === false} onChange={(checked) => set({ network: checked })} />
      </SettingsRow>
      {pythonBlocked && (
        <SettingsRow
          label={t.settings.isolationPython}
          description={`${format(t.settings.isolationPythonDesc, { path: status?.python?.path || 'python' })}${allowError ? ` ${allowError}` : ''}`}
        >
          <Button variant="secondary" size="sm" onClick={allowPython} disabled={allowing}>
            {t.settings.isolationAllow}
          </Button>
        </SettingsRow>
      )}
    </>
  );
};
