import type { PlanMethod } from './schemas-plans';

export type PlanChargeStatus = 'pending' | 'processing' | 'paid' | 'failed' | 'cancelled' | 'expected';
export type PlanStatus = 'active' | 'paused' | 'cancelled' | 'completed';

export const PLAN_CHARGE_STATUS: Record<PlanChargeStatus, [string, string]> = {
  pending: ['ממתין', 'o'],
  processing: ['בביצוע', 'bl'],
  paid: ['שולם', 'g'],
  failed: ['נכשל', 'r'],
  cancelled: ['בוטל', 'gr'],
  expected: ['ממתין להעברה', 'bl'],
};

export interface PlanRow {
  id: string;
  studentId: string;
  studentName: string;
  type: 'installments' | 'recurring';
  label: string;
  amountAgorot: number;
  count: number;
  paidCount: number;
  totalCount: number;
  method: PlanMethod;
  methodLabel: string;
  next: { dueDate: string; amountAgorot: number } | null;
  status: PlanStatus;
  /** Status shown in the demo: הסתיימה / נכשל חיוב / פעילה / מושבתת */
  display: [string, string];
}

export interface PlanChargeRow {
  id: string;
  seq: number;
  dueDate: string;
  amountAgorot: number;
  status: PlanChargeStatus;
  lastError: string | null;
  receiptId: string | null;
}

export interface PlanDetail extends PlanRow {
  charges: PlanChargeRow[];
  cardId: string | null;
  standingOrder: { bank: string; branch: string; accountLast4: string } | null;
  consent: { method: string; text: string; at: string } | null;
}

export interface RunSummary {
  runId: string | null;
  skipped: boolean;
  ok: number;
  failed: number;
  expected: number;
  failures: { studentName: string; amountAgorot: number; reason: string }[];
}

export interface AlertItem {
  level: 'bad' | 'warn' | 'info';
  text: string;
  path: string;
}

export interface Dashboard {
  kpis: {
    netChargedAgorot: number;
    collectedAgorot: number;
    openAgorot: number;
    collectionPct: number;
    discountsAgorot: number;
    activeStudents: number;
    activePlans: number;
    failedCharges: number;
  };
  aging: [number, number, number, number];
  monthly: { month: string; label: string; amountAgorot: number }[];
  forecast: { month: string; label: string; amountAgorot: number }[];
  topDebtors: { familyId: string; name: string; balanceAgorot: number; agingLabel: string }[];
  activity: { at: string; actor: string; summary: string }[];
}
