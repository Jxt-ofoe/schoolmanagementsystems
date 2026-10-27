# 🛡️ Database Backup & Disaster Recovery Guide

This guide details the complete backup architecture and disaster recovery procedures for the School Management System.

---

## 1. Quick Commands Reference

| Command | Description | Output Location |
| :--- | :--- | :--- |
| `npm run db:backup` | Takes a full, live snapshot of all tables, schema, and relations. | `backups/backup-<timestamp>/` |
| `npm run db:restore` | Restores the latest backup archive into the active or backup database. | Supabase / PostgreSQL |
| `npm run db:schema` | Recompiles all migrations into a unified master SQL schema file. | `supabase/full_schema_backup.sql` |

---

## 2. Backup Archive Structure

Every time `npm run db:backup` is executed, an immutable, timestamped folder is generated inside `backups/`:

```
backups/
├── backup-2026-10-27T13-02-32/
│   ├── manifest.json       # Record counts, timestamp, source URL, and duration
│   ├── schema.sql          # Complete DDL: tables, indexes, triggers, RLS, functions
│   ├── data.sql            # Master SQL file with all PostgreSQL INSERT statements
│   └── tables/
│       ├── schools.json
│       ├── schools.sql
│       ├── classes.json
│       ├── classes.sql
│       ├── students.json
│       ├── students.sql
│       └── ... (all 29 tables)
└── latest/
    ├── latest_backup.txt   # Pointer to the most recent backup folder
    └── manifest.json       # Copy of latest manifest for quick inspection
```

---

## 3. How to Set Up a Standby / Backup Database (100% Free on Supabase)

If you want a **live secondary database ready to take over at any time**, follow these steps:

### Step 1: Create a New Supabase Project
1. Log into [supabase.com](https://supabase.com/dashboard).
2. Click **New Project** and name it (e.g., `school-ms-backup` or `school-ms-standby`).
3. Set a strong database password and select your preferred region.

### Step 2: Initialize the Backup Database Schema
1. In your new backup project's dashboard, go to the **SQL Editor**.
2. Open the file `supabase/full_schema_backup.sql` from this repository.
3. Paste its entire contents into the SQL Editor and click **Run**.
4. This creates all tables, views, foreign keys, triggers, security policies, and RPC functions in seconds.

### Step 3: Populate the Backup Database
Run the restore script pointing to your new backup project:

```bash
node scripts/restore-db.cjs \
  --target-url=https://<your-backup-project-id>.supabase.co \
  --target-key=<your-backup-project-service-role-key>
```

Your backup project now contains an exact 1-to-1 clone of all schools, students, classes, and marks!

---

## 4. Disaster Recovery & Failover Procedure

If your primary Supabase database ever experiences an outage or accidental data corruption:

### Option A: Restore the Primary Database
If data was accidentally deleted from the primary database:
```bash
npm run db:restore
```
The restore script reads from `backups/latest/` and uses `UPSERT` to restore all missing or damaged records in exact foreign-key order without violating constraints.

### Option B: Immediate Failover to Standby Project (Under 2 Minutes)
If the primary Supabase project is completely unreachable:
1. Open `.env.local` (and your hosting dashboard, e.g. Vercel).
2. Update the environment variables to point to your standby project:
   ```env
   VITE_SUPABASE_URL=https://<your-backup-project-id>.supabase.co
   VITE_SUPABASE_ANON_KEY=<your-backup-project-anon-key>
   SUPABASE_SERVICE_ROLE_KEY=<your-backup-project-service-key>
   ```
3. Redeploy or restart the app. The system immediately resumes operation on the backup database.

---

## 5. Automated Daily / Weekly Backups

To automate backups:

### On Windows (Task Scheduler)
Create a basic task that runs daily:
- **Program:** `node.exe`
- **Arguments:** `c:\Users\LENOVO\Desktop\Projects\schoolmanagementsystem\school-ms\scripts\backup-db.cjs`
- **Start in:** `c:\Users\LENOVO\Desktop\Projects\schoolmanagementsystem\school-ms`

### On Linux / Server (Cron)
Add to crontab (`crontab -e`) to run every midnight:
```cron
0 0 * * * cd /path/to/school-ms && node scripts/backup-db.cjs >> /var/log/school-ms-backup.log 2>&1
```

---

## 6. Supabase Cloud Native Backups

In addition to our custom offline backup utility, Supabase provides cloud backups:
- **Daily Automatic Backups:** Enabled by default on all Supabase projects.
- **Point-in-Time Recovery (PITR):** On Pro projects, you can rewind the database to any specific second in the past 7 days from **Project Settings $\rightarrow$ Database $\rightarrow$ Backups**.
