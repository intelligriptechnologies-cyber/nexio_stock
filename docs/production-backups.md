# Production backup and recovery

The **Backup production** GitHub Actions workflow protects the live Nexio Stock
PostgreSQL database and creates a whole-server Hetzner snapshot. Run it before
every major production deployment. It is manual by design and is not a
deployment gate.

## Before the first run

Add the `HETZNER_API_TOKEN` repository secret. Create a Hetzner Cloud API token
with read/write access for the project that contains server `nexiolabs` (ID
`165574147`). The workflow reuses `HETZNER_HOST`, `HETZNER_USER`, and
`HETZNER_DEPLOY_KEY` for database access.

## Create and retain a backup

1. Open **Actions** in GitHub, select **Backup production**, then choose **Run
   workflow**.
2. Enter `BACKUP_PRODUCTION` exactly and supply the related deployment, change,
   or incident reference.
3. Wait for the run to complete. Download the `nexio-stock-production-postgres-...`
   artifact from that run to a secure workstation. It contains
   `production.dump` and `production.dump.sha256` and is retained for seven
   days.
4. On the secure workstation, verify both the checksum and dump structure:

   ```bash
   sha256sum --check production.dump.sha256
   pg_restore --list production.dump > /dev/null
   ```

5. After the local verification, delete the GitHub Actions artifact from the run
   page if policy does not require the full seven-day retention. Store the
   verified dump only in approved secure storage.

The workflow retains the newest three Hetzner snapshots labelled as GitHub
managed Nexio Stock production backups. It does not alter snapshots belonging to
other servers or projects.

## Restore the database

Restore only during an approved maintenance window. Restore into a newly created
or explicitly empty target database; `pg_restore --clean` can delete existing
objects.

```bash
createdb -h DB_HOST -U DB_USER TARGET_DATABASE
pg_restore --verbose --no-owner --no-privileges \
  -h DB_HOST -U DB_USER -d TARGET_DATABASE production.dump
```

For an in-place recovery, stop application writers first, make a fresh safety
backup, then use the approved production connection details with `pg_restore`.
Validate application health and critical data before reopening writes.

## Recover the whole server

1. In Hetzner Cloud Console, open server `nexiolabs` and select the required
   snapshot labelled `managed-by=github-actions`, `application=nexio-stock`, and
   `backup=production`.
2. Use Hetzner's restore/rebuild flow to create or rebuild a server from that
   snapshot. This replaces or creates the complete server filesystem, not merely
   the database.
3. Before directing production traffic to it, check network/firewall settings,
   the application stack, database health, DNS/load-balancer configuration, and
   current secrets. Perform a smoke test and record the recovery decision.

The pre-migration dumps kept on the server are convenience copies only; they are
not disaster-recovery backups because they share the server's failure domain.
