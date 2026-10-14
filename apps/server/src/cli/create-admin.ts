/**
 * Creates the first system administrator and prints a one-time invite link.
 * Usage: pnpm --filter @tuition/server create-admin -- --name "רחל" --email admin@school.co.il
 * The admin sets a password and 2FA through the link; no password is ever passed on the command line.
 */
import { parseArgs } from 'node:util';
import { ALL_PERMISSIONS } from '@tuition/shared';
import { loadConfig } from '../config';
import { systemClock } from '../lib/clock';
import { createDb } from '../lib/db';
import { createDeps } from '../deps';
import { SYSTEM_ACTOR, recordAudit } from '../modules/audit/service';
import { issueInvite } from '../modules/users/routes';

const { values } = parseArgs({ options: { name: { type: 'string' }, email: { type: 'string' } } });
if (!values.name || !values.email) {
  console.error('Usage: create-admin --name "<name>" --email <email>');
  process.exit(1);
}
const config = loadConfig();
const db = await createDb(config.DATABASE_URL);
const deps = createDeps(config, db, systemClock);
const email = values.email.trim().toLowerCase();

if (await db.user.findUnique({ where: { email } })) {
  console.error('A user with this email already exists.');
  process.exit(1);
}
const { link } = await db.$transaction(async (tx) => {
  const user = await tx.user.create({
    data: {
      name: values.name!.trim(),
      email,
      role: 'מנהל מערכת',
      permissions: JSON.stringify(ALL_PERMISSIONS),
    },
  });
  await recordAudit(tx, SYSTEM_ACTOR, new Date(), {
    action: 'user.create',
    summary: `נוצר מנהל מערכת ראשון: ${user.name}`,
    entity: 'User',
    entityId: user.id,
  });
  return issueInvite(deps, tx, user);
});
console.log('\nAdministrator created. Open this one-time link (valid 72 hours) to set a password and 2FA:\n');
console.log(link + '\n');
await db.$disconnect();
