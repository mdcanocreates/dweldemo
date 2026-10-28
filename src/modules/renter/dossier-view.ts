/**
 * Read-only presentation of an application dossier.
 * Submitted fields come from the frozen snapshot when one exists.
 * Later profile or intake edits are never copied into that snapshot.
 */

export type FieldSource =
  | 'submitted_snapshot'
  | 'live_dossier'
  | 'current_account'
  | 'not_on_file';

export type DossierText = {
  value: string | null;
  source: FieldSource;
};

export type ContactBlock = {
  given_name: DossierText;
  family_name: DossierText;
  email: DossierText;
  phone: DossierText;
};

export type ResidenceBlock = {
  line1: DossierText;
  city: DossierText;
  state: DossierText;
  postal: DossierText;
  move_in: DossierText;
};

export type EmploymentBlock = {
  employer_name: DossierText;
  job_title: DossierText;
  employer_phone: DossierText;
  employment_length_months: DossierText;
  monthly_gross_income_cents: DossierText;
};

export type JsonField = {
  value: unknown;
  source: FieldSource;
};

export type LiveProfileFields = {
  given_name: string | null;
  family_name: string | null;
  email: string | null;
  phone_e164: string | null;
};

export type SnapshotShape = 'wrapped' | 'flat_intake' | 'empty' | 'unrecognized';

export type PresentedDossier = {
  mode: 'frozen_snapshot' | 'snapshot_absent' | 'live_dossier';
  captured_at: string | null;
  snapshot_shape: SnapshotShape;
  snapshot_readable: boolean;
  contact: ContactBlock;
  residence: ResidenceBlock;
  employment: EmploymentBlock;
  occupants: JsonField;
  pets: JsonField;
  emergency_contact: JsonField;
  vehicle: JsonField;
  /** Live account data that was not part of the frozen submission. */
  current_account: null | {
    reason: 'fills_gaps_in_submission' | 'account_is_not_the_submission';
    contact: ContactBlock;
    residence: ResidenceBlock;
    employment: EmploymentBlock;
  };
  retrieval: {
    snapshot: 'present' | 'absent';
    profile: 'present' | 'absent';
    intake: 'present' | 'absent';
  };
};

export type RecordedUpdate = {
  at: string;
  label: string;
};

const UPDATE_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'created_at', label: 'Application created' },
  { key: 'move_forward_at', label: 'Home provider moved the application forward' },
  { key: 'info_requested_at', label: 'Home provider requested more information' },
  { key: 'screening_authorized_at', label: 'Screening was authorized' },
  { key: 'screened_at', label: 'Screening result was recorded' },
  { key: 'contact_revealed_at', label: 'Contact was shared with the home provider' },
  { key: 'passed_at', label: 'Home provider passed on the application' },
  { key: 'closed_at', label: 'Application was closed' },
];

export function shouldFreezeIntakeSnapshot(existingSnapshot: unknown): boolean {
  return existingSnapshot == null;
}

export function recordedStatusUpdates(
  timestamps: Record<string, string | null | undefined>,
): RecordedUpdate[] {
  const updates: RecordedUpdate[] = [];
  for (const field of UPDATE_FIELDS) {
    const at = timestamps[field.key];
    if (typeof at === 'string' && at.trim()) {
      updates.push({ at, label: field.label });
    }
  }
  updates.sort((a, b) => a.at.localeCompare(b.at));
  return updates;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function textField(value: unknown, sourceWhenPresent: FieldSource): DossierText {
  if (typeof value === 'string' && value.trim()) {
    return { value: value.trim(), source: sourceWhenPresent };
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { value: String(value), source: sourceWhenPresent };
  }
  return { value: null, source: 'not_on_file' };
}

function emptyContact(): ContactBlock {
  return {
    given_name: textField(null, 'not_on_file'),
    family_name: textField(null, 'not_on_file'),
    email: textField(null, 'not_on_file'),
    phone: textField(null, 'not_on_file'),
  };
}

function emptyResidence(): ResidenceBlock {
  return {
    line1: textField(null, 'not_on_file'),
    city: textField(null, 'not_on_file'),
    state: textField(null, 'not_on_file'),
    postal: textField(null, 'not_on_file'),
    move_in: textField(null, 'not_on_file'),
  };
}

function emptyEmployment(): EmploymentBlock {
  return {
    employer_name: textField(null, 'not_on_file'),
    job_title: textField(null, 'not_on_file'),
    employer_phone: textField(null, 'not_on_file'),
    employment_length_months: textField(null, 'not_on_file'),
    monthly_gross_income_cents: textField(null, 'not_on_file'),
  };
}

function contactFrom(
  source: Record<string, unknown> | null,
  sourceWhenPresent: FieldSource,
  phoneKey: 'phone_e164' | 'phone',
): ContactBlock {
  if (!source) return emptyContact();
  return {
    given_name: textField(source.given_name, sourceWhenPresent),
    family_name: textField(source.family_name, sourceWhenPresent),
    email: textField(source.email, sourceWhenPresent),
    phone: textField(source[phoneKey] ?? source.phone_e164 ?? source.phone, sourceWhenPresent),
  };
}

function residenceFrom(
  source: Record<string, unknown> | null,
  sourceWhenPresent: FieldSource,
): ResidenceBlock {
  if (!source) return emptyResidence();
  const moveIn = source.current_address_move_in;
  const move =
    moveIn instanceof Date
      ? moveIn.toISOString().slice(0, 10)
      : typeof moveIn === 'string'
        ? moveIn.slice(0, 10)
        : null;
  return {
    line1: textField(source.current_address_line1, sourceWhenPresent),
    city: textField(source.current_address_city, sourceWhenPresent),
    state: textField(source.current_address_state, sourceWhenPresent),
    postal: textField(source.current_address_postal, sourceWhenPresent),
    move_in: textField(move, sourceWhenPresent),
  };
}

function employmentFrom(
  source: Record<string, unknown> | null,
  sourceWhenPresent: FieldSource,
): EmploymentBlock {
  if (!source) return emptyEmployment();
  return {
    employer_name: textField(source.employer_name, sourceWhenPresent),
    job_title: textField(source.job_title, sourceWhenPresent),
    employer_phone: textField(source.employer_phone, sourceWhenPresent),
    employment_length_months: textField(source.employment_length_months, sourceWhenPresent),
    monthly_gross_income_cents: textField(source.monthly_gross_income_cents, sourceWhenPresent),
  };
}

function jsonField(value: unknown, sourceWhenPresent: FieldSource): JsonField {
  if (value == null) return { value: null, source: 'not_on_file' };
  if (Array.isArray(value)) {
    return value.length
      ? { value, source: sourceWhenPresent }
      : { value: null, source: 'not_on_file' };
  }
  if (isRecord(value)) {
    const any = Object.values(value).some((item) => item != null && String(item).trim() !== '');
    return any ? { value, source: sourceWhenPresent } : { value: null, source: 'not_on_file' };
  }
  return { value: null, source: 'not_on_file' };
}

function blockHasValue(block: ContactBlock | ResidenceBlock | EmploymentBlock): boolean {
  return Object.values(block).some((field) => field.value != null);
}

function parseSnapshot(raw: unknown): {
  shape: SnapshotShape;
  captured_at: string | null;
  contact: Record<string, unknown> | null;
  intake: Record<string, unknown> | null;
  readable: boolean;
} {
  if (!isRecord(raw)) {
    return { shape: 'empty', captured_at: null, contact: null, intake: null, readable: false };
  }
  const wrapped = 'contact' in raw || 'intake' in raw || 'captured_at' in raw;
  if (wrapped) {
    return {
      shape: 'wrapped',
      captured_at: typeof raw.captured_at === 'string' ? raw.captured_at : null,
      contact: isRecord(raw.contact) ? raw.contact : null,
      intake: isRecord(raw.intake) ? raw.intake : null,
      readable: true,
    };
  }
  const flat =
    'current_address_line1' in raw || 'employer_name' in raw || 'occupants' in raw;
  if (flat) {
    return {
      shape: 'flat_intake',
      captured_at: null,
      contact: null,
      intake: raw,
      readable: true,
    };
  }
  return { shape: 'unrecognized', captured_at: null, contact: null, intake: null, readable: false };
}

function liveContact(profile: LiveProfileFields | null): ContactBlock {
  if (!profile) return emptyContact();
  return contactFrom(
    {
      given_name: profile.given_name,
      family_name: profile.family_name,
      email: profile.email,
      phone_e164: profile.phone_e164,
    },
    'current_account',
    'phone_e164',
  );
}

export function presentApplicationDossier(input: {
  snapshot: unknown;
  snapshotFrozen: boolean;
  liveProfile: LiveProfileFields | null;
  liveIntake: Record<string, unknown> | null;
}): PresentedDossier {
  const parsed = parseSnapshot(input.snapshot);
  const retrieval = {
    snapshot: input.snapshotFrozen ? ('present' as const) : ('absent' as const),
    profile: input.liveProfile ? ('present' as const) : ('absent' as const),
    intake: input.liveIntake ? ('present' as const) : ('absent' as const),
  };

  if (!input.snapshotFrozen) {
    const account = input.liveProfile || input.liveIntake;
    return {
      mode: 'snapshot_absent',
      captured_at: null,
      snapshot_shape: 'empty',
      snapshot_readable: true,
      contact: emptyContact(),
      residence: emptyResidence(),
      employment: emptyEmployment(),
      occupants: jsonField(null, 'not_on_file'),
      pets: jsonField(null, 'not_on_file'),
      emergency_contact: jsonField(null, 'not_on_file'),
      vehicle: jsonField(null, 'not_on_file'),
      current_account: account
        ? {
            reason: 'account_is_not_the_submission',
            contact: liveContact(input.liveProfile),
            residence: residenceFrom(input.liveIntake, 'current_account'),
            employment: employmentFrom(input.liveIntake, 'current_account'),
          }
        : null,
      retrieval,
    };
  }

  const source: FieldSource = 'submitted_snapshot';
  const contact = contactFrom(parsed.contact, source, 'phone_e164');
  const residence = residenceFrom(parsed.intake, source);
  const employment = employmentFrom(parsed.intake, source);
  const submittedHasGap =
    !parsed.readable ||
    !blockHasValue(contact) ||
    !blockHasValue(residence) ||
    !blockHasValue(employment);
  const accountContact = liveContact(input.liveProfile);
  const accountResidence = residenceFrom(input.liveIntake, 'current_account');
  const accountEmployment = employmentFrom(input.liveIntake, 'current_account');
  const accountHasValue =
    blockHasValue(accountContact) ||
    blockHasValue(accountResidence) ||
    blockHasValue(accountEmployment);
  const submittedName = [contact.given_name.value, contact.family_name.value]
    .filter(Boolean)
    .join(' ');
  const accountName = [accountContact.given_name.value, accountContact.family_name.value]
    .filter(Boolean)
    .join(' ');
  const accountDrifted = Boolean(submittedName && accountName && submittedName !== accountName);

  return {
    mode: 'frozen_snapshot',
    captured_at: parsed.captured_at,
    snapshot_shape: parsed.shape,
    snapshot_readable: parsed.readable,
    contact,
    residence,
    employment,
    occupants: jsonField(parsed.intake?.occupants, source),
    pets: jsonField(parsed.intake?.pets, source),
    emergency_contact: jsonField(parsed.intake?.emergency_contact, source),
    vehicle: jsonField(parsed.intake?.vehicle, source),
    current_account:
      (submittedHasGap || accountDrifted) && accountHasValue
        ? {
            reason: accountDrifted ? 'account_is_not_the_submission' : 'fills_gaps_in_submission',
            contact: accountContact,
            residence: accountResidence,
            employment: accountEmployment,
          }
        : null,
    retrieval,
  };
}
