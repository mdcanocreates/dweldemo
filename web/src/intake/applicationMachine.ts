/**
 * Listing interest confirm — profile already collected on homepage.
 * Screening/identity details are collected later via Certn, not here.
 */

import type { RenterAnswers } from './answers';

export type AppStepId = 'welcome' | 'review' | 'submit';

export type ChatMessage = { id: string; role: 'guide' | 'user'; text: string };

let seq = 0;
const mid = () => `a${++seq}`;
export const guide = (text: string): ChatMessage => ({ id: mid(), role: 'guide', text });
export const userMsg = (text: string): ChatMessage => ({ id: mid(), role: 'user', text });

export function firstAppStep(_a: RenterAnswers): AppStepId {
  return 'welcome';
}

export function promptFor(step: AppStepId, a: RenterAnswers): string {
  switch (step) {
    case 'welcome':
      return a.given_name
        ? `${a.given_name}, ready to send interest on this listing?`
        : 'Ready to send interest on this listing?';
    case 'review':
      return 'We already have your matching profile. Reply continue to submit interest.';
    case 'submit':
      return 'Reply submit to send interest.';
    default:
      return 'Continue.';
  }
}

export type Advance =
  | { ok: true; next: AppStepId; answers: RenterAnswers; echo: string; done?: boolean }
  | { ok: false; error: string };

export function advanceApp(step: AppStepId, answers: RenterAnswers, raw: string): Advance {
  const text = raw.trim();

  switch (step) {
    case 'welcome':
      return { ok: true, next: 'review', answers, echo: text || 'Ready' };
    case 'review': {
      const low = text.toLowerCase();
      if (low === 'edit') {
        return { ok: true, next: 'welcome', answers, echo: 'Edit' };
      }
      return { ok: true, next: 'submit', answers, echo: text || 'Continue' };
    }
    case 'submit': {
      const low = text.toLowerCase();
      if (low === 'submit' || low === 'yes' || low === 'continue') {
        return { ok: true, next: 'submit', answers, echo: 'Submit', done: true };
      }
      return { ok: false, error: 'Reply submit to finish.' };
    }
    default:
      return { ok: false, error: 'Unknown step.' };
  }
}

export function reviewText(a: RenterAnswers): string {
  return [
    'Ready to apply with this profile:',
    `• ${a.given_name} ${a.family_name} · ${a.email}`,
    `• ${a.preferred_state} · ${a.bedrooms_min}+ beds · pets: ${a.has_pets ? 'yes' : 'no'}`,
  ].join('\n');
}
