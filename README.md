![ClaudeClaw](images/banner.png)

<p align="center"><b>A personal AI assistant daemon built into your Claude Code subscription.</b></p>

ClaudeClaw runs as a background daemon — always on, always remembering, responding to messages and executing scheduled tasks entirely within your existing Claude Code plan. No separate API keys. No billing surprises.

> Fork of [moazbuilds/claudeclaw](https://github.com/moazbuilds/claudeclaw) with a focus on personal use: persistent memory, multi-platform messaging, and browser automation.

---

## Why ClaudeClaw?

**Zero API overhead.** Runs entirely within your Claude Code subscription. Smart context management with fallback model support (e.g. GLM on rate-limit).

**Persistent memory.** Every session reads from `~/.claudeclaw/workspace/MEMORY.md` and writes a dated journal entry. Your assistant remembers what you've told it across restarts.

**Always on.** One command starts the daemon. Heartbeat check-ins, cron jobs, and message handling run in the background indefinitely.

**Browser-capable.** Playwright MCP integration lets Claude control a real browser — navigate, click, fill forms, extract data — during any scheduled job or message response.

**Controllable anywhere.** Chat via Telegram today; Slack and WhatsApp support are in progress.

---

## Getting Started

```bash
claude plugin marketplace add moazbuilds/claudeclaw
claude plugin install claudeclaw
```

Then open a Claude Code session and run:

```
/claudeclaw:start
```

The setup wizard walks you through model, heartbeat interval, Telegram, and security level. Your daemon starts with a web dashboard at `http://localhost:4632`.

---

## Config Directory

All runtime data lives at `~/.claudeclaw/` — user-global, not tied to any project. This mirrors openclaw's `~/.openclaw/` layout so conventions are portable.

```
~/.claudeclaw/
  settings.json          ← model, telegram token, heartbeat, security
  session.json           ← active Claude session ID
  daemon.pid             ← running daemon PID
  state.json             ← live statusline data
  workspace/
    AGENTS.md            ← agent identity / persona (edit to customize)
    SOUL.md              ← behavioral guidelines
    MEMORY.md            ← persistent memory, read on every run
    memory/
      YYYY-MM-DD.md      ← daily journal entries (auto-written)
    skills/              ← reusable skill packs
    jobs/                ← cron job definitions (*.md with frontmatter)
  logs/                  ← per-run execution logs
  inbox/telegram/        ← telegram message queue
  whisper/               ← voice transcription temp files
```

### Customizing Identity

Edit `~/.claudeclaw/workspace/AGENTS.md` to give your assistant a name, personality, and role. If the file doesn't exist, the bundled `prompts/IDENTITY.md` template is used as a fallback.

### Persistent Memory

`MEMORY.md` is loaded into every run as system prompt context. Your assistant can update it when it learns something new. After each run, a brief summary is appended to that day's journal (`memory/YYYY-MM-DD.md`).

---

## Features

| Feature | Status |
|---------|--------|
| Heartbeat (configurable interval + quiet hours) | ✅ |
| Cron jobs (standard syntax, timezone-aware) | ✅ |
| Telegram bot (text, images, voice) | ✅ |
| Web dashboard (jobs, logs, settings) | ✅ |
| Persistent memory + daily journals | ✅ |
| Security levels (locked / strict / moderate / unrestricted) | ✅ |
| Fallback model (e.g. GLM on rate-limit) | ✅ |
| Voice transcription (OGG/Opus via whisper) | ✅ |
| Slack bot | 🔧 in progress |
| Playwright browser control (MCP) | 🔧 in progress |
| WhatsApp | 📋 planned |
| Webhook job triggers | 📋 planned |

See [ROADMAP.md](./ROADMAP.md) for full details.

---

## Settings Reference

`~/.claudeclaw/settings.json`:

```json
{
  "model": "claude-sonnet-4-6",
  "fallback": { "model": "glm", "api": "" },
  "timezone": "America/New_York",
  "heartbeat": {
    "enabled": true,
    "interval": 60,
    "prompt": "~/.claudeclaw/workspace/HEARTBEAT.md",
    "excludeWindows": [
      { "start": "23:00", "end": "08:00" }
    ]
  },
  "telegram": {
    "token": "your-bot-token",
    "allowedUserIds": [123456789]
  },
  "security": {
    "level": "moderate",
    "allowedTools": [],
    "disallowedTools": []
  },
  "web": { "enabled": true, "host": "127.0.0.1", "port": 4632 }
}
```

## Cron Job Format

Jobs live in `~/.claudeclaw/workspace/jobs/*.md`:

```markdown
---
schedule: "0 9 * * 1-5"
recurring: true
notify: true
---
Check my calendar for today and send me a morning brief.
```

---

![ClaudeClaw Status Bar](images/bar.png)

![ClaudeClaw Dashboard](images/dashboard.png)
