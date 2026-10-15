-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN "itemsJson" TEXT;

-- CreateTable
CREATE TABLE "Tutor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "TutorAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "tutorId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "priceAgorot" INTEGER NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TutorAssignment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TutorAssignment_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "Tutor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TutorCharge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assignmentId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "chargeId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TutorCharge_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "TutorAssignment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TutorAssignment_studentId_idx" ON "TutorAssignment"("studentId");

-- CreateIndex
CREATE INDEX "TutorAssignment_tutorId_idx" ON "TutorAssignment"("tutorId");

-- CreateIndex
CREATE UNIQUE INDEX "TutorCharge_chargeId_key" ON "TutorCharge"("chargeId");

-- CreateIndex
CREATE UNIQUE INDEX "TutorCharge_assignmentId_month_key" ON "TutorCharge"("assignmentId", "month");


-- The record of which month was charged for which lesson is never removed.
CREATE TRIGGER "TutorCharge_no_delete" BEFORE DELETE ON "TutorCharge"
BEGIN SELECT RAISE(ABORT, 'tutor charges are append-only'); END;
CREATE TRIGGER "TutorCharge_no_update" BEFORE UPDATE ON "TutorCharge"
BEGIN SELECT RAISE(ABORT, 'tutor charges are append-only'); END;

-- The new items column is part of the frozen receipt content, like the other content columns.
CREATE TRIGGER "Receipt_items_frozen" BEFORE UPDATE OF "itemsJson" ON "Receipt"
BEGIN SELECT RAISE(ABORT, 'Receipt content is immutable'); END;
