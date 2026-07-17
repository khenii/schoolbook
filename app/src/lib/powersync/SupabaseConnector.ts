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
        // IMPORTANT: supabase-js/postgrest-js does NOT throw on a
        // server-side rejection (stale/expired JWT, RLS denial, FK/unique
        // constraint violation, etc.) — by default it always resolves with
        // `{ data, error }`, even for a non-2xx response. Only a genuine
        // network-level failure (offline, DNS, timeout) throws. This was
        // previously the root cause of local data being silently lost on
        // reconnect: a rejected upload was never noticed, so the code fell
        // through to `transaction.complete()` and PowerSync discarded the
        // (never-actually-persisted) change from its local queue. Every
        // branch below must check `.error` explicitly and throw on it, so a
        // rejected upload retries instead of being silently dropped.
        let result: { error: { message: string } | null };
        switch (op.op) {
          case UpdateType.PUT:
            result = await table.upsert({ ...op.opData, id: op.id });
            break;
          case UpdateType.PATCH:
            if (op.opData) {
              result = await table.update(op.opData).eq('id', op.id);
            } else {
              result = { error: null };
            }
            break;
          case UpdateType.DELETE:
            // Should rarely succeed in practice — append-only tables (charges,
            // payments, enrollment_history, write_offs, audit_log) have no
            // DELETE RLS policy, so Supabase rejects this and (now that the
            // error is actually checked) PowerSync retries rather than
            // silently dropping the record.
            result = await table.delete().eq('id', op.id);
            break;
          default:
            result = { error: null };
        }
        if (result.error) throw result.error;
      } catch (err) {
        console.error('PowerSync upload failed for', op.table, op.id, err);
        throw err; // rethrow so PowerSync retries instead of losing the change
      }
    }

    await transaction.complete();
  }
}
