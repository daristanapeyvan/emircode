import React from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTranslations } from '@/lib/localization/i18n';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';

export const DeleteApprovalModal: React.FC = () => {
  const { pendingDelete, approveDelete, rejectDelete } = useAgentStore();
  const { settings } = useSettingsStore();
  const t = getTranslations(settings.language);

  if (!pendingDelete) return null;

  return (
    <Modal
      isOpen
      onClose={rejectDelete}
      dismissible={false}
      title={t.agent.deleteApprovalTitle}
      width="max-w-md"
      footer={
        <>
          <span className="flex-1" />
          <Button variant="secondary" onClick={rejectDelete}>
            {t.agent.reject}
          </Button>
          <Button variant="danger" onClick={approveDelete}>
            {t.agent.confirmDeletion}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-xs">
        <p className="px-3 py-2 rounded-md bg-zinc-950 border border-zinc-800 font-mono text-zinc-100 break-all">{pendingDelete.relativePath}</p>
        {pendingDelete.reason && <p className="text-zinc-300 leading-relaxed">{pendingDelete.reason}</p>}
        <p className="text-zinc-500">{t.agent.deleteSnapshotNotice}</p>
      </div>
    </Modal>
  );
};
