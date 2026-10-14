-- AlterTable
ALTER TABLE "Check" ADD COLUMN "depositedAt" DATETIME;
ALTER TABLE "Check" ADD COLUMN "feeChargeId" TEXT;
ALTER TABLE "Check" ADD COLUMN "returnPaymentId" TEXT;
ALTER TABLE "Check" ADD COLUMN "returnedAt" DATETIME;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "cashSessionId" TEXT;

-- CreateTable
CREATE TABLE "CashSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "openedAt" DATETIME NOT NULL,
    "openedById" TEXT NOT NULL,
    "openedByName" TEXT NOT NULL,
    "openingFloatAgorot" INTEGER NOT NULL,
    "closedAt" DATETIME,
    "closedById" TEXT,
    "closedByName" TEXT,
    "expectedAgorot" INTEGER,
    "countedAgorot" INTEGER,
    "diffAgorot" INTEGER,
    "notes" TEXT
);

-- CreateTable
CREATE TABLE "BankImport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "importedAt" DATETIME NOT NULL,
    "importedById" TEXT NOT NULL,
    "rows" INTEGER NOT NULL,
    "matched" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "BankTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "importId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT NOT NULL DEFAULT '',
    "amountAgorot" INTEGER NOT NULL,
    "rowHash" TEXT NOT NULL,
    "suggestedFamilyId" TEXT,
    "suggestedPlanChargeId" TEXT,
    "matchLevel" TEXT NOT NULL DEFAULT 'none',
    "matchReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "paymentId" TEXT,
    "familyId" TEXT,
    "decidedById" TEXT,
    "decidedAt" DATETIME,
    CONSTRAINT "BankTransaction_importId_fkey" FOREIGN KEY ("importId") REFERENCES "BankImport" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MasavExport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL,
    "createdById" TEXT NOT NULL,
    "chargeDate" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "totalAgorot" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "settledAt" DATETIME
);

-- CreateTable
CREATE TABLE "MasavExportItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "exportId" TEXT NOT NULL,
    "planChargeId" TEXT NOT NULL,
    "amountAgorot" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "returnReason" TEXT,
    "paymentId" TEXT,
    CONSTRAINT "MasavExportItem_exportId_fkey" FOREIGN KEY ("exportId") REFERENCES "MasavExport" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "BankImport_fileHash_key" ON "BankImport"("fileHash");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_rowHash_key" ON "BankTransaction"("rowHash");

-- CreateIndex
CREATE INDEX "BankTransaction_status_idx" ON "BankTransaction"("status");

-- CreateIndex
CREATE INDEX "MasavExportItem_planChargeId_idx" ON "MasavExportItem"("planChargeId");

-- Only one cash drawer can be open at a time (portable: PostgreSQL supports the same partial index).
CREATE UNIQUE INDEX "CashSession_one_open" ON "CashSession"((1)) WHERE "closedAt" IS NULL;
-- A charge can be in at most one Masav file awaiting the bank.
CREATE UNIQUE INDEX "MasavExportItem_one_submitted" ON "MasavExportItem"("planChargeId") WHERE "status" = 'submitted';

-- A closed drawer session is final.
CREATE TRIGGER "CashSession_closed_final" BEFORE UPDATE ON "CashSession"
WHEN OLD."closedAt" IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'closed CashSession is final'); END;
CREATE TRIGGER "CashSession_no_delete" BEFORE DELETE ON "CashSession"
BEGIN SELECT RAISE(ABORT, 'CashSession cannot be deleted'); END;
CREATE TRIGGER "BankTransaction_no_delete" BEFORE DELETE ON "BankTransaction"
BEGIN SELECT RAISE(ABORT, 'BankTransaction cannot be deleted'); END;
CREATE TRIGGER "BankTransaction_amount_frozen" BEFORE UPDATE OF "amountAgorot", "date", "description", "reference", "rowHash" ON "BankTransaction"
BEGIN SELECT RAISE(ABORT, 'BankTransaction content is immutable'); END;

-- A paid installment stays final, except for one transition: a standing order the bank returned
-- after it was recorded ("returned"), keeping its payment link and amount.
DROP TRIGGER "PlanCharge_paid_final";
CREATE TRIGGER "PlanCharge_paid_final" BEFORE UPDATE ON "PlanCharge"
WHEN OLD."status" IN ('paid', 'returned') AND NOT (
  OLD."status" = 'paid' AND NEW."status" = 'returned'
  AND NEW."paymentId" IS OLD."paymentId" AND NEW."amountAgorot" = OLD."amountAgorot" AND NEW."dueDate" = OLD."dueDate"
)
BEGIN SELECT RAISE(ABORT, 'paid PlanCharge is final'); END;
