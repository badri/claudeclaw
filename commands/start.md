---
description: Start the heartbeat daemon
---

Start the heartbeat daemon for this project. Follow these steps exactly:

1. **Check if already running**: Run `bun run ${CLAUDE_PLUGIN_ROOT}/src/index.ts status`. If it reports the daemon is running, tell the user and exit.

2. **Ensure Bun is installed**: Run `which bun`. If it's not found:
   - Tell the user Bun is required and will be auto-installed.
   - Run:
     ```bash
     curl -fsSL https://bun.sh/install | bash
     ```
   - Then source the shell profile to make `bun` available in the current session:
     ```bash
     source ~/.bashrc 2>/dev/null || source ~/.zshrc 2>/dev/null || true
     ```
   - Verify `bun` is now available with `which bun`. If still not found, tell the user installation failed and to install manually from https://bun.sh, then exit.
   - Tell the user Bun was auto-installed successfully.

3. **Initialize config if needed**: If `.claude/heartbeat/` doesn't exist:
   - Create `.claude/heartbeat/`, `.claude/heartbeat/jobs/`, `.claude/heartbeat/logs/`
   - Write `.claude/heartbeat/settings.json` with defaults:
     ```json
     {
       "heartbeat": {
         "enabled": false,
         "interval": 15,
         "prompt": ""
       },
       "telegram": {
         "token": "",
         "allowedUserIds": []
       }
     }
     ```

4. **Launch daemon**: Run this command to start the daemon in the background:
   ```bash
   nohup bun run ${CLAUDE_PLUGIN_ROOT}/src/index.ts > .claude/heartbeat/logs/daemon.log 2>&1 &
   ```

5. **Report**: Print the ASCII art below then show the PID and status info.

CRITICAL: Output the ASCII art block below EXACTLY as-is inside a markdown code block. Do NOT re-indent, re-align, or adjust ANY whitespace. Copy every character verbatim. Only replace `<PID>` and `<WORKING_DIR>` with actual values.

```
🦞         🦞
   ▐▛███▜▌
  ▝▜█████▛▘
    ▘▘ ▝▝
```

# HELLO, I AM YOUR CLAUDECLAW!
**Daemon is running! PID: \<PID> | Dir: \<WORKING_DIR>**

```
   1. Enable heartbeat?
   2. Configure Telegram?

/heartbeat:status  - check status
/heartbeat:stop    - stop daemon
```

After displaying the above, ask the user to answer each question:

- **If user answers yes to #1 (Enable heartbeat)**:
  - Ask: "What prompt should the heartbeat run on each check?"
  - Ask: "How often should it run? (in minutes, default: 15)"
  - Set `heartbeat.enabled` to `true`, `heartbeat.prompt` to their answer, `heartbeat.interval` to their answer (or `15` if they accept default).

- **If user answers yes to #2 (Configure Telegram)**:
  - Ask: "What is your Telegram bot token?"
  - Ask: "What are the allowed Telegram user IDs? (comma-separated)"
  - Set `telegram.token` and `telegram.allowedUserIds` (as array of numbers) accordingly.
  - Note: Telegram bot runs in-process with the daemon. All components (heartbeat, cron, telegram) share one Claude session.

Update `.claude/heartbeat/settings.json` with their answers.
