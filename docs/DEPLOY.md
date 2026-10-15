# התקנה בשרת: מדריך צעד אחר צעד

המדריך מתקין את המערכת על מכונה של Oracle Cloud מסוג VM.Standard.E2.1.Micro, עם Ubuntu 24.04 ומסד SQLite (ד1).

**מה עושים בעצמך:** כל הפעולות בחשבון הענן, בשרת ובדומיין. אף אחת מהן לא בוצעה מכאן.

בכל מקום שכתוב `school.example`, החליפו בדומיין שלכם (ד2).

## מה צריך לפני שמתחילים

- **חשבון Oracle Cloud,** ודומיין שבו אפשר להוסיף רשומת DNS.
- **שירות מייל יוצא (SMTP)**, למשל המייל של בית הספר. **זה הערוץ היחיד שלכם להורים** (שלב 9): קבלות, תזכורות וקודי הכניסה לפורטל יוצאים במייל.
- **כתובת ה-IP הציבורית שלכם,** שממנה תתחברו ב-SSH.
- **`age` במחשב שלכם.** יוצרים מפתח גיבוי:
  ```bash
  age-keygen -o tuition-backup-key.txt
  ```
  הקובץ הזה הוא **המפתח הפרטי**. הוא נשאר רק אצלכם, במנהל סיסמאות או בכונן מוצפן, ולעולם לא עולה לשרת (ד4). בלעדיו אי אפשר לשחזר אף גיבוי.
  השורה `public key: age1...` שמודפסת היא **המפתח הציבורי**, והוא זה שיעלה לשרת.
- **ארכיון גרסה** `tuition-<גרסה>.tar.gz`. בכל push ה-CI בונה אותו (ב-GitHub: Actions ← הריצה ← Artifacts ← `release`). אפשר גם לבנות במחשב Linux עם `deploy/scripts/package.sh`. לא בונים על השרת: 1GB לא מספיק לבנייה (ד3).

## 1. יצירת המכונה

ב-Oracle Cloud: Compute ← Instances ← Create instance.
- **Image:** Canonical Ubuntu 24.04. **Shape:** VM.Standard.E2.1.Micro.
- **רשת:** VCN חדש עם subnet ציבורי ו-"Assign a public IPv4 address".
- **SSH:** מדביקים את המפתח הציבורי שלכם (`~/.ssh/id_ed25519.pub`).

## 2. חומת האש בענן (Security List)

ב-VCN ← Security Lists ← Default ← Ingress Rules, משאירים **רק** את שלושת אלה:

| מקור | פורט | למה |
|---|---|---|
| ה-IP שלכם בלבד (`x.x.x.x/32`) | 22/TCP | SSH |
| `0.0.0.0/0` | 80/TCP | הפניה ל-HTTPS ואימות תעודה |
| `0.0.0.0/0` | 443/TCP | המערכת |

את כלל ברירת המחדל של SSH מכל העולם (`0.0.0.0/0` לפורט 22) מוחקים.

## 3. אחסון הגיבויים (Object Storage)

1. **Storage ← Buckets ← Create bucket:** בשם `tuition-backups`, עם Private, ועם Object Versioning כבוי.
2. **Identity ← Dynamic Groups ← Create:** בשם `tuition-vm`, עם הכלל `instance.id = '<ה-OCID של המכונה>'`.
3. **Identity ← Policies ← Create:** מוסיפים את השורה הבאה (מחליפים `<compartment>` בשם שלכם):
   ```
   Allow dynamic-group tuition-vm to manage objects in compartment <compartment> where target.bucket.name = 'tuition-backups'
   ```
   כך המכונה עצמה רשאית לכתוב לדלי, ואין על השרת קובץ מפתח של הענן.
4. **אופציונלי:** כלל Lifecycle שמוחק אובייקטים אחרי 60 יום, כגיבוי נוסף לשמירת 30 הגיבויים שהסקריפט עושה בעצמו.

## 4. הכנת השרת

```bash
scp tuition-<גרסה>.tar.gz* ubuntu@<IP>:/tmp/
ssh ubuntu@<IP>
sudo tar -C /tmp -xzf /tmp/tuition-<גרסה>.tar.gz
sudo /tmp/tuition-<גרסה>/deploy/scripts/server-setup.sh
```

**מה הסקריפט מתקין:** Node.js 22, ‏Nginx, ‏certbot, ‏age ועדכוני אבטחה אוטומטיים.

**מה הוא מכין:**
- swap בנפח 2GB.
- המשתמש `tuition`, שאין לו כניסה למערכת.
- התיקיות `/var/lib/tuition` (מסד הנתונים) ו-`/var/backups/tuition`.
- קבצי השירות של systemd.

את ה-OCI CLI להעלאת הגיבויים מתקינים לפי [ההוראות של Oracle](https://docs.oracle.com/iaas/Content/API/SDKDocs/cliinstall.htm), או לפי הפקודה הבאה. הפקודה מתקינה ל-`/usr/local/bin`, כדי שהמשתמש `tuition` יוכל להריץ:
```bash
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/oracle/oci-cli/master/scripts/install/install.sh)" -- --accept-all-defaults --exec-dir /usr/local/bin --install-dir /opt/oci-cli
```

## 5. חומת האש בשרת

```bash
sudo /tmp/tuition-<גרסה>/deploy/scripts/firewall.sh <ה-IP-שלכם>
```
הסקריפט פותח SSH רק מה-IP שלכם, ואת 80 ו-443 לכולם. כל השאר חסום.

לפני כן הוא מכבה את כללי ה-iptables שמגיעים עם תמונת ה-Ubuntu של Oracle, כי הם חוסמים את 80 ו-443 ומתנגשים עם ufw.

**חשוב:** לפני שסוגרים את ה-SSH הנוכחי, פותחים חיבור SSH חדש ומוודאים שהוא עובד.

## 6. הגדרות

**`/etc/tuition/tuition.env`:**
```bash
openssl rand -base64 32        # → APP_ENCRYPTION_KEY
sudo nano /etc/tuition/tuition.env
```
- `APP_ENCRYPTION_KEY`: הערך שנוצר.
  **שמרו עותק שלו גם אצלכם** (מנהל סיסמאות), ליד מפתח הגיבוי. בלעדיו, גיבוי משוחזר נפתח, אבל השדות המוצפנים לא נקראים: טוקני כרטיסים, סודות האימות הדו-שלבי ומספרי חשבון.
- `APP_BASE_URL=https://school.example`
- `SMTP_URL`, ‏`MAIL_FROM` ו-`ALERT_EMAIL`: לאן נשלחות התראות כשהרצה לילית, גיבוי או השרת נכשלים (ד2).
  אחרי ההתקנה: הגדרות וחיבורים ← חיבורים ← "דואר אלקטרוני" ← בדיקת חיבור. המערכת בודקת את שרת ה-SMTP ושולחת אליכם מייל בדיקה.
- **שיחות קוליות (ימות המשיח), במקום SMS:** הגדרות וחיבורים ← חיבורים ← "שיחות קוליות (ימות המשיח)" ← הגדרה.
  1. מזינים את מספר המערכת, הסיסמה, ומספר מזוהה אם רוצים. הפרטים נשמרים מוצפנים.
  2. מתחילים ב**מצב בדיקה** ולוחצים "בדיקת חיבור". המערכת בודקת את פרטי הכניסה בלי לחייג.
  3. שולחים לעצמכם דף חשבון "בשיחה קולית" ממשפחת בדיקה עם הטלפון שלכם. אם ימות המשיח עונה בפורמט אחר מהצפוי, תופיע ההודעה "תשובה לא צפויה". במקרה כזה פנו אליי לפני שעוברים לייצור.
  4. רק אחרי שהשיחה הגיעה ונשמעה כמו שצריך, עוברים ל**מצב ייצור**. מאז, מה שהיה SMS מוקרא להורים בשיחה.
  5. השרת צריך לצאת ל-`https://www.call2all.co.il` בפורט 443 (חומת האש מאפשרת יציאה כברירת מחדל).
- **סליקת אשראי (נדרים פלוס):** `PAYMENT_PROVIDER=mock` נשאר כמו שהוא. זה הספק הפנימי, עד שמחברים את נדרים פלוס במסך החיבורים. כל עוד נדרים פלוס לא מחובר במצב ייצור, לא מתבצע שום חיוב אמיתי.
  1. בממשק נדרים פלוס לוקחים את **מספר המוסד** ואת **ה-ApiValid** (מפתחות API).
  2. בדקו שהשרת עונה ב-HTTPS בכתובת `APP_BASE_URL`. נדרים פלוס שולחים את אישור התשלום ל-`https://<הדומיין>/api/webhooks/nedarim`.
  3. הגדרות וחיבורים ← חיבורים ← "חברת סליקה" ← הגדרה: מספר מוסד, ‏ApiValid, ו**מצב ייצור**.
  4. **תשלום ניסיון של ₪1:**
     1. יוצרים משפחת בדיקה.
     2. קבלת תשלום ← ₪1 ← אשראי.
     3. מקלידים כרטיס שלכם בטופס של נדרים פלוס ולוחצים "חיוב".
  5. **אם נוצרה קבלה עם "נדרים פלוס · ****1234 · אישור …",** החיבור עובד. מבטלים את קבלת הניסיון בזיכוי, ומחזירים את ה-₪1 בממשק נדרים פלוס.
  6. **אם התשלום נשאר "עוד לא אישרו",** השרת לא קיבל או לא הבין את אישור התשלום. בודקים ב-`journalctl -u tuition`:
     - "nedarim callback from an address not allowed": האישור הגיע מכתובת אחרת מהצפוי. מעדכנים את `NEDARIM_CALLBACK_IPS` ב-`tuition.env` לפי הכתובת שנדרים פלוס מפרסמים, ומפעילים מחדש.
     - "nedarim callback without Param1": שמות השדות שונים מהצפוי. ביומן מופיעים שמות השדות בלבד, בלי ערכים. שלחו לי אותם ואתאים.
  7. **שימו לב:** עם נדרים פלוס כבויים שמירת כרטיסים ותוכניות חיוב בכרטיס שמור. הם היו מעבירים את הכרטיס דרך השרת שלנו.

**`/etc/tuition/backup.env`:** ממלאים `OCI_BUCKET=tuition-backups`. את המפתח הציבורי של age מכניסים לקובץ:
```bash
echo 'age1...' | sudo tee /etc/tuition/backup-recipients.txt
sudo chown root:tuition /etc/tuition/backup-recipients.txt && sudo chmod 0640 /etc/tuition/backup-recipients.txt
```

## 7. דומיין ותעודת HTTPS

1. **ב-DNS** של הדומיין מוסיפים רשומת `A`: מ-`school.example` ל-IP של המכונה.
2. **תעודה** מ-Let's Encrypt. ה-hooks נשמרים לחידושים, ובכל חידוש (פעם ב-60 יום בערך) Nginx נעצר לכמה שניות:
   ```bash
   sudo systemctl stop nginx
   sudo certbot certonly --standalone -d school.example --agree-tos -m office@school.example \
     --pre-hook "systemctl stop nginx" --post-hook "systemctl start nginx"
   ```
3. **אתר ב-Nginx:**
   ```bash
   sudo sed -i 's/school.example/<הדומיין-שלכם>/g' /etc/nginx/sites-available/tuition.conf
   sudo ln -s /etc/nginx/sites-available/tuition.conf /etc/nginx/sites-enabled/
   sudo rm -f /etc/nginx/sites-enabled/default
   sudo nginx -t && sudo systemctl start nginx
   ```

## 8. התקנת הגרסה ומנהל המערכת הראשון

```bash
sudo /tmp/tuition-<גרסה>/deploy/scripts/release.sh /tmp/tuition-<גרסה>.tar.gz
sudo -u tuition node --env-file=/etc/tuition/tuition.env /opt/tuition/current/dist/cli/create-admin.js \
  --name "<שם>" --email <המייל-שלכם>
```

**`release.sh`** מבצע לפי הסדר:
1. גיבוי של הגרסה הקודמת, אם יש.
2. פריסה ל-`/opt/tuition/releases/`.
3. עדכון מבנה המסד.
4. החלפת `current` והפעלה מחדש.
5. בדיקת `/health`.

אם הגרסה החדשה לא עונה, הסקריפט חוזר לגרסה הקודמת.

**`create-admin`** מדפיס קישור הזמנה חד-פעמי. בקישור קובעים סיסמה ומגדירים אימות דו-שלבי. אף סיסמה לא עוברת בשורת הפקודה.

## 9. בדיקות קבלה

```bash
curl -fsS https://school.example/health              # {"status":"ok",...}
systemctl list-timers 'tuition-*'                   # גיבוי יומי ובדיקת תקינות כל 5 דקות
sudo systemctl start tuition-backup && ls -l /var/backups/tuition
sudo reboot                                         # ואחרי דקה:
curl -fsS https://school.example/health             # השרת עלה מעצמו
```

**הפורטים הפתוחים:** מהמחשב שלכם בודקים ש-22, 80 ו-443 בלבד פתוחים, ו-22 רק מה-IP שלכם (`nmap -Pn school.example`). פורט 3000 לא נגיש מבחוץ, כי השרת מאזין רק ל-127.0.0.1.

**שחזור על מכונה נקייה:** מורידים גיבוי מהדלי, ובמחשב או ב-VM חדש עם Node 22 ו-age, פורסים את ארכיון הגרסה ומריצים:
```bash
APP_DIR=./tuition-<גרסה> APP_ENV_FILE=./tuition.env \
  ./tuition-<גרסה>/deploy/scripts/verify-restore.sh tuition-<תאריך>.db.age tuition-backup-key.txt
```
הסקריפט:
1. מפענח את הגיבוי לתיקייה זמנית.
2. בודק שלמות: מבנה SQLite, מפתחות זרים, שרשרת ה-hash של היומן, מספור רציף של קבלות, וכל תשלום מוקצה במלואו ויש לו מסמך.
3. מפעיל עותק של השרת על הגיבוי ושואל אותו `/health`.

ב-`tuition.env` המקומי צריך אותו `APP_ENCRYPTION_KEY`.

## עבודה שוטפת

- **גרסה חדשה:** מעתיקים את הארכיון ומריצים את `release.sh` (צעד 8).
- **שחזור** (מחליף את המסד החי, ומבקש להקליד RESTORE):
  ```bash
  sudo /opt/tuition/current/deploy/scripts/restore.sh <גיבוי>.db.age <מפתח-פרטי>
  ```
  המסד הקודם נשמר לידו בשם `tuition.db.before-restore-<תאריך>` ולא נמחק. את המפתח הפרטי מעלים לשרת רק לזמן השחזור ומוחקים מיד אחריו (`shred -u`).
- **לוגים:**
  - `journalctl -u tuition` (השרת), ‏`journalctl -u tuition-backup` (הגיבויים).
  - הלוגים מוגבלים ל-300MB ול-90 יום.
  - ביומן הגישה של Nginx לא נשמרות מחרוזות שאילתה (בקישורי הפורטל יש טוקן חתום).
- **התראות במייל:**
  - הרצה לילית שנכשלה.
  - גיבוי שנכשל.
  - שרת שלא עונה פעמיים ברציפות, והודעה נוספת כשהוא חוזר.
- **עדכוני אבטחה** של מערכת ההפעלה מותקנים אוטומטית (`unattended-upgrades`).
