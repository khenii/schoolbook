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

// Generates the charges a student owes on enrollment, per spec §3.1:
// - all-students fee items always apply
// - new-students-only fee items apply only if the student's status is 'new'
// - one-off and recurring items both get exactly one charge here, scoped to
//   the enrolling term; recurring items get further charges generated when
//   later terms start — that's a separate, not-yet-built flow (advancing
//   a school to its next term), tracked as a backlog gap, not silently
//   assumed to be handled here.
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
  const now = new Date().toISOString();
  let count = 0;

  for (const item of feeItems) {
    const applicable =
      item.applies_to === 'all-students' || (item.applies_to === 'new-students-only' && isNewStudent);
    if (!applicable) continue;

    const amount = priceByFeeItem.get(item.id) ?? 0;
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
