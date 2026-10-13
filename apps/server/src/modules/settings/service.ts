import { DEFAULT_SETTINGS, type AllSettings } from '@tuition/shared';
import type { Db, Tx } from '../../lib/db';

export async function getSettings(db: Db | Tx): Promise<AllSettings> {
  const rows = await db.setting.findMany();
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    if (r.key in DEFAULT_SETTINGS) {
      try {
        out[r.key] = JSON.parse(r.value);
      } catch {
        // keep default on corrupt value
      }
    }
  }
  return out as AllSettings;
}

export async function saveSettings(tx: Tx, patch: Partial<AllSettings>): Promise<void> {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const v = JSON.stringify(value);
    await tx.setting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
  }
}
