import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

export type BrokerInviteFormData = {
  businessName: string;
  email: string;
  note: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: BrokerInviteFormData) => void | Promise<void>;
  submitting?: boolean;
  error?: string | null;
};

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function BrokerInviteModal({ open, onClose, onSubmit, submitting = false, error }: Props) {
  const titleId = useId();
  const descId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [businessName, setBusinessName] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setBusinessName('');
      setEmail('');
      setNote('');
      setLocalError(null);
      return;
    }
    const t = window.setTimeout(
      () => dialogRef.current?.querySelector<HTMLInputElement>('input')?.focus(),
      0,
    );
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled])',
      );
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    const trimmedBusiness = businessName.trim();
    const trimmedEmail = email.trim();
    if (!trimmedBusiness) {
      setLocalError('Business name is required.');
      return;
    }
    if (!trimmedEmail) {
      setLocalError('Contact email is required.');
      return;
    }
    if (!isValidEmail(trimmedEmail)) {
      setLocalError('Enter a valid email address.');
      return;
    }
    await onSubmit({
      businessName: trimmedBusiness,
      email: trimmedEmail,
      note: note.trim(),
    });
  }

  const displayError = localError ?? error;

  return (
    <div className="modal-backdrop fixed inset-0 z-[70] flex items-end justify-center p-4 sm:items-center">
      <button
        type="button"
        className="absolute inset-0"
        aria-label="Close dialog"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="broker-ack-glass relative z-10 w-full max-w-[520px] overflow-hidden"
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/50 px-6 py-5">
          <div>
            <h2 id={titleId} className="text-xl font-semibold tracking-tight text-dwel-gray-900">
              Invite a Home Provider
            </h2>
            <p id={descId} className="mt-1.5 text-sm text-dwel-gray-600">
              Connect a property owner or management company to your Dwel network.
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-sm font-semibold text-dwel-gray-600 hover:bg-white/60"
            aria-label="Close"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 px-6 py-5">
          <label className="block text-sm">
            <span className="font-medium text-dwel-gray-900">Business name</span>
            <Input
              required
              className="mt-1.5"
              placeholder="Oak Street Property Management"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              disabled={submitting}
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-dwel-gray-900">Contact email</span>
            <Input
              required
              type="email"
              className="mt-1.5"
              placeholder="owner@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-dwel-gray-900">Personal note (optional)</span>
            <textarea
              className="mt-1.5 h-24 w-full rounded-lg border border-dwel-gray-300 bg-white/80 px-4 py-3 text-sm text-dwel-gray-900 placeholder:text-dwel-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-dwel-black"
              placeholder="We'd love to help manage your Austin portfolio…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={submitting}
            />
          </label>

          <p className="rounded-lg bg-white/50 px-3 py-2.5 text-xs leading-relaxed text-dwel-gray-600">
            The Home Provider will review your invitation and approve the relationship before you
            can access their listings or applications.
          </p>

          {displayError ? <p className="text-sm text-dwel-red">{displayError}</p> : null}

          <div className="flex flex-wrap justify-end gap-2 border-t border-white/50 pt-4">
            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Sending…' : 'Send invitation'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
