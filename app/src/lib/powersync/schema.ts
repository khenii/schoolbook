import { Schema, Table, column } from '@powersync/web';

// Mirrors db/001_initial_schema.sql. Excludes the implicit `id` column,
// which PowerSync manages automatically on every table.
//
// Money columns use REAL — SQLite has no native DECIMAL type. That's fine
// for early development, but worth revisiting (store amounts as integer
// kobo instead) before this handles real payments, to avoid floating-point
// rounding on financial data.

const schools = new Table({
  name: column.text,
  address: column.text,
  contact_email: column.text,
  contact_phone: column.text,
  subscription_status: column.text,
  state: column.text,
  city: column.text,
  created_at: column.text
});

const accounts = new Table({
  school_id: column.text,
  email: column.text,
  role: column.text,
  created_at: column.text
});

const sessions = new Table({
  school_id: column.text,
  name: column.text,
  start_date: column.text,
  end_date: column.text,
  is_active: column.integer,
  created_at: column.text
});

const terms = new Table({
  school_id: column.text,
  session_id: column.text,
  name: column.text,
  start_date: column.text,
  end_date: column.text,
  is_current: column.integer,
  created_at: column.text
});

const class_levels = new Table({
  school_id: column.text,
  name: column.text,
  sort_order: column.integer,
  created_at: column.text
});

const class_arms = new Table({
  school_id: column.text,
  class_level_id: column.text,
  session_id: column.text,
  name: column.text,
  created_at: column.text
});

const fee_items = new Table({
  school_id: column.text,
  name: column.text,
  type: column.text,
  applies_to: column.text,
  created_at: column.text
});

const fee_item_pricing = new Table({
  school_id: column.text,
  fee_item_id: column.text,
  class_level_id: column.text,
  amount: column.real,
  created_at: column.text
});

const households = new Table({
  school_id: column.text,
  name: column.text,
  phone: column.text,
  email: column.text,
  address: column.text,
  created_at: column.text
});

const students = new Table({
  school_id: column.text,
  first_name: column.text,
  last_name: column.text,
  other_names: column.text,
  admission_number: column.text,
  status: column.text,
  date_of_birth: column.text,
  gender: column.text,
  guardian_name: column.text,
  guardian_phone: column.text,
  address: column.text,
  household_id: column.text,
  current_class_arm_id: column.text,
  admission_session_id: column.text,
  status_changed_at: column.text,
  status_reason: column.text,
  created_at: column.text
});

const enrollment_history = new Table({
  school_id: column.text,
  student_id: column.text,
  session_id: column.text,
  class_level_id: column.text,
  class_arm_id: column.text,
  type: column.text,
  created_at: column.text
});

const charges = new Table({
  school_id: column.text,
  student_id: column.text,
  fee_item_id: column.text,
  session_id: column.text,
  term_id: column.text,
  class_level_id: column.text,
  amount_expected: column.real,
  created_at: column.text
});

const payments = new Table({
  school_id: column.text,
  student_id: column.text,
  charge_id: column.text,
  amount_paid: column.real,
  date_paid: column.text,
  method: column.text,
  receipt_number: column.text,
  recorded_by: column.text,
  household_transaction_id: column.text,
  void_of_payment_id: column.text,
  void_reason: column.text,
  created_at: column.text
});

const student_notes = new Table({
  school_id: column.text,
  student_id: column.text,
  text: column.text,
  created_by: column.text,
  pinned: column.integer,
  archived: column.integer,
  created_at: column.text
});

const write_offs = new Table({
  school_id: column.text,
  charge_id: column.text,
  student_id: column.text,
  amount: column.real,
  reason: column.text,
  written_off_by: column.text,
  created_at: column.text
});

const discounts = new Table({
  school_id: column.text,
  student_id: column.text,
  fee_item_id: column.text,
  type: column.text,
  value: column.real,
  reason: column.text,
  applied_by: column.text,
  active: column.integer,
  created_at: column.text,
  removed_at: column.text
});

const audit_log = new Table({
  school_id: column.text,
  actor_id: column.text,
  action: column.text,
  entity_type: column.text,
  entity_id: column.text,
  metadata: column.text, // JSON stored as text; JSON.parse on read
  created_at: column.text
});

export const AppSchema = new Schema({
  schools,
  accounts,
  sessions,
  terms,
  class_levels,
  class_arms,
  fee_items,
  fee_item_pricing,
  households,
  students,
  enrollment_history,
  charges,
  payments,
  student_notes,
  write_offs,
  discounts,
  audit_log
});

export type Database = (typeof AppSchema)['types'];
