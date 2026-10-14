-- AlterTable
ALTER TABLE "Outbox" ADD COLUMN "attachmentNames" TEXT;

-- CreateTable
CREATE TABLE "Family" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "parentName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "phoneNorm" TEXT NOT NULL,
    "email" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" DATETIME
);

-- CreateTable
CREATE TABLE "Student" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "enrollSeq" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" DATETIME,
    CONSTRAINT "Student_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChargeCatalogItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "defaultAgorot" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ChargeBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "description" TEXT NOT NULL,
    "catalogItemId" TEXT,
    "grade" TEXT,
    "count" INTEGER NOT NULL,
    "amountAgorot" INTEGER NOT NULL,
    "date" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Charge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "yearName" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountAgorot" INTEGER NOT NULL,
    "date" TEXT NOT NULL,
    "reason" TEXT,
    "internalNote" TEXT,
    "reversalOfId" TEXT,
    "batchId" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Charge_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Charge_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ChargeBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Charge_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "Charge" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "amountAgorot" INTEGER NOT NULL,
    "date" TEXT NOT NULL,
    "reference" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL,
    "reversalOfId" TEXT,
    "cardTxnId" TEXT,
    "checkId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payment_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Payment_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "Payment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paymentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "amountAgorot" INTEGER NOT NULL,
    CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PaymentAllocation_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DocumentSequence" (
    "docType" TEXT NOT NULL PRIMARY KEY,
    "next" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "docType" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "paymentId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "issuedAt" DATETIME NOT NULL,
    "payerName" TEXT NOT NULL,
    "amountAgorot" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT NOT NULL DEFAULT '',
    "creditForReceiptId" TEXT,
    "reason" TEXT,
    "contentSha256" TEXT NOT NULL,
    "printCount" INTEGER NOT NULL DEFAULT 0,
    "sentAt" DATETIME,
    "sentTo" TEXT,
    CONSTRAINT "Receipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Receipt_creditForReceiptId_fkey" FOREIGN KEY ("creditForReceiptId") REFERENCES "Receipt" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SavedCard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "tokenEnc" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "expMonth" INTEGER NOT NULL,
    "expYear" INTEGER NOT NULL,
    "holderName" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" DATETIME,
    CONSTRAINT "SavedCard_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CardTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "idempotencyKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "amountAgorot" INTEGER NOT NULL,
    "cardId" TEXT,
    "last4" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "providerTxnId" TEXT,
    "approvalCode" TEXT,
    "errorMessageHe" TEXT,
    "refundOfId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Check" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "bank" TEXT NOT NULL,
    "amountAgorot" INTEGER NOT NULL,
    "dueDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "paymentId" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Check_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Family_phoneNorm_idx" ON "Family"("phoneNorm");

-- CreateIndex
CREATE INDEX "Student_familyId_idx" ON "Student"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "Charge_reversalOfId_key" ON "Charge"("reversalOfId");

-- CreateIndex
CREATE INDEX "Charge_studentId_idx" ON "Charge"("studentId");

-- CreateIndex
CREATE INDEX "Charge_date_idx" ON "Charge"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_reversalOfId_key" ON "Payment"("reversalOfId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_cardTxnId_key" ON "Payment"("cardTxnId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Payment_familyId_idx" ON "Payment"("familyId");

-- CreateIndex
CREATE INDEX "Payment_date_idx" ON "Payment"("date");

-- CreateIndex
CREATE INDEX "PaymentAllocation_studentId_idx" ON "PaymentAllocation"("studentId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_paymentId_idx" ON "PaymentAllocation"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_paymentId_key" ON "Receipt"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_creditForReceiptId_key" ON "Receipt"("creditForReceiptId");

-- CreateIndex
CREATE INDEX "Receipt_familyId_idx" ON "Receipt"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_docType_number_key" ON "Receipt"("docType", "number");

-- CreateIndex
CREATE INDEX "SavedCard_studentId_idx" ON "SavedCard"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "CardTransaction_idempotencyKey_key" ON "CardTransaction"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Check_idempotencyKey_key" ON "Check"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Check_status_dueDate_idx" ON "Check"("status", "dueDate");

-- ===== Append-only money tables (rules: no deleting money movements; cancel = reversal) =====
CREATE TRIGGER "Charge_no_update" BEFORE UPDATE ON "Charge"
BEGIN SELECT RAISE(ABORT, 'Charge is append-only'); END;
CREATE TRIGGER "Charge_no_delete" BEFORE DELETE ON "Charge"
BEGIN SELECT RAISE(ABORT, 'Charge is append-only'); END;

CREATE TRIGGER "Payment_no_update" BEFORE UPDATE ON "Payment"
BEGIN SELECT RAISE(ABORT, 'Payment is append-only'); END;
CREATE TRIGGER "Payment_no_delete" BEFORE DELETE ON "Payment"
BEGIN SELECT RAISE(ABORT, 'Payment is append-only'); END;

CREATE TRIGGER "PaymentAllocation_no_update" BEFORE UPDATE ON "PaymentAllocation"
BEGIN SELECT RAISE(ABORT, 'PaymentAllocation is append-only'); END;
CREATE TRIGGER "PaymentAllocation_no_delete" BEFORE DELETE ON "PaymentAllocation"
BEGIN SELECT RAISE(ABORT, 'PaymentAllocation is append-only'); END;

-- Receipts: the document itself is frozen; only print count and delivery info may change.
CREATE TRIGGER "Receipt_no_delete" BEFORE DELETE ON "Receipt"
BEGIN SELECT RAISE(ABORT, 'Receipt is append-only'); END;
CREATE TRIGGER "Receipt_frozen" BEFORE UPDATE OF
  "docType", "number", "paymentId", "familyId", "date", "issuedAt", "payerName", "amountAgorot",
  "method", "reference", "creditForReceiptId", "reason", "contentSha256" ON "Receipt"
BEGIN SELECT RAISE(ABORT, 'Receipt content is immutable'); END;

-- Sequences only move forward and are never removed.
CREATE TRIGGER "DocumentSequence_forward" BEFORE UPDATE ON "DocumentSequence"
WHEN NEW."next" <= OLD."next" OR NEW."docType" <> OLD."docType"
BEGIN SELECT RAISE(ABORT, 'DocumentSequence only moves forward'); END;
CREATE TRIGGER "DocumentSequence_no_delete" BEFORE DELETE ON "DocumentSequence"
BEGIN SELECT RAISE(ABORT, 'DocumentSequence cannot be deleted'); END;

-- Provider calls: a final result is never rewritten, and the request itself never changes.
CREATE TRIGGER "CardTransaction_final" BEFORE UPDATE ON "CardTransaction"
WHEN OLD."status" <> 'pending'
BEGIN SELECT RAISE(ABORT, 'CardTransaction result is final'); END;
CREATE TRIGGER "CardTransaction_request_frozen" BEFORE UPDATE OF
  "idempotencyKey", "kind", "familyId", "amountAgorot", "cardId", "last4", "refundOfId" ON "CardTransaction"
BEGIN SELECT RAISE(ABORT, 'CardTransaction request is immutable'); END;
CREATE TRIGGER "CardTransaction_no_delete" BEFORE DELETE ON "CardTransaction"
BEGIN SELECT RAISE(ABORT, 'CardTransaction is append-only'); END;

-- Default charge catalog from the demo.
INSERT INTO "ChargeCatalogItem" ("id", "name", "defaultAgorot", "type", "active", "createdAt") VALUES
  ('cat_reg',   'דמי רישום',       25000, 'reg',   1, CURRENT_TIMESTAMP),
  ('cat_trip',  'טיול שנתי',       12000, 'trip',  1, CURRENT_TIMESTAMP),
  ('cat_bus',   'הסעות - חודשי',   35000, 'bus',   1, CURRENT_TIMESTAMP),
  ('cat_meals', 'ארוחות - חודשי',  20000, 'meals', 1, CURRENT_TIMESTAMP),
  ('cat_books', 'ספרים וציוד',     30000, 'books', 1, CURRENT_TIMESTAMP);

-- Receipt numbering starts at 3001 as in the demo; credit notes and refunds have their own sequences (A3).
INSERT INTO "DocumentSequence" ("docType", "next") VALUES ('receipt', 3001), ('credit_note', 1), ('refund', 1);
