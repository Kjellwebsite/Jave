'use client';

import type { ReactElement, ReactNode } from 'react';
import { Button } from './button';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from './dialog';

export interface ConfirmDialogProps {
  /** The element that opens the dialog (rendered as the trigger via asChild). */
  trigger?: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  eyebrow?: ReactNode;
  /** Say exactly what happens: "Grant role", not "OK". */
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  pending?: boolean;
  confirmDisabled?: boolean;
  /** Click handler for button-style confirms. */
  onConfirm?: () => void;
  /** Submit a form (by id) instead of calling onConfirm — for Server Action forms. */
  form?: string;
  /** Extra content: a required reason, a preview of the change. */
  children?: ReactNode;
}

/** Two-step confirmation for consequential actions. Cancel is always the safe default. */
export function ConfirmDialog({
  trigger,
  open,
  onOpenChange,
  title,
  description,
  eyebrow,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'default',
  pending = false,
  confirmDisabled = false,
  onConfirm,
  form,
  children,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent
        size="sm"
        eyebrow={eyebrow ?? 'CONFIRM'}
        title={title}
        description={description}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="ghost" disabled={pending}>
                {cancelLabel}
              </Button>
            </DialogClose>
            <Button
              variant={tone === 'danger' ? 'danger' : 'primary'}
              type={form ? 'submit' : 'button'}
              form={form}
              onClick={form ? undefined : onConfirm}
              loading={pending}
              disabled={confirmDisabled}
            >
              {confirmLabel}
            </Button>
          </>
        }
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}
