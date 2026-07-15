interface HouseholdExecutor {
  execute(sql: string, params?: unknown[]): Promise<unknown>;
  getAll<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

// Strips everything but digits, so "080 3409 8249", "0803-409-8249", and
// "08034098249" are all recognized as the same guardian phone number —
// per spec §3.6, phone match is the mechanism for finding siblings.
export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

// Links a set of students (typically: a new enrollee plus any matched
// siblings, or a student plus one manually chosen sibling from the profile
// page) into the same household. Reuses an existing household if any of
// them already has one; otherwise creates a new one. Never reassigns a
// student who already belongs to a *different* household — that would
// silently break an existing family link, which should only ever happen
// as a deliberate action, not a side effect of enrolling someone else.
export async function linkStudentsToHousehold(
  tx: HouseholdExecutor,
  params: {
    schoolId: string;
    studentIds: string[];
    fallbackName?: string;
    fallbackPhone?: string;
  }
): Promise<string> {
  const { schoolId, studentIds, fallbackName, fallbackPhone } = params;
  if (studentIds.length === 0) throw new Error('linkStudentsToHousehold requires at least one student id');

  const placeholders = studentIds.map(() => '?').join(',');
  const rows = await tx.getAll<{ id: string; household_id: string | null }>(
    `SELECT id, household_id FROM students WHERE id IN (${placeholders})`,
    studentIds
  );

  const existingHouseholdId = rows.find((r) => r.household_id)?.household_id ?? null;
  let householdId = existingHouseholdId;

  if (!householdId) {
    householdId = crypto.randomUUID();
    const now = new Date().toISOString();
    await tx.execute('INSERT INTO households (id, school_id, name, phone, created_at) VALUES (?, ?, ?, ?, ?)', [
      householdId,
      schoolId,
      fallbackName?.trim() || 'Unnamed household',
      fallbackPhone?.trim() || null,
      now
    ]);
  }

  for (const row of rows) {
    if (!row.household_id) {
      await tx.execute('UPDATE students SET household_id = ? WHERE id = ?', [householdId, row.id]);
    }
  }

  return householdId;
}
