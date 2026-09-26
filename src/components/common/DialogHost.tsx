import React, { useEffect } from 'react';
import { useDialogStore, answerDialog } from '@/lib/ui/dialogs';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTranslations } from '@/lib/localization/i18n';
import { Modal } from './Modal';
import { Button } from './Button';

/** Shows the questions and messages of `confirmDialog` / `noticeDialog`, one at a time. */
export const DialogHost: React.FC = () => {
  const request = useDialogStore((s) => s.queue[0]);
  const language = useSettingsStore((s) => s.settings.language);
  const t = getTranslations(language).common;

  useEffect(() => {
    useDialogStore.setState({ hostMounted: true });
    return () => useDialogStore.setState({ hostMounted: false });
  }, []);

  if (!request) return null;
  const cancel = () => answerDialog(request.id, false);
  const confirm = () => answerDialog(request.id, true);

  return (
    <Modal
      key={request.id}
      isOpen
      onClose={request.kind === 'notice' ? confirm : cancel}
      title={request.title}
      width="max-w-sm"
      footer={
        <>
          <span className="flex-1" />
          {request.kind === 'confirm' && (
            <Button variant="secondary" onClick={cancel}>
              {t.cancel}
            </Button>
          )}
          <Button variant={request.danger ? 'danger' : 'primary'} onClick={confirm} autoFocus>
            {request.kind === 'confirm' ? request.confirmLabel || t.confirm : t.ok}
          </Button>
        </>
      }
    >
      <p className="text-xs text-zinc-400 leading-relaxed whitespace-pre-line break-words">{request.message}</p>
    </Modal>
  );
};
