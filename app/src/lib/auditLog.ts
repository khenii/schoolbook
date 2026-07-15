interface AuditExecutor {
  execute(sql: string, params?: unknown[]): Promise<unknown>;
}

// Single insert point for the audit trail — append-only, same as
// charges/payments (audit_log has no UPDATE/DELETE policy either). Works
// with either `db` directly (for actions that aren't already inside a
// writeTransaction) or a `tx` passed in from one, so it can sit right next
// to the write it's recording without forcing every caller to open its own
// transaction just for this.
export async function logAudit(
  executor: AuditExecutor,
  params: {
    schoolId: string;
    actorId: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  const { schoolId, actorId, action, entityType, entityId, metadata } = params;
  await executor.execute(
    `INSERT INTO audit_log (id, school_id, actor_id, action, entity_type, entity_id, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(),
      schoolId,
      actorId,
      action,
      entityType,
      entityId ?? null,
      metadata ? JSON.stringify(metadata) : null,
      new Date().toISOString()
    ]
  );
}
