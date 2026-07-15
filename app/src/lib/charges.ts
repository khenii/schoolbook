interface ChargeExecutor {
  execute(sql: string, params?: unknown[]): Promise<unknown>;
  getAll<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

interface FeeItemRow {
  id: string;
  type: 'one-off' | 'recurring';
  applies_to: 'new-students-only' | 'all-students';
}

interface FeeItemPricingRow {
  fee_item_id: string;
  class_level_id: string;
  amount: number;
}

interface DiscountRow {
  student_id: string;
  fee_item_id: string;
  type: 'percent' | 'fixed';
  value: number;
}

// Standing discounts (spec: "applied at charge generation") only affect
// charges generated from here on — they never rewrite an already-generated
// charge, since charges are append-only. Adjusting an existing charge is
// what write-offs are for. Clamped to zero: a discount can reduce a charge
// to free, never negative.
function applyDiscount(baseAmount: number, discount: DiscountRow | undefined): number {
  if (!discount) return baseAmount;
  const reduced = discount.type === 'percent' ? baseAmount * (1 - discount.value / 100) : baseAmount - discount.value;
  return Math.max(0, reduced);
}

// Generates the charges a student owes on enrollment, per spec §3.1:
// - all-students fee items always apply
// - new-students-only fee items apply only if the student's status is 'new'
// - one-off and recurring items both get exactly one charge here, scoped to
//   the enrolling term. Recurring items get further charges generated when
//   later terms start — see generateRecurringChargesForTerm below.
//
// Takes a transaction/executor rather than opening its own, so callers can
// run this atomically alongside the student insert itself.
export async function generateChargesForNewStudent(
  tx: ChargeExecutor,
  params: {
    schoolId: string;
    studentId: string;
    classLevelId: string;
    sessionId: string;
    termId: string;
    isNewStudent: boolean;
  }
): Promise<number> {
  const { schoolId, studentId, classLevelId, sessionId, termId, isNewStudent } = params;

  const feeItems = await tx.getAll<FeeItemRow>('SELECT id, type, applies_to FROM fee_items');
  const pricingRows = await tx.getAll<FeeItemPricingRow>(
    'SELECT fee_item_id, class_level_id, amount FROM fee_item_pricing WHERE class_level_id = ?',
    [classLevelId]
  );
  const priceByFeeItem = new Map(pricingRows.map((p) => [p.fee_item_id, p.amount]));

  const discountRows = await tx.getAll<DiscountRow>(
    'SELECT student_id, fee_item_id, type, value FROM discounts WHERE student_id = ? AND active = 1',
    [studentId]
  );
  const discountByFeeItem = new Map(discountRows.map((d) => [d.fee_item_id, d]));

  const now = new Date().toISOString();
  let count = 0;

  for (const item of feeItems) {
    const applicable =
      item.applies_to === 'all-students' || (item.applies_to === 'new-students-only' && isNewStudent);
    if (!applicable) continue;

    const amount = applyDiscount(priceByFeeItem.get(item.id) ?? 0, discountByFeeItem.get(item.id));
    await tx.execute(
      `INSERT INTO charges
         (id, school_id, student_id, fee_item_id, session_id, term_id, class_level_id, amount_expected, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), schoolId, studentId, item.id, sessionId, termId, classLevelId, amount, now]
    );
    count++;
  }

  return count;
}

// Bulk-generates recurring charges for every currently-enrolled student when
// the school advances to a new term — the gap flagged after building Student
// CRUD. Only fee items that are both `recurring` AND `all-students` apply
// here: `new-students-only` items are charged exactly once, at enrollment
// (spec §3.1 — "only once, typically at admission"), regardless of their
// type, so they're deliberately excluded from ever recurring here.
//
// Safe to re-run for the same term: skips any (student, fee item) pair that
// already has a charge for that term, so an admin double-clicking "generate"
// doesn't create duplicate charges.
export async function generateRecurringChargesForTerm(
  tx: ChargeExecutor,
  params: { schoolId: string; termId: string; sessionId: string }
): Promise<{ generated: number; skipped: number }> {
  const { schoolId, termId, sessionId } = params;

  const feeItems = await tx.getAll<FeeItemRow>(
    "SELECT id, type, applies_to FROM fee_items WHERE type = 'recurring' AND applies_to = 'all-students'"
  );
  if (feeItems.length === 0) return { generated: 0, skipped: 0 };

  const students = await tx.getAll<{ id: string; current_class_arm_id: string | null }>(
    "SELECT id, current_class_arm_id FROM students WHERE status NOT IN ('withdrawn', 'graduated')"
  );

  const arms = await tx.getAll<{ id: string; class_level_id: string }>('SELECT id, class_level_id FROM class_arms');
  const armToLevel = new Map(arms.map((a) => [a.id, a.class_level_id]));

  const pricingRows = await tx.getAll<FeeItemPricingRow>(
    'SELECT fee_item_id, class_level_id, amount FROM fee_item_pricing'
  );
  const priceKey = (feeItemId: string, classLevelId: string) => `${feeItemId}:${classLevelId}`;
  const priceMap = new Map(pricingRows.map((p) => [priceKey(p.fee_item_id, p.class_level_id), p.amount]));

  const discountRows = await tx.getAll<DiscountRow>(
    'SELECT student_id, fee_item_id, type, value FROM discounts WHERE active = 1'
  );
  const discountKey = (studentId: string, feeItemId: string) => `${studentId}:${feeItemId}`;
  const discountMap = new Map(discountRows.map((d) => [discountKey(d.student_id, d.fee_item_id), d]));

  const existingCharges = await tx.getAll<{ student_id: string; fee_item_id: string }>(
    'SELECT student_id, fee_item_id FROM charges WHERE term_id = ?',
    [termId]
  );
  const existingKey = (studentId: string, feeItemId: string) => `${studentId}:${feeItemId}`;
  const existingSet = new Set(existingCharges.map((c) => existingKey(c.student_id, c.fee_item_id)));

  const now = new Date().toISOString();
  let generated = 0;
  let skipped = 0;

  for (const student of students) {
    const classLevelId = student.current_class_arm_id ? armToLevel.get(student.current_class_arm_id) : undefined;
    if (!classLevelId) {
      skipped += feeItems.length;
      continue;
    }

    for (const item of feeItems) {
      if (existingSet.has(existingKey(student.id, item.id))) {
        skipped++;
        continue;
      }
      const amount = applyDiscount(
        priceMap.get(priceKey(item.id, classLevelId)) ?? 0,
        discountMap.get(discountKey(student.id, item.id))
      );
      await tx.execute(
        `INSERT INTO charges
           (id, school_id, student_id, fee_item_id, session_id, term_id, class_level_id, amount_expected, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), schoolId, student.id, item.id, sessionId, termId, classLevelId, amount, now]
      );
      generated++;
    }
  }

  return { generated, skipped };
}
