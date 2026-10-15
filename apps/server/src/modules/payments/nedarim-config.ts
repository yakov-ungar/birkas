import type { Deps } from '../../deps';
import type { Db, Tx } from '../../lib/db';
import { badRequest } from '../../lib/errors';
import type { NedarimConfig } from '../../providers/payment/nedarim';

/** Nedarim Plus is used when the card connection is set up in production mode with its details. */
export async function nedarimConfig(deps: Deps, db: Db | Tx = deps.db): Promise<NedarimConfig | null> {
  const i = await db.integration.findUnique({ where: { key: 'card' } });
  if (!i?.connected || i.mode !== 'live' || !i.configEnc) return null;
  const c = JSON.parse(deps.enc.decrypt(i.configEnc)) as { username: string; secret: string };
  return { mosad: c.username, apiValid: c.secret };
}

export const NEDARIM_NO_TOKENS =
  'תשלום באשראי מתבצע בחלון של נדרים פלוס. כרטיסים שמורים וחיוב אוטומטי של כרטיס שמור אינם זמינים כשנדרים פלוס מחובר';

/** Refuses the token-based card paths (hosted fields, saved cards) while Nedarim Plus is live. */
export async function assertHostedCards(deps: Deps) {
  if (await nedarimConfig(deps)) throw badRequest(NEDARIM_NO_TOKENS);
}
