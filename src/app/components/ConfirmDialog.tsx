import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle, X } from 'lucide-react'
import { useRef } from 'react'

interface ConfirmDialogProps {
  readonly open: boolean
  readonly title: string
  readonly description: string
  readonly confirmLabel: string
  readonly danger?: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onConfirm: () => void
}

export function ConfirmDialog({ open, title, description, confirmLabel, danger = false, onOpenChange, onConfirm }: ConfirmDialogProps) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay confirm-overlay" />
        <Dialog.Content
          className="confirm-dialog"
          aria-describedby="confirm-dialog-description"
          onOpenAutoFocus={(event) => { event.preventDefault(); titleRef.current?.focus() }}
        >
          <div className="confirm-icon"><AlertTriangle aria-hidden="true" /></div>
          <Dialog.Title ref={titleRef} tabIndex={-1}>{title}</Dialog.Title>
          <Dialog.Description id="confirm-dialog-description">{description}</Dialog.Description>
          <div className="confirm-actions">
            <Dialog.Close asChild><button className="button button-secondary" type="button">Cancel</button></Dialog.Close>
            <button className={`button ${danger ? 'button-danger' : 'button-primary'}`} type="button" onClick={onConfirm}>{confirmLabel}</button>
          </div>
          <Dialog.Close className="dialog-close icon-button" aria-label={`Close ${title}`}><X aria-hidden="true" /></Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
