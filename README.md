# מערכת גבייה לשכר לימוד

**English:** [Part A: Launch on an Oracle Cloud Micro server](#part-a-launch-the-system-on-an-oracle-cloud-micro-server) · [Part B: Set up the system and load your data](#part-b-set-up-the-system-and-load-your-data)

מערכת לניהול וגבייה של שכר לימוד, בעברית ומימין לשמאל.

**מסמכים נוספים:**

- המפרט: `docs/reference/tuition-demo-v3.html`
- התוכנית: `docs/PLAN.md`
- שאלות פתוחות: `docs/OPEN_QUESTIONS.md`
- סיכומי השלבים: `docs/stages/`
- אבטחה: [docs/SECURITY.md](docs/SECURITY.md)

**הקובץ הזה בנוי משני חלקים:**

1. **[התקנה בשרת](#חלק-1-התקנה-בשרת):** מהמכונה בענן ועד כתובת HTTPS שעובדת, עם גיבויים.
2. **[הגדרת המערכת והכנסת הנתונים](#חלק-2-הגדרת-המערכת-והכנסת-הנתונים):** מהכניסה הראשונה ועד מערכת מלאה עם תלמידים, חיובים, סליקה, שיחות ומייל.

---

## חלק 1: התקנה בשרת

ההוראות המלאות, עם כל הפקודות, נמצאות ב-[docs/DEPLOY.md](docs/DEPLOY.md). כאן הסדר והעיקר.

### מה צריך לפני שמתחילים

| מה                                                         | בשביל מה                                                             |
| ---------------------------------------------------------- | -------------------------------------------------------------------- |
| חשבון Oracle Cloud (או כל מכונת Ubuntu 24.04 עם 1GB ומעלה) | השרת                                                                 |
| דומיין, למשל `pay.school.org.il`                           | כתובת המערכת ותעודת HTTPS                                            |
| שרת מייל יוצא (SMTP)                                       | קבלות, תזכורות, קודי כניסה להורים והתראות. **זה הערוץ הראשי להורים** |
| `age` במחשב שלכם                                           | מפתח להצפנת הגיבויים. המפתח הפרטי נשאר אצלכם בלבד                    |
| ארכיון גרסה `tuition-<גרסה>.tar.gz`                        | ב-GitHub: Actions ← הריצה האחרונה ← Artifacts ← `release`            |
| אופציונלי: חשבון ימות המשיח                                | שיחות קוליות להורים במקום SMS                                        |
| אופציונלי: חשבון נדרים פלוס                                | סליקת אשראי אמיתית                                                   |

### הסדר

1. **מכונה:** Ubuntu 24.04 עם IP ציבורי (DEPLOY, צעד 1).
2. **חומת אש בענן:** 22 רק מה-IP שלכם, ו-80 ו-443 לכולם (צעד 2).
3. **דלי לגיבויים** ב-Object Storage, והרשאה למכונה לכתוב אליו (צעד 3).
4. **הכנת השרת:** מעתיקים את הארכיון ומריצים `deploy/scripts/server-setup.sh`. הסקריפט מתקין Node 22, ‏Nginx, ‏certbot ו-age, ויוצר משתמש שירות ותיקיות (צעד 4).
5. **חומת האש בשרת:** `deploy/scripts/firewall.sh <ה-IP-שלכם>` (צעד 5).
6. **הגדרות** ב-`/etc/tuition/tuition.env` (צעד 6):
   - `APP_ENCRYPTION_KEY`: מ-`openssl rand -base64 32`. **שומרים עותק מחוץ לשרת.** בלעדיו הגיבויים לא שמישים.
   - `APP_BASE_URL`: הכתובת המלאה, למשל `https://pay.school.org.il`.
   - `SMTP_URL`, ‏`MAIL_FROM` ו-`ALERT_EMAIL`.
   - `TRUST_PROXY=true` (כבר בקובץ הדוגמה).
   - את המפתח **הציבורי** של age מכניסים ל-`/etc/tuition/backup-recipients.txt`, ואת שם הדלי ל-`/etc/tuition/backup.env`.
7. **דומיין ו-HTTPS:** רשומת `A` לשרת, ואז תעודה מ-Let's Encrypt והפעלת אתר Nginx (צעד 7).
8. **התקנת הגרסה:** `deploy/scripts/release.sh`, ואז `create-admin` שמדפיס קישור הזמנה למנהל הראשון (צעד 8).
9. **בדיקות קבלה** (צעד 9):
   - `/health` עונה.
   - הטיימרים של הגיבוי ובדיקת התקינות רצים.
   - השרת עולה מעצמו אחרי reboot.
   - רק 22, 80 ו-443 פתוחים.
   - גיבוי משוחזר על מכונה נקייה עם `verify-restore.sh`.

### אחרי ההתקנה

- **גרסה חדשה:** מעתיקים ארכיון ומריצים `release.sh`. הסקריפט מגבה, מעדכן את המסד, ואם הגרסה לא עונה הוא חוזר לקודמת.
- **גיבוי:** כל לילה, מוצפן, לדלי. 30 האחרונים נשמרים.
- **שחזור:** `deploy/scripts/restore.sh`. הוא מבקש להקליד RESTORE, ושומר את המסד הקודם לידו.
- **התראות במייל:** כשהרצה לילית או גיבוי נכשלים, וכשהשרת לא עונה.

---

## חלק 2: הגדרת המערכת והכנסת הנתונים

עושים את הצעדים לפי הסדר. כל המסכים נמצאים בתפריט הימני.

### 1. כניסה ראשונה של המנהל

1. פותחים את קישור ההזמנה ש-`create-admin` הדפיס, וקובעים סיסמה (לפחות 10 תווים).
2. מגדירים אימות דו-שלבי: סורקים את קוד ה-QR באפליקציית אימות (Google Authenticator, ‏Microsoft Authenticator וכדומה).
3. **שומרים את 10 קודי השחזור** במקום בטוח. הם הדרך היחידה להיכנס אם הטלפון אבד.

### 2. הגדרות בית הספר

**הגדרות וחיבורים ← כללי ← עריכת הגדרות:**

- **שם בית הספר:** מופיע בקבלות, בדפי החשבון ובהודעות.
- **הנחת אחים:** אחוז לילד השני, ואחוז לילד השלישי ואילך. ההנחה מחושבת לבד לכל משפחה.
- **עמלת שיק חוזר.**
- **שעת הרצת חיובים אוטומטית:** השעה שבה רצים בכל לילה חיובי תוכניות התשלום, התזכורות והחיוב החודשי של השיעורים הפרטיים.
- **כיתות לפי הסדר, מופרדות בפסיק,** למשל `א', ב', ג', ד', ה', ו', ז', ח'`. הכיתה האחרונה היא כיתת הסיום: בפתיחת שנה חדשה תלמידיה מסיימים.

**הגדרות וחיבורים ← אבטחה ← עריכת הגדרות אבטחה:** אימות דו-שלבי חובה, ניתוק אחרי חוסר פעילות, אורך סיסמה מינימלי, ונעילה אחרי ניסיונות כושלים. באותו מסך מוצגים אירועי ההתחברות האחרונים.

### 3. משתמשים והרשאות

**משתמשים והרשאות ← משתמש חדש:** שם, אימייל ותפקיד. המשתמש מקבל במייל קישור הזמנה, וקובע בו סיסמה ואימות דו-שלבי.

| תפקיד         | מה מותר                                                                 |
| ------------- | ----------------------------------------------------------------------- |
| מנהל מערכת    | הכול                                                                    |
| גבייה         | תלמידים, תשלומים, חיובים, כרטיסים, תוכניות, שיקים, קבלות, הודעות ובקשות |
| קופאית        | צפייה בתלמידים, קבלת תשלומים, שיקים וקופה, קבלות                        |
| הנהלת חשבונות | צפייה, קבלות, דוחות, בנק, שיקים                                         |
| צפייה בלבד    | צפייה בתלמידים ומשפחות                                                  |

אפשר לסמן הרשאות אחת-אחת, ואז התפקיד נקרא "מותאם אישית". ההרשאות נבדקות בשרת, לא רק במסך.

### 4. קטלוג חיובים

**חיובים והנחות ← קטלוג חיובים ← פריט חדש:** פריטים שחוזרים כל שנה, כמו דמי רישום, הסעות, טיולים וספרים. לכל פריט יש סכום ברירת מחדל וסוג. בחיוב קבוצתי בוחרים פריט מהקטלוג.

### 5. שיעורים פרטיים (אברכים)

**הגדרות וחיבורים ← שיעורים פרטיים:**

1. **רשימת המקצועות,** מופרדים בפסיק, למשל `גמרא, משנה, חומש, קריאה, חשבון, אנגלית`.
2. **אברך חדש:** שם וטלפון. אברך שהפסיק מסמנים "לא פעיל". השיעורים הקודמים שלו נשמרים.

שיעור לתלמיד מוסיפים בכרטיס התלמיד (צעד 7).

### 6. הכנסת התלמידים: ייבוא מאקסל

**תלמידים ומשפחות ← ייבוא מאקסל:** קובץ `xlsx` או `csv` עם שורת כותרות.

| עמודה     | חובה               | שמות כותרת שמתקבלים                                            |
| --------- | ------------------ | -------------------------------------------------------------- |
| שם התלמיד | כן                 | שם תלמיד, שם התלמיד, תלמיד, שם                                 |
| כיתה      | כן                 | כיתה. צריכה להופיע ברשימת הכיתות מצעד 2                        |
| שם ההורה  | כן                 | שם הורה, הורה, שם ההורה                                        |
| טלפון     | כן                 | טלפון, נייד, טלפון הורה                                        |
| אימייל    | לא, אבל מומלץ מאוד | אימייל, מייל, דוא"ל, דואר אלקטרוני                             |
| כתובת     | לא                 | כתובת                                                          |
| שכר לימוד | לא                 | שכר לימוד, סכום. בשורה בלי סכום נלקח הסכום שמזינים במסך הייבוא |

- **משפחות:** תלמידים עם אותו טלפון נכנסים לאותה משפחה, והנחת האחים מחושבת לבד.
- **שורות שגויות:** בסוף מוצג דוח, ושורה עם שגיאה לא נקלטת. מתקנים בקובץ ומייבאים שוב. שורה שכבר נקלטה לא תיכנס פעמיים.
- **תלמיד בודד:** "תלמיד חדש" באותו מסך.
- **מייל להורים:** בלי מייל, ההורה לא מקבל קבלות ותזכורות (אלא אם חוברו שיחות קוליות), והכניסה לפורטל רק בקוד בשיחה.

### 7. חיובים, הנחות ושיעורים פרטיים

- **שכר הלימוד השנתי** נרשם בייבוא או בפתיחת שנה (צעד 8).
- **חיוב קבוצתי:** חיובים והנחות ← חיוב קבוצתי. בוחרים פריט מהקטלוג וכיתה (או כולם). לפני הביצוע מוצגת תצוגה מקדימה.
- **חיוב לתלמיד,** ו**הנחה / מלגה:** באחוזים או בסכום, עם סיבה והערה פנימית שלא מופיעה בדף החשבון.
- **שיעור פרטי:** כרטיס התלמיד ← הוספת שיעור פרטי. בוחרים אברך, מקצוע ומחיר לחודש.
  - ביום האחרון של כל חודש המערכת מחייבת את החודש המלא.
  - השיעור מופיע בקבלה כפריט נפרד: "שיעור פרטי: משנה · הרב … · 10/2026".
  - כשהשיעור נגמר: "סיום" ליד השיעור. החודש של תאריך הסיום עדיין מחויב.
- **ביטול:** חיוב לא נמחק לעולם. ביטול רושם שורה הפוכה, וכך ההיסטוריה נשארת שלמה.

### 8. פתיחת שנת לימודים

**הגדרות וחיבורים ← שנת לימודים ← פתיחת שנת לימודים חדשה:** שם השנה, שכר לימוד שנתי ותאריך חיוב.

- לפני הביצוע מוצגת תצוגה מקדימה: מי עולה כיתה ומי מסיים.
- רק אחרי "אישור והפעלה" התלמידים עולים כיתה ונרשם שכר הלימוד.
- אי אפשר לפתוח את אותה שנה פעמיים.

### 9. חיבורים: מייל, שיחות קוליות, סליקה

הכול ב**הגדרות וחיבורים ← חיבורים**. פרטי החיבור נשמרים מוצפנים במסד.

**דואר אלקטרוני**

1. שרת המייל מוגדר בשרת (`SMTP_URL` בחלק 1).
2. כאן לוחצים "בדיקת חיבור". המערכת שולחת מייל בדיקה אליכם.

**שיחות קוליות (ימות המשיח), במקום SMS**

1. "הגדרה": מספר המערכת, הסיסמה ומספר מזוהה (לא חובה), ב**מצב בדיקה**.
2. "בדיקת חיבור": בודקת את פרטי הכניסה בלי לחייג.
3. שולחים לעצמכם דף חשבון "בשיחה קולית" ממשפחת בדיקה עם הטלפון שלכם.
4. אם השיחה הגיעה ונשמעה טוב: "ניתוק", ואז "הגדרה" מחדש ב**מצב ייצור**.
5. מאז, תזכורות וקודי כניסה שהיו נשלחים ב-SMS מוקראים להורים בשיחה. קישורים לא מוקראים.

**סליקת אשראי (נדרים פלוס)**

1. **בממשק של נדרים פלוס:** לוקחים את **מספר המוסד** ואת **ה-ApiValid** (מפתחות API).
2. **"חברת סליקה" ← "הגדרה":** מספר מוסד, ‏ApiValid, ו**מצב ייצור**.
3. **תשלום ניסיון של ₪1:** קבלת תשלום ← אשראי, עם כרטיס שלכם, לפי [docs/DEPLOY.md](docs/DEPLOY.md). רק אם נוצרה קבלה ממשיכים לעבוד.
4. **איך זה עובד:**
   - מספר הכרטיס וה-CVV מוקלדים בטופס של נדרים פלוס עצמו, בתוך המסך, ולא עוברים במערכת.
   - התשלום נרשם רק כשהשרת של נדרים פלוס מאשר אותו לשרת שלנו. רק אז נוצרת קבלה ונשלחת להורה.
   - ההורים משלמים באותו טופס מהפורטל.
5. **מה לא זמין עם נדרים פלוס:**
   - שמירת כרטיסים, ותוכניות תשלום שמחייבות כרטיס שמור, עוברים דרך השרת שלנו ולכן כבויים.
   - לתשלומים: תוכניות בהעברה, בשיק או בהוראת קבע, או חיוב בכל פעם מחדש בטופס.
6. **עד שמחברים:** הסליקה במצב בדיקה פנימי ולא מחייבת שום כרטיס.

**SMS, וואטסאפ והנהלת חשבונות**

- SMS ווואטסאפ לא בשימוש: SMS מוחלף בשיחה, ווואטסאפ במייל.
- הנהלת החשבונות: "ייצוא לאקסל (CSV)" במסך הדוחות.

### 10. בנק והוראות קבע

**בנק והוראות קבע:**

- **ייבוא דף בנק:** קובץ csv או xlsx מהבנק, עם תאריך, תיאור, זכות ואסמכתא.
  - המערכת מציעה לאיזו משפחה שייך כל זיכוי. מאשרים או משייכים ידנית.
  - תנועה שכבר יובאה לא נקלטת שוב.
- **הוראות קבע:** תוכנית חיוב מסוג הוראת קבע, בכרטיס התלמיד ← "תוכנית חיוב".
- **קובץ מס״ב:** "הפקת קובץ מס״ב" עד תאריך חיוב.
  - **שימו לב:** עד שתתקבל מהבנק ההגדרה הרשמית וקוד המוסד (שאלה א7 ב-`OPEN_QUESTIONS.md`), הקובץ הוא קובץ הדגמה מסומן "לא לשליחה".

### 11. שגרה

| מתי               | מה                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------- |
| כל יום            | לוח הבקרה: חובות, חיובים שנכשלו ובקשות הורים. "שיקים וקופה": פתיחה וסגירה של הקופה       |
| כל לילה, אוטומטית | חיובי תוכניות, תזכורות, גיבוי. ביום האחרון של החודש: השיעורים הפרטיים                    |
| כל שבוע           | ייבוא דף בנק ושיוך תנועות                                                                |
| לפי הצורך         | גבייה והודעות: רשימת חייבים, תזכורות במייל או בשיחה. בקשות הורים: הנחות, הסדרים ותשלומים |
| סוף שנה           | דוחות ← "ייצוא לאקסל (CSV)" להנהלת החשבונות, ואז פתיחת שנה חדשה                          |

### 12. פורטל ההורים

- **כניסה:** ההורה נכנס ב-`/portal` עם הטלפון או המייל שלו, ומקבל קוד חד-פעמי במייל או בשיחה.
- **מה ההורה רואה:** יתרה, קבלות ודף חשבון.
- **מה ההורה יכול לעשות:** לשלם באשראי ולבקש הנחה, הסדר תשלומים או שיחה.
- **בצד הצוות:** "פורטל הורים (תצוגה)" מציג את הפורטל כמו שמשפחה מסוימת רואה אותו, לקריאה בלבד.

---

# English guide

This part is in English. It has two step-by-step guides:

- **[Part A: Launch the system on an Oracle Cloud Micro server](#part-a-launch-the-system-on-an-oracle-cloud-micro-server).** From an empty Oracle account to a working HTTPS address with nightly encrypted backups.
- **[Part B: Set up the system and load your data](#part-b-set-up-the-system-and-load-your-data).** From the first sign-in to a working system with students, charges, card payments, calls and email.

The screens of the system are in Hebrew. In Part B each screen and button is given in Hebrew, followed by its meaning in English.

Throughout, replace these placeholders with your own values:

| Placeholder          | Meaning                                                                | Example               |
| -------------------- | ---------------------------------------------------------------------- | --------------------- |
| `pay.school.example` | Your domain for the system                                             | `pay.myschool.org.il` |
| `<SERVER_IP>`        | The public IP of your Oracle server                                    | `141.147.10.20`       |
| `<MY_IP>`            | The public IP of your own computer (look it up at https://ifconfig.me) | `85.64.1.2`           |
| `<VERSION>`          | The version in the release file name                                   | `fcc0a816debf`        |

## Part A: Launch the system on an Oracle Cloud Micro server

The server is an Oracle "Always Free" virtual machine of shape **VM.Standard.E2.1.Micro**: 1 CPU, 1 GB of memory, Ubuntu 24.04. The database is SQLite on the same machine. The scripts in `deploy/scripts/` do most of the work.

You do every step yourself, in your own accounts. Nothing here connects to your accounts for you.

### A1. What you need before you start

- **An Oracle Cloud account.** Sign up at https://www.oracle.com/cloud/free/. A credit card is needed for verification; the Micro machine is in the free tier.
- **A domain name** where you can add DNS records, for example a subdomain of your school's website.
- **An outgoing email (SMTP) account.** Email is the main channel to parents: receipts, reminders and portal sign-in codes go by email, and alerts reach you by email. Any SMTP service works: your school's mail server, Google Workspace, Microsoft 365, or a sending service.
- **A computer with a terminal:** macOS or Linux, or Windows with PowerShell. You need `ssh` and `scp`, which are built in.
- **`age`**, the backup encryption tool, on your computer. Install it from https://github.com/FiloSottile/age/releases, or with `brew install age` on macOS, or `sudo apt install age` on Ubuntu.

### A2. Prepare two keys on your computer

**1. An SSH key** for signing in to the server. Skip this if you already have `~/.ssh/id_ed25519.pub`.

```bash
ssh-keygen -t ed25519
```

Press Enter to accept the default location, and choose a passphrase.

**2. A backup key.** Backups are encrypted to this key.

```bash
age-keygen -o tuition-backup-key.txt
```

- The file `tuition-backup-key.txt` is the **private key**. Keep it only with you: in a password manager or on an encrypted drive. **It never goes on the server.** Without it, no backup can ever be restored.
- The command also prints a line `Public key: age1...`. This is the **public key**. Copy it; it goes on the server in step A11.

### A3. Download the release archive

1. On GitHub, open the repository and go to **Actions**.
2. Open the latest green (successful) run of **CI** on the branch you want to install.
3. At the bottom of the run page, under **Artifacts**, download **release**. You get `release.zip`.
4. Unzip it. It contains two files:
   - `tuition-<VERSION>.tar.gz`: the release.
   - `tuition-<VERSION>.tar.gz.sha256`: its checksum. `release.sh` checks it.

GitHub keeps artifacts for 30 days. If the artifact has expired, push any commit to run CI again, or build the archive yourself on a Linux computer with Node 22 and pnpm: `deploy/scripts/package.sh`.

Do not build on the server: 1 GB of memory is not enough for the build.

### A4. Create the virtual machine

In the Oracle Cloud console:

1. Open the menu (☰) → **Compute** → **Instances** → **Create instance**.
2. **Name:** `tuition`.
3. **Image and shape:**
   - Click **Edit** → **Change image** → **Ubuntu** → **Canonical Ubuntu 24.04** (not "Minimal"). Click **Select image**.
   - Click **Change shape** → **Specialty and previous generation** → **VM.Standard.E2.1.Micro**. It is marked "Always Free-eligible". Click **Select shape**.
4. **Networking:**
   - Choose **Create new virtual cloud network** and **Create new public subnet**.
   - Make sure **Assign a public IPv4 address** is selected.
5. **Add SSH keys:** choose **Paste public keys** and paste the contents of `~/.ssh/id_ed25519.pub`.
6. **Boot volume:** leave the default size.
7. Click **Create**. When the instance is **Running**, copy its **Public IP address**. This is `<SERVER_IP>`.
8. On the instance page, also copy the **OCID** (click **Copy** next to it). You need it in step A6.

### A5. Open the cloud firewall (Security List)

Oracle filters traffic before it reaches the machine.

1. On the instance page, click the **subnet** name under **Primary VNIC**.
2. Open **Security** (or **Security Lists**) → **Default Security List for ...** → **Ingress Rules** (or **Security rules**).
3. Make the rules exactly these three:

   | Source CIDR  | IP protocol | Destination port | Why                                  |
   | ------------ | ----------- | ---------------- | ------------------------------------ |
   | `<MY_IP>/32` | TCP         | 22               | SSH, from your computer only         |
   | `0.0.0.0/0`  | TCP         | 80               | HTTPS redirect and certificate check |
   | `0.0.0.0/0`  | TCP         | 443              | The system                           |

4. Edit or delete the default rule that allows port 22 from `0.0.0.0/0`. Leave the ICMP rules as they are.

If your home IP changes, update the port 22 rule here, and in the server firewall (step A10).

### A6. Create the backup storage

Nightly backups go, encrypted, to an Object Storage bucket. The machine itself is allowed to write there, so no cloud password is kept on the server.

1. **Create the bucket:** menu → **Storage** → **Buckets** → **Create bucket**.
   - Name: `tuition-backups`.
   - Storage tier: **Standard**.
   - Leave visibility **Private** and **Object versioning** off.
2. **Create a dynamic group** for the machine: menu → **Identity & Security** → **Domains** → your domain (usually **Default**) → **Dynamic groups** → **Create dynamic group**.
   - Name: `tuition-vm`.
   - Rule: `instance.id = '<the instance OCID from step A4>'`.
3. **Create a policy:** menu → **Identity & Security** → **Policies** → choose the compartment of the bucket → **Create policy**.
   - Name: `tuition-backups`.
   - Turn on **Show manual editor**, and paste (replace `<compartment>` with your compartment name; for the root compartment, use `in tenancy` instead of `in compartment <compartment>`):
     ```
     Allow dynamic-group tuition-vm to manage objects in compartment <compartment> where target.bucket.name = 'tuition-backups'
     ```
     If your domain is not "Default", write `dynamic-group '<domain>'/'tuition-vm'`.
4. **Optional:** on the bucket, add a **Lifecycle rule** that deletes objects older than 60 days. The backup script already keeps only the newest 30.

### A7. Copy the release to the server and sign in

On your computer, in the folder with the release files:

```bash
scp tuition-<VERSION>.tar.gz tuition-<VERSION>.tar.gz.sha256 ubuntu@<SERVER_IP>:/tmp/
ssh ubuntu@<SERVER_IP>
```

The first time, answer `yes` to the fingerprint question. All the following commands run **on the server**, unless a step says otherwise.

### A8. Prepare the server

```bash
sudo tar -C /tmp -xzf /tmp/tuition-<VERSION>.tar.gz
sudo /tmp/tuition-<VERSION>/deploy/scripts/server-setup.sh
```

The script:

- Installs Node.js 22, Nginx, certbot, age and automatic security updates.
- Adds 2 GB of swap (the machine has only 1 GB of memory).
- Creates the system user `tuition`, which cannot sign in.
- Creates the folders `/var/lib/tuition` (database), `/var/backups/tuition` (local backups) and `/etc/tuition` (settings).
- Installs the systemd services and timers, the log limits, and the Nginx files.

It takes a few minutes. It ends with "Next: edit /etc/tuition/tuition.env...".

### A9. Install the Oracle command-line tool (for uploading backups)

```bash
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/oracle/oci-cli/master/scripts/install/install.sh)" -- --accept-all-defaults --exec-dir /usr/local/bin --install-dir /opt/oci-cli
oci --version
```

It installs into `/usr/local/bin`, so the `tuition` user can run it. No configuration file is needed: the machine signs in as itself (the dynamic group from step A6).

If you skip this step, leave `OCI_BUCKET` empty in step A11. Backups then stay on the server only, which does not protect you if the server is lost.

### A10. Turn on the server firewall

```bash
sudo /tmp/tuition-<VERSION>/deploy/scripts/firewall.sh <MY_IP>
```

- Port 22 (SSH) is allowed from `<MY_IP>` only. Ports 80 and 443 are open to everyone. Everything else is blocked.
- The script first turns off the iptables rules that come with Oracle's Ubuntu image. They block ports 80 and 443, and conflict with `ufw`.

**Important:** before you close your current SSH window, open a **new** terminal and check that `ssh ubuntu@<SERVER_IP>` still works. If it does not, fix the rule from the open window: `sudo ufw allow from <MY_IP> to any port 22 proto tcp`.

### A11. Write the settings

**1. The main settings file.** First create the encryption key:

```bash
openssl rand -base64 32
```

Copy the output. **Save a copy outside the server**, in your password manager, next to the backup key. Without it, a restored backup opens but its encrypted fields cannot be read: saved card tokens, two-factor secrets, bank account numbers and connection passwords.

Then edit the file:

```bash
sudo nano /etc/tuition/tuition.env
```

Change these lines; leave the others as they are:

| Setting              | Value                                                                                                                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_ENCRYPTION_KEY` | The output of `openssl rand -base64 32`                                                                                                                                                                                                                                   |
| `APP_BASE_URL`       | `https://pay.school.example`, with no `/` at the end                                                                                                                                                                                                                      |
| `SMTP_URL`           | Your SMTP server, as `smtps://USER:PASSWORD@HOST:465` (or `smtp://USER:PASSWORD@HOST:587` for STARTTLS). Write `@` inside the user name as `%40`, e.g. `smtps://office%40school.org.il:app-password@smtp.gmail.com:465`. For Gmail and Microsoft 365, use an app password |
| `MAIL_FROM`          | The sender name and address, e.g. `מערכת גבייה <office@school.org.il>`. The address must be one your SMTP account may send from                                                                                                                                           |
| `ALERT_EMAIL`        | Where failure alerts go: a failed nightly run, a failed backup, a server that stopped answering                                                                                                                                                                           |

Save with Ctrl+O, Enter, and exit with Ctrl+X.

Leave `PAYMENT_PROVIDER=mock` as it is. Real card payments are turned on later, in the system's screens (Part B, step B11), through נדרים פלוס (Nedarim Plus).

**2. The backup settings.**

```bash
sudo nano /etc/tuition/backup.env
```

Set `OCI_BUCKET=tuition-backups`. Leave `OCI_BUCKET` empty if you skipped step A9.

**3. The backup public key.** Use the `age1...` line from step A2:

```bash
echo 'age1...' | sudo tee /etc/tuition/backup-recipients.txt
sudo chown root:tuition /etc/tuition/backup-recipients.txt
sudo chmod 0640 /etc/tuition/backup-recipients.txt
```

### A12. Point your domain to the server

1. At your domain's DNS provider, add an **A record**: name `pay` (or whatever subdomain you chose), value `<SERVER_IP>`.
2. Wait until it works. On your computer, `nslookup pay.school.example` should show `<SERVER_IP>`. This can take from a few minutes to an hour.

### A13. Get an HTTPS certificate

On the server (replace the domain and the email):

```bash
sudo systemctl stop nginx
sudo certbot certonly --standalone -d pay.school.example --agree-tos -m office@school.example \
  --pre-hook "systemctl stop nginx" --post-hook "systemctl start nginx"
```

- The certificate comes from Let's Encrypt and lasts 90 days.
- certbot renews it automatically. The hooks are saved, so on each renewal (about every 60 days) Nginx stops for a few seconds and starts again.

### A14. Turn on the website in Nginx

```bash
sudo sed -i 's/school.example/pay.school.example/g' /etc/nginx/sites-available/tuition.conf
sudo ln -s /etc/nginx/sites-available/tuition.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl start nginx
```

`nginx -t` must say "syntax is ok" and "test is successful". Opening the address now shows a gateway error (502), because the application is not installed yet. That is expected.

### A15. Install the application and create the first administrator

```bash
sudo /tmp/tuition-<VERSION>/deploy/scripts/release.sh /tmp/tuition-<VERSION>.tar.gz
```

`release.sh`:

1. Checks the archive against its `.sha256` file.
2. Takes a backup of the current version, if there is one.
3. Unpacks the release into `/opt/tuition/releases/`.
4. Updates the database structure.
5. Switches `/opt/tuition/current` to the new release and restarts the service.
6. Checks `/health`. If the new version does not answer, it switches back to the previous one.

It ends with `running tuition-<VERSION>`.

Now create the first administrator (use your own name and email):

```bash
sudo -u tuition node --env-file=/etc/tuition/tuition.env /opt/tuition/current/dist/cli/create-admin.js \
  --name "Your Name" --email you@school.example
```

It prints a **one-time invitation link**. Open it in your browser, and continue with Part B, step B1. No password is ever typed on the command line.

### A16. Check that everything works

On the server:

```bash
curl -fsS https://pay.school.example/health        # {"status":"ok",...}
systemctl status tuition --no-pager                # active (running)
systemctl list-timers 'tuition-*' --no-pager       # tuition-backup (nightly 03:30) and tuition-health (every 5 minutes)
sudo systemctl start tuition-backup                # a backup right now
ls -l /var/backups/tuition                         # a file tuition-<date>.db.age
```

If `OCI_BUCKET` is set, the same file now appears in the bucket in the Oracle console.

Check that the server comes back by itself after a restart:

```bash
sudo reboot
```

Wait a minute, then on your computer: `curl -fsS https://pay.school.example/health`.

Check the open ports from your computer, if you have `nmap`: `nmap -Pn pay.school.example`. Only 22, 80 and 443 should be open, and 22 only from your IP. Port 3000 must not be reachable from outside: the application listens on 127.0.0.1 only.

### A17. Test a restore (do this once, before you rely on the backups)

A backup is useful only if it can be restored. On your own computer (Linux or macOS with Node 22 and age), or on a spare virtual machine:

1. Download a backup file (`tuition-<date>.db.age`) from the bucket, in the Oracle console: bucket → the object → **Download**.
2. Unpack the same release archive: `tar -xzf tuition-<VERSION>.tar.gz`.
3. Make a local settings file `tuition.env` with the **same** `APP_ENCRYPTION_KEY` as the server.
4. Run:
   ```bash
   APP_DIR=./tuition-<VERSION> APP_ENV_FILE=./tuition.env \
     ./tuition-<VERSION>/deploy/scripts/verify-restore.sh tuition-<date>.db.age tuition-backup-key.txt
   ```

The script decrypts the backup into a temporary folder and checks it:

- the SQLite structure and the foreign keys;
- the hash chain of the audit log;
- gap-free receipt numbers;
- every payment fully allocated and with its document.

Then it starts a copy of the server on the backup and asks it for `/health`.

### A18. Day-to-day operation

| Task                                      | How                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Install a new version**                 | Copy the new archive and its `.sha256` to `/tmp` (step A7), then run `release.sh` (step A15)                                                                                                                                                                                                                       |
| **Restore a backup over the live system** | `sudo /opt/tuition/current/deploy/scripts/restore.sh <backup>.db.age <private-key-file>`. It asks you to type RESTORE, and keeps the old database next to it as `tuition.db.before-restore-<date>`. Copy the private key to the server only for this, and delete it right after with `shred -u <private-key-file>` |
| **Read the logs**                         | `journalctl -u tuition` (the application), `journalctl -u tuition-backup` (backups). Logs are kept up to 300 MB and 90 days                                                                                                                                                                                        |
| **Email alerts**                          | Sent to `ALERT_EMAIL` for a failed nightly run, a failed backup, and a server that does not answer twice in a row (with another email when it is back)                                                                                                                                                             |
| **Operating system updates**              | Security updates install automatically (`unattended-upgrades`)                                                                                                                                                                                                                                                     |
| **Your IP changed**                       | Update the port 22 rule in the Security List (step A5) and on the server run `sudo ufw allow from <NEW_IP> to any port 22 proto tcp`. If SSH is already blocked, use the instance's **Console connection** in the Oracle console                                                                                   |

## Part B: Set up the system and load your data

Do the steps in this order. All screens are in the menu on the right side. Each step names the Hebrew screen, then its meaning in English.

### B1. First sign-in of the administrator

1. Open the invitation link from step A15.
2. Choose a password, at least 10 characters.
3. Set up two-factor authentication. Scan the QR code with an authenticator app: Google Authenticator, Microsoft Authenticator, or similar. Then type the 6-digit code.
4. **Save the 10 recovery codes** in a safe place. They are the only way in if you lose the phone.

From now on, you sign in at `https://pay.school.example` with your email, password and the 6-digit code.

### B2. School settings

**הגדרות וחיבורים** (Settings and connections) → **כללי** (General) → **עריכת הגדרות** (Edit settings):

| Field (Hebrew)                  | Meaning                                                                                                                                                               |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| שם בית הספר                     | School name. Shown on receipts, statements and messages                                                                                                               |
| הנחת אחים - ילד שני (%)         | Sibling discount for the second child, in percent                                                                                                                     |
| הנחת אחים - ילד שלישי ואילך (%) | Sibling discount for the third child and on                                                                                                                           |
| עמלת שיק חוזר (₪)               | Fee for a bounced check                                                                                                                                               |
| שעת הרצת חיובים אוטומטית        | The time of the nightly run: plan charges, reminders, and the month-end private lesson charges                                                                        |
| תדירות גיבוי                    | Backup frequency. The server backs up every night at 03:30. For weekly backups, also change the server's timer, as described in `deploy/systemd/tuition-backup.timer` |
| כיתות לפי הסדר, מופרדות בפסיק   | Grades in order, separated by commas, e.g. `א', ב', ג', ד', ה', ו', ז', ח'`. The last grade is the graduating grade: when a new year opens, its students graduate     |

Sibling discounts are calculated automatically for each family.

**Security settings:** **הגדרות וחיבורים** → **אבטחה** (Security) → **עריכת הגדרות אבטחה** (Edit security settings): required two-factor authentication, sign-out after inactivity, minimum password length, and lockout after failed attempts. The same screen lists the recent sign-in events.

### B3. Users and permissions

**משתמשים והרשאות** (Users and permissions) → **משתמש חדש** (New user): name, email and role. The new user gets an invitation email, sets a password and sets up two-factor authentication.

| Role (Hebrew) | Meaning       | Allowed                                                                                   |
| ------------- | ------------- | ----------------------------------------------------------------------------------------- |
| מנהל מערכת    | Administrator | Everything                                                                                |
| גבייה         | Collections   | Students, payments, charges, cards, plans, checks, receipts, messages and parent requests |
| קופאית        | Cashier       | View students, take payments, checks and cash drawer, receipts                            |
| הנהלת חשבונות | Bookkeeping   | View, receipts, reports, bank, checks                                                     |
| צפייה בלבד    | View only     | View students and families                                                                |

You can also tick individual permissions; the role then shows as מותאם אישית (custom). Permissions are enforced on the server, not only on screen.

### B4. Charge catalog

**חיובים והנחות** (Charges and discounts) → **קטלוג חיובים** (Charge catalog) → **פריט חדש** (New item).

Add the items that repeat every year, such as registration fees, transport, trips and books. Each item has a default amount and a type. When you make a group charge, you choose an item from this catalog.

### B5. Private lessons with tutors (אברכים)

**הגדרות וחיבורים** → **שיעורים פרטיים** (Private lessons):

1. **The subject list**, separated by commas, e.g. `גמרא, משנה, חומש, קריאה, חשבון, אנגלית`.
2. **אברך חדש** (New tutor): name and phone.
   - When a tutor stops, mark them לא פעיל (inactive). Their past lessons are kept.

Lessons are added to each student in step B7.

### B6. Load the students from Excel

**תלמידים ומשפחות** (Students and families) → **ייבוא מאקסל** (Import from Excel).

The file is `xlsx` or `csv`, with a header row. The header names must be in Hebrew, as in the right-hand column:

| Column       | Required                     | Accepted header names                                                                                            |
| ------------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Student name | Yes                          | שם תלמיד, שם התלמיד, תלמיד, שם                                                                                   |
| Grade        | Yes                          | כיתה. The value must be one of the grades from step B2                                                           |
| Parent name  | Yes                          | שם הורה, הורה, שם ההורה                                                                                          |
| Phone        | Yes                          | טלפון, נייד, טלפון הורה                                                                                          |
| Email        | No, but strongly recommended | אימייל, מייל, דוא"ל, דואר אלקטרוני                                                                               |
| Address      | No                           | כתובת                                                                                                            |
| Tuition      | No                           | שכר לימוד, סכום. Rows without an amount get the amount you type in the import screen (שכר לימוד לשורות בלי סכום) |

- **Families:** students with the same phone number go into the same family, and the sibling discount is calculated automatically.
- **Errors:** at the end you get a report. A row with an error is not imported. Fix the file and import it again; rows that were already imported are not added twice.
- **A single student:** **תלמיד חדש** (New student) on the same screen.
- **Why email matters:** without an email, the parent gets no receipts or reminders (unless voice calls are connected, step B10), and can sign in to the portal only with a code by phone call.

### B7. Charges, discounts and private lessons

- **Annual tuition** is charged by the import (step B6) or by opening the school year (step B8).
- **Group charge:** **חיובים והנחות** → **חיוב קבוצתי** (Group charge). Choose a catalog item and a grade (or everyone). A preview shows exactly who will be charged before you confirm.
- **Charge one student:** **חיוב לתלמיד** (Charge a student).
- **Discount or scholarship:** **הנחה / מלגה** (Discount / scholarship), as a percent or an amount, with a reason and an internal note. The internal note does not appear on the parent's statement.
- **Private lesson:** open the student card → **הוספת שיעור פרטי** (Add private lesson). Choose the tutor, the subject and the monthly price.
  - On the last day of each month, the system charges the full month for each active lesson.
  - The lesson appears on the receipt as its own item, e.g. "שיעור פרטי: משנה · <tutor> · 10/2026".
  - When the lesson ends: **סיום** (End) next to the lesson. The month of the end date is still charged.
- **Cancelling:** a charge is never deleted. Cancelling records an opposite entry, so the history stays complete.

### B8. Open the school year

**הגדרות וחיבורים** → **שנת לימודים** (School year) → **פתיחת שנת לימודים חדשה** (Open a new school year).

1. Enter the year name (e.g. תשפ״ח), the annual tuition per student, and the charge date.
2. **המשך** (Continue) shows a preview: who moves up a grade and who graduates. Nothing has changed yet.
3. **אישור והפעלה** (Confirm and run): the students move up a grade and the tuition is charged.

The same year cannot be opened twice.

### B9. Email

The SMTP server was set on the server in step A11.

**הגדרות וחיבורים** → **חיבורים** (Connections) → **דואר אלקטרוני** (Email) → **בדיקת חיבור** (Test connection). The system checks the SMTP server and sends a test email to you. If it fails, the message says why; fix `SMTP_URL` in `/etc/tuition/tuition.env` and run `sudo systemctl restart tuition`.

### B10. Voice calls through ימות המשיח (Yemot HaMashiach), instead of SMS

Optional. You need a ימות המשיח account.

1. **חיבורים** → **שיחות קוליות (ימות המשיח)** (Voice calls) → **הגדרה** (Set up):
   - **מספר המערכת בימות המשיח:** your system number.
   - **סיסמת המערכת:** its password.
   - **מספר מזוהה להורים:** the caller ID parents see (optional).
   - **מצב** (Mode): **בדיקה** (Test). No calls are made in test mode.
2. **בדיקת חיבור** (Test connection) checks the user name and password without calling anyone.
3. Make a test family with your own phone number, and send it a statement by voice call.
4. If the call arrived and sounded right: **ניתוק** (Disconnect), then **הגדרה** again with **מצב** set to **ייצור** (Production).
5. From then on, reminders and portal sign-in codes that would have been SMS are read aloud to parents in a call. Links are not read; they go by email or are shown in the portal.

If the test says "תשובה לא צפויה" (unexpected answer), the provider answered in a format the system does not expect. Do not switch to production; send the message you see so it can be adjusted.

### B11. Card payments through נדרים פלוס (Nedarim Plus)

Optional. You need a נדרים פלוס account. Until it is connected, card payments run on the built-in test provider, and no card is ever charged.

1. **In the נדרים פלוס back office:** find your **institution number** (מספר מוסד) and your **ApiValid** key (under API keys).
2. **חיבורים** → **חברת סליקה** (Card processor) → **הגדרה**:
   - **מספר מוסד בנדרים פלוס:** the institution number.
   - **ApiValid:** the key.
   - **מצב:** **ייצור** (Production).
3. **Make a ₪1 test payment:**
   1. Create a test family.
   2. Open its card → **קבלת תשלום** (Take payment) → amount ₪1 → **אמצעי תשלום** (Payment method): אשראי (card) → **המשך**.
   3. Type your own card into the נדרים פלוס form and press **חיוב** (Charge).
   4. **It works** if the receipt shows "נדרים פלוס · \*\*\*\*1234 · אישור …". Cancel the test receipt with a credit note (זיכוי), and refund the ₪1 in the נדרים פלוס back office.
   5. **If it stays on "not yet confirmed"**, our server did not get, or did not understand, נדרים פלוס's confirmation. Look in `journalctl -u tuition`:
      - "nedarim callback from an address not allowed": the confirmation came from another address. Put the address נדרים פלוס publishes in `NEDARIM_CALLBACK_IPS` in `/etc/tuition/tuition.env`, and run `sudo systemctl restart tuition`.
      - "nedarim callback without Param1": the field names differ. The log shows the field names only, without values. Send them so the integration can be adjusted.

**How it works:**

- The card number and CVV are typed into נדרים פלוס's own form inside the page. They never pass through this system.
- A payment counts only when נדרים פלוס's server confirms it to our server, from their address and for the exact amount. Only then is a receipt created and sent to the parent.
- Parents pay with the same form from the parent portal.

**What is turned off while נדרים פלוס is connected:**

- Saved cards, and payment plans charged to a saved card. They would pass the card through our server.
- For installments, use plans paid by bank transfer, check or standing order (הוראת קבע), or charge the card each time in the form.

### B12. SMS, WhatsApp and bookkeeping

- **SMS and WhatsApp are not used.** SMS is replaced by voice calls (step B10), and WhatsApp by email. In the connections screen they show as לא בשימוש (not in use).
- **Bookkeeping:** **דוחות** (Reports) → **ייצוא לאקסל (CSV)** (Export to Excel).

### B13. Bank and standing orders

**בנק והוראות קבע** (Bank and standing orders):

- **ייבוא דף בנק** (Import bank statement): a csv or xlsx file from your bank, with date, description, credit and reference columns.
  - The system suggests which family each credit belongs to. Confirm the suggestion, or assign the credit by hand.
  - A transaction that was already imported is not imported again.
- **Standing orders:** in the student card → **תוכנית חיוב** (Billing plan), choose the standing order method.
- **Masav file:** **הפקת קובץ מס״ב** (Create Masav file), up to a charge date.
  - **Note:** until the bank's official file format and your institution code arrive (question א7 in `docs/OPEN_QUESTIONS.md`), the file is a demo marked "לא לשליחה" (not for sending). Do not send it to the bank.

### B14. The parent portal

- **Sign-in:** parents go to `https://pay.school.example/portal` and type the phone or email the school has for them. They get a one-time code by email, or by voice call.
- **What parents see:** the balance, receipts and the statement.
- **What parents can do:** pay by card; ask for a discount, an installment arrangement or a call back.
- **For staff:** **פורטל הורים (תצוגה)** (Parent portal preview) shows the portal exactly as a chosen family sees it, read-only.
- **Parent requests** arrive at **בקשות הורים** (Parent requests).

### B15. The routine

| When                       | What                                                                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Every day                  | **לוח בקרה** (Dashboard): debts, failed charges and parent requests. **שיקים וקופה** (Checks and cash drawer): open and close the cash drawer |
| Every night, automatically | Plan charges, reminders, backup. On the last day of the month: private lessons                                                                |
| Every week                 | Import the bank statement and assign its transactions                                                                                         |
| As needed                  | **גבייה והודעות** (Collections and messages): debtor list, reminders by email or call. **בקשות הורים**: discounts, arrangements and payments  |
| End of year                | **דוחות** → **ייצוא לאקסל (CSV)** for the bookkeeper, then open the new year (step B8)                                                        |

---

## פיתוח

**דרישות:** Node.js 22 ו-pnpm 10 (`corepack enable`).

```bash
pnpm install
cp .env.example .env
# ב-.env: למלא APP_ENCRYPTION_KEY עם הפלט של:  openssl rand -base64 32
pnpm --filter @tuition/server db:migrate
pnpm --filter @tuition/server create-admin -- --name "שם המנהל" --email admin@example.com
pnpm dev
```

- `create-admin` מדפיס קישור הזמנה חד-פעמי. פותחים אותו ב-http://localhost:5173, קובעים סיסמה ומגדירים אימות דו-שלבי.
- במצב פיתוח המיילים לא נשלחים. הם נשמרים בטבלה `Outbox` במסד.

**בדיקות:**

```bash
pnpm lint
pnpm typecheck
pnpm test     # Vitest: יחידה ואינטגרציה, כל קובץ על מסד SQLite זמני
pnpm e2e      # Playwright: בונה את האתר ומריץ שרת בדיקה על מסד נקי
```

בדיקת ארכיון הגרסה והגיבויים (דורשת `age`): `deploy/test/release-roundtrip.sh`

**מבנה:**

```
apps/server     Fastify + Prisma (SQLite, WAL)
apps/web        React + Vite
packages/shared הרשאות, תפקידים, סכמות Zod וטיפוסים משותפים
deploy/         systemd, Nginx, סקריפטים לגיבוי, שחזור, בדיקת תקינות והתקנת גרסה
docs/           תוכנית, שאלות, סיכומי שלבים, ההדגמה
```
