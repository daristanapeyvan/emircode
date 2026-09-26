import { create } from 'zustand';

/** A question or a message shown in the app's own dialog instead of the browser's confirm()/alert(). */
export interface DialogRequest {
  id: number;
  kind: 'confirm' | 'notice';
  title: string;
  message: string;
  confirmLabel?: string;
  /** The confirm button is red (deleting, stopping, undoing). */
  danger?: boolean;
  resolve: (answer: boolean) => void;
}

interface DialogState {
  queue: DialogRequest[];
  /** DialogHost is on screen; without it (tests, very early start) the browser's dialogs are used. */
  hostMounted: boolean;
}

export const useDialogStore = create<DialogState>(() => ({ queue: [], hostMounted: false }));

let nextId = 0;

function ask(kind: DialogRequest['kind'], options: Omit<DialogRequest, 'id' | 'kind' | 'resolve'>): Promise<boolean> {
  if (!useDialogStore.getState().hostMounted) {
    const text = options.title ? `${options.title}\n\n${options.message}` : options.message;
    if (kind === 'confirm') return Promise.resolve(typeof window !== 'undefined' && !!window.confirm?.(options.message || text));
    window?.alert?.(options.message || text);
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const request: DialogRequest = { ...options, id: ++nextId, kind, resolve };
    useDialogStore.setState((s) => ({ queue: [...s.queue, request] }));
  });
}

/** Resolves true when the user confirms, false when they cancel (button, Escape or ×). */
export const confirmDialog = (options: { title: string; message: string; confirmLabel?: string; danger?: boolean }) => ask('confirm', options);

/** A message with a single OK button. */
export const noticeDialog = (options: { title: string; message: string }) => ask('notice', options).then(() => undefined);

/** Answers the dialog on screen and shows the next one. */
export function answerDialog(id: number, answer: boolean) {
  const request = useDialogStore.getState().queue.find((r) => r.id === id);
  useDialogStore.setState((s) => ({ queue: s.queue.filter((r) => r.id !== id) }));
  request?.resolve(answer);
}
