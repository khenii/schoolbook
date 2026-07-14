import { PowerSyncDatabase } from '@powersync/web';
import { AppSchema } from './schema';
import { SupabaseConnector } from './SupabaseConnector';

export const powersync = new PowerSyncDatabase({
  schema: AppSchema,
  database: { dbFilename: 'schoolbook.sqlite' }
});

const connector = new SupabaseConnector();

export async function connectPowerSync() {
  await powersync.connect(connector);
}
