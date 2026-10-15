import { useMemo, useState, type ReactNode } from 'react';
import { Button } from '../ui/Button';
import { BROKER_TERMS_VERSION } from '../../lib/demo-store';

export type BrokerAckValues = {
  compensation_cap_ack: boolean;
  non_circumvention_ack: boolean;
  licensing_ack: boolean;
  platform_role_ack: boolean;
};

const SECTIONS: Array<{
  key: keyof BrokerAckValues;
  heading: string;
  copy: string;
  checkbox: string;
}> = [
  {
    key: 'compensation_cap_ack',
    heading: 'Broker compensation',
    copy: 'For opportunities introduced through Dwel, you agree that your broker or agent compensation will not exceed 15% of the applicable platform-originated commission, referral fee, or other transaction compensation, unless RBIT approves different terms in writing.',
    checkbox: 'I agree to the 15% compensation cap for Dwel-originated opportunities.',
  },
  {
    key: 'non_circumvention_ack',
    heading: 'Keep Dwel-originated business on Dwel',
    copy: "You agree not to use leads, contact information, introductions, or relationships obtained through Dwel to move a transaction outside the platform for the purpose of avoiding RBIT's agreed fees or commercial terms.",
    checkbox: 'I agree not to circumvent Dwel for platform-originated leads or transactions.',
  },
  {
    key: 'licensing_ack',
    heading: 'Licensing and authority',
    copy: 'You confirm that you hold any license, brokerage affiliation, or supervising broker relationship required for the work you perform through Dwel, and that you will keep that information current.',
    checkbox: 'I confirm that my licensing and brokerage information is accurate and current.',
  },
  {
    key: 'platform_role_ack',
    heading: 'Your role on Dwel',
    copy: 'Dwel provides technology, lead flow, workflow tools, and screening coordination. Your professional real-estate services remain your responsibility and must be performed under your applicable license and brokerage requirements.',
    checkbox: 'I understand my role and responsibilities when using Dwel.',
  },
];

/**
 * Frosted glass broker acknowledgment — provisional business copy, not legal-approved.
 */
export function BrokerAckModal({
  open,
  demo = false,
  preview = false,
  onContinue,
  onSignOut,
}: {
  open: boolean;
  demo?: boolean;
  preview?: boolean;
  onContinue: (values: BrokerAckValues) => void;
  onSignOut: () => void;
}) {
  const [values, setValues] = useState<BrokerAckValues>({
    compensation_cap_ack: false,
    non_circumvention_ack: false,
    licensing_ack: false,
    platform_role_ack: false,
  });

  const allChecked = useMemo(
    () =>
      values.compensation_cap_ack &&
      values.non_circumvention_ack &&
      values.licensing_ack &&
      values.platform_role_ack,
    [values],
  );

  if (!open) return null;

  return (
    <div className="modal-backdrop fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal
        aria-labelledby="broker-ack-title"
        className="broker-ack-glass relative z-10 flex max-h-[90vh] w-full max-w-[720px] flex-col overflow-hidden"
      >
        <div className="border-b border-white/50 px-6 py-5 sm:px-8">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="broker-ack-title" className="text-2xl font-semibold tracking-tight">
              Partner acknowledgments
            </h2>
            {demo && (
              <span className="rounded-md bg-dwel-mint/30 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-dwel-gray-900">
                DEMO
              </span>
            )}
            {preview && !demo && (
              <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-800">
                Preview acknowledgment
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-dwel-gray-600">
            Provisional business copy — not legally approved. Counsel must review before production
            use. Version {BROKER_TERMS_VERSION}.
          </p>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5 sm:px-8">
          {SECTIONS.map((section) => (
            <section key={section.key}>
              <h3 className="text-lg font-semibold">{section.heading}</h3>
              <p className="mt-2 text-sm leading-relaxed text-dwel-gray-600">{section.copy}</p>
              <label className="mt-3 flex items-start gap-3 text-sm font-medium text-dwel-gray-900">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-dwel-mint-dark"
                  checked={values[section.key]}
                  onChange={(e) =>
                    setValues((prev) => ({ ...prev, [section.key]: e.target.checked }))
                  }
                />
                <span>{section.checkbox}</span>
              </label>
            </section>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/50 bg-white/40 px-6 py-4 sm:px-8">
          <Button variant="ghost" onClick={onSignOut}>
            Sign out
          </Button>
          <Button disabled={!allChecked} onClick={() => onContinue(values)}>
            Continue to Broker Dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}

export function BrokerAckGate({
  children,
  needsAck,
  demo,
  preview,
  onAccepted,
  onSignOut,
}: {
  children: ReactNode;
  needsAck: boolean;
  demo?: boolean;
  preview?: boolean;
  onAccepted: (values: BrokerAckValues) => void | Promise<void>;
  onSignOut: () => void;
}) {
  return (
    <>
      <BrokerAckModal
        open={needsAck}
        demo={demo}
        preview={preview}
        onContinue={(v) => void onAccepted(v)}
        onSignOut={onSignOut}
      />
      <div className={needsAck ? 'pointer-events-none select-none blur-[2px]' : undefined}>
        {children}
      </div>
    </>
  );
}
