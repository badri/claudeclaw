![ClaudeClaw](images/banner.png)

<p align="center"><b>A personal AI assistant daemon built into your Claude Code subscription.</b></p>

ClaudeClaw runs as a background daemon — always on, always remembering, responding to messages and executing scheduled tasks entirely within your existing Claude Code plan. No separate API keys. No billing surprises.

> Fork of [moazbuilds/claudeclaw](https://github.com/moazbuilds/claudeclaw) with a focus on personal use: persistent memory, multi-platform messaging, and browser automation.

---

## Why ClaudeClaw?

**Zero API overhead.** Runs entirely within your Claude Code subscription. Smart context management with fallback model support (e.g. GLM on rate-limit).

**Persistent memory.** Every session can recall from `~/.claudeclaw/workspace/MEMORY.md` via `memory_search` and `memory_get` MCP tools. The heartbeat prompt grooms the file automatically. Optional semantic search via OpenAI or Ollama embeddings; keyword search works out of the box with no API key.

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
  settings.json          ← model, telegram token, heartbeat, security, memory
  session.json           ← active Claude session ID
  daemon.pid             ← running daemon PID
  state.json             ← live statusline data
  memory-mcp.json        ← auto-generated MCP config for memory tools
  memory-embeddings.db   ← SQLite cache for memory chunk embeddings
  workspace/
    AGENTS.md            ← agent identity / persona (edit to customize)
    SOUL.md              ← behavioral guidelines
    MEMORY.md            ← persistent memory, groomed by the heartbeat
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

`MEMORY.md` is your assistant's long-term memory. It is not dumped wholesale into the prompt — instead, two MCP tools are registered on every run:

- **`memory_search(query)`** — keyword or semantic search over `MEMORY.md` + `memory/*.md`. Claude calls this before answering questions about prior work, decisions, or preferences.
- **`memory_get(path, from?, lines?)`** — reads a specific line range from a memory file after searching.

The heartbeat prompt instructs Claude to update `MEMORY.md` when it learns new preferences or facts. After each run a brief summary is appended to that day's journal (`memory/YYYY-MM-DD.md`).

You can also manage it directly:

```bash
claudeclaw memory          # open in $EDITOR
claudeclaw memory show     # print to stdout
claudeclaw memory clear    # empty the file
claudeclaw memory path     # print the file path
```

#### Semantic search (optional)

By default `memory_search` uses keyword overlap scoring. To enable semantic search, add a `memory.embeddings` block to `settings.json`:

**OpenAI** (recommended — best quality):
```json
"memory": {
  "embeddings": {
    "provider": "openai",
    "model": "text-embedding-3-small",
    "api": "sk-...",
    "baseUrl": ""
  }
}
```
Leave `api` blank to fall back to the `OPENAI_API_KEY` environment variable.

**Ollama** (local, no API key):
```json
"memory": {
  "embeddings": {
    "provider": "ollama",
    "model": "nomic-embed-text",
    "baseUrl": "http://localhost:11434"
  }
}
```
Requires Ollama running locally with the model pulled (`ollama pull nomic-embed-text`).

When a provider is configured, search uses a hybrid score: `0.7 × cosine similarity + 0.3 × keyword`. Embeddings are cached in `memory-embeddings.db` and only recomputed when content changes. If the embedding API is unreachable, it falls back to keyword search automatically.

---

## Features

| Feature | Status |
|---------|--------|
| Heartbeat (configurable interval + quiet hours) | ✅ |
| Cron jobs (standard syntax, timezone-aware) | ✅ |
| Telegram bot (text, images, voice) | ✅ |
| Web dashboard (jobs, logs, settings) | ✅ |
| Persistent memory + daily journals | ✅ |
| memory_search / memory_get MCP tools | ✅ |
| Semantic memory search (OpenAI / Ollama embeddings) | ✅ |
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
  "web": { "enabled": true, "host": "127.0.0.1", "port": 4632 },
  "memory": {
    "embeddings": {
      "provider": "none",
      "model": "",
      "api": "",
      "baseUrl": ""
    }
  }
}
```

`memory.embeddings.provider`: `"none"` (keyword search, default) · `"openai"` · `"ollama"`

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
