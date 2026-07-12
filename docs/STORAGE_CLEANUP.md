# VPS storage cleanup

Klui deletes attachment files immediately when a message or conversation is deleted. This scheduled task handles uploads that were never attached to a chat and have remained orphaned for seven days.

The task enumerates the original upload, extracted data, preview data, and rendered page JPEGs. It deletes the Supabase attachment row only after every Cloudflare R2 deletion succeeds. A failed run is safe to retry.

## One-time VPS setup

1. Deploy this code and apply `supabase/migrations/20260712222116_move_orphan_storage_cleanup_to_vps.sql`. Apply the migration before enabling the timer so Supabase does not remove R2 key metadata itself.
2. Rebuild the cleanup image from the deployed repository:

   ```bash
   cd /absolute/path/to/Chat
   docker compose --profile maintenance build storage-cleanup
   ```

3. Create the timer environment file with the absolute repository path:

   ```bash
   sudo install -d -m 0755 /etc/klui
   printf 'KLUI_ROOT=/absolute/path/to/Chat\n' | sudo tee /etc/klui/storage-cleanup.env
   ```

4. Install the systemd units:

   ```bash
   sudo cp deploy/systemd/klui-storage-cleanup.service /etc/systemd/system/
   sudo cp deploy/systemd/klui-storage-cleanup.timer /etc/systemd/system/
   sudo systemctl daemon-reload
   ```

5. Run it once and inspect the result before scheduling it:

   ```bash
   sudo systemctl start klui-storage-cleanup.service
   sudo journalctl -u klui-storage-cleanup.service -n 100 --no-pager
   ```

6. Enable the daily timer:

   ```bash
   sudo systemctl enable --now klui-storage-cleanup.timer
   systemctl list-timers klui-storage-cleanup.timer
   ```

The service uses the repository's existing `.env` through Docker Compose, including the Supabase service-role and R2 credentials. Configure `STORAGE_CLEANUP_GRACE_DAYS` and `STORAGE_CLEANUP_BATCH_SIZE` there if the defaults of 7 days and 100 attachments per run need changing.

## Operations

Run manually:

```bash
sudo systemctl start klui-storage-cleanup.service
```

View the most recent run:

```bash
sudo journalctl -u klui-storage-cleanup.service -n 100 --no-pager
```

Turn the schedule off or on:

```bash
sudo systemctl disable --now klui-storage-cleanup.timer
sudo systemctl enable --now klui-storage-cleanup.timer
```
