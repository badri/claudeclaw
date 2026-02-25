# Daily Tasks Agent Design

**Date:** 2026-02-25
**Agent:** `~/.claudeclaw/agents/tasks/` (shell already exists)
**Approach:** Fluid throughout the day — post tasks/updates/queries anytime via Slack #tasks. No scheduled jobs, no unsolicited nudging.

---

## Goal

A low-friction daily context layer. User posts tasks, completions, and queries as they go. Agent keeps the day's task file accurate and memory searchable for pattern queries on demand.

---

## Architecture

### Agent Setup

Fill out `~/.claudeclaw/agents/tasks/` with:

- **AGENTS.md** — identity, tone (warm, low-friction, non-naggy), file paths, interaction patterns
- No extra-mcp.json needed — no external data sources required
- No scheduled jobs — purely reactive to user input

### Slack Channel

- Create `#tasks` in the workspace
- Add route: `#tasks` → `tasks` agent
- Add `#tasks` to `allowedChannelIds` in settings.json

### Task File Format

One file per day at `~/tasks/YYYY-MM-DD.md`:

```markdown
## 2026-02-25

### Content
- [ ] draft essay on vibe code security
- [x] atomize yesterday's essay → LinkedIn

### Projects
- [ ] fix Stacksweller billing bug
- [x] review VMKit PR

### Learning
- [ ] explore new MCP pattern from agentic-coding-research
```

Categories: Content, Projects, Learning, Other. Agent infers category from context.

### Memory

Agent saves a daily summary to memory when user signals end of day ("wrapping up", "done for today", etc.):

```
2026-02-25: 4/7 tasks completed. Content: 1/2. Projects: 2/3. Learning: 1/2.
Notable: Stacksweller bug carried over. Essay drafted and atomized.
```

Queryable later: "what's my content completion rate?" / "what do I usually carry over?"

---

## Interaction Patterns

Agent parses free-form input and acts:

| User says | Agent does |
|-----------|------------|
| "add: fix stacksweller bug" | Appends `- [ ] fix stacksweller bug` under Projects |
| "done: drafted essay" | Finds matching task, marks `[x]` |
| "what's left today?" | Lists all `[ ]` items from today's file |
| "what did I do today?" | Lists all `[x]` items |
| "carry fix stacksweller to tomorrow" | Moves task to tomorrow's file |
| "wrapping up" | Saves daily summary to memory, shows completion stats |
| "what's my content completion rate?" | Queries memory, returns pattern |
| "clear today" | Archives today's file, starts fresh |

Agent always reads today's file first before responding so it has full context.

---

## Cross-Agent Writes

Other agents can append to today's task file directly:

- **Content agent** morning brief: if configured, appends the chosen essay idea as a task
- **Business agent**: can add "follow up on [signal]" tasks after scans

No special protocol — just a file append. Agent will pick it up on next read.

---

## Out of Scope (for now)

- Automated cross-agent writes (manual for now — user decides what to pull in)
- Time tracking per task
- Priority/urgency scoring
- Calendar integration
