import type { ConfirmDialogProps } from './types.ts';
// This file was written in 2026 by the Faculty of Informatics and Information
// Technologies for the Professional License Registry. It is licensed under
// the MIT License (see LICENSE).

import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import Button from './Button.tsx';

/**
 * An accessible confirmation dialog that keeps destructive actions explicit.
 * @param options - Existing component inputs: { busy = false, cancelLabel, children, confirmLabel, danger = false, onCancel, onConfirm, open, title, }.
 * @returns The rendered React content.
 */
export default function ConfirmDialog(options: ConfirmDialogProps) {
  const {
    busy = false,
    cancelLabel,
    children,
    confirmLabel,
    danger = false,
    onCancel,
    onConfirm,
    open,
    title,
  } = options;

  const dialogRef = useRef(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return undefined;

    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector('[data-dialog-cancel]')?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      (previouslyFocused as HTMLElement)?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="confirm-dialog-backdrop"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) {
          event.preventDefault();
          onCancel();
          return;
        }
        if (event.key === 'Tab') {
          const controls = [...dialogRef.current.querySelectorAll('button:not(:disabled)')];
          const first = controls[0];
          const last = controls.at(-1);
          if (!first) {
            event.preventDefault();
          } else if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <h2 id={titleId}>{title}</h2>
        <div id={descriptionId} className="confirm-dialog-content">
          {children}
        </div>
        <div className="confirm-dialog-actions">
          <Button data-dialog-cancel variant="ghost" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            className={danger ? 'danger' : ''}
            disabled={busy}
            aria-busy={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
