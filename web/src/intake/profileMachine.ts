/**
 * G-0 homepage chat — matching profile only (≤8 questions). Certn handles screening later.
 */

import type { RenterAnswers } from './answers';
import { profileComplete } from './answers';

export type ProfileStepId =
  | 'welcome'
  | 'ask_given_name'
  | 'ask_family_name'
  | 'ask_phone'
  | 'ask_email'
  | 'ask_move_in'
  | 'ask_budget'
  | 'ask_bedrooms'
  | 'ask_state'
  | 'ask_pets'
  | 'review'
  | 'submit';

export type ChatMessage = { id: string; role: 'guide' | 'user'; text: string };

const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA',
  'ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK',
  'OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
]);

const URGENCY: Record<string, string> = {
  immediate: 'immediate',
  asap: 'immediate',
  'this week': 'immediate',
  'within 30': 'within_30_days',
  '30 days': 'within_30_days',
  'within 60': 'within_60_days',
  '60 days': 'within_60_days',
  flexible: 'flexible',
};

const URGENCY_LABEL: Record<string, string> = {
  immediate: 'ASAP',
  within_30_days: 'within 30 days',
  within_60_days: 'within 60 days',
  flexible: 'flexible',
};

let seq = 0;
const mid = () => `p${++seq}`;
export const guide = (text: string): ChatMessage => ({ id: mid(), role: 'guide', text });
export const userMsg = (text: string): ChatMessage => ({ id: mid(), role: 'user', text });

function fmtMoney(raw: string): string {
  const n = Number(String(raw).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n)) return raw;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

export function promptFor(step: ProfileStepId): string {
  switch (step) {
    case 'welcome':
      return "Hi — I'm Dwel. A few quick questions so we can match you with homes. Ready?";
    case 'ask_given_name':
      return "What's your first name?";
    case 'ask_family_name':
      return 'And your last name?';
    case 'ask_phone':
      return 'Best phone number?';
    case 'ask_email':
      return "Email? We'll send a private link so your progress is saved.";
    case 'ask_move_in':
      return 'When do you need to move? (ASAP / within 30 days / within 60 days / flexible)';
    case 'ask_budget':
      return "What's your max monthly rent budget?";
    case 'ask_bedrooms':
      return 'Minimum bedrooms? (1, 2, 3…)';
    case 'ask_state':
      return 'Which US state are you targeting? (2-letter code, e.g. OH)';
    case 'ask_pets':
      return 'Any pets? (yes / no)';
    case 'review':
      return 'Does this look right? Reply continue to save, or edit to start over.';
    case 'submit':
      return 'Reply submit to save your profile and get a private link.';
    default:
      return 'Continue.';
  }
}

export function firstProfileStep(a: RenterAnswers): ProfileStepId {
  if (profileComplete(a)) return 'review';
  return 'welcome';
}

export type Advance =
  | { ok: true; next: ProfileStepId; answers: RenterAnswers; echo: string; done?: boolean }
  | { ok: false; error: string };

function parseUrgency(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (URGENCY[t]) return URGENCY[t]!;
  for (const [k, v] of Object.entries(URGENCY)) {
    if (t.includes(k)) return v;
  }
  if (['immediate', 'within_30_days', 'within_60_days', 'flexible'].includes(t)) {
    return t;
  }
  return null;
}

export function advanceProfile(step: ProfileStepId, answers: RenterAnswers, raw: string): Advance {
  const text = raw.trim();
  if (!text && step !== 'welcome') return { ok: false, error: 'Please enter a reply.' };

  switch (step) {
    case 'welcome':
      return { ok: true, next: 'ask_given_name', answers, echo: text || 'Ready' };
    case 'ask_given_name':
      return { ok: true, next: 'ask_family_name', answers: { ...answers, given_name: text }, echo: text };
    case 'ask_family_name':
      return { ok: true, next: 'ask_phone', answers: { ...answers, family_name: text }, echo: text };
    case 'ask_phone':
      return { ok: true, next: 'ask_email', answers: { ...answers, phone: text }, echo: text };
    case 'ask_email':
      if (!text.includes('@')) return { ok: false, error: 'Enter a valid email.' };
      return { ok: true, next: 'ask_move_in', answers: { ...answers, email: text }, echo: text };
    case 'ask_move_in': {
      const u = parseUrgency(text);
      if (!u) return { ok: false, error: 'Pick ASAP, within 30 days, within 60 days, or flexible.' };
      return { ok: true, next: 'ask_budget', answers: { ...answers, move_in_urgency: u }, echo: URGENCY_LABEL[u] ?? u };
    }
    case 'ask_budget': {
      const n = Number(text.replace(/[$,\s]/g, ''));
      if (!Number.isFinite(n) || n <= 0) return { ok: false, error: 'Enter a positive rent budget.' };
      return {
        ok: true,
        next: 'ask_bedrooms',
        answers: { ...answers, rent_max_dollars: String(n) },
        echo: fmtMoney(String(n)) + '/mo',
      };
    }
    case 'ask_bedrooms': {
      if (!/^\d+$/.test(text)) return { ok: false, error: 'Enter a whole number of bedrooms.' };
      return { ok: true, next: 'ask_state', answers: { ...answers, bedrooms_min: text }, echo: `${text}+ beds` };
    }
    case 'ask_state': {
      const st = text.toUpperCase();
      if (!US_STATES.has(st)) return { ok: false, error: 'Use a 2-letter US state code.' };
      return { ok: true, next: 'ask_pets', answers: { ...answers, preferred_state: st }, echo: st };
    }
    case 'ask_pets': {
      const t = text.toLowerCase();
      const yes = ['y', 'yes', 'yeah'].includes(t);
      const no = ['n', 'no', 'nope'].includes(t);
      if (!yes && !no) return { ok: false, error: 'Reply yes or no.' };
      return {
        ok: true,
        next: 'review',
        answers: { ...answers, has_pets: yes, profile_complete: true },
        echo: yes ? 'Yes' : 'No',
      };
    }
    case 'review': {
      const t = text.toLowerCase();
      if (t === 'edit' || t === 'change') {
        return { ok: true, next: 'ask_given_name', answers: { ...answers, profile_complete: false }, echo: 'Edit' };
      }
      return { ok: true, next: 'submit', answers, echo: text || 'Continue' };
    }
    case 'submit': {
      const t = text.toLowerCase();
      if (t === 'submit' || t === 'yes' || t === 'continue' || t === 'save') {
        return { ok: true, next: 'submit', answers, echo: 'Submit', done: true };
      }
      return { ok: false, error: 'Reply submit to save your profile.' };
    }
    default:
      return { ok: false, error: 'Unknown step.' };
  }
}

export function reviewText(a: RenterAnswers): string {
  const move = URGENCY_LABEL[a.move_in_urgency] ?? a.move_in_urgency;
  return [
    'Here’s your profile:',
    `• ${a.given_name} ${a.family_name}`,
    `• ${a.email} · ${a.phone}`,
    `• Up to ${fmtMoney(a.rent_max_dollars)}/mo · ${a.bedrooms_min}+ bedrooms · ${a.preferred_state}`,
    `• Move-in: ${move} · Pets: ${a.has_pets ? 'yes' : 'no'}`,
  ].join('\n');
}

export const PROFILE_STEP_CATALOG: ProfileStepId[] = [
  'welcome',
  'ask_given_name',
  'ask_family_name',
  'ask_phone',
  'ask_email',
  'ask_move_in',
  'ask_budget',
  'ask_bedrooms',
  'ask_state',
  'ask_pets',
  'review',
  'submit',
];
