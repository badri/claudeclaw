# Roadmap

This fork of [claudeclaw](https://github.com/moazbuilds/claudeclaw) is a personal AI assistant daemon built on your Claude Code subscription. It runs 24/7, remembers things, handles scheduled tasks, and responds to messages — all without a separate API key.

## Principles

1. **Claude subscription only** — no Anthropic API billing, no OpenAI, no separate keys
2. **Always on** — background daemon, starts on boot, never needs babysitting
3. **Remembers** — persistent memory across sessions via `MEMORY.md` + daily journals
4. **Controllable** — respond to messages on Telegram, Slack, or WhatsApp
5. **Browser-capable** — real web automation via Playwright MCP
6. **Skill-growing** — Claude can write new skills to disk during a run; they persist

---

## Done ✅

- [x] Heartbeat daemon with configurable intervals and quiet hours
- [x] Cron job scheduling (standard cron syntax, timezone-aware)
- [x] Telegram bot integration (text, images, voice)
- [x] Web dashboard (job management, logs, settings)
- [x] Security levels: locked / strict / moderate / unrestricted
- [x] Fallback model support (e.g. GLM on rate-limit)
- [x] Session persistence and backup
- [x] Voice transcription via whisper (OGG/Opus)
- [x] Per-job `notify` control
- [x] **Global config** — migrated from `.claude/claudeclaw/` (per-project) to `~/.claudeclaw/` (user-global, mirrors openclaw's `~/.openclaw/` layout)
- [x] **Persistent memory** — `~/.claudeclaw/workspace/MEMORY.md` loaded as system prompt on every run; daily journal entries written to `~/.claudeclaw/workspace/memory/YYYY-MM-DD.md`
- [x] **Workspace layout** — `AGENTS.md` + `SOUL.md` in `~/.claudeclaw/workspace/` mirror openclaw's workspace structure; user files override bundled templates

---

## In Progress 🔧

- [ ] **Slack adapter** — Socket Mode bot, same message→runner→reply flow as Telegram
- [ ] **Browser control via Playwright MCP** — wire `@playwright/mcp` into daemon startup via `--mcp-config`; expose browser tools to all runs

---

## Planned 📋

### Messaging

- [ ] **Slack** (Socket Mode, no public URL needed)
- [ ] **WhatsApp** via `whatsapp-web.js` (unofficial but works for personal use)

### Browser

- [ ] Launch `@playwright/mcp` server on daemon start
- [ ] Pass `--mcp-config ~/.claudeclaw/mcp.json` to every `claude -p` invocation
- [ ] Document which security levels permit browser tools

### Memory

- [ ] Heartbeat prompt instructs Claude to update `MEMORY.md` when it learns something new
- [ ] `claudeclaw memory` command to view/edit persistent memory
- [ ] Auto-compact memory when `MEMORY.md` exceeds ~4k tokens

### Skills

- [ ] Skills in `~/.claudeclaw/workspace/skills/` auto-loaded as system prompt context
- [ ] Convention: Claude writes new skills here during runs (`created_by: agent` frontmatter)
- [ ] `claudeclaw skills` command to list installed skills

### Webhooks

- [ ] `trigger: webhook` frontmatter in job files
- [ ] Web server endpoint `POST /webhook/:job-name` fires the job immediately

---

## Config Directory Layout

```
~/.claudeclaw/
  settings.json              ← daemon config (model, telegram, heartbeat, security)
  state.json                 ← live countdown state for statusline
  session.json               ← active Claude session ID
  daemon.pid                 ← running daemon PID
  workspace/
    AGENTS.md                ← agent identity / persona (user-editable, mirrors openclaw)
    SOUL.md                  ← behavioral guidelines (user-editable, mirrors openclaw)
    MEMORY.md                ← persistent memory, groomed across sessions  ← NEW
    memory/
      YYYY-MM-DD.md          ← daily journal entries                       ← NEW
    skills/
      my-skill/SKILL.md      ← user and agent-written skills               ← NEW
    jobs/
      daily-review.md        ← cron job definitions
  logs/
    heartbeat-*.log          ← per-run execution logs
  inbox/
    telegram/                ← telegram message inbox
  whisper/                   ← voice transcription temp files
```

This mirrors openclaw's `~/.openclaw/workspace/` layout so config conventions are portable.
