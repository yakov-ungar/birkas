-- AlterTable
ALTER TABLE "CardTransaction" ADD COLUMN "planChargeId" TEXT;

-- CreateTable
CREATE TABLE "StandingOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "bank" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "accountEnc" TEXT NOT NULL,
    "accountLast4" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "BillingPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountAgorot" INTEGER NOT NULL,
    "count" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "cardId" TEXT,
    "standingOrderId" TEXT,
    "startDate" TEXT NOT NULL,
    "dayOfMonth" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "consentMethod" TEXT,
    "consentText" TEXT,
    "consentAt" DATETIME,
    "consentById" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BillingPlan_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BillingPlan_standingOrderId_fkey" FOREIGN KEY ("standingOrderId") REFERENCES "StandingOrder" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlanCharge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "dueDate" TEXT NOT NULL,
    "amountAgorot" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "paymentId" TEXT,
    "processingAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlanCharge_planId_fkey" FOREIGN KEY ("planId") REFERENCES "BillingPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "job" TEXT NOT NULL,
    "runKey" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "finishedAt" DATETIME,
    "status" TEXT NOT NULL,
    "okCount" INTEGER NOT NULL DEFAULT 0,
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingPlan_idempotencyKey_key" ON "BillingPlan"("idempotencyKey");

-- CreateIndex
CREATE INDEX "BillingPlan_studentId_idx" ON "BillingPlan"("studentId");

-- CreateIndex
CREATE INDEX "BillingPlan_status_idx" ON "BillingPlan"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PlanCharge_paymentId_key" ON "PlanCharge"("paymentId");

-- CreateIndex
CREATE INDEX "PlanCharge_status_dueDate_idx" ON "PlanCharge"("status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "PlanCharge_planId_seq_key" ON "PlanCharge"("planId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "JobRun_job_runKey_key" ON "JobRun"("job", "runKey");

-- A paid installment is final: its payment link and amount never change.
CREATE TRIGGER "PlanCharge_paid_final" BEFORE UPDATE ON "PlanCharge"
WHEN OLD."status" = 'paid'
BEGIN SELECT RAISE(ABORT, 'paid PlanCharge is final'); END;
CREATE TRIGGER "PlanCharge_no_delete" BEFORE DELETE ON "PlanCharge"
BEGIN SELECT RAISE(ABORT, 'PlanCharge cannot be deleted'); END;
CREATE TRIGGER "BillingPlan_no_delete" BEFORE DELETE ON "BillingPlan"
BEGIN SELECT RAISE(ABORT, 'BillingPlan cannot be deleted'); END;
