-- CreateTable
CREATE TABLE "ContactNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyId" TEXT NOT NULL,
    "at" DATETIME NOT NULL,
    "date" TEXT NOT NULL,
    "byId" TEXT NOT NULL,
    "byName" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "promiseDate" TEXT,
    "promiseAgorot" INTEGER,
    "fulfilledAt" DATETIME,
    "fulfilledById" TEXT
);

-- CreateTable
CREATE TABLE "ReminderRule" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "channel" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MessageBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "at" DATETIME NOT NULL,
    "channel" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "ruleKey" TEXT,
    "recipientCount" INTEGER NOT NULL,
    "template" TEXT NOT NULL,
    "createdByName" TEXT
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT,
    "familyId" TEXT,
    "channel" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "notBefore" DATETIME NOT NULL,
    "sentAt" DATETIME,
    "providerRef" TEXT,
    "error" TEXT,
    "dedupeKey" TEXT,
    "ruleKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MessageBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ContactNote_familyId_idx" ON "ContactNote"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_dedupeKey_key" ON "Message"("dedupeKey");

-- CreateIndex
CREATE INDEX "Message_status_notBefore_idx" ON "Message"("status", "notBefore");

-- CreateIndex
CREATE INDEX "Message_familyId_ruleKey_idx" ON "Message"("familyId", "ruleKey");

-- The demo's four rules with its default channels, states and templates.
INSERT INTO "ReminderRule" ("key", "name", "enabled", "channel", "template", "updatedAt") VALUES
  ('pre_charge',    'תזכורת 3 ימים לפני חיוב', 1, 'sms',      'שלום {הורה}, בתאריך {תאריך} יחויב כרטיסך בסך {סכום} עבור {תלמיד}.', CURRENT_TIMESTAMP),
  ('charge_failed', 'חיוב כרטיס נכשל',         1, 'whatsapp', 'שלום {הורה}, החיוב עבור {תלמיד} לא עבר ({סיבה}). אנא עדכנו כרטיס: {קישור}', CURRENT_TIMESTAMP),
  ('debt_30',       'חוב מעל 30 יום',          0, 'email',    'שלום {הורה}, קיימת יתרה פתוחה של {יתרה}. לתשלום: {קישור}', CURRENT_TIMESTAMP),
  ('receipt_auto',  'שליחת קבלה אוטומטית',     1, 'email',    'שלום {הורה}, מצורפת קבלה על התשלום שבוצע. תודה.', CURRENT_TIMESTAMP);

CREATE TRIGGER "ReminderRule_no_delete" BEFORE DELETE ON "ReminderRule"
BEGIN SELECT RAISE(ABORT, 'ReminderRule cannot be deleted'); END;
CREATE TRIGGER "ReminderRule_no_insert" BEFORE INSERT ON "ReminderRule"
WHEN (SELECT COUNT(*) FROM "ReminderRule") >= 4
BEGIN SELECT RAISE(ABORT, 'only the four demo rules exist'); END;
