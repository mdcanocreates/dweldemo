import { useId, useState } from 'react';

export type LandingFaqItem = {
  id: string;
  question: string;
  answer: string;
};

const DEFAULT_ITEMS: LandingFaqItem[] = [
  {
    id: 'how-dwel-works',
    question: 'How does Dwel work?',
    answer:
      'Browse homes without creating an account. When you are ready, verify your email with a one-time code, save homes you like, and apply through Dwel. Cashback and other offers appear only when a listing specifically supports them.',
  },
  {
    id: 'cashback',
    question: 'How does cashback work?',
    answer:
      'Cashback is not guaranteed on every home. When a listing shows a Dwel cashback amount, payout follows the Cashback Terms and the conditions shown for that listing. Externally advertised rent specials are shown separately and are not converted into Dwel cashback.',
  },
  {
    id: 'browse-without-joining',
    question: 'Can I browse without joining?',
    answer:
      'Yes. You can explore the public catalog as a guest. Saving homes, submitting interest, and applying require email verification so we can protect your account and preferences.',
  },
  {
    id: 'home-partners',
    question: 'For home partners',
    answer:
      'Home providers and brokers can sign in with the same email-code flow, claim and manage properties they are authorized for, and review renter interest through Dwel. Live outreach and paid lead access stay off until those workflows are fully validated.',
  },
];

/** Inline FAQ accordion for the landing page. Dedicated /faqs page remains in the footer. */
export function LandingFaqAccordion({ items = DEFAULT_ITEMS }: { items?: LandingFaqItem[] }) {
  const baseId = useId();
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="lv5-faq-accordion" aria-label="Helpful questions">
      {items.map((item) => {
        const panelId = `${baseId}-${item.id}-panel`;
        const buttonId = `${baseId}-${item.id}-button`;
        const expanded = openId === item.id;
        return (
          <div key={item.id} className={expanded ? 'lv5-faq-item is-open' : 'lv5-faq-item'}>
            <h3 className="lv5-faq-question">
              <button
                type="button"
                id={buttonId}
                className="lv5-faq-trigger"
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => setOpenId(expanded ? null : item.id)}
              >
                <span>{item.question}</span>
                <span className="lv5-faq-chevron" aria-hidden="true">
                  {expanded ? '−' : '+'}
                </span>
              </button>
            </h3>
            <div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              hidden={!expanded}
              className="lv5-faq-panel"
            >
              <p>{item.answer}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
