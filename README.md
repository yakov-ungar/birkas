# מערכת גבייה לשכר לימוד

מערכת לניהול וגבייה של שכר לימוד, בעברית ומימין לשמאל. המפרט: `docs/reference/tuition-demo-v3.html`. התוכנית: `docs/PLAN.md`. שאלות פתוחות: `docs/OPEN_QUESTIONS.md`. סיכומי שלבים: `docs/stages/`.

## דרישות

- Node.js 22 (LTS)
- pnpm 10 (`corepack enable`)

## הרצה מקומית

```bash
pnpm install
cp .env.example .env
# ב-.env: למלא APP_ENCRYPTION_KEY עם הפלט של:  openssl rand -base64 32
pnpm --filter @tuition/server db:migrate
pnpm --filter @tuition/server create-admin -- --name "שם המנהל" --email admin@example.com
pnpm dev
```

`create-admin` מדפיס קישור הזמנה חד-פעמי. פותחים אותו בדפדפן (http://localhost:5173), קובעים סיסמה, ובכניסה הראשונה מגדירים אימות דו-שלבי באפליקציית אימות.

במצב פיתוח המיילים לא נשלחים. הם נשמרים בטבלה `Outbox` במסד הנתונים.

## בדיקות

```bash
pnpm lint
pnpm typecheck
pnpm test     # Vitest: יחידה ואינטגרציה, כל קובץ על מסד SQLite זמני
pnpm e2e      # Playwright: בונה את האתר ומריץ שרת בדיקה על מסד נקי
```

בדיקת ארכיון הגרסה והגיבויים (דורשת `age`): `deploy/test/release-roundtrip.sh`

## התקנה בשרת

ההוראות צעד אחר צעד נמצאות ב-[docs/DEPLOY.md](docs/DEPLOY.md), ורשימת בדיקות האבטחה ב-[docs/SECURITY.md](docs/SECURITY.md).

## מבנה

```
apps/server     Fastify + Prisma (SQLite, WAL)
apps/web        React + Vite
packages/shared הרשאות, תפקידים, סכמות Zod וטיפוסים משותפים
deploy/         systemd, Nginx, סקריפטים לגיבוי, שחזור, בדיקת תקינות והתקנת גרסה
docs/           תוכנית, שאלות, סיכומי שלבים, ההדגמה
```
