import React from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTranslations } from '@/lib/localization/i18n';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';

export const CommandApprovalModal: React.FC = () => {
  const { pendingCommand, approveCommand, rejectCommand } = useAgentStore();
  const { settings } = useSettingsStore();
  const t = getTranslations(settings.language);

  if (!pendingCommand) return null;

  return (
    <Modal
      isOpen
      onClose={rejectCommand}
      dismissible={false}
      title={t.agent.commandApprovalTitle}
      width="max-w-lg"
      footer={
        <>
          <span className="flex-1" />
          <Button variant="secondary" onClick={rejectCommand}>
            {t.agent.reject}
          </Button>
          <Button variant="primary" onClick={approveCommand}>
            {t.agent.allowAndRun}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-xs">
        <p className="px-3 py-2 rounded-md bg-zinc-950 border border-zinc-800 font-mono text-zinc-100 break-all select-text">
          {pendingCommand.binary} {pendingCommand.args.join(' ')}
        </p>
        {pendingCommand.reason && <p className="text-zinc-300 leading-relaxed">{pendingCommand.reason}</p>}
      </div>
    </Modal>
  );
};
