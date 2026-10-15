import type { FastifyBaseLogger } from 'fastify';
import type { Deps } from '../../deps';
import { israelDate } from '../../lib/clock';
import { getSettings } from '../settings/service';
import { runDueCharges } from '../plans/service';
import { dispatch, runDailyReminders } from '../messages/service';
import { monthEndTutoring } from '../tutoring/service';

const HHMM = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jerusalem',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * Once the configured time has passed (Israel time), runs today's charges exactly once.
 * The JobRun unique key (job, date) is the lock, so a restart or a second process cannot
 * run the same day twice; if the server was down at that hour it catches up when it starts.
 */
export async function schedulerTick(deps: Deps, log?: FastifyBaseLogger) {
  const now = deps.clock.now();
  // Messages: send what is due, and once a day after 08:00 run the time-based reminder rules.
  await dispatch(deps, log).catch((e) => log?.error({ err: e }, 'message dispatch failed'));
  if (HHMM.format(now) >= '08:00')
    await runDailyReminders(deps).catch((e) => log?.error({ err: e }, 'reminders run failed'));
  const { autoRunTime } = await getSettings(deps.db);
  if (HHMM.format(now) < autoRunTime) return { ran: false as const };
  // Private lessons: charged on the last day of the month (with catch-up early next month).
  await monthEndTutoring(deps).catch((e) => log?.error({ err: e }, 'tutoring month-end failed'));
  const runKey = israelDate(now);
  if (await deps.db.jobRun.findUnique({ where: { job_runKey: { job: 'charges', runKey } } }))
    return { ran: false as const };
  try {
    const summary = await runDueCharges(deps, { runKey, trigger: 'schedule' });
    log?.info(
      { runKey, ok: summary.ok, failed: summary.failed, skipped: summary.skipped },
      'nightly charges run',
    );
    return { ran: !summary.skipped, summary };
  } catch (e) {
    log?.error({ err: e, runKey }, 'nightly charges run failed');
    return { ran: false as const };
  }
}

export function startScheduler(deps: Deps, log: FastifyBaseLogger): () => void {
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void schedulerTick(deps, log).finally(() => (busy = false));
  }, 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
