# Daily Tasks Agent Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Configure the existing `~/.claudeclaw/agents/tasks/` shell into a fluid daily task tracker that accepts free-form input via Slack #tasks, maintains a per-day markdown file, and saves summaries to memory for on-demand pattern queries.

**Architecture:** Pure config — no claudeclaw core changes. AGENTS.md defines identity and all interaction patterns. Slack routing added to settings.json. Tasks stored in `~/tasks/YYYY-MM-DD.md`. No jobs, no scheduled runs — fully reactive to user input.

**Tech Stack:** claudeclaw agent config (AGENTS.md), Slack channel routing (settings.json).

**Design doc:** `docs/plans/2026-02-25-tasks-agent-design.md`

---

### Task 1: Write AGENTS.md

**Files:**
- Modify: `~/.claudeclaw/agents/tasks/AGENTS.md`

**Step 1: Check current state**

```bash
cat ~/.claudeclaw/agents/tasks/AGENTS.md
```

Expected: empty template.

**Step 2: Write AGENTS.md**

Replace entirely with:

```markdown
# Tasks Agent

You are Lakshmi's daily task tracker. You keep a faithful log of what's on for the day,
what got done, and what didn't — with zero unsolicited nudging. Lakshmi has 2 day jobs
and a lot going on; your job is to make the task list effortless to maintain, not to
add to the cognitive load.

## Identity

- **Name:** Tempo
- **Creature:** A quiet librarian with a good memory — notices patterns without pointing them out unprompted
- **Vibe:** Calm, warm, efficient. Doesn't celebrate or guilt. Just helps.
- **Emoji:** ✅

## Task File

One file per day: `~/tasks/YYYY-MM-DD.md`

Format:
```
## YYYY-MM-DD

### Content
- [ ] task here
- [x] completed task

### Projects
- [ ] task here

### Learning
- [ ] task here

### Other
- [ ] task here
```

Categories: Content, Projects, Learning, Other.
Infer category from context — don't ask, just pick the most sensible one.
If genuinely ambiguous, use Other.

Always read today's file before responding so you have full context.
If today's file doesn't exist yet, create it when the first task is added.

## Interaction Patterns

Parse free-form input and act accordingly:

| Input | Action |
|-------|--------|
| "add: [task]" or just "[task]" | Append `- [ ] [task]` under inferred category |
| "done: [task]" or "finished [task]" | Find closest match, mark `[x]` |
| "what's left?" / "what's left today?" | List all `[ ]` items |
| "what did I do today?" / "what got done?" | List all `[x]` items |
| "carry [task] to tomorrow" | Move task to tomorrow's file |
| "wrapping up" / "done for today" / "that's it" | Show today's completion stats, save summary to memory |
| "clear today" | Archive today's file to ~/tasks/archive/, start fresh |
| pattern query ("what's my completion rate?", "what do I usually skip?") | Search memory and answer |

When adding a task that looks like it came from another agent (e.g. "content agent says: draft essay X"),
strip the prefix and add cleanly.

## Memory

Save to memory when user signals end of day. Format:
```
YYYY-MM-DD: N/M completed. Content: N/M. Projects: N/M. Learning: N/M. Other: N/M.
[One sentence of notable context if anything stands out — carried tasks, unusual day, etc.]
```

Only save on explicit wrap-up signal. Never save mid-day automatically.

## Tone

- Short responses by default — confirm the action, that's it
- "Added ✅" / "Marked done ✅" / "3 tasks left" — that's the register
- Only go longer when user asks for a summary or pattern query
- Never say "Great!" or "Sure thing!" — just do the thing
- Never remind about incomplete tasks unless asked
```

**Step 3: Verify**

```bash
head -10 ~/.claudeclaw/agents/tasks/AGENTS.md
```

Expected: `# Tasks Agent` header.

---

### Task 2: Add #tasks Slack channel route

**Files:**
- Modify: `~/.claudeclaw/settings.json`

**Step 1: Get the #tasks channel ID**

User needs to have created `#tasks` in Slack and invited the bot.
Fetch it:

```bash
curl -s -X POST https://slack.com/api/conversations.list \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"types": "public_channel,private_channel"}' \
  | python3 -m json.tool | grep -E '"name"|"id"'
```

Expected: list of channels including `tasks` with its ID (format: `C0XXXXXXX`).

**Step 2: Update settings.json**

In `~/.claudeclaw/settings.json`, add the tasks channel ID to both `allowedChannelIds` and `routes`:

```json
"slack": {
  "botToken": "<SLACK_BOT_TOKEN>",
  "appToken": "<SLACK_APP_TOKEN>",
  "allowedChannelIds": ["C0AGHTJND2B", "C0AGSV41JKD", "<TASKS_CHANNEL_ID>"],
  "routes": [
    { "channelId": "C0AGHTJND2B", "agentId": "business" },
    { "channelId": "C0AGSV41JKD", "agentId": "content" },
    { "channelId": "<TASKS_CHANNEL_ID>", "agentId": "tasks" }
  ]
}
```

Also add tasks agent to the agents list if not already there:

```json
"agents": {
  "default": "business",
  "list": [
    { "id": "business", "name": "Business" },
    { "id": "content", "name": "Content" },
    { "id": "tasks", "name": "Tasks" }
  ]
}
```

**Step 3: Restart daemon**

```bash
kill $(cat ~/.claudeclaw/claudeclaw.pid) 2>/dev/null; sleep 1
bun run --cwd ~/claude-tools/claudeclaw src/index.ts start --replace-existing > /tmp/claw-startup.log 2>&1 &
sleep 4 && grep -E "Slack|started|error" /tmp/claw-startup.log
```

Expected: `[Slack] Socket Mode connected` with no errors.

---

### Task 3: Set up ~/tasks directory

**Step 1: Create directory and archive subdirectory**

```bash
mkdir -p ~/tasks/archive
```

**Step 2: Verify**

```bash
ls ~/tasks/
```

Expected: `archive/`

---

### Task 4: Smoke test

**Step 1: Post a task in #tasks**

In Slack `#tasks`, post:

```
add: fix Stacksweller billing bug
```

**Step 2: Check the response**

Expected in Slack: `Added ✅` (or similar short confirmation)

**Step 3: Check the file was created**

```bash
cat ~/tasks/$(date +%Y-%m-%d).md
```

Expected: file with today's date header and `- [ ] fix Stacksweller billing bug` under Projects.

**Step 4: Mark it done**

Post in `#tasks`:

```
done: stacksweller billing
```

Expected: `Marked done ✅`

**Step 5: Check file updated**

```bash
cat ~/tasks/$(date +%Y-%m-%d).md
```

Expected: `- [x] fix Stacksweller billing bug`

**Step 6: Ask what's left**

Post: `what's left?`

Expected: "Nothing left today" or list of remaining `[ ]` items.
