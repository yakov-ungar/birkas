-- Stage 9: voice calls through ימות המשיח replace SMS. The services list stays fixed otherwise.
DROP TRIGGER "Integration_no_insert";
INSERT INTO "Integration" ("key") VALUES ('voice');
CREATE TRIGGER "Integration_no_insert" BEFORE INSERT ON "Integration"
BEGIN SELECT RAISE(ABORT, 'integrations are fixed'); END;
