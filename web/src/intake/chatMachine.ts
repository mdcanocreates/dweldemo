/**
 * N-6 — Deterministic, non-LLM intake chat state machine.
 * Every step and transition is enumerable below. Zero model calls.
 */

export type Occupant = { name: string; relationship: string; age_band: string };
export type Pet = { species: string; breed: string; weight_lbs: string };

export type IntakeAnswers = {
  given_name: string;
  family_name: string;
  phone: string;
  email: string;
  current_address_line1: string;
  current_address_city: string;
  current_address_state: string;
  current_address_postal: string;
  current_address_move_in: string;
  employer_name: string;
  job_title: string;
  employer_phone: string;
  employment_length_months: string;
  monthly_gross_income_dollars: string;
  occupants: Occupant[];
  pets: Pet[];
  emergency_name: string;
  emergency_relationship: string;
  emergency_phone: string;
  vehicle_make: string;
  vehicle_model: string;
  vehicle_plate: string;
  skip_vehicle: boolean;
};

export type ChatStepId =
  | 'welcome'
  | 'confirm_contact'
  | 'ask_given_name'
  | 'ask_family_name'
  | 'ask_phone'
  | 'ask_email'
  | 'confirm_address'
  | 'ask_line1'
  | 'ask_city'
  | 'ask_state'
  | 'ask_postal'
  | 'ask_move_in'
  | 'confirm_income'
  | 'ask_employer'
  | 'ask_job_title'
  | 'ask_employer_phone'
  | 'ask_emp_months'
  | 'ask_income'
  | 'ask_occupant'
  | 'ask_more_occupants'
  | 'confirm_pets'
  | 'ask_pet'
  | 'ask_more_pets'
  | 'ask_emergency_name'
  | 'ask_emergency_rel'
  | 'ask_emergency_phone'
  | 'ask_vehicle'
  | 'review'
  | 'submit';

export type ChatMessage = {
  id: string;
  role: 'guide' | 'user';
  text: string;
};

export type ChatMachineState = {
  stepId: ChatStepId;
  answers: IntakeAnswers;
  messages: ChatMessage[];
  /** When confirming known G-0 / prior intake values */
  confirming: boolean;
};

export const EMPTY_ANSWERS: IntakeAnswers = {
  given_name: '',
  family_name: '',
  phone: '',
  email: '',
  current_address_line1: '',
  current_address_city: '',
  current_address_state: '',
  current_address_postal: '',
  current_address_move_in: '',
  employer_name: '',
  job_title: '',
  employer_phone: '',
  employment_length_months: '',
  monthly_gross_income_dollars: '',
  occupants: [],
  pets: [],
  emergency_name: '',
  emergency_relationship: '',
  emergency_phone: '',
  vehicle_make: '',
  vehicle_model: '',
  vehicle_plate: '',
  skip_vehicle: false,
};

const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA',
  'ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK',
  'OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
]);

let msgSeq = 0;
function mid(): string {
  msgSeq += 1;
  return `m${msgSeq}`;
}

export function guide(text: string): ChatMessage {
  return { id: mid(), role: 'guide', text };
}

export function userMsg(text: string): ChatMessage {
  return { id: mid(), role: 'user', text };
}

export function promptFor(stepId: ChatStepId, answers: IntakeAnswers): string {
  switch (stepId) {
    case 'welcome':
      return "Hi — I'm Dwel. I'll walk you through your rental application one step at a time. Ready?";
    case 'confirm_contact':
      return `We have you as ${answers.given_name} ${answers.family_name} · ${answers.email || 'no email'} · ${answers.phone || 'no phone'}. Still correct?`;
    case 'ask_given_name':
      return "What's your first name?";
    case 'ask_family_name':
      return 'And your last name?';
    case 'ask_phone':
      return "What's the best phone number to reach you? (E.164 or US digits is fine.)";
    case 'ask_email':
      return "What's your email? We'll use it only when you submit, for your private application link.";
    case 'confirm_address':
      return `Current address on file: ${[
        answers.current_address_line1,
        answers.current_address_city,
        answers.current_address_state,
        answers.current_address_postal,
      ]
        .filter(Boolean)
        .join(', ')}. Still right?`;
    case 'ask_line1':
      return "What's your current street address?";
    case 'ask_city':
      return 'City?';
    case 'ask_state':
      return 'State (2-letter code, e.g. OH)?';
    case 'ask_postal':
      return 'ZIP / postal code?';
    case 'ask_move_in':
      return 'When did you move into that address? (YYYY-MM-DD)';
    case 'confirm_income':
      return `Monthly gross income we have: $${answers.monthly_gross_income_dollars}. Still accurate?`;
    case 'ask_employer':
      return 'Employer name?';
    case 'ask_job_title':
      return 'Job title?';
    case 'ask_employer_phone':
      return 'Employer phone?';
    case 'ask_emp_months':
      return 'How many months have you been in this role? (number)';
    case 'ask_income':
      return 'Monthly gross income in dollars? (numbers only, e.g. 4500)';
    case 'ask_occupant':
      return answers.occupants.length
        ? 'Add another occupant — name, relationship, and age band (e.g. "Alex, sibling, 18-24"). Or type skip.'
        : 'Any additional occupants? Reply with name, relationship, and age band (e.g. "Sam, partner, 25-34"), or type none.';
    case 'ask_more_occupants':
      return 'Add another occupant the same way, or type done.';
    case 'confirm_pets':
      return answers.pets.length
        ? `Pets on file: ${answers.pets.map((p) => p.species).join(', ')}. Still right?`
        : 'Do you have pets? (yes / no)';
    case 'ask_pet':
      return 'Pet details — species, breed, weight in lbs (e.g. "dog, lab, 45"). Or type none.';
    case 'ask_more_pets':
      return 'Add another pet the same way, or type done.';
    case 'ask_emergency_name':
      return "Emergency contact or reference — what's their name?";
    case 'ask_emergency_rel':
      return 'Their relationship to you?';
    case 'ask_emergency_phone':
      return 'Their phone number?';
    case 'ask_vehicle':
      return 'Vehicle for parking (optional) — make, model, plate (e.g. "Toyota, Corolla, ABC123"), or type skip.';
    case 'review':
      return buildReviewText(answers);
    case 'submit':
      return 'Ready to submit this application to the listing? Reply submit to continue (we only ask for sign-in at this step if needed).';
    default:
      return 'Continue.';
  }
}

function buildReviewText(a: IntakeAnswers): string {
  const lines = [
    'Here’s what I have — reply edit to change, or continue to submit:',
    `• ${a.given_name} ${a.family_name} · ${a.email} · ${a.phone}`,
    `• ${[a.current_address_line1, a.current_address_city, a.current_address_state, a.current_address_postal].filter(Boolean).join(', ')}`,
    `• Move-in at address: ${a.current_address_move_in || '—'}`,
    `• ${a.employer_name || '—'} / ${a.job_title || '—'} · $${a.monthly_gross_income_dollars || '—'}/mo`,
    `• Occupants: ${a.occupants.length ? a.occupants.map((o) => o.name).join(', ') : 'none'}`,
    `• Pets: ${a.pets.length ? a.pets.map((p) => p.species).join(', ') : 'none'}`,
    `• Emergency: ${a.emergency_name || '—'} (${a.emergency_relationship || '—'}) ${a.emergency_phone || ''}`,
    a.skip_vehicle
      ? '• Vehicle: skipped'
      : `• Vehicle: ${[a.vehicle_make, a.vehicle_model, a.vehicle_plate].filter(Boolean).join(' ') || '—'}`,
  ];
  return lines.join('\n');
}

export function initialMachine(answers: IntakeAnswers): ChatMachineState {
  const stepId = firstStep(answers);
  return {
    stepId,
    answers,
    confirming: stepId.startsWith('confirm_'),
    messages: [guide(promptFor(stepId === 'welcome' ? 'welcome' : stepId, answers))],
  };
}

function hasContact(a: IntakeAnswers): boolean {
  return Boolean(a.given_name && a.family_name && (a.email || a.phone));
}

function hasAddress(a: IntakeAnswers): boolean {
  return Boolean(a.current_address_line1 && a.current_address_city && a.current_address_state);
}

function firstStep(a: IntakeAnswers): ChatStepId {
  if (hasContact(a) && hasAddress(a) && a.monthly_gross_income_dollars) {
    return 'confirm_contact';
  }
  return 'welcome';
}

function parseTriple(raw: string): [string, string, string] {
  const parts = raw.split(',').map((s) => s.trim());
  return [parts[0] ?? '', parts[1] ?? '', parts[2] ?? ''];
}

function isYes(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  return ['y', 'yes', 'yeah', 'yep', 'correct', 'still', 'true', 'ok', 'okay'].includes(t);
}

function isNo(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  return ['n', 'no', 'nope', 'edit', 'change', 'wrong', 'false'].includes(t);
}

export type StepAdvance =
  | { ok: true; next: ChatStepId; answers: IntakeAnswers; echo: string }
  | { ok: false; error: string };

export function advance(stepId: ChatStepId, answers: IntakeAnswers, raw: string): StepAdvance {
  const text = raw.trim();
  if (!text && stepId !== 'ask_vehicle') {
    return { ok: false, error: 'Please enter a reply.' };
  }

  switch (stepId) {
    case 'welcome':
      return { ok: true, next: hasContact(answers) ? 'confirm_contact' : 'ask_given_name', answers, echo: text || 'Ready' };

    case 'confirm_contact':
      if (isYes(text)) {
        return {
          ok: true,
          next: hasAddress(answers) ? 'confirm_address' : 'ask_line1',
          answers,
          echo: 'Yes — still correct',
        };
      }
      if (isNo(text)) {
        return { ok: true, next: 'ask_given_name', answers, echo: 'I need to update that' };
      }
      return { ok: false, error: 'Reply yes or no (or edit).' };

    case 'ask_given_name':
      return {
        ok: true,
        next: 'ask_family_name',
        answers: { ...answers, given_name: text },
        echo: text,
      };

    case 'ask_family_name':
      return {
        ok: true,
        next: 'ask_phone',
        answers: { ...answers, family_name: text },
        echo: text,
      };

    case 'ask_phone':
      return { ok: true, next: 'ask_email', answers: { ...answers, phone: text }, echo: text };

    case 'ask_email': {
      if (!text.includes('@')) return { ok: false, error: 'Enter a valid email.' };
      return {
        ok: true,
        next: hasAddress(answers) ? 'confirm_address' : 'ask_line1',
        answers: { ...answers, email: text },
        echo: text,
      };
    }

    case 'confirm_address':
      if (isYes(text)) {
        return {
          ok: true,
          next: answers.monthly_gross_income_dollars ? 'confirm_income' : 'ask_employer',
          answers,
          echo: 'Yes — still right',
        };
      }
      if (isNo(text)) {
        return { ok: true, next: 'ask_line1', answers, echo: 'Update address' };
      }
      return { ok: false, error: 'Reply yes or no.' };

    case 'ask_line1':
      return { ok: true, next: 'ask_city', answers: { ...answers, current_address_line1: text }, echo: text };

    case 'ask_city':
      return { ok: true, next: 'ask_state', answers: { ...answers, current_address_city: text }, echo: text };

    case 'ask_state': {
      const st = text.toUpperCase();
      if (!US_STATES.has(st)) return { ok: false, error: 'Use a 2-letter US state code.' };
      return { ok: true, next: 'ask_postal', answers: { ...answers, current_address_state: st }, echo: st };
    }

    case 'ask_postal':
      return { ok: true, next: 'ask_move_in', answers: { ...answers, current_address_postal: text }, echo: text };

    case 'ask_move_in':
      return {
        ok: true,
        next: answers.monthly_gross_income_dollars ? 'confirm_income' : 'ask_employer',
        answers: { ...answers, current_address_move_in: text },
        echo: text,
      };

    case 'confirm_income':
      if (isYes(text)) {
        return { ok: true, next: 'ask_occupant', answers, echo: 'Yes — still accurate' };
      }
      if (isNo(text)) {
        return { ok: true, next: 'ask_employer', answers, echo: 'Update income details' };
      }
      return { ok: false, error: 'Reply yes or no.' };

    case 'ask_employer':
      return { ok: true, next: 'ask_job_title', answers: { ...answers, employer_name: text }, echo: text };

    case 'ask_job_title':
      return { ok: true, next: 'ask_employer_phone', answers: { ...answers, job_title: text }, echo: text };

    case 'ask_employer_phone':
      return { ok: true, next: 'ask_emp_months', answers: { ...answers, employer_phone: text }, echo: text };

    case 'ask_emp_months': {
      if (!/^\d+$/.test(text)) return { ok: false, error: 'Enter months as a whole number.' };
      return {
        ok: true,
        next: 'ask_income',
        answers: { ...answers, employment_length_months: text },
        echo: text,
      };
    }

    case 'ask_income': {
      const n = Number(text.replace(/[$,\s]/g, ''));
      if (!Number.isFinite(n) || n <= 0) return { ok: false, error: 'Enter a positive dollar amount.' };
      return {
        ok: true,
        next: 'ask_occupant',
        answers: { ...answers, monthly_gross_income_dollars: String(n) },
        echo: `$${n}`,
      };
    }

    case 'ask_occupant': {
      const low = text.toLowerCase();
      if (low === 'none' || low === 'skip' || low === 'no') {
        return { ok: true, next: 'confirm_pets', answers, echo: 'None' };
      }
      const [name, relationship, age_band] = parseTriple(text);
      if (!name) return { ok: false, error: 'Include at least a name, or type none.' };
      return {
        ok: true,
        next: 'ask_more_occupants',
        answers: { ...answers, occupants: [...answers.occupants, { name, relationship, age_band }] },
        echo: text,
      };
    }

    case 'ask_more_occupants': {
      const low = text.toLowerCase();
      if (low === 'done' || low === 'no' || low === 'skip') {
        return { ok: true, next: 'confirm_pets', answers, echo: 'Done' };
      }
      const [name, relationship, age_band] = parseTriple(text);
      if (!name) return { ok: false, error: 'Include a name, or type done.' };
      return {
        ok: true,
        next: 'ask_more_occupants',
        answers: { ...answers, occupants: [...answers.occupants, { name, relationship, age_band }] },
        echo: text,
      };
    }

    case 'confirm_pets': {
      if (answers.pets.length) {
        if (isYes(text)) return { ok: true, next: 'ask_emergency_name', answers, echo: 'Yes' };
        if (isNo(text)) {
          return { ok: true, next: 'ask_pet', answers: { ...answers, pets: [] }, echo: 'Update pets' };
        }
        return { ok: false, error: 'Reply yes or no.' };
      }
      if (isYes(text)) return { ok: true, next: 'ask_pet', answers, echo: 'Yes' };
      if (isNo(text) || text.toLowerCase() === 'none') {
        return { ok: true, next: 'ask_emergency_name', answers: { ...answers, pets: [] }, echo: 'No pets' };
      }
      return { ok: false, error: 'Reply yes or no.' };
    }

    case 'ask_pet': {
      const low = text.toLowerCase();
      if (low === 'none' || low === 'skip' || low === 'no') {
        return { ok: true, next: 'ask_emergency_name', answers, echo: 'None' };
      }
      const [species, breed, weight_lbs] = parseTriple(text);
      if (!species) return { ok: false, error: 'Include a species, or type none.' };
      return {
        ok: true,
        next: 'ask_more_pets',
        answers: { ...answers, pets: [...answers.pets, { species, breed, weight_lbs }] },
        echo: text,
      };
    }

    case 'ask_more_pets': {
      const low = text.toLowerCase();
      if (low === 'done' || low === 'no' || low === 'skip') {
        return { ok: true, next: 'ask_emergency_name', answers, echo: 'Done' };
      }
      const [species, breed, weight_lbs] = parseTriple(text);
      if (!species) return { ok: false, error: 'Include a species, or type done.' };
      return {
        ok: true,
        next: 'ask_more_pets',
        answers: { ...answers, pets: [...answers.pets, { species, breed, weight_lbs }] },
        echo: text,
      };
    }

    case 'ask_emergency_name':
      return {
        ok: true,
        next: 'ask_emergency_rel',
        answers: { ...answers, emergency_name: text },
        echo: text,
      };

    case 'ask_emergency_rel':
      return {
        ok: true,
        next: 'ask_emergency_phone',
        answers: { ...answers, emergency_relationship: text },
        echo: text,
      };

    case 'ask_emergency_phone':
      return {
        ok: true,
        next: 'ask_vehicle',
        answers: { ...answers, emergency_phone: text },
        echo: text,
      };

    case 'ask_vehicle': {
      const low = text.toLowerCase();
      if (!text || low === 'skip' || low === 'none' || low === 'no') {
        return {
          ok: true,
          next: 'review',
          answers: {
            ...answers,
            skip_vehicle: true,
            vehicle_make: '',
            vehicle_model: '',
            vehicle_plate: '',
          },
          echo: 'Skip',
        };
      }
      const [make, model, plate] = parseTriple(text);
      return {
        ok: true,
        next: 'review',
        answers: {
          ...answers,
          skip_vehicle: false,
          vehicle_make: make,
          vehicle_model: model,
          vehicle_plate: plate,
        },
        echo: text,
      };
    }

    case 'review': {
      const low = text.toLowerCase();
      if (low === 'edit' || low === 'change') {
        return { ok: true, next: 'ask_given_name', answers, echo: 'Edit' };
      }
      return { ok: true, next: 'submit', answers, echo: text || 'Continue' };
    }

    case 'submit': {
      const low = text.toLowerCase();
      if (low === 'submit' || isYes(text) || low === 'continue') {
        return { ok: true, next: 'submit', answers, echo: 'Submit' };
      }
      return { ok: false, error: 'Reply submit to finish, or go back by typing edit on the review step.' };
    }

    default:
      return { ok: false, error: 'Unknown step.' };
  }
}

/** Session persistence key (pre-auth tab close/reopen). */
export const CHAT_SESSION_KEY = 'dwel20.intake.chat.v1';
export const INTAKE_DRAFT_KEY = 'dwel20.intake.draft.v1';

export function answersToApiPayload(a: IntakeAnswers, markComplete: boolean) {
  const dollars = Number(a.monthly_gross_income_dollars);
  return {
    current_address_line1: a.current_address_line1 || undefined,
    current_address_city: a.current_address_city || undefined,
    current_address_state: a.current_address_state || undefined,
    current_address_postal: a.current_address_postal || undefined,
    current_address_move_in: a.current_address_move_in || undefined,
    employer_name: a.employer_name || undefined,
    job_title: a.job_title || undefined,
    employer_phone: a.employer_phone || undefined,
    employment_length_months: a.employment_length_months
      ? Number(a.employment_length_months)
      : undefined,
    monthly_gross_income_cents: Number.isFinite(dollars) ? Math.round(dollars * 100) : undefined,
    occupants: a.occupants.filter((o) => o.name.trim()),
    pets: a.pets.filter((p) => p.species.trim()),
    emergency_contact:
      a.emergency_name.trim() || a.emergency_phone.trim()
        ? {
            name: a.emergency_name,
            relationship: a.emergency_relationship,
            phone: a.emergency_phone,
          }
        : null,
    vehicle: a.skip_vehicle
      ? null
      : a.vehicle_make.trim() || a.vehicle_model.trim() || a.vehicle_plate.trim()
        ? { make: a.vehicle_make, model: a.vehicle_model, plate: a.vehicle_plate }
        : null,
    mark_complete: markComplete,
    given_name: a.given_name,
    family_name: a.family_name,
    phone: a.phone,
    email: a.email,
  };
}

/** Enumerable step list for the Part N report. */
export const CHAT_STEP_CATALOG: ChatStepId[] = [
  'welcome',
  'confirm_contact',
  'ask_given_name',
  'ask_family_name',
  'ask_phone',
  'ask_email',
  'confirm_address',
  'ask_line1',
  'ask_city',
  'ask_state',
  'ask_postal',
  'ask_move_in',
  'confirm_income',
  'ask_employer',
  'ask_job_title',
  'ask_employer_phone',
  'ask_emp_months',
  'ask_income',
  'ask_occupant',
  'ask_more_occupants',
  'confirm_pets',
  'ask_pet',
  'ask_more_pets',
  'ask_emergency_name',
  'ask_emergency_rel',
  'ask_emergency_phone',
  'ask_vehicle',
  'review',
  'submit',
];
