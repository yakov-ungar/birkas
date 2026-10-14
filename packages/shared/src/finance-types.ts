import type { ChargeType, DocType, PaymentMethod, StudentStatus } from './domain-types';

export interface StudentListRow {
  id: string;
  fullName: string;
  grade: string;
  status: StudentStatus;
  familyId: string;
  familyName: string;
  parentName: string;
  phone: string;
  netChargedAgorot: number;
  paidAgorot: number;
  balanceAgorot: number;
  payStatus: 'paid' | 'partial' | 'debt' | 'inactive';
}

export interface FamilyListRow {
  id: string;
  name: string;
  parentName: string;
  phone: string;
  email: string;
  childCount: number;
  balanceAgorot: number;
  agingLabel: string;
}

export interface LedgerRow {
  date: string;
  studentId: string;
  studentName: string;
  description: string;
  debitAgorot: number;
  creditAgorot: number;
  balanceAgorot: number;
  kind: 'charge' | 'payment';
  refId: string;
  cancelled: boolean;
  receiptNumber?: number;
}

export interface ChargeRow {
  id: string;
  date: string;
  studentId: string;
  studentName: string;
  description: string;
  type: ChargeType;
  amountAgorot: number;
  cancelled: boolean;
  isReversal: boolean;
}

export interface SavedCardRow {
  id: string;
  studentId: string;
  studentName: string;
  last4: string;
  brand: string;
  exp: string;
  expired: boolean;
  holderName: string;
  isDefault: boolean;
}

export interface StudentCard {
  student: { id: string; fullName: string; grade: string; status: StudentStatus; enrollSeq: number };
  family: { id: string; name: string; parentName: string; phone: string; email: string };
  siblings: { id: string; fullName: string }[];
  netChargedAgorot: number;
  paidAgorot: number;
  balanceAgorot: number;
  aging: [number, number, number, number];
  ledger: LedgerRow[];
  /** Present only when the viewer holds the "cards" permission. */
  cards: SavedCardRow[] | null;
  hasFinancialHistory: boolean;
}

export interface FamilyCard {
  family: {
    id: string;
    name: string;
    parentName: string;
    phone: string;
    email: string;
    address: string;
    note: string;
  };
  students: { id: string; fullName: string; grade: string; status: StudentStatus; balanceAgorot: number }[];
  balanceAgorot: number;
  aging: [number, number, number, number];
}

export interface ReceiptRow {
  id: string;
  docType: DocType;
  number: number;
  date: string;
  payerName: string;
  familyId: string;
  amountAgorot: number;
  method: PaymentMethod;
  reference: string;
  cancelled: boolean;
  creditForNumber: number | null;
  sentAt: string | null;
}

export interface ReceiptView extends ReceiptRow {
  schoolName: string;
  lines: { studentName: string; amountAgorot: number }[];
  issuedAt: string;
  printCount: number;
  cancelledBy: number | null;
}

export interface PaymentResult {
  paymentId: string | null;
  receipt: ReceiptRow | null;
  checkId?: string;
  approvalCode?: string;
  allocations: { studentId: string; studentName: string; amountAgorot: number }[];
}

export interface ImportReport {
  imported: number;
  newFamilies: number;
  rejected: { row: number; reason: string; values: string }[];
}
