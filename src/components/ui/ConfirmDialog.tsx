import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}

export function ConfirmDialog({
  isOpen,
  title,
  description,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
      <div className="space-y-5">
        <div className="flex items-start gap-3 rounded-xl border border-expense/20 bg-expense-subtle px-3.5 py-3">
          <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-lg bg-expense/15 text-expense">
            <AlertTriangle size={16} />
          </div>
          <p className="text-sm leading-relaxed text-text-primary">{description}</p>
        </div>

        <div className="flex justify-end gap-3 pt-1">
          <Button variant="secondary" type="button" onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button variant="danger" type="button" onClick={() => void onConfirm()}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
