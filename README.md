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
  browser-mcp.json       ← auto-generated MCP config for browser tools (when browser.enabled)
  mcp.json               ← merged MCP config written when both memory + browser are active
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

### Browser Control

ClaudeClaw can give Claude full browser control via [`@playwright/mcp`](https://github.com/microsoft/playwright-mcp). When enabled, a `browser-mcp.json` config is generated at startup and merged with the memory MCP config, so Claude receives all browser tools automatically.

**Enable in `settings.json`:**

```json
"browser": {
  "enabled": true,
  "engine": "chromium"
}
```

**First-time setup** — install Playwright's browser binaries:

```bash
npx playwright install chromium
```

**Available tools** (35 total, added to `allowedTools` automatically):

`browser_navigate`, `browser_click`, `browser_type`, `browser_snapshot`, `browser_take_screenshot`, `browser_fill_form`, `browser_evaluate`, `browser_select_option`, `browser_hover`, `browser_drag`, `browser_press_key`, `browser_navigate_back`, `browser_close`, and more.

**Security levels:** Browser tools work with `moderate`, `strict`, and `unrestricted` levels. At `locked`, only `Read`, `Grep`, and `Glob` are permitted so browser tools are blocked regardless.

**Engine options:**
- `"chromium"` — default, stable, full Playwright support
- `"lightpanda"` — experimental lightweight browser (AGPL-3.0, beta); run it as a CDP server on `localhost:9222` before starting the daemon

---

## Agents

ClaudeClaw supports multiple named agents, each with its own isolated workspace, memory, and session. This lets you run specialised contexts in parallel — a `content` agent for writing, a `daily` agent for planning, an `ideas` agent for brainstorming — without them sharing context or memory.

The **`main`** agent is always present and maps to the legacy `~/.claudeclaw/workspace/` directory. Existing installs require no migration.

### Directory layout

```
~/.claudeclaw/
  workspace/           ← main agent (legacy, always present)
    AGENTS.md
    SOUL.md
    MEMORY.md
    memory/
  agents/
    content/           ← additional agents under ~/.claudeclaw/agents/<id>/
      AGENTS.md
      SOUL.md
      MEMORY.md
      memory/
      session.json
      memory-mcp.json
      mcp.json
    ideas/
      ...
```

### Configuring agents

Add an `agents` block to `~/.claudeclaw/settings.json`. Workspace directories and MCP configs are created automatically at startup:

```json
"agents": {
  "default": "main",
  "list": [
    {
      "id": "content",
      "name": "Content Writer",
      "systemPrompt": "You are a creative writing assistant focused on long-form content."
    },
    {
      "id": "daily",
      "name": "Daily Planner"
    },
    {
      "id": "ideas",
      "workspace": "/custom/path/ideas-workspace"
    }
  ]
}
```

Each agent supports:
- `id` — unique slug used in CLI flags and routing rules
- `name` — optional display name
- `systemPrompt` — inline text or path to a `.md` file; overrides `AGENTS.md` for this agent
- `workspace` — optional absolute path override; defaults to `~/.claudeclaw/agents/<id>/`

### CLI usage

```bash
# One-shot: run a prompt with a specific agent
claudeclaw start --prompt "draft a blog post about X" --agent content

# Send a message to a specific agent's session
claudeclaw send "add this to the ideas list" --agent ideas

# List all configured agents
claudeclaw agents list

# Show config + workspace paths + session state for an agent
claudeclaw agents show content

# Clear the session for an agent (forces a fresh context next run)
claudeclaw agents reset content
```

If `--agent` is omitted, the `agents.default` value is used (defaults to `main`).

### Telegram routing

Map Telegram chats or topic threads to specific agents by adding a `routes` array to the `telegram` config:

```json
"telegram": {
  "token": "your-bot-token",
  "allowedUserIds": [123456789],
  "routes": [
    { "chatId": -100123456789, "agentId": "content" },
    { "chatId": -100123456789, "topicId": 42, "agentId": "ideas" }
  ]
}
```

Rules are matched most-specific first (`chatId + topicId` before `chatId`-only). Unmatched messages fall back to `agents.default`. The `/reset` command resets only the matched agent's session.

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
| Playwright browser control (MCP) | ✅ |
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
    "allowedUserIds": [123456789],
    "routes": []
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
  },
  "browser": {
    "enabled": false,
    "engine": "chromium"
  },
  "agents": {
    "default": "main",
    "list": []
  }
}
```

`memory.embeddings.provider`: `"none"` (keyword search, default) · `"openai"` · `"ollama"`

`browser.engine`: `"chromium"` (default) · `"lightpanda"` (experimental)

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
