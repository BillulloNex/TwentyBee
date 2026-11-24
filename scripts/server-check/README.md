# Production server check

`server-check.sh` runs on the production server (`prime`) every 15 minutes and posts to the BeeNex Sales
Telegram topic, through the `resend-inbound-webhook` worker's `/server-alert` route, when:

- the root disk is 85% full or more (on Nov 17, 2026 a full disk crashed the Twenty worker and stopped all sending for a week), or
- the TwentyBee worker container is not running.

Each problem is re-announced at most every 3 hours.

Installed at `/home/ubuntu/.config/beenex/server-check.sh`, scheduled by `/etc/cron.d/beenex-server-check`
(the ubuntu user may not use `crontab`). The shared secret is in `~/.config/beenex/alert-token` on the server,
in the worker as the `SERVER_ALERT_TOKEN` secret, and in git-ignored `scripts/.env`.

The worker also checks every 10 minutes that the "Campaign 1 — Daily Follow-up Sender" workflow ran in the
last 30 minutes and that its last 3 runs did not all fail. `GET /sender-check` with the same bearer token
returns that status without posting anything.
