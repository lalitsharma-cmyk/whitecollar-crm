# Database Backup → Google Drive — one-time setup

The CRM now backs itself up **automatically every day**: a complete copy of the
whole database is `pg_dump`-ed, zipped, and uploaded to **Google Drive**, keeping
the **last 30 daily** + **last 12 monthly** copies, and emailing the admins
success/failure. It runs on GitHub Actions (free), separate from the website.

It needs **3 secrets** added **once**. Until they're set, the job skips quietly.
Add them at: **GitHub → your repo `lalitsharma-cmyk/whitecollar-crm` → Settings →
Secrets and variables → Actions → New repository secret.**

---

## Secret 1 — `BACKUP_DATABASE_URL`  (the database to back up)
1. Open **console.neon.tech** → your project **whitecollar-crm**.
2. On the dashboard, click **Connect** / **Connection Details**.
3. Choose **Direct connection** (NOT "Pooled"), and copy the full string. It looks like:
   `postgresql://USER:PASSWORD@ep-...neon.tech/neondb?sslmode=require`
4. In GitHub, add a secret named **`BACKUP_DATABASE_URL`** and paste it as the value.

## Secret 2 + 3 — Google Drive access (`GDRIVE_RCLONE_TOKEN`, `GDRIVE_FOLDER_ID`)
We use **rclone** (a free tool) to talk to Drive. Do this once on any computer:

1. **Install rclone**: download from **https://rclone.org/downloads/** (Windows: the
   `.exe`), or on a Mac/Linux run `curl https://rclone.org/install.sh | sudo bash`.
2. Open a terminal/command prompt and run:
   ```
   rclone authorize "drive"
   ```
3. It opens your browser → **log into your Google account** (lalitsharma@whitecollarrealty.com)
   → click **Allow**.
4. Back in the terminal it prints a token that looks like:
   `{"access_token":"ya29...","refresh_token":"1//...","expiry":"..."}`
   **Copy that whole `{...}` line.**
5. In GitHub, add a secret named **`GDRIVE_RCLONE_TOKEN`** and paste that `{...}` token.
6. In **Google Drive**, create a folder named **`WCR-CRM-Backups`**. Open it. The
   browser URL ends with `…/folders/XXXXXXXXXXXX` — copy that `XXXX…` id.
7. In GitHub, add a secret named **`GDRIVE_FOLDER_ID`** and paste that folder id.

## Secret 4 — `CRON_SECRET`  (already set)
This is the same secret the other scheduled jobs already use. If it's there, you're
done. (If not: GitHub secret `CRON_SECRET` = the same value as the `CRON_SECRET`
environment variable in Vercel.)

---

## Test it
GitHub → **Actions** tab → **"Database backup (daily → Google Drive)"** → **Run
workflow**. In ~1 minute you should see a file appear in `WCR-CRM-Backups/daily/`
in Drive, and an **"✅ Database backup completed"** notification + email to admins.

## To restore from a backup (if ever needed)
Download the `.sql.gz` from Drive, then:
```
gunzip -c wcr-backup-YYYY-MM-DD.sql.gz | psql "YOUR_DATABASE_URL"
```
(restore into a fresh/empty database, or a new Neon branch, to be safe).

## What's backed up
The **entire database** — every table (leads, activities, remarks, HR candidates &
resumes, projects, properties, settings, everything). It's a true full export, not
a partial one. Schedule: daily 02:30 IST. Retention: 30 daily + 12 monthly.
