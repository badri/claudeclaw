# VM Deployment

Run claudeclaw as an always-on systemd service.

## Quick Setup

```bash
# 1. Create service user
sudo useradd -r -s /bin/false claudeclaw

# 2. Install claudeclaw to /opt/claudeclaw
sudo mkdir -p /opt/claudeclaw/data
sudo cp -r . /opt/claudeclaw/
sudo chown -R claudeclaw:claudeclaw /opt/claudeclaw

# 3. Install systemd unit
sudo cp deploy/claudeclaw.service /etc/systemd/system/
sudo systemctl daemon-reload

# 4. Authenticate Claude CLI (one-time, interactive)
# Claude Code requires a browser-based login. Run this manually first:
sudo -u claudeclaw CLAUDECLAW_HOME=/opt/claudeclaw/data bun run src/index.ts start --prompt "hello"
# Complete the browser auth flow, then Ctrl+C.
# The session token persists in CLAUDECLAW_HOME but expires periodically.
# When it expires, the daemon logs will show auth errors — re-run this step.

# 5. Start the service
sudo systemctl enable --now claudeclaw

# 6. Check status
sudo systemctl status claudeclaw
journalctl -u claudeclaw -f
curl http://localhost:9100/
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDECLAW_HOME` | `~/.claudeclaw` | Root data directory |
| `CLAUDECLAW_HEALTH_PORT` | `9100` | Health endpoint port (when web UI is off) |

## Health Endpoint

Always available at `http://localhost:9100/` (or `/api/health` if web UI is on).

Returns:
```json
{
  "ok": true,
  "uptime_ms": 3600000,
  "started_at": 1712300000000,
  "last_heartbeat_at": 1712303600000,
  "last_job_run_at": 1712303500000,
  "last_job_run_name": "morning-brief",
  "slack": true,
  "telegram": false,
  "jobs_loaded": 8
}
```

## Logs

Stdout/stderr go to journald:
```bash
journalctl -u claudeclaw -f          # live tail
journalctl -u claudeclaw --since today  # today's logs
```

Per-run logs are still written to `$CLAUDECLAW_HOME/logs/`.

## Claude CLI Auth

Claude Code requires an interactive browser login to create a session token. This is the main operational constraint for VM deployment:

- Session tokens persist across restarts but expire periodically
- When expired, the daemon will fail to run prompts and log auth errors
- Re-authenticate manually: `sudo -u claudeclaw CLAUDECLAW_HOME=/opt/claudeclaw/data claude --auth`
- Monitor via health endpoint — if `last_job_run_at` stops updating, auth may have expired

## PID File

When running under systemd, PID file management is automatically skipped (detected via `INVOCATION_ID` env var set by systemd). Systemd tracks the process lifecycle natively.
