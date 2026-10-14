-- CreateTable
CREATE TABLE "ParentOtp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "usedAt" DATETIME,
    "ip" TEXT,
    "createdAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ParentSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "csrfToken" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "lastSeenAt" DATETIME NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "ip" TEXT,
    "userAgent" TEXT
);

-- CreateTable
CREATE TABLE "ParentDevice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "lastUsedAt" DATETIME NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME
);

-- CreateTable
CREATE TABLE "ParentRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL,
    "decidedAt" DATETIME,
    "decidedById" TEXT,
    "decidedByName" TEXT,
    "rejectReason" TEXT,
    "resultSummary" TEXT
);

-- CreateIndex
CREATE INDEX "ParentOtp_familyId_createdAt_idx" ON "ParentOtp"("familyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ParentSession_tokenHash_key" ON "ParentSession"("tokenHash");

-- CreateIndex
CREATE INDEX "ParentSession_familyId_idx" ON "ParentSession"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "ParentDevice_tokenHash_key" ON "ParentDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "ParentDevice_familyId_idx" ON "ParentDevice"("familyId");

-- CreateIndex
CREATE INDEX "ParentRequest_status_idx" ON "ParentRequest"("status");

-- CreateIndex
CREATE INDEX "ParentRequest_familyId_createdAt_idx" ON "ParentRequest"("familyId", "createdAt");


-- Parent requests are a record of what parents asked and what was decided: never deleted,
-- and a decision is final.
CREATE TRIGGER "ParentRequest_no_delete" BEFORE DELETE ON "ParentRequest"
BEGIN SELECT RAISE(ABORT, 'parent requests are append-only'); END;
CREATE TRIGGER "ParentRequest_decision_final" BEFORE UPDATE ON "ParentRequest"
WHEN OLD."status" <> 'pending'
BEGIN SELECT RAISE(ABORT, 'a decided parent request cannot change'); END;
