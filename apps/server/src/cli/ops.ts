/**
 * Operations commands used by the scripts in deploy/ (backup, restore check, alerts).
 *
 *   node dist/cli/ops.js snapshot --out /path/file.db   consistent copy of the live database
 *   node dist/cli/ops.js verify --db /path/file.db      integrity report (exit 1 when not ok)
 *   node dist/cli/ops.js alert --subject "..." --text "..."   email to ALERT_EMAIL or the admins
 *
 * Nothing here prints personal data: only counts and check results.
 */
import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { loadConfig } from '../config';
import { systemClock } from '../lib/clock';
import { createDb } from '../lib/db';
import { createDeps } from '../deps';
import { checkIntegrity, snapshotTo } from '../ops/integrity';
import { notifyAdmins } from '../modules/plans/service';

const [cmd, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: {
    out: { type: 'string' },
    db: { type: 'string' },
    subject: { type: 'string' },
    text: { type: 'string' },
  },
});

async function main(): Promise<number> {
  if (cmd === 'snapshot') {
    if (!values.out || !isAbsolute(values.out)) throw new Error('--out must be an absolute path');
    if (existsSync(values.out)) throw new Error('--out already exists');
    const config = loadConfig();
    const db = await createDb(config.DATABASE_URL);
    await snapshotTo(db, values.out);
    await db.$disconnect();
    console.log(JSON.stringify({ ok: true, out: values.out }));
    return 0;
  }
  if (cmd === 'verify') {
    if (!values.db || !existsSync(values.db)) throw new Error('--db must point to an existing file');
    const db = await createDb(`file:${values.db}`);
    const r = await checkIntegrity(db);
    await db.$disconnect();
    console.log(JSON.stringify(r, null, 2));
    return r.ok ? 0 : 1;
  }
  if (cmd === 'alert') {
    if (!values.subject || !values.text) throw new Error('--subject and --text are required');
    const config = loadConfig();
    const db = await createDb(config.DATABASE_URL);
    await notifyAdmins(createDeps(config, db, systemClock), values.subject, values.text);
    await db.$disconnect();
    return 0;
  }
  console.error('Usage: ops.js snapshot --out <file> | verify --db <file> | alert --subject <s> --text <t>');
  return 2;
}

main().then(
  (code) => process.exit(code),
  (e: Error) => {
    console.error(`ops ${cmd ?? ''} failed: ${e.message}`);
    process.exit(1);
  },
);
