-- CreateTable
CREATE TABLE "Integration" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "connected" BOOLEAN NOT NULL DEFAULT false,
    "mode" TEXT NOT NULL DEFAULT 'test',
    "configEnc" TEXT,
    "details" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME,
    "updatedByName" TEXT
);


-- The six services of the demo; rows can be configured but never added or removed.
INSERT INTO "Integration" ("key") VALUES ('card'), ('masav'), ('sms'), ('whatsapp'), ('email'), ('accounting');
CREATE TRIGGER "Integration_no_insert" BEFORE INSERT ON "Integration"
BEGIN SELECT RAISE(ABORT, 'integrations are fixed'); END;
CREATE TRIGGER "Integration_no_delete" BEFORE DELETE ON "Integration"
BEGIN SELECT RAISE(ABORT, 'integrations are fixed'); END;
