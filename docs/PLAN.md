# תוכנית עבודה: מערכת גבייה לשכר לימוד

> מסמך זה נכתב אחרי קריאה מלאה של `docs/reference/tuition-demo-v3.html`. ההדגמה היא מקור האמת. כל מקום שבו ההדגמה סותרת את הכללים בפרומפט, או שהיא לא מספיקה כדי להחליט, מופיע ב-`docs/OPEN_QUESTIONS.md` עם הצעה שלי. **לא אתחיל לממש לפני אישור.**
>
> הערה: בראש קובץ ההדגמה היה סקריפט שהוזרק על ידי סינון NetFree (`wfapi.internal.netfree.link`). הוא לא חלק מההדגמה, ולכן הסרתי אותו מהעותק שב-`docs/reference`.

---

## 1. מה ההדגמה מגדירה (סיכום קצר לאימות הבנה)

**מסכים (14 פריטים בתפריט):** לוח בקרה · תלמידים ומשפחות · חיובים והנחות · תוכניות חיוב · כרטיסים שמורים · שיקים וקופה · בנק והוראות קבע · קבלות וזיכויים · גבייה והודעות · בקשות הורים · פורטל הורים (תצוגה) · דוחות · משתמשים והרשאות · הגדרות וחיבורים.

**רכיבים בכותרת:** שם בית הספר והשנה הפעילה, תאריך לועזי ועברי ויום בשבוע, חיפוש כללי (תלמיד, הורה, טלפון, מספר קבלה), כפתור התראות עם מונה.

**14 הרשאות** (מזהים מההדגמה):
`stu_view` צפייה בתלמידים ומשפחות · `stu_edit` הוספה ועריכת תלמידים · `pay` קבלת תשלומים וזיכויים · `charges` חיובים והנחות · `cards` כרטיסי אשראי שמורים · `plans` תוכניות חיוב · `checks` שיקים וקופה · `bank` בנק והוראות קבע · `rec` קבלות · `msg` גבייה והודעות · `req` בקשות הורים ופורטל · `rep` דוחות · `users` משתמשים והרשאות · `settings` הגדרות וחיבורים.

**תפקידי ברירת מחדל:**

| תפקיד | הרשאות |
|---|---|
| מנהל מערכת | כל ה-14 |
| גבייה | stu_view, stu_edit, pay, charges, cards, plans, checks, rec, msg, req |
| קופאית | stu_view, pay, checks, rec |
| הנהלת חשבונות | stu_view, rec, rep, bank, checks |
| צפייה בלבד | stu_view |
| מותאם אישית | כל צירוף. התפקיד מחושב: אם ההרשאות שוות בדיוק לתפקיד מוגדר, הוא מוצג בשמו, אחרת "מותאם אישית" |

**כללים עסקיים שחילצתי מהקוד של ההדגמה:**

- **יתרה** = סכום החיובים (כולל הנחות שליליות) פחות סכום התשלומים (כולל החזרים שליליים). יתרת משפחה היא סכום יתרות הילדים.
- **הנחת אחים** (`recalcSib`): הילדים הפעילים ממוינים לפי סדר הוספה. הראשון מקבל 0%, השני `sib[1]`% והשלישי ואילך `sib[2]`%, מתוך שכר הלימוד של השנה הפעילה. החישוב מחדש קורה בהוספת תלמיד, בשינוי סטטוס, במחיקה, בשינוי ההגדרות ובפתיחת שנה.
- **הקצאה** (`allocate`): הילדים ממוינים מהיתרה הגדולה לקטנה, וכל ילד מקבל עד גובה החוב שלו. עודף, אם נשאר, מתווסף לחלק הראשון. אם אין חוב בכלל, כל הסכום הולך לילד הראשון ברשימה הממוינת.
- **פריסה** (`mk`): כל תשלום הוא `floor(total/n)` ש״ח שלמים, והתשלום האחרון סופג את ההפרש. היום בחודש נשמר, ובחודש קצר נלקח היום האחרון בו. בחיוב חוזר הסכום קבוע, `count=0` פירושו ללא הגבלה, וההדגמה מייצרת 24 מועדים. מגבלות: פריסה 2 עד 36 תשלומים, חיוב חוזר 0 עד 60 חודשים.
- **גיל חוב** (`aging`): הזיכויים והתשלומים מקוזזים מול החיובים מהישן לחדש (FIFO). את היתרה הפתוחה של כל חיוב מסווגים לפי גילו: עד 30, 31 עד 60, 61 עד 90, מעל 90 ימים.
- **הנחה או מלגה:** באחוזים משכר הלימוד של השנה, או בסכום קבוע. ההנחה לא יכולה לעלות על שכר הלימוד. הסיבות: מלגה, צורך משפחתי, בן או בת צוות, הנחה מיוחדת, אחר. אפשר להוסיף הערה פנימית.
- **שיק:** נרשם במצב "ממתין" ואינו משפיע על היתרה. בהפקדה נוצרים תשלום וקבלה. שיק שחזר יוצר תשלום שלילי, מסמן את הקבלה כמבוטלת ומחייב עמלה לפי ההגדרות. ביטול אפשרי רק לשיק ממתין.
- **קופה:** תשלומי מזומן שעוד לא נסגרו נצברים לקופה הפתוחה. בסגירה רושמים סכום שנספר, ואם יש הפרש נדרש אישור נוסף. נשמרים מי סגר, מתי, הסכום הצפוי, הסכום שנספר, ההפרש והערות.
- **קבלה:** מספור רץ שמתחיל ב-3001. ביטול קבלה מייצר תשלומים הפוכים ו"אישור זיכוי" עם מספר חדש שמפנה לקבלה המקורית. החזר כספי אפשרי רק כשיש יתרת זכות, באמצעי לבחירה (העברה, מזומן, אשראי).
- **תוכנית חיוב:** אמצעי החיוב הוא כרטיס שמור, הוראת קבע (בנק, סניף, חשבון) או העברה. לפני יצירה מוצגת טבלת 6 החיובים הראשונים לאישור. אפשר להשהות ולחדש, להחליף כרטיס, לנסות שוב חיוב שנכשל ולבטל את החיובים הנותרים. כישלון קורה כשהכרטיס הוסר או פג תוקף ביום החיוב.
- **כרטיס:** אי אפשר להסיר כרטיס שיש לו חיוב ממתין או כושל בתוכנית. כשמוסר כרטיס ברירת המחדל, הכרטיס הבא של אותו תלמיד הופך לברירת מחדל.
- **התראות (10 סוגים):** חיובים שנכשלו · חיובים שהגיע מועדם ולא בוצעו · כרטיס שפג תוקפו ומשויך לתוכנית פעילה · כרטיס שיפוג בתוך 60 יום ומשויך לתוכנית · שיקים שעבר מועד פירעונם ולא הופקדו · שיקים לפירעון בתוך 7 ימים · הבטחות תשלום שמועדן בעוד 3 ימים או פחות, או שכבר עבר · משפחות עם חוב מעל 90 יום · תנועות בנק שממתינות · בקשות הורים שממתינות · מזומן שלא נסגר בקופה. לכל התראה יש כפתור "פתח" שמוביל למסך הרלוונטי.
- **לוח בקרה:** 8 מדדים (חויב נטו, נגבה, יתרה פתוחה, אחוז גבייה, הנחות ומלגות, תלמידים פעילים, תוכניות פעילות, חיובים שנכשלו), גרף גיל חובות, גבייה בפועל בששת החודשים האחרונים, תחזית גבייה לשישה חודשים קדימה (מתוכניות חיוב ושיקים דחויים), חמשת החייבים הגדולים ופעילות אחרונה.
- **תזכורות אוטומטיות (4 כללים):** 3 ימים לפני חיוב כרטיס (SMS) · חיוב כרטיס נכשל (וואטסאפ) · חוב מעל 30 יום (מייל, כבוי) · שליחת קבלה אוטומטית (מייל). לכל כלל יש עריכה (ערוץ, מצב, תבנית), בדיקה ("הכלל היה שולח כעת N הודעות", עם דוגמה) ו"שלח עכשיו". המשתנים: `{הורה} {משפחה} {תלמיד} {יתרה} {קישור} {תאריך} {סכום} {סיבה}`.
- **שליחה לקבוצה:** לכל המשפחות החייבות, לחוב מעל 3,000 ₪, לחוב מעל 30 יום, למשפחות עם חיוב שנכשל, או לחייבים בכיתה מסוימת. הערוצים SMS, וואטסאפ ומייל. אפשר לכתוב טקסט חופשי או לבחור תבנית, ולפני השליחה מוצגת דוגמה מלאה.
- **פורטל הורים:** יתרה, יתרה לכל ילד, "שלם עכשיו" (אשראי עם הקצאה), בקשת פריסה (3, 6, 9 או 12 חודשים ואמצעי מועדף), בקשת הנחה (באחוזים), עדכון פרטי קשר, 6 התנועות האחרונות ו-4 הקבלות האחרונות.
- **אישור בקשות הורים:** בקשת עדכון פרטים מתעדכנת מיד. בקשת הנחה פותחת את טופס ההנחה כשהוא ממולא מראש. בקשת פריסה יוצרת תוכנית על יתרת התלמיד, עם תשלום ראשון בעוד 30 יום. בדחייה חובה לכתוב סיבה, והיא נשלחת להורה.
- **פתיחת שנה:** בתצוגה המקדימה רואים כמה תלמידים עולים כיתה, כמה בוגרים (כיתה ו') מסומנים כסיימו, וכמה חיובים חדשים נוצרים ובאיזה סכום לפני הנחות. אחר כך מאשרים, והמערכת מחשבת מחדש את הנחות האחים. יתרות קודמות נשארות.
- **דוחות (9):** חייבים וגיל חוב · לפי אמצעי תשלום · לפי חודש · לפי כיתה (עם אחוז גבייה) · הנחות ומלגות · חיובים שנכשלו · שיקים · סגירות קופה · ייצוא להנהלת חשבונות. כל דוח ניתן לייצוא CSV עם BOM.
- **משתמשים:** יצירה (שם, אימייל, תפקיד), עריכת הרשאות בתיבות סימון, השבתה. אי אפשר להסיר מעצמך את הרשאת המשתמשים או להשבית את עצמך, וחייב להישאר לפחות מנהל פעיל אחד. מוצגת מטריצת הרשאות לפי תפקיד ויומן פעולות עם סינון וייצוא.
- **הגדרות:** כללי (שם, שנה, הנחות אחים, עמלת שיק, שעת הרצה, תדירות גיבוי) · חיבורים (6 שירותים, עם בדיקת חיבור, הגדרה וניתוק) · אבטחה (2FA חובה, זמן ניתוק, אורך סיסמה, מספר ניסיונות, אירועי התחברות אחרונים) · שנת לימודים.
- **אכיפת הרשאות בתוך כרטיס התלמיד:** בלי `cards` מוצג "אין הרשאה לצפייה בכרטיסים", ובלי `plans` מוצג "אין הרשאה". כפתורי הפעולות מוצגים רק עם ההרשאה המתאימה.

---

## 2. ארכיטקטורה

```
                ┌───────────── Oracle Cloud VM (Ubuntu) ─────────────┐
 Browser ──443──▶ Nginx (TLS, Let's Encrypt, gzip, security headers) │
                │    │                                                │
                │    ▼ 127.0.0.1:3000                                 │
                │  Node.js (Fastify) – single process, systemd        │
                │    ├─ /api/*        staff API                       │
                │    ├─ /portal/api/* parent API (separate auth)      │
                │    ├─ /health                                       │
                │    ├─ static: apps/web/dist (SPA)                   │
                │    └─ in-process scheduler (charges, reminders,     │
                │       backups) with DB-level lock                   │
                │    ▼                                                │
                │  SQLite (WAL) – data/app.db  (not exposed)          │
                └─────────────────────────────────────────────────────┘
                        │ nightly encrypted backup
                        ▼
                Oracle Object Storage (S3-compatible API)
```

### מבנה ה-monorepo (pnpm workspaces)

```
apps/
  server/            Fastify + Prisma
    prisma/schema.prisma
    src/
      app.ts               buildApp(): plugin registration, used by tests too
      main.ts              entry point
      config.ts            env parsing with Zod; fails fast on missing values
      plugins/             auth, csrf, rate-limit, helmet, audit, errors
      modules/<domain>/    routes.ts · service.ts · repo (Prisma)
        auth, users, families, students, charges, payments, receipts,
        plans, cards, checks, cash, bank, masav, collection, messages,
        portal, requests, reports, settings, integrations, dashboard, year
      domain/              pure functions, no I/O: money, allocate,
                           installments, siblings, aging, templates
      providers/
        payment/  PaymentProvider + MockProvider
        messaging/ SmsProvider, WhatsAppProvider, EmailProvider + mocks
      scheduler/           job runner, locks, Clock
      lib/                 clock, logger (pino + redaction), csv, pdf
    test/
  web/               React + Vite
    src/
      app/                 router, layout (RTL), nav, header
      pages/<screen>/      one folder per screen from the demo
      portal/              parent portal (separate bundle entry)
      components/          Modal, Form, Table, Tabs, Pill, Kpi, Bars, Toast
      api/                 typed fetch client (types from packages/shared)
    e2e/                   Playwright
packages/
  shared/            Zod schemas + types + constants
                     (permissions, roles, charge types, Hebrew labels)
docs/
  PLAN.md  OPEN_QUESTIONS.md  DEPLOY.md  reference/
deploy/
  nginx.conf  tuition.service  backup.sh  restore.sh  verify-restore.sh
```

### החלטות טכנולוגיות (בתוך המחסנית שהוגדרה)

| נושא | בחירה | למה |
|---|---|---|
| מנהל חבילות | pnpm workspaces | מותקן בסביבה, מהיר וחסכוני בדיסק |
| ORM | Prisma + SQLite (WAL, `busy_timeout`) | לפי הדרישה. אין שימוש ב-enum של מסד הנתונים ואין SQL ספציפי, כך שמעבר ל-PostgreSQL הוא החלפת `provider` ו-`DATABASE_URL` בלבד. הערכים המותרים נאכפים ב-Zod מתוך `packages/shared` |
| סיסמאות | `argon2` (argon2id, ‏m=19MiB, ‏t=2, ‏p=1) | ההמלצה של OWASP, ומתאים ל-1GB זיכרון |
| 2FA | `otplib` + `qrcode` | ה-secret נשמר מוצפן ב-AES-256-GCM עם מפתח ממשתנה סביבה. יש קודי שחזור חד-פעמיים, שנשמרים מגובבים |
| Sessions | טבלת `Session`. בעוגייה רק מזהה אקראי, ובמסד ה-hash שלו | עוגייה `HttpOnly; Secure; SameSite=Strict` (בפורטל `Lax` בגלל קישורי התשלום). ניתוק אחרי חוסר פעילות לפי ההגדרה, ותוקף מוחלט של 12 שעות |
| CSRF | `@fastify/csrf-protection` (double-submit) + SameSite | בכל בקשה משנה |
| כותרות | `@fastify/helmet` עם CSP קשיח | |
| קצב | `@fastify/rate-limit` | בהתחברות, ב-OTP של הפורטל ובפורטל כולו |
| לוגים | `pino` עם `redact` | ראו סעיף 6 |
| Scheduler | לולאה פנימית (`setInterval` של דקה) + טבלת `JobRun` עם מפתח ייחודי (`job`,`runKey`) | הנעילה נעשית במסד ולא בזיכרון, כך שגם שני תהליכים לא ירוצו פעמיים |
| שעון | ממשק `Clock` (`SystemClock` ו-`TestClock`) | `TestClock` ונקודת הקצה "קדם חודש" נטענים רק כש-`NODE_ENV=test` או כש-`ENABLE_TEST_CLOCK=true` מוגדר מחוץ לפרודקשן. השרת מסרב לעלות כשהם מופעלים עם `NODE_ENV=production`, וזה נבדק בבדיקה |
| אזור זמן | `Asia/Jerusalem` לכל חישוב של "היום" | התאריכים נשמרים כ-`YYYY-MM-DD` (ימים עסקיים), והזמנים כ-UTC |
| Excel/CSV | `exceljs` (קריאה), `csv-parse` | ייבוא תלמידים ודף בנק |
| PDF | `pdfkit` עם גופן עברי (Noto Sans Hebrew / Heebo) ו-`bidi-js` לסידור RTL | בשלב 2 אעשה בדיקה מקדימה של עברית מעורבת במספרים. אם התוצאה לא תהיה טובה אחזור אליך עם חלופה (ראו שאלות) |
| מייל | `nodemailer`. ב-dev וב-test נשמר ל-`Outbox` במסד ולא נשלח | |
| לקוח | React 18 + Vite + React Router + TanStack Query + React Hook Form + Zod | גופן Heebo, מוגש מקומית ולא מ-CDN. הכיוון לוגי (`margin-inline`) |
| עיצוב | CSS משלי לפי הצבעים והמבנה של ההדגמה (המשתנים ב-`:root`) | בלי ספריית UI כבדה, כדי לשמור על ההתאמה להדגמה ועל ההנגשה |
| גרפים | רכיב עמודות פשוט כמו בהדגמה, מעליו טבלה נגישה | |
| בדיקות | Vitest (יחידה ואינטגרציה עם SQLite זמני לכל קובץ), Playwright | |

---

## 3. מודל נתונים

**עקרונות:**

- כל סכום הוא `Int` באגורות, ושמות השדות מסתיימים ב-`Agorot`. אין `Float` או `Decimal` בשום מקום.
- טבלאות כספיות (`Charge`, `Payment`, `PaymentAllocation`, `Receipt`, `PlanChargeAttempt`, `AuditLog`) הן append-only. אין להן נקודת קצה של מחיקה, ומעבר לזה מוגדרים ב-SQLite triggers שזורקים שגיאה על `DELETE`, וגם על `UPDATE` של עמודות כספיות. ביטול נעשה ברשומה הפוכה עם `reversalOfId`.
- אין מחיקה פיזית של תלמיד, משפחה, כרטיס או משתמש. יש סטטוס, ובמקרה הצורך `archivedAt`.
- `id` הוא `cuid`, חוץ ממספרי מסמכים, שמנוהלים בטבלת רצף.

**הישויות העיקריות (סכמה מקוצרת):**

```prisma
// ---------- school & config ----------
model Setting        { key String @id  value String /* JSON */  updatedAt DateTime }
// schoolName, activeYearId, siblingPct [0,10,20], checkReturnFeeAgorot,
// autoRunTime "02:00", backupFrequency, require2fa, idleTimeoutMin,
// minPasswordLength, maxFailedLogins, receiptStartNumber
model AcademicYear   { id  name /* תשפ״ז */  startDate  isActive  openedAt  openedById }
model Integration    { key @id  connected Boolean  mode /* test|live */  configEnc String?  details  updatedAt }

// ---------- staff & security ----------
model User           { id  name  email @unique  passwordHash?  role  permissions /* JSON string[] */
                       active  totpSecretEnc?  totpEnabledAt?  failedLogins  lockedUntil?  lastLoginAt?  createdAt }
model UserInvite     { id  userId  tokenHash @unique  expiresAt  usedAt? }
model RecoveryCode   { id  userId  codeHash  usedAt? }
model Session        { id  tokenHash @unique  userId  createdAt  lastSeenAt  expiresAt  ip  userAgent  revokedAt? }
model LoginEvent     { id  userId?  emailTried  event /* success|fail|locked|2fa_fail|logout */  ip  userAgent  at }
model AuditLog       { id  at  actorType /* user|parent|system */  actorId?  action  entity  entityId
                       before /* JSON */  after /* JSON */  ip?  prevHash  hash }   // append-only + hash chain

// ---------- families & students ----------
model Family         { id  name /* משפחת כהן */  parentName  phone  email?  address?  note?  createdAt  archivedAt? }
model Student        { id  familyId  fullName  grade /* א'..ו' */  status /* active|left|graduated */
                       enrollSeq Int /* order for sibling discount */  createdAt }

// ---------- charges (debits and credits on the student ledger) ----------
model ChargeCatalogItem { id  name  defaultAgorot  type  active /* "delete" = deactivate */ }
model Charge         { id  studentId  yearId  type /* tuition|reg|trip|bus|meals|books|other|disc|sib|carry|check_fee */
                       description  amountAgorot /* + debit, - credit */  date  reason?  internalNote?
                       reversalOfId? @unique  batchId?  createdById  createdAt }
model ChargeBatch    { id  description  catalogItemId?  target /* all|grade */  grade?  count  totalAgorot  createdById }

// ---------- payments, allocations, receipts ----------
model Payment        { id  familyId  method /* card|cash|transfer|check|standing_order */
                       amountAgorot /* + payment, - refund/reversal */  date  reference?
                       status /* completed|reversed */  reversalOfId? @unique
                       providerTxnId?  cardId?  cashSessionId?  checkId?  bankTxnId?  planChargeId?
                       idempotencyKey @unique  createdById?  source /* staff|portal|scheduler|bank|check */ }
model PaymentAllocation { id  paymentId  studentId  amountAgorot  manual Boolean }
model DocumentSequence  { docType @id /* receipt|credit_note|refund */  next Int }
model Receipt        { id  docType  number Int  /* @@unique([docType, number]) */  paymentId @unique
                       issuedAt  payerName  amountAgorot  method  reference?
                       creditForReceiptId?  cancelledAt?  cancelReason?  pdfPath?  sentAt?  sentTo? }

// ---------- cards & plans ----------
model SavedCard      { id  studentId  provider  token /* encrypted */  last4  brand  expMonth  expYear
                       holderName  isDefault  createdAt  removedAt? }
model StandingOrder  { id  studentId  bankCode  branch  accountEnc  accountLast4  holderName?  status  createdAt }
model BillingPlan    { id  studentId  type /* installments|recurring */  amountAgorot  count /* 0 = unlimited */
                       method /* card|standing_order|transfer */  cardId?  standingOrderId?
                       startDate  dayOfMonth  status /* active|paused|cancelled|completed */  requestId?  createdById }
model PlanCharge     { id  planId  seq  dueDate  amountAgorot  status /* pending|paid|failed|cancelled */
                       paymentId?  lastError?  attempts Int   /* @@unique([planId, seq]) */ }
model PlanChargeAttempt { id  planChargeId  attemptNo  idempotencyKey @unique  at
                          result /* success|declined|error */  providerRef?  errorCode?  errorMessageHe?  jobRunId? }
model JobRun         { id  job /* charges|reminders|backup */  runKey /* 2026-10-13 */  startedAt  finishedAt?
                       status  okCount  failCount  summary /* JSON */   /* @@unique([job, runKey]) */ }

// ---------- checks, cash, bank ----------
model Check          { id  studentId  number  bankBranch  amountAgorot  dueDate
                       status /* pending|deposited|returned|cancelled */  paymentId?  returnPaymentId?  feeChargeId?  createdById }
model CashSession    { id  openedAt  openedById  openingFloatAgorot  closedAt?  closedById?
                       expectedAgorot?  countedAgorot?  diffAgorot?  notes? }
model BankImport     { id  fileName  fileHash @unique  importedAt  importedById  rows  matched }
model BankTransaction{ id  importId  date  description  amountAgorot  rowHash @unique
                       suggestedFamilyId?  matchScore?  status /* pending|registered|ignored */  paymentId? }
model MasavExport    { id  createdAt  createdById  chargeDate  count  totalAgorot  fileName  sha256 }

// ---------- collection & messaging ----------
model ContactNote    { id  familyId  at  byId  type /* call|message|meeting|promise */  note
                       promiseDate?  promiseAgorot?  fulfilledAt? }
model ReminderRule   { id  key @unique /* pre_charge|charge_failed|debt_30|receipt_auto */  name  enabled  channel  template }
model MessageBatch   { id  at  channel  source /* manual|auto */  ruleId?  recipientCount  template  createdById? }
model Message        { id  batchId  familyId  to  body  status /* queued|sent|failed */  providerRef?  error?  dedupeKey? @unique }

// ---------- parent portal ----------
model ParentLogin    { id  familyId  phone/email  otpHash?  otpExpiresAt?  attempts  lockedUntil? }
model ParentSession  { id  tokenHash @unique  familyId  createdAt  lastSeenAt  expiresAt }
model ParentRequest  { id  familyId  studentId  type /* installments|discount|contact_update */  details /* JSON */
                       note?  status /* pending|approved|rejected */  decidedById?  decidedAt?  rejectReason?  resultRef? }
```

**חישובים שנגזרים ולא נשמרים** (כדי שלא יהיו שתי גרסאות של האמת): יתרת תלמיד, יתרת משפחה, גיל חוב, סטטוס תשלום ("שולם", "חלקי", "חוב"), סטטוס תוכנית. כל אלה פונקציות טהורות ב-`domain/`. אם יהיה צורך בביצועים, אוסיף טבלת cache שמתעדכנת בתוך אותה טרנזקציה.

---

## 4. ממשק `PaymentProvider`

```ts
interface PaymentProvider {
  /** Returns config for hosted fields / hosted page; the browser talks to the provider directly. */
  createTokenizationSession(input: { purpose: 'save' | 'charge'; amountAgorot?: number; returnUrl: string }): Promise<TokenizationSession>;
  /** Exchanges the provider's one-time result for a stored token + card metadata. Never receives PAN/CVV. */
  finalizeTokenization(sessionId: string, providerResult: unknown): Promise<CardToken>;
  chargeToken(input: { token: string; amountAgorot: number; idempotencyKey: string; description: string }): Promise<ChargeResult>;
  refund(input: { providerTxnId: string; amountAgorot: number; idempotencyKey: string }): Promise<RefundResult>;
  verifyWebhook(headers: Record<string, string>, rawBody: Buffer): WebhookEvent | null;
  testConnection(): Promise<{ ok: boolean; latencyMs: number; messageHe: string }>;
}
```

- **MockProvider** מספק דף "שדות מאובטחים" מדומה שרץ מ-origin נפרד (`/mock-provider/*`), כך שהטופס עם מספר הכרטיס וה-CVV לא נשלח לנקודת קצה של השרת שלנו. הוא מחזיר טוקן, 4 ספרות אחרונות, סוג כרטיס ותוקף, ושומר על אותה חוויה של ההדגמה ("יוצר טוקן מאובטח אצל חברת הסליקה...").
- אותו קוד ייקרא בשני מקומות: ב-`/mock-provider` (רק כש-`PAYMENT_PROVIDER=mock`), ובשרת עצמו רק לצורך החזרת הטוקן.
- **כישלונות מבוקרים:** ממשיכים את ההדגמה. כרטיס שפג תוקפו ביום החיוב נכשל. כרטיסי בדיקה מוכרים (לדוגמה, כרטיס שמסתיים ב-0002 נדחה תמיד). אפשר להגדיר `MOCK_FAILURE_RATE` עם seed קבוע לבדיקות. הודעות השגיאה בעברית: "הכרטיס פג תוקף", "סירוב חברת האשראי", "תקלת תקשורת".
- **Idempotency:** לכל ניסיון חיוב יש `idempotencyKey` שנשמר ב-`PlanChargeAttempt` עם אילוץ ייחודי. אם אותו מפתח נשלח שוב, ה-provider מחזיר את התוצאה הקודמת ולא גובה פעם שנייה.

---

## 5. תהליכים קריטיים

**קבלת תשלום (בכל אמצעי):** בטרנזקציה אחת נוצרים `Payment`, `PaymentAllocation`s וקבלה ממספר הרצף הבא, ונרשם `AuditLog`. אחרי ה-commit מופעל כלל "שליחת קבלה אוטומטית". מסך ההקצאה מציג את ההצעה של `allocate`, ואפשר לשנות אותה ידנית. השרת בודק שסכום החלקים שווה לסכום התשלום ושאין סכום שלילי.

**הרצת חיובים לילית:**
1. `JobRun(job='charges', runKey=<תאריך ישראלי>)` נוצר עם `INSERT`. אם הוא כבר קיים, ההרצה נעצרת.
2. נאספים כל ה-`PlanCharge` במצב `pending` שהגיע מועדם בתוכניות `active`.
3. לכל חיוב: `idempotencyKey = planChargeId + ':' + attemptNo`. מתבצע חיוב דרך ה-provider, ובהצלחה נוצרים תשלום, הקצאה וקבלה. בכישלון נשמרים `failed` והסיבה, ומופעל כלל "חיוב נכשל".
4. בסיום נשמר סיכום ההרצה. אם היו כישלונות טכניים, או שההרצה עצמה נפלה, נשלח מייל התראה למנהל.
5. כפתור "הרץ חיובים שהגיע מועדם" במסך מפעיל את אותה פונקציה עם `runKey` ידני, ועדיין לא יחייב שוב חיוב ששולם.

**שיק חוזר:** בטרנזקציה אחת נוצרים תשלום הפוך (`reversalOfId`), מסמך זיכוי לקבלת השיק (ראו שאלות), וחיוב עמלה לפי ההגדרה. הסטטוס הופך ל"חזר".

**פתיחת שנה:** תצוגה מקדימה (`dry-run`) מחזירה את המספרים. האישור מבוצע בטרנזקציה אחת: יוצרים `AcademicYear` חדש, מעלים כיתה, מסמנים בוגרים, יוצרים חיובי שכר לימוד חדשים ומחשבים מחדש את הנחות האחים. אין "העברת יתרה" פיזית, כי היתרה ממשיכה להיגזר מכל התנועות.

---

## 6. אבטחה ופרטיות (מעבר לרשימה בפרומפט)

- **הרשאות:** כל route מוגדר עם `requirePermission('pay')` כחלק מההגדרה שלו. בדיקה אוטומטית עוברת על כל ה-routes הרשומים ב-Fastify ונכשלת אם יש route בלי הצהרת הרשאה (או סימון מפורש `public` או `portal`). בנוסף, לכל route מורץ טסט שמוודא `403` למשתמש בלי ההרשאה.
- **פורטל:** ה-`familyId` נלקח רק מה-session ולא מהבקשה. כל שאילתה בפורטל עוברת דרך `scopeToFamily()`.
- **אין כרטיס מלא:**
  1. אין שדה כזה בסכמה.
  2. Zod מסרב לכל גוף בקשה שיש בו מחרוזת של 13 עד 19 ספרות שעוברת Luhn, בכל שדה בכל נקודת קצה (חוץ מ-`/mock-provider` בסביבת dev).
  3. ‏`pino.redact` ומסנן Luhn בכל רשומת לוג.
  4. בדיקה אוטומטית מריצה זרימות עם כרטיסי בדיקה, ואז סורקת את קובצי הלוג, את תגובות ה-HTTP, את כל הטבלאות ואת קובץ הגיבוי, ומוודאת שהמספר וה-CVV לא מופיעים באף אחד מהם.
- **נתונים אישיים בלוגים:** בלוג נרשמים רק מזהים (id), בלי שמות, טלפונים או כתובות. יומן הביקורת נמצא במסד ונגיש רק עם הרשאת `users`.
- **סודות במסד** (פרטי חיבור לספקים, TOTP, טוקן כרטיס, מספר חשבון בנק) מוצפנים ב-AES-256-GCM עם `APP_ENCRYPTION_KEY`.
- **יומן ביקורת:** append-only עם trigger, ולכל רשומה hash של הרשומה הקודמת, כך שאפשר לזהות שינוי. ייצוא ל-CSV.

---

## 7. שלבים וקריטריוני קבלה

> בסוף כל שלב: `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e`, הרצה ידנית ובדיקה, commit, ואז **עצירה** וסיכום (מה נבנה, איך מפעילים, מה נבדק, מה חסר).
> השינוי היחיד שאני מציע לסדר שלך: הגדרות האבטחה והגדרות הנחת האחים נבנות כבר בשלבים 1 ו-2 (רק השדות, בלי מסך החיבורים), כי ההתחברות וחישוב ההנחות תלויים בהן. מסך ההגדרות המלא נשאר בשלב 7.

### שלב 1: תשתית
- monorepo: pnpm, TS strict, ESLint ו-Prettier, `packages/shared` עם ההרשאות, התפקידים והתוויות בעברית מההדגמה.
- Fastify עם `config` (Zod על env), helmet, CSRF, rate limit, טיפול שגיאות שמחזיר הודעות בעברית, pino עם redaction, ו-`/health`.
- Prisma + SQLite WAL, migrations, seed (משתמש מנהל ראשון דרך CLI ולא סיסמה קבועה בקוד), triggers של append-only.
- התחברות: argon2id, הגדרת TOTP עם QR וקודי שחזור, 2FA חובה לפי ההגדרה, נעילה אחרי N ניסיונות, ניתוק אחרי חוסר פעילות, התנתקות, ורישום אירועי התחברות.
- משתמשים והרשאות: רשימה, יצירה עם הזמנה במייל (Outbox מדומה) והגדרת סיסמה מהקישור, עריכת הרשאות ותפקיד (כולל "מותאם אישית"), השבתה, שתי החסימות (לא להשבית את עצמך, ולא להשאיר מערכת בלי מנהל פעיל), ומטריצת התפקידים.
- יומן ביקורת: רישום אוטומטי לפני ואחרי, מסך עם סינון וייצוא CSV.
- מעטפת UI: כותרת (שם, שנה, תאריך עברי ולועזי), תפריט לפי הרשאות, רכיבי Modal, Form, Table, Tabs ו-Toast, ניווט במקלדת (Enter על שורה, Escape לסגירה, מלכודת פוקוס במודל), ופוקוס גלוי.
- **קבלה:** אפשר להתחבר עם 2FA. משתמש בלי הרשאה מקבל 403 בכל route (טסט מלא). מסך שאין עליו הרשאה לא מוצג בתפריט. אי אפשר להשבית את עצמך או את המנהל האחרון. ניסיון לעדכן או למחוק ב-`AuditLog` נכשל ברמת המסד. Playwright: התחברות, הגדרת 2FA ויצירת משתמש.

### שלב 2: ליבה כספית
- `domain/`: ‏money (פרסור "1,234.50" לאגורות ופורמט ₪), ‏`allocate`, הנחת אחים, גיל חוב, ‏ledger. בדיקות יחידה, כולל בדיקות property-based: סכום החלוקה שווה לסכום המקורי, אין סכום שלילי, ואין שינוי כשהקלט כבר "מאוזן".
- משפחות ותלמידים: רשימות עם הסינונים של ההדגמה, כרטיס תלמיד וכרטיס משפחה, הוספה, עריכת פרטי משפחה, שינוי סטטוס, וייבוא מ-Excel או CSV עם דוח שורות שנדחו.
- חיובים: קטלוג, חיוב בודד, חיוב קבוצתי עם אישור, הנחה או מלגה, הנחת אחים אוטומטית, ו"ביטול חיוב" כתנועה הפוכה.
- תשלומים: מזומן, העברה, שיק (רישום בלבד, ההפקדה בשלב 4), ואשראי דרך MockProvider (כרטיס שמור או חדש, עם אפשרות לשמור). תשלום משפחתי עם הקצאה אוטומטית וידנית.
- קבלות: מספור רציף בטרנזקציה, תצוגה, הדפסה ו-PDF, שליחה במייל (Outbox), ביטול בזיכוי, והחזר כספי.
- דף חשבון לתלמיד ולמשפחה: הדפסה, PDF ושליחה.
- חיפוש כללי.
- **קבלה:** כל בדיקות היחידה הכספיות עוברות. 1,000 תשלומים במקביל לא יוצרים חור או כפילות במספרי הקבלות. ביטול קבלה מחזיר את היתרות למצב הקודם, והמקור נשמר. ניסיון למחוק חיוב נכשל ברמת המסד. Playwright: קבלת תשלום משפחתי באשראי, הקצאה ובדיקת קבלה.

### שלב 3: תוכניות חיוב והרצה אוטומטית
- כרטיסים שמורים: מסך, ברירת מחדל, הסרה (חסומה כשיש תוכנית פעילה), ותוכניות מקושרות.
- תוכניות: פריסה (2 עד 36), חיוב חוזר (מוגבל או ללא הגבלה, עם גלגול מועדים קדימה), תצוגת לוח לפני אישור, השהיה וחידוש, החלפת כרטיס, ניסיון חוזר, וביטול החיובים הנותרים.
- Scheduler: שעת הרצה מההגדרות, נעילה במסד, סיכום הרצה ומייל כשנכשל. כפתור "הרץ עכשיו".
- `TestClock` ונקודת קצה "קדם חודש", רק בסביבת test או dev.
- מרכז התראות (כל 10 הסוגים שההדגמה מגדירה עד השלב הזה) ולוח בקרה (מדדים וגרפים).
- **קבלה:** הרצה כפולה באותו יום, וגם שתי הרצות במקביל, יוצרות אפס חיובים כפולים (טסט). כרטיס שפג תוקף נכשל עם סיבה בעברית. בדיקת "אין PAN ו-CVV בשום מקום" עוברת. Playwright: יצירת תוכנית, קידום חודש, הרצה ובדיקת הסיכום.

### שלב 4: שיקים, קופה, בנק, מס״ב
- שיקים: רישום, הפקדה (בודדת ו"הגיע מועדם"), החזרה עם עמלה, וביטול.
- קופה: פתיחה (עם יתרת פתיחה), צבירת מזומן, סיכום לפי אמצעי תשלום, סגירה עם הפרש, ומי סגר.
- בנק: ייבוא CSV או Excel (פורמט הבנק לפי השאלות), דה-דופליקציה של שורות, התאמה לפי שם וסכום עם ציון ביטחון, אישור או שיוך ידני, ו"התעלם".
- הוראות קבע: רשימה, והפקת קובץ מס״ב בפורמט הרשמי (לפי השאלות).
- **קבלה:** ייבוא אותו קובץ פעמיים לא יוצר כפילויות. שיק חוזר מעדכן את היתרה ואת גיל החוב. קובץ המס״ב עובר validation לפי המפרט. Playwright: שיק חוזר.

### שלב 5: גבייה והודעות
- מעקב חייבים עם סינון לפי גיל חוב ולפי יתרה.
- יומן קשר: הערות, הבטחות תשלום, ו"סמן כבוצע".
- כללי תזכורת: ארבעת הכללים של ההדגמה, עריכה, בדיקה ("היה שולח N"), שליחה, ומניעת כפילות (`dedupeKey`).
- שליחה לקבוצות. ספקי SMS, וואטסאפ ומייל מדומים, ששומרים את ההודעות ב-Outbox. היסטוריית הודעות.
- **קבלה:** כל משתני התבנית מוחלפים, ומשתנה לא מוכר נשאר כמו שהוא. הרצת כלל פעמיים באותו יום לא שולחת פעמיים. הכלל "בדיקה" לא שולח בפועל.

### שלב 6: פורטל הורים ובקשות
- הזדהות נפרדת (לפי השאלות: OTP ב-SMS או במייל לטלפון או לכתובת שרשומים במשפחה), עוגייה נפרדת ו-rate limit קשיח.
- מסך כמו בהדגמה: יתרה, ילדים, תשלום באשראי (hosted fields), תנועות, קבלות וצפייה בקבלה. בקשות פריסה, הנחה ועדכון פרטים.
- מסך "בקשות הורים" לצוות: אישור (לפי הזרימות של ההדגמה) או דחייה עם סיבה, שנשלחת להורה. הכול ביומן.
- תצוגה מקדימה של הפורטל לצוות (הרשאת `req`), לקריאה בלבד או כמו בהדגמה (ראו שאלות).
- **קבלה:** טסט אוטומטי שבו הורה של משפחה א׳ מנסה לגשת לכל נקודת קצה בפורטל עם מזהים של משפחה ב׳, ומקבל 404 או 403 בכולן. Playwright: בקשת הורה, אישור ובדיקת תוכנית שנוצרה.

### שלב 7: דוחות, הגדרות, פתיחת שנה
- 9 הדוחות של ההדגמה, ובנוסף "תנועות לפי תקופה", עם סינון תאריכים ו-CSV עם BOM (נבדק שנפתח באקסל בעברית).
- הגדרות: כללי, אבטחה, חיבורים (6 שירותים, בדיקת חיבור, מצב בדיקה או ייצור, סודות מוצפנים), ואירועי התחברות אחרונים.
- פתיחת שנת לימודים: תצוגה מקדימה ואישור.
- **קבלה:** שינוי אחוזי הנחת אחים מחשב מחדש את הכול דרך תנועות הפוכות וחדשות, בלי למחוק. פתיחת שנה ב-dry-run לא משנה כלום. בייצוא, סכומים שווים לסכומי ה-ledger.

### שלב 8: פריסה, גיבויים, הקשחה
- `docs/DEPLOY.md` צעד אחר צעד: יצירת VM, ‏swap, ‏Node LTS, ‏Nginx, ‏certbot, ‏systemd, ‏UFW ו-Security List של Oracle (80, 443, ו-SSH מוגבל ל-IP).
- גיבוי: `sqlite3 .backup`, הצפנה עם `age`, העלאה ל-Object Storage, שמירת 30 הגיבויים האחרונים, ‏`restore.sh`, ו-`verify-restore.sh` שמשחזר לתיקייה זמנית ומריץ בדיקות שלמות.
- ניטור: `/health`, ‏logrotate, ומייל כשהרצה לילית נכשלת או שגיבוי נכשל.
- בדיקת אבטחה סופית: `pnpm audit`, סריקת כותרות, ‏OWASP ASVS L1 checklist, והרצה חוזרת של כל בדיקות ה-403 והדליפה.
- **קבלה:** שחזור מגיבוי עובד על מכונה נקייה. השרת עולה מחדש אחרי reboot. הפורטים פתוחים רק לפי הדרישה.

### שלב 9: ספקים אמיתיים
- אחרי שתבחר: מימוש `PaymentProvider` לחברת הסליקה, ספקי SMS ומייל, וקובץ מס״ב מול הבנק. בדיקות במצב sandbox לפני ייצור.

---

## 8. אסטרטגיית בדיקות

| סוג | כלי | מה נבדק |
|---|---|---|
| יחידה | Vitest | כל פונקציה ב-`domain/`: פריסה, עיגול, אחים, הקצאה, גיל חוב, זיכויים, תבניות. property-based (`fast-check`) לאינוריאנטים של סכומים |
| אינטגרציה | Vitest + `app.inject()` + SQLite זמני | כל route: תקין, קלט לא תקין (400), בלי התחברות (401), בלי הרשאה (403), הורה של משפחה אחרת (404) |
| Idempotency | Vitest | scheduler פעמיים, ובמקביל. אותו `idempotencyKey` פעמיים מול ה-provider |
| דליפה | Vitest | סריקה של לוגים, תגובות, מסד וגיבוי למספרי כרטיס ול-CVV |
| e2e | Playwright | קבלת תשלום · יצירת תוכנית והרצתה · שיק חוזר · בקשת הורה ואישורה · התחברות עם 2FA |
| נגישות | `@axe-core/playwright` | בכל מסך ראשי, בלי הפרות חמורות |

---

## 9. סיכונים ידועים

- **זיכרון של 1GB:** ‏`vite build` ו-`prisma generate` עלולים לא להספיק. הפתרון: בנייה ב-GitHub Actions או במחשב שלך והעלאה של `dist` בלבד, ו-swap של 2GB. הזיכרון של תהליך Node בזמן ריצה צפוי להיות כ-120 עד 180MB.
- **PDF בעברית:** סידור RTL ב-pdfkit עדין. אעשה בדיקה מקדימה בתחילת שלב 2.
- **Argon2 ו-Prisma על ARM או x86:** שתיהן ארכיטקטורות נתמכות עם קבצים בינאריים מוכנים, אבל צריך לבנות על אותה ארכיטקטורה של השרת.
- **דרישות משפטיות** (קבלות, מס״ב, חיוב חוזר): מפורטות בשאלות הפתוחות, ועלולות לשנות את מודל הקבלות.
