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
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

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

  const windows = status?.method === 'appcontainer';
  const full = status?.full;
  const fullWorks = !!full?.working;

  // What this computer supports: a short note on the left, the state of each program on the right.
  const hereNote = !status
    ? t.settings.isolationChecking
    : !status.supported
      ? status.reasonText || ''
      : windows
        ? fullWorks
          ? t.settings.isolationWindowsFull
          : t.settings.isolationWindows
        : t.settings.isolationLinux;
  const stateOf = (item?: { isolated: boolean }) => (item?.isolated ? t.settings.isolationStateOn : t.settings.isolationStateWrite);
  const found = (item?: { reason?: string }) => !!item && item.reason !== 'isolationInterpreterMissing';
  const hereState: string[] = !status
    ? []
    : !status.supported
      ? [t.settings.isolationUnavailable]
      : !isolation.enabled
        ? [t.settings.isolationOffShort]
        : !windows
          ? [t.settings.isolationStateOn]
          : fullWorks
            ? [format(t.settings.isolationAllState, { state: t.settings.isolationStateOn })]
            : [
                ...(found(status.node) ? [format(t.settings.isolationNodeState, { state: stateOf(status.node) })] : []),
                ...(found(status.python) ? [format(t.settings.isolationPythonState, { state: stateOf(status.python) })] : []),
                format(t.settings.isolationNpmState, { state: t.settings.isolationStateWrite }),
              ];

  const pythonBlocked = !fullWorks && status?.python && !status.python.isolated && status.python.reason === 'isolationInterpreterUnreadable';

  /** An action that asks Windows for an administrator; the status is read again afterwards. */
  const run = async (action?: () => Promise<{ ok: boolean; error?: string }>) => {
    if (!action) return;
    setBusy(true);
    setActionError('');
    try {
      const res = await action();
      if (res && !res.ok) setActionError(format(t.settings.isolationActionFailed, { error: res.error || '' }));
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const fullNotes = [
    full?.configured && !full.working ? format(t.settings.isolationFullError, { error: full.error || '' }) : '',
    fullWorks && full?.network === 'open' && !isolation.network ? t.settings.isolationFullNetworkOpen : '',
    actionError,
  ].filter(Boolean);

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
      {windows && status?.supported && (
        <SettingsRow label={t.settings.isolationFull} description={[t.settings.isolationFullDesc, ...fullNotes].join(' ')}>
          {full?.configured ? (
            <Button variant="secondary" size="sm" onClick={() => run(window.electronAPI?.removeFullIsolation)} disabled={busy}>
              {t.settings.isolationFullRemove}
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => run(window.electronAPI?.setupFullIsolation)} disabled={busy}>
              {t.settings.isolationFullSetUp}
            </Button>
          )}
        </SettingsRow>
      )}
      <SettingsRow label={t.settings.isolationNetwork} description={t.settings.isolationNetworkDesc}>
        <Toggle checked={isolation.network} disabled={!isolation.enabled || status?.supported === false} onChange={(checked) => set({ network: checked })} />
      </SettingsRow>
      {pythonBlocked && (
        <SettingsRow label={t.settings.isolationPython} description={format(t.settings.isolationPythonDesc, { path: status?.python?.path || 'python' })}>
          <Button variant="secondary" size="sm" onClick={() => run(window.electronAPI?.allowPythonIsolation)} disabled={busy}>
            {t.settings.isolationAllow}
          </Button>
        </SettingsRow>
      )}
    </>
  );
};
