import type { ContactNote } from '@prisma/client';
import type { ContactNoteRow, NoteType, PromiseInfo } from '@tuition/shared';
import type { Db, Tx } from '../../lib/db';

/**
 * A promise is kept when it was marked done, or when the family paid at least the promised
 * amount between the note and the promised date; it is broken once that date passed without it.
 */
export async function promiseInfo(db: Db | Tx, n: ContactNote, today: string): Promise<PromiseInfo | null> {
  if (n.type !== 'promise' || !n.promiseDate || !n.promiseAgorot) return null;
  let status: PromiseInfo['status'] = 'pending';
  if (n.fulfilledAt) status = 'kept';
  else {
    const paid = await db.payment.aggregate({
      where: { familyId: n.familyId, date: { gte: n.date, lte: n.promiseDate } },
      _sum: { amountAgorot: true },
    });
    if ((paid._sum.amountAgorot ?? 0) >= n.promiseAgorot) status = 'kept';
    else if (n.promiseDate < today) status = 'broken';
  }
  return { noteId: n.id, date: n.promiseDate, amountAgorot: n.promiseAgorot, status };
}

export async function noteRows(db: Db | Tx, familyId: string, today: string): Promise<ContactNoteRow[]> {
  const notes = await db.contactNote.findMany({ where: { familyId }, orderBy: { at: 'desc' } });
  return Promise.all(
    notes.map(async (n) => ({
      id: n.id,
      date: n.date,
      byName: n.byName,
      type: n.type as NoteType,
      note: n.note,
      promise: await promiseInfo(db, n, today),
    })),
  );
}

/** The demo's "הבטחת תשלום" column: the earliest promise not yet kept. */
export async function openPromise(db: Db | Tx, familyId: string, today: string): Promise<PromiseInfo | null> {
  const notes = await db.contactNote.findMany({
    where: { familyId, type: 'promise', fulfilledAt: null },
    orderBy: { promiseDate: 'asc' },
  });
  for (const n of notes) {
    const p = await promiseInfo(db, n, today);
    if (p && p.status !== 'kept') return p;
  }
  return null;
}

export async function lastContact(db: Db | Tx, familyId: string): Promise<string | null> {
  const n = await db.contactNote.findFirst({
    where: { familyId },
    orderBy: { at: 'desc' },
    select: { date: true },
  });
  return n?.date ?? null;
}
