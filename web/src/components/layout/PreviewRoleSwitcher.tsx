import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { api } from '../../api/client';
import {
  getPreviewRole,
  setPreviewRole,
  type PreviewRole,
} from '../../lib/internal-preview';

const ROLE_LABEL: Record<PreviewRole, string> = {
  renter: 'Renter',
  landlord: 'Home Provider',
  broker: 'Broker',
};

const ROLE_PATH: Record<PreviewRole, string> = {
  renter: '/home',
  landlord: '/dashboard',
  broker: '/broker/dashboard',
};

type Tone = 'light' | 'dark';

/**
 * Compact PREVIEW + Viewing as control for normal Dwel headers.
 * Server-authorized only — switching never mutates party_role / DB memberships.
 */
export function PreviewRoleSwitcher({ tone = 'light' }: { tone?: Tone }) {
  const [, setLocation] = useLocation();
  const [allowed, setAllowed] = useState(false);
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<PreviewRole | null>(() => getPreviewRole());
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .internalPreviewAccess()
      .then((r) => {
        if (cancelled) return;
        setAllowed(r.allowed);
        if (r.allowed && r.preview?.role) {
          setPreviewRole(r.preview.role);
          setRole(r.preview.role);
        } else if (!r.allowed) {
          setPreviewRole(null);
          setRole(null);
        }
      })
      .catch(() => {
        if (!cancelled) setAllowed(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!allowed) return null;

  const dark = tone === 'dark';
  const currentLabel = role ? ROLE_LABEL[role] : 'Select role';

  async function applyRole(next: PreviewRole | null) {
    if (busy) return;
    setBusy(true);
    setOpen(false);
    try {
      const res = await api.internalPreviewSetRole(next);
      if (!res.allowed) return;
      setPreviewRole(next);
      setRole(next);
      if (next) setLocation(ROLE_PATH[next]);
      else setLocation('/internal/preview');
    } catch {
      /* keep prior UI */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={rootRef} className="relative flex items-center gap-2">
      <span
        className={
          dark
            ? 'rounded-[4px] bg-dwel-mint px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-dwel-black'
            : 'rounded-[4px] bg-dwel-mint px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-dwel-black'
        }
      >
        Preview
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        className={
          dark
            ? 'flex items-center gap-1 rounded-[8px] border border-white/20 bg-white/5 px-2.5 py-1 text-xs font-medium text-dwel-gray-100 hover:bg-white/10'
            : 'flex items-center gap-1 rounded-[8px] border border-dwel-gray-200 bg-dwel-white px-2.5 py-1 text-xs font-medium text-dwel-gray-700 hover:border-dwel-gray-300'
        }
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        Viewing as: {currentLabel}
        <span className="opacity-60" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <ul
          role="listbox"
          className={
            dark
              ? 'absolute right-0 top-full z-50 mt-1 min-w-[180px] overflow-hidden rounded-[10px] border border-white/15 bg-dwel-black py-1 shadow-lg'
              : 'absolute right-0 top-full z-50 mt-1 min-w-[180px] overflow-hidden rounded-[10px] border border-dwel-gray-200 bg-dwel-white py-1 shadow-lg'
          }
        >
          {(['renter', 'landlord', 'broker'] as PreviewRole[]).map((r) => (
            <li key={r}>
              <button
                type="button"
                role="option"
                aria-selected={role === r}
                className={
                  dark
                    ? `block w-full px-3 py-2 text-left text-sm ${
                        role === r ? 'bg-white/15 text-dwel-mint' : 'text-dwel-gray-200 hover:bg-white/10'
                      }`
                    : `block w-full px-3 py-2 text-left text-sm ${
                        role === r ? 'bg-dwel-mint/30 font-semibold text-dwel-black' : 'text-dwel-gray-700 hover:bg-dwel-gray-50'
                      }`
                }
                onClick={() => void applyRole(r)}
              >
                {ROLE_LABEL[r]}
              </button>
            </li>
          ))}
          <li className={dark ? 'border-t border-white/10' : 'border-t border-dwel-gray-100'}>
            <button
              type="button"
              className={
                dark
                  ? 'block w-full px-3 py-2 text-left text-sm text-dwel-gray-400 hover:bg-white/10'
                  : 'block w-full px-3 py-2 text-left text-sm text-dwel-gray-500 hover:bg-dwel-gray-50'
              }
              onClick={() => void applyRole(null)}
            >
              Exit preview
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
