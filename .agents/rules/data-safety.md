# 🚨 PRODUCTION DATA IS SACRED — ZERO TOLERANCE FOR DATA LOSS

## Absolute Rule
**Existing production data must NEVER be lost, corrupted, or made inaccessible. There are no exceptions.**

If an action risks production data loss, STOP and ask the user for explicit confirmation before proceeding — even if it delays the task.

## Specific Prohibitions

### Docker / Coolify / Compose
- **NEVER rename Docker volume names** in a compose file without first verifying the old volume names and confirming with the user. Renaming a volume (e.g. `db-data` → `new-db-data`) silently creates a NEW empty volume and orphans the existing data.
- **NEVER drop or recreate database containers** without confirming the data volume will be preserved.
- **NEVER replace an entire compose file** — always diff against the current version and preserve volume names, database credentials, and network settings exactly as they were.
- Before editing any compose file, **extract and record the current volume names, passwords, and secrets** so they can be verified after the edit.

### Database
- **NEVER run DROP, TRUNCATE, or destructive DELETE** on production databases without explicit user consent.
- **NEVER change database passwords** on a running system where the existing data volume expects the old password.

### General
- When in doubt about whether an action could affect existing data: **STOP and ASK**.
- Prefer additive changes (adding new stages, new env vars) over destructive rewrites.
- Always verify that data persists after infrastructure changes — don't just check if containers are "healthy".
