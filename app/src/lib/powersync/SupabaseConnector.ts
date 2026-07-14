import { AbstractPowerSyncDatabase, PowerSyncBackendConnector, UpdateType } from '@powersync/web';
import { supabase } from '../supabase';

const POWERSYNC_URL = import.meta.env.VITE_POWERSYNC_URL;

export class SupabaseConnector implements PowerSyncBackendConnector {
  async fetchCredentials() {
    const {
      data: { session },
      error
    } = await supabase.auth.getSession();
    if (error) throw error;
    if (!session) return null;

    return {
      endpoint: POWERSYNC_URL,
      token: session.access_token
    };
  }

  async uploadData(database: AbstractPowerSyncDatabase) {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;

    for (const op of transaction.crud) {
      const table = supabase.from(op.table);
      try {
        switch (op.op) {
          case UpdateType.PUT:
            await table.upsert({ ...op.opData, id: op.id });
            break;
          case UpdateType.PATCH:
            if (op.opData) {
              await table.update(op.opData).eq('id', op.id);
            }
            break;
          case UpdateType.DELETE:
            // Should rarely fire in practice — append-only tables (charges,
            // payments, enrollment_history, write_offs, audit_log) have no
            // DELETE RLS policy, so Supabase rejects this and PowerSync
            // retries rather than silently dropping the record.
            await table.delete().eq('id', op.id);
            break;
        }
      } catch (err) {
        console.error('PowerSync upload failed for', op.table, op.id, err);
        throw err; // rethrow so PowerSync retries instead of losing the change
      }
    }

    await transaction.complete();
  }
}
