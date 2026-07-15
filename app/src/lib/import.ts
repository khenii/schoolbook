import { parseCSV } from './csv';

export interface RowError {
  row: number; // 1-based, matches spreadsheet row incl. header (header = row 1)
  message: string;
}

// ============================================================
// Students template
// ============================================================

export const STUDENTS_HEADERS = [
  'Admission Number',
  'First Name',
  'Last Name',
  'Other Names',
  'Status (New or Existing)',
  'Date of Birth (YYYY-MM-DD)',
  'Gender',
  'Guardian Name',
  'Guardian Phone',
  'Address',
  'Class Level',
  'Arm'
];

export const STUDENTS_TEMPLATE_EXAMPLE = [
  'ADM-2024-001',
  'Chidinma',
  'Okafor',
  '',
  'Existing',
  '2014-03-12',
  'Female',
  'Mrs. Okafor',
  '08034098249',
  '12 Allen Avenue, Ikeja',
  'Primary 4',
  'A'
];

export interface ParsedStudentRow {
  rowNum: number;
  admissionNumber: string;
  firstName: string;
  lastName: string;
  otherNames: string | null;
  status: 'new' | 'existing';
  dateOfBirth: string | null;
  gender: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  address: string | null;
  classArmId: string;
  classLevelId: string;
}

export interface StudentsRefData {
  existingAdmissionNumbers: Set<string>; // lowercased
  levels: { id: string; name: string }[];
  arms: { id: string; class_level_id: string; name: string }[]; // scoped to target session
}

export function parseStudentsCSV(
  text: string,
  ref: StudentsRefData
): { valid: ParsedStudentRow[]; errors: RowError[]; skipped: { row: number; admissionNumber: string }[] } {
  const rows = parseCSV(text);
  const errors: RowError[] = [];
  const valid: ParsedStudentRow[] = [];
  const skipped: { row: number; admissionNumber: string }[] = [];
  if (rows.length === 0) return { valid, errors, skipped };

  const levelByName = new Map(ref.levels.map((l) => [l.name.trim().toLowerCase(), l]));
  const seenInFile = new Set<string>(); // admission numbers already processed within this file

  // Skip the header row.
  for (let i = 1; i < rows.length; i++) {
    const rowNum = i + 1;
    const cells = rows[i];
    if (cells.every((c) => !c)) continue; // blank line

    const [
      admissionNumberRaw,
      firstNameRaw,
      lastNameRaw,
      otherNamesRaw,
      statusRaw,
      dobRaw,
      genderRaw,
      guardianNameRaw,
      guardianPhoneRaw,
      addressRaw,
      levelRaw,
      armRaw
    ] = cells;

    const admissionNumber = (admissionNumberRaw ?? '').trim();
    const firstName = (firstNameRaw ?? '').trim();
    const lastName = (lastNameRaw ?? '').trim();

    if (!admissionNumber || !firstName || !lastName) {
      errors.push({ row: rowNum, message: 'Admission Number, First Name, and Last Name are required.' });
      continue;
    }

    const admissionKey = admissionNumber.toLowerCase();
    if (ref.existingAdmissionNumbers.has(admissionKey)) {
      skipped.push({ row: rowNum, admissionNumber });
      continue;
    }
    if (seenInFile.has(admissionKey)) {
      errors.push({ row: rowNum, message: `Admission Number "${admissionNumber}" appears more than once in this file.` });
      continue;
    }

    const statusInput = (statusRaw ?? '').trim().toLowerCase();
    let status: 'new' | 'existing' = 'existing';
    if (statusInput === 'new') status = 'new';
    else if (statusInput === 'existing' || statusInput === '') status = 'existing';
    else {
      errors.push({ row: rowNum, message: `Status must be "New" or "Existing" (got "${statusRaw}").` });
      continue;
    }

    const levelName = (levelRaw ?? '').trim();
    const armName = (armRaw ?? '').trim();
    if (!levelName || !armName) {
      errors.push({ row: rowNum, message: 'Class Level and Arm are required.' });
      continue;
    }
    const level = levelByName.get(levelName.toLowerCase());
    if (!level) {
      errors.push({ row: rowNum, message: `Class Level "${levelName}" doesn't match any configured level.` });
      continue;
    }
    const arm = ref.arms.find(
      (a) => a.class_level_id === level.id && a.name.trim().toLowerCase() === armName.toLowerCase()
    );
    if (!arm) {
      errors.push({
        row: rowNum,
        message: `Arm "${armName}" doesn't exist under "${levelName}" for the active session — add it in Settings first.`
      });
      continue;
    }

    const dob = (dobRaw ?? '').trim();
    if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      errors.push({ row: rowNum, message: `Date of Birth "${dob}" must be in YYYY-MM-DD format.` });
      continue;
    }

    seenInFile.add(admissionKey);
    valid.push({
      rowNum,
      admissionNumber,
      firstName,
      lastName,
      otherNames: (otherNamesRaw ?? '').trim() || null,
      status,
      dateOfBirth: dob || null,
      gender: (genderRaw ?? '').trim() || null,
      guardianName: (guardianNameRaw ?? '').trim() || null,
      guardianPhone: (guardianPhoneRaw ?? '').trim() || null,
      address: (addressRaw ?? '').trim() || null,
      classArmId: arm.id,
      classLevelId: level.id
    });
  }

  return { valid, errors, skipped };
}

// ============================================================
// Historical Charges & Payments template
// ============================================================

export const CHARGES_PAYMENTS_HEADERS = [
  'Admission Number',
  'Session',
  'Term',
  'Fee Item',
  'Class Level',
  'Amount Expected',
  'Amount Paid',
  'Date Paid (YYYY-MM-DD)',
  'Method (Cash/Bank Transfer/POS/Other)',
  'Receipt Number'
];

export const CHARGES_PAYMENTS_TEMPLATE_EXAMPLE = [
  'ADM-2024-001',
  '2023/2024',
  'Term 1',
  'School Fees',
  'Primary 4',
  '45000',
  '45000',
  '2023-09-15',
  'Cash',
  'RCT-0192'
];

export interface ParsedChargePaymentRow {
  rowNum: number;
  admissionNumber: string;
  studentId: string;
  sessionId: string;
  termId: string;
  feeItemId: string;
  classLevelId: string;
  amountExpected: number;
  amountPaid: number;
  datePaid: string | null;
  method: 'cash' | 'bank-transfer' | 'pos' | 'other';
  receiptNumber: string | null;
}

export interface ChargesPaymentsRefData {
  studentByAdmissionNumber: Map<string, { id: string }>; // key lowercased
  sessions: { id: string; name: string }[];
  terms: { id: string; session_id: string; name: string }[];
  feeItems: { id: string; name: string }[];
  levels: { id: string; name: string }[];
  existingChargeKeys: Set<string>; // `${studentId}:${feeItemId}:${termId}`
}

const METHOD_MAP: Record<string, ParsedChargePaymentRow['method']> = {
  cash: 'cash',
  'bank transfer': 'bank-transfer',
  'bank-transfer': 'bank-transfer',
  pos: 'pos',
  other: 'other'
};

export function parseChargesPaymentsCSV(
  text: string,
  ref: ChargesPaymentsRefData
): { valid: ParsedChargePaymentRow[]; errors: RowError[]; skipped: { row: number; admissionNumber: string }[] } {
  const rows = parseCSV(text);
  const errors: RowError[] = [];
  const valid: ParsedChargePaymentRow[] = [];
  const skipped: { row: number; admissionNumber: string }[] = [];
  if (rows.length === 0) return { valid, errors, skipped };

  const sessionByName = new Map(ref.sessions.map((s) => [s.name.trim().toLowerCase(), s]));
  const feeItemByName = new Map(ref.feeItems.map((f) => [f.name.trim().toLowerCase(), f]));
  const levelByName = new Map(ref.levels.map((l) => [l.name.trim().toLowerCase(), l]));
  const seenInFile = new Set<string>(); // `${admissionKey}:${sessionName}:${termName}:${feeItemName}`

  for (let i = 1; i < rows.length; i++) {
    const rowNum = i + 1;
    const cells = rows[i];
    if (cells.every((c) => !c)) continue;

    const [
      admissionNumberRaw,
      sessionRaw,
      termRaw,
      feeItemRaw,
      levelRaw,
      amountExpectedRaw,
      amountPaidRaw,
      datePaidRaw,
      methodRaw,
      receiptRaw
    ] = cells;

    const admissionNumber = (admissionNumberRaw ?? '').trim();
    if (!admissionNumber) {
      errors.push({ row: rowNum, message: 'Admission Number is required.' });
      continue;
    }
    const student = ref.studentByAdmissionNumber.get(admissionNumber.toLowerCase());
    if (!student) {
      errors.push({ row: rowNum, message: `No student found with Admission Number "${admissionNumber}" — import the Students template first.` });
      continue;
    }

    const sessionName = (sessionRaw ?? '').trim();
    const session = sessionByName.get(sessionName.toLowerCase());
    if (!session) {
      errors.push({ row: rowNum, message: `Session "${sessionName}" doesn't match any configured session.` });
      continue;
    }
    const termName = (termRaw ?? '').trim();
    const term = ref.terms.find((t) => t.session_id === session.id && t.name.trim().toLowerCase() === termName.toLowerCase());
    if (!term) {
      errors.push({ row: rowNum, message: `Term "${termName}" doesn't exist under session "${sessionName}".` });
      continue;
    }

    const feeItemName = (feeItemRaw ?? '').trim();
    const feeItem = feeItemByName.get(feeItemName.toLowerCase());
    if (!feeItem) {
      errors.push({ row: rowNum, message: `Fee Item "${feeItemName}" doesn't match any configured fee item.` });
      continue;
    }

    const levelName = (levelRaw ?? '').trim();
    const level = levelByName.get(levelName.toLowerCase());
    if (!level) {
      errors.push({ row: rowNum, message: `Class Level "${levelName}" doesn't match any configured level.` });
      continue;
    }

    const amountExpected = Number(amountExpectedRaw);
    if (!amountExpectedRaw || Number.isNaN(amountExpected) || amountExpected < 0) {
      errors.push({ row: rowNum, message: `Amount Expected "${amountExpectedRaw}" must be a non-negative number.` });
      continue;
    }
    const amountPaid = amountPaidRaw ? Number(amountPaidRaw) : 0;
    if (amountPaidRaw && (Number.isNaN(amountPaid) || amountPaid < 0)) {
      errors.push({ row: rowNum, message: `Amount Paid "${amountPaidRaw}" must be a non-negative number.` });
      continue;
    }

    const datePaid = (datePaidRaw ?? '').trim();
    if (datePaid && !/^\d{4}-\d{2}-\d{2}$/.test(datePaid)) {
      errors.push({ row: rowNum, message: `Date Paid "${datePaid}" must be in YYYY-MM-DD format.` });
      continue;
    }

    const methodInput = (methodRaw ?? '').trim().toLowerCase();
    const method = methodInput ? METHOD_MAP[methodInput] : 'other';
    if (methodInput && !method) {
      errors.push({ row: rowNum, message: `Method "${methodRaw}" must be one of Cash, Bank Transfer, POS, Other.` });
      continue;
    }

    const dedupeKey = `${admissionNumber.toLowerCase()}:${sessionName.toLowerCase()}:${termName.toLowerCase()}:${feeItemName.toLowerCase()}`;
    const existingKey = `${student.id}:${feeItem.id}:${term.id}`;
    if (ref.existingChargeKeys.has(existingKey) || seenInFile.has(dedupeKey)) {
      skipped.push({ row: rowNum, admissionNumber });
      continue;
    }
    seenInFile.add(dedupeKey);

    valid.push({
      rowNum,
      admissionNumber,
      studentId: student.id,
      sessionId: session.id,
      termId: term.id,
      feeItemId: feeItem.id,
      classLevelId: level.id,
      amountExpected,
      amountPaid,
      datePaid: amountPaid > 0 ? datePaid || new Date().toISOString().slice(0, 10) : datePaid || null,
      method: method ?? 'other',
      receiptNumber: (receiptRaw ?? '').trim() || null
    });
  }

  return { valid, errors, skipped };
}
