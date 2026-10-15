-- CreateTable
CREATE TABLE "NedarimIntent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "partsJson" TEXT NOT NULL,
    "amountAgorot" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdById" TEXT,
    "actorJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "cardTxnId" TEXT NOT NULL,
    "paymentId" TEXT,
    "providerTxnId" TEXT,
    "last4" TEXT,
    "message" TEXT,
    "createdAt" DATETIME NOT NULL,
    "completedAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "NedarimIntent_idempotencyKey_key" ON "NedarimIntent"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "NedarimIntent_cardTxnId_key" ON "NedarimIntent"("cardTxnId");

-- CreateIndex
CREATE UNIQUE INDEX "NedarimIntent_paymentId_key" ON "NedarimIntent"("paymentId");

-- CreateIndex
CREATE INDEX "NedarimIntent_familyId_idx" ON "NedarimIntent"("familyId");


-- A decided Nedarim payment never changes and nothing is deleted.
CREATE TRIGGER "NedarimIntent_final" BEFORE UPDATE ON "NedarimIntent"
WHEN OLD."status" <> 'pending'
BEGIN SELECT RAISE(ABORT, 'NedarimIntent result is final'); END;
CREATE TRIGGER "NedarimIntent_no_delete" BEFORE DELETE ON "NedarimIntent"
BEGIN SELECT RAISE(ABORT, 'NedarimIntent is append-only'); END;
