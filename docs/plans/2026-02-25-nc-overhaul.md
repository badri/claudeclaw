# NC Plugin Overhaul v2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Overhaul the NC fiction writing plugin — convert all slash commands to intent-triggered skills, replace DevRag semantic search with grep, replace Gemini subagent with Task tool (haiku), and enable the plugin scoped to `~/writing/` only.

**Architecture:** Pure plugin config changes — no claudeclaw core changes. All commands in `commands/` become skills in `skills/` with `description` frontmatter that drives intent matching. DevRag and Gemini CLI dependencies removed entirely. Plugin enabled via `~/writing/.claude/settings.json` (project-scoped, not global).

**Tech Stack:** Claude Code plugin system (skills/, plugin.json), Grep tool for search, Task tool (haiku subagent) for summarization.

**Design doc:** `docs/plans/2026-02-25-nc-overhaul.md` (this file)

---

### Task 1: Create skills/ directory and core writing skills

**Files:**
- Create: `~/nc/skills/new-scene.md`
- Create: `~/nc/skills/edit-scene.md`
- Create: `~/nc/skills/brainstorm.md`
- Create: `~/nc/skills/chat.md`
- Create: `~/nc/skills/cycle.md`

**Step 1: Create skills directory**

```bash
mkdir -p ~/nc/skills
```

**Step 2: Create `~/nc/skills/new-scene.md`**

Copy logic from `~/nc/commands/new-scene.md` verbatim. Replace the header with this frontmatter:

```markdown
---
name: new-scene
description: Use when the user wants to write the next scene, continue the story, add a new chapter, or generate new prose. Trigger on: "let's write", "next scene", "continue", "what happens next", "write the scene where X", "I want to write", or any intent to produce new story content.
---
```

Then paste the full body from `commands/new-scene.md` (starting from `# New Scene`).

**Step 3: Create `~/nc/skills/edit-scene.md`**

Copy from `commands/edit-scene.md` with frontmatter:

```markdown
---
name: edit-scene
description: Use when the user wants to modify, fix, improve, or revise an existing scene. Trigger on: "fix scene N", "this scene feels off", "rewrite the opening", "scene N needs work", "edit scene", "something's wrong with scene N".
---
```

**Step 4: Create `~/nc/skills/brainstorm.md`**

Copy from `commands/brainstorm.md` with frontmatter:

```markdown
---
name: brainstorm
description: Use when the user is stuck, exploring story possibilities, or needs to work through plot problems before writing. Trigger on: "I'm stuck", "what should happen", "brainstorm", "help me figure out", "what if", "I can't decide what to do next", "let's think through".
---
```

**Step 5: Create `~/nc/skills/chat.md`**

Copy from `commands/chat.md` with frontmatter:

```markdown
---
name: chat
description: Use for open-ended story discussion — characters, themes, world, decisions — that doesn't fit a specific action. General creative conversation about the project when the user isn't ready to write yet.
---
```

**Step 6: Create `~/nc/skills/cycle.md`**

Copy from `commands/cycle.md` with frontmatter:

```markdown
---
name: cycle
description: Use when the user wants to write a payoff first and plant setups later, write out of order, or work backward from a known ending. Trigger on: "write the ending first", "I know how this ends", "cycle", "work backwards", "plant the setup for X".
---
```

**Step 7: Verify**

```bash
ls ~/nc/skills/
```

Expected: `brainstorm.md  chat.md  cycle.md  edit-scene.md  new-scene.md`

---

### Task 2: Navigation and project management skills

**Files:**
- Create: `~/nc/skills/scenes.md`
- Create: `~/nc/skills/status.md`
- Create: `~/nc/skills/codex.md`
- Create: `~/nc/skills/reorder.md`
- Create: `~/nc/skills/new-project.md`

**Step 1: Create `~/nc/skills/scenes.md`**

Copy from `commands/scenes.md` with frontmatter:

```markdown
---
name: scenes
description: Use when the user wants to see what they've written, review the scene list, check scene titles or word counts, or get an overview of the manuscript structure. Trigger on: "what scenes do I have", "show me my scenes", "scene list", "what have I written", "how many scenes".
---
```

**Step 2: Create `~/nc/skills/status.md`**

Copy from `commands/status.md` with frontmatter:

```markdown
---
name: status
description: Use when the user wants a project snapshot — total word count, scene count, progress toward goal, or overall project health. Trigger on: "how am I doing", "project status", "word count", "how far am I", "show me the stats".
---
```

**Step 3: Create `~/nc/skills/codex.md`**

Copy from `commands/codex.md` with frontmatter:

```markdown
---
name: codex
description: Use when the user wants to add, view, or update worldbuilding information — characters, locations, timeline, lore. Trigger on: "add to codex", "who is X", "where is Y", "update character Z", "what do I know about", "codex entry for", "add this character".
---
```

**Step 4: Create `~/nc/skills/reorder.md`**

Copy from `commands/reorder.md` with frontmatter. Add confirmation before renumbering files:

```markdown
---
name: reorder
description: Use when the user wants to restructure, reorganize, or renumber scenes. Trigger on: "move scene X before Y", "reorder", "restructure", "scene X should come first", "swap scenes N and M".
---
```

At the point in the logic where files would be renamed, add:

```
Before renumbering, confirm with user:
"This will rename [N] scene files. Proceed? (y/n)"
Only proceed if confirmed.
```

**Step 5: Create `~/nc/skills/new-project.md`**

Copy from `commands/new-project.md` with frontmatter. Remove all DevRag setup steps (Step 8 "Create DevRag config", Step 10 ".mcp.json setup"):

```markdown
---
name: new-project
description: Use when the user wants to start a completely new writing project. Trigger on: "new project", "start a new story", "create a project", "let's begin a new novel/story/novella", "I want to write something new".
---
```

Remove from the task steps:
- Any step that creates `.devrag/` or `config.json` for DevRag
- Any step that creates `.mcp.json`
- Any reference to `/setup-devrag`

Keep all other scaffolding (scenes/, codex/, summaries/, brainstorms/, manuscript/, project.json, hooks).

**Step 6: Verify**

```bash
ls ~/nc/skills/
```

Expected: 10 files including new ones: `codex.md  new-project.md  reorder.md  scenes.md  status.md`

---

### Task 3: Session skills with confirmation on destructive action

**Files:**
- Create: `~/nc/skills/session-start.md`
- Create: `~/nc/skills/session-end.md`

**Step 1: Create `~/nc/skills/session-start.md`**

```markdown
---
name: session-start
description: Use when the user is beginning a writing session, explicitly says they want to start, or when it's the first writing-related interaction in a new Claude Code session in a writing project. Trigger on: "start session", "let's begin", "starting to write", "I want to write today", or infer from context when user opens a project and gives their first task.
---

# Session Start

Begin a writing session and initialize tracking.

## Task

1. **Check for existing active session**:
   - Read `notes/current-session.json` if it exists
   - If active session found: "You have an active session from [time]. Continue it or start fresh?"

2. **Get current project stats**:
   - Read `project.json` for word count and scene count
   - Record as session baseline

3. **Ask for session goal (optional)**:
   - "What do you want to write today? (or skip)"
   - Accept: word count target, scene count, specific scene, or "no goal"

4. **Create `notes/current-session.json`**:
   ```json
   {
     "startTime": "<ISO-8601 timestamp>",
     "startWordCount": <number>,
     "startSceneCount": <number>,
     "sessionGoal": "<goal or null>",
     "status": "active"
   }
   ```

5. **Output**:
   ```
   ✓ Session started at [time]
   Baseline: [N] scenes, [N] words
   Goal: [goal or "open session"]
   ```
```

**Step 2: Create `~/nc/skills/session-end.md`**

```markdown
---
name: session-end
description: Use when the user signals they are done writing for now. Trigger on: "wrapping up", "done for today", "end session", "that's it for today", "save and close", "I'm done writing", "calling it a day". Always confirm before committing to git.
---

# Session End

Close the writing session, log stats, and commit work.

## Task

1. **Check for active session**:
   - Read `notes/current-session.json`
   - If no active session: "No active session found. Nothing to close."

2. **Calculate stats**:
   - Duration: now - startTime (in minutes)
   - Words written: current word count - startWordCount
   - Scenes written: current scene count - startSceneCount
   - Words/hour: (wordsWritten / duration) * 60

3. **Show summary and confirm**:
   ```
   Session summary:
   ⏱  Duration: [N] minutes
   ✍️  Words: [+N] ([total] total)
   📄  Scenes: [+N] ([total] total)
   🚀  Pace: [N] words/hour
   Goal: [achieved/not achieved]

   Save stats and commit to git? (y/n)
   ```
   Only proceed if user confirms.

4. **If confirmed**:
   - Append to `notes/session-log.json`:
     ```json
     {
       "date": "YYYY-MM-DD",
       "startTime": "<ISO>",
       "endTime": "<ISO>",
       "duration": <minutes>,
       "wordsWritten": <number>,
       "scenesWritten": <number>,
       "wordsPerHour": <number>,
       "goal": "<string>",
       "goalAchieved": <boolean>
     }
     ```
   - Delete `notes/current-session.json`
   - Run git add + commit:
     ```bash
     git add -A && git commit -m "session: +[N] words, [N] scenes ([date])"
     ```

5. **Output**:
   ```
   ✓ Session logged and committed.
   Streak: [N] days
   ```

6. **Streak calculation**:
   - Check `notes/session-log.json` for consecutive dates
   - Update streak in session-log metadata
```

**Step 3: Verify**

```bash
ls ~/nc/skills/ | grep session
```

Expected: `session-end.md  session-start.md`

---

### Task 4: Search skill (grep-based, replaces DevRag)

**Files:**
- Create: `~/nc/skills/search.md`

**Step 1: Create `~/nc/skills/search.md`**

```markdown
---
name: search
description: Use when the user wants to find something in their manuscript, codex, notes, or brainstorms. Trigger on: "find X", "where did I mention", "search for", "which scene has", "look for", "did I write about", "find all references to".
---

# Search Project

Search across scenes, codex, and notes using keyword and pattern matching.

## Task

1. **Parse the search query** from user input.

2. **Search across project directories**:

   Use the Grep tool to search these locations:
   - `scenes/` — scene files
   - `codex/` — worldbuilding entries
   - `brainstorms/` — brainstorm sessions
   - `summaries/` — reverse outlines
   - `notes/` — session notes (excluding current-session.json)

   Run grep with `-i` (case insensitive) and `-l` (file names) first to find matching files, then read the relevant sections.

3. **Present results grouped by type**:
   ```
   🔍 Search: "[query]"

   📝 Scenes (N matches):
   - scene-003.md: "...matching context..."
   - scene-012.md: "...matching context..."

   📚 Codex (N matches):
   - characters.md: "...matching context..."

   💭 Notes/Brainstorms (N matches):
   - brainstorms/magic-rules.md: "...matching context..."
   ```

4. **If no results**: "Nothing found for '[query]'. Try a broader term?"

5. **Follow-up**: Offer to open any matching file for full context.

## Notes

- No external dependencies — uses Claude's built-in Grep tool
- For semantic/conceptual search, describe what you're looking for in plain language and Claude will interpret
- Searches file content, not filenames
```

**Step 2: Verify**

```bash
cat ~/nc/skills/search.md | head -5
```

Expected: frontmatter with name and description.

---

### Task 5: Summarize skill (Task tool replaces Gemini)

**Files:**
- Create: `~/nc/skills/summarize.md`

**Step 1: Create `~/nc/skills/summarize.md`**

```markdown
---
name: summarize
description: Use when the user wants a reverse outline, summary of what they've written, beat sheet, or structure overview of their story. Trigger on: "summarize", "reverse outline", "what did I write", "outline what I have", "beat sheet", "show me the structure", "summarize scenes X to Y".
---

# Summarize / Reverse Outline

Generate a reverse outline of written scenes using a fast subagent.

## Task

1. **Determine scope** from user input:
   - Single scene: "summarize scene 3"
   - Range: "summarize scenes 1-8"
   - All scenes: "summarize everything" / "reverse outline"
   - Continuity check: "check continuity across scenes"

2. **Read the scene files** in scope.

3. **Dispatch Task tool with haiku model**:

   Use the Task tool to spawn a subagent with this prompt template:

   ```
   You are summarizing fiction scenes for a discovery writer creating a reverse outline.

   Task: [scene-summary | reverse-outline | continuity-check]

   Scenes to analyze:
   [scene content]

   For scene-summary: Return key events, character decisions, emotional beats, POV, timeline placement. 2-3 sentences per scene.

   For reverse-outline: Return a beat-by-beat breakdown — what actually happens in each scene, what it accomplishes structurally, any setup/payoff pairs. Numbered list.

   For continuity-check: Flag timeline inconsistencies, character detail contradictions, unresolved threads, and logic gaps. Be specific (scene numbers and exact details).

   Be concise. This is a working document, not a literary analysis.
   ```

   Use model: haiku (fast and cheap for summarization).

4. **Save output** to `summaries/`:
   - Single scene: `summaries/summary-scene-NNN.md`
   - Range/All: `summaries/reverse-outline-[date].md`
   - Continuity: `summaries/continuity-check-[date].md`

   Include header:
   ```
   # [Type] — [scope]
   Generated: [date]
   Scenes analyzed: [N]
   ```

5. **Confirm**: "Saved to summaries/[filename]"
```

**Step 2: Verify**

```bash
head -5 ~/nc/skills/summarize.md
```

Expected: frontmatter block.

---

### Task 6: Publishing skills

**Files:**
- Create: `~/nc/skills/compile.md`
- Create: `~/nc/skills/blurb.md`
- Create: `~/nc/skills/cover.md`
- Create: `~/nc/skills/import.md`

**Step 1: Create `~/nc/skills/compile.md`**

Copy logic from `commands/compile.md` with frontmatter. Add confirmation before writing files:

```markdown
---
name: compile
description: Use when the user wants to assemble the complete manuscript into a single document. Trigger on: "compile", "put it together", "assemble manuscript", "I need the manuscript file", "generate the manuscript", "export to Word/EPUB".
---
```

In the task steps, before writing to `manuscript/`, add:

```
Before writing any files, confirm:
"This will write [project-name]-manuscript.md to manuscript/. [Format: MD/DOCX]. Proceed? (y/n)"
Only proceed if confirmed.
```

**Step 2: Create `~/nc/skills/blurb.md`**

Copy from `commands/blurb.md` with frontmatter:

```markdown
---
name: blurb
description: Use when the user needs back-cover copy, a book description, a query letter pitch, or marketing copy for the story. Trigger on: "write a blurb", "book description", "back cover copy", "pitch the story", "Amazon description", "marketing copy".
---
```

**Step 3: Create `~/nc/skills/cover.md`**

Copy from `commands/cover.md` with frontmatter:

```markdown
---
name: cover
description: Use when the user needs a cover design brief, concept, or art direction for the book cover. Trigger on: "cover concept", "cover brief", "cover design", "what should the cover look like", "describe the cover".
---
```

**Step 4: Create `~/nc/skills/import.md`**

Copy from `commands/import.md` with frontmatter. Add confirmation before writing files:

```markdown
---
name: import
description: Use when the user wants to bring an existing manuscript written elsewhere into an NC project. Trigger on: "import", "I wrote this in Word", "bring in my draft", "import manuscript", "I have existing scenes to import".
---
```

Before any file writes, add:

```
Confirm before overwriting:
"This will create [N] scene files in scenes/. Any existing scenes with the same numbers will be moved to scenes/archive/. Proceed? (y/n)"
```

**Step 5: Verify all 18 skills exist**

```bash
ls ~/nc/skills/ | wc -l
```

Expected: 18

```bash
ls ~/nc/skills/
```

Expected: `blurb.md  brainstorm.md  chat.md  codex.md  compile.md  cover.md  cycle.md  edit-scene.md  import.md  new-project.md  new-scene.md  reorder.md  scenes.md  search.md  session-end.md  session-start.md  status.md  summarize.md`

---

### Task 7: Update plugin.json

**Files:**
- Modify: `~/nc/.claude-plugin/plugin.json`

**Step 1: Read current plugin.json**

```bash
cat ~/nc/.claude-plugin/plugin.json
```

**Step 2: Update plugin.json**

Replace entirely with:

```json
{
  "name": "fiction-writer",
  "version": "2.0.0",
  "description": "Discovery writing system for fiction authors. Intent-driven skills for scene writing, worldbuilding, session tracking, search, and manuscript compilation.",
  "author": {
    "name": "Lakshmi Narasimhan P",
    "url": "https://github.com/badri"
  },
  "homepage": "https://github.com/badri/novel-claude",
  "repository": "https://github.com/badri/novel-claude",
  "license": "MIT",
  "keywords": [
    "fiction",
    "writing",
    "novel",
    "discovery-writing",
    "worldbuilding",
    "manuscript",
    "pulp-fiction",
    "creative-writing",
    "authoring"
  ]
}
```

(Skills are auto-discovered from `skills/` folder — no explicit registration needed in plugin.json.)

**Step 3: Verify**

```bash
python3 -m json.tool ~/nc/.claude-plugin/plugin.json > /dev/null && echo "valid JSON"
```

Expected: `valid JSON`

---

### Task 8: Remove DevRag and Gemini infrastructure

**Files:**
- Delete: `~/nc/scripts/search/devrag-search.sh`
- Delete: `~/nc/commands/setup-devrag.md`
- Delete: `~/nc/commands/search.md`
- Delete: `~/nc/commands/summarize.md`
- Delete: `~/nc/agents/gemini-summarizer.md`
- Delete: `~/nc/scripts/summarize/gemini-wrapper.sh`
- Modify: `~/nc/.mcp.json` — remove devrag server
- Delete: `~/nc/config.json` (root-level DevRag config, superseded)
- Delete: `~/nc/config.json.template`

**Step 1: Remove DevRag files**

```bash
rm ~/nc/scripts/search/devrag-search.sh
rm ~/nc/commands/setup-devrag.md
rm ~/nc/commands/search.md
rm ~/nc/commands/summarize.md
```

**Step 2: Remove Gemini files**

```bash
rm ~/nc/agents/gemini-summarizer.md
rm ~/nc/scripts/summarize/gemini-wrapper.sh
```

**Step 3: Remove DevRag MCP config**

```bash
cat ~/nc/.mcp.json
```

If the only server is `devrag`, delete the file:

```bash
rm ~/nc/.mcp.json
```

If there are other MCP servers, edit to remove only the `devrag` entry.

**Step 4: Remove stale DevRag config files**

```bash
rm -f ~/nc/config.json ~/nc/config.json.template
```

**Step 5: Verify no devrag references remain in skills/**

```bash
grep -r "devrag\|gemini-wrapper\|gemini-summarizer" ~/nc/skills/ && echo "FOUND — fix these" || echo "clean"
```

Expected: `clean`

**Step 6: Verify agents/ is empty or has only non-Gemini files**

```bash
ls ~/nc/agents/
```

Expected: empty or `.gitkeep` only.

---

### Task 9: Enable plugin at ~/writing/ level

**Files:**
- Create: `~/writing/.claude/settings.json`

**Step 1: Create directory**

```bash
mkdir -p ~/writing/.claude
```

**Step 2: Check global settings to confirm fiction-writer is disabled globally**

```bash
python3 -c "
import json
with open('/Users/lakshminp/.claude/settings.json') as f:
    s = json.load(f)
print(s.get('enabledPlugins', {}).get('fiction-writer@fiction-writer-marketplace', 'not set'))
"
```

Expected: `false` (disabled globally — good, we enable only at ~/writing/ level).

**Step 3: Create `~/writing/.claude/settings.json`**

```json
{
  "enabledPlugins": {
    "fiction-writer@fiction-writer-marketplace": true
  }
}
```

**Step 4: Verify**

```bash
cat ~/writing/.claude/settings.json | python3 -m json.tool
```

Expected: valid JSON with `fiction-writer` enabled.

---

### Task 10: Smoke test

**Step 1: Open a Claude Code session in ~/writing/firewall-devi/**

```bash
cd ~/writing/firewall-devi
```

Start Claude Code in this directory.

**Step 2: Test intent matching — scene list**

Say to Claude: `what scenes do I have?`

Expected: Claude invokes `scenes` skill without being explicitly told to. Returns scene list for firewall-devi.

**Step 3: Test intent matching — status**

Say: `how's the word count?`

Expected: Claude invokes `status` skill. Returns word count and scene count.

**Step 4: Test search**

Say: `find where Devi is introduced`

Expected: Claude invokes `search` skill. Uses Grep across scenes/ and codex/. Returns matching lines.

**Step 5: Test session start inference**

In a new Claude Code session in a writing project, say: `let's write today`

Expected: Claude invokes `session-start` skill. Creates `notes/current-session.json`.

**Step 6: Test session end confirmation**

Say: `wrapping up for today`

Expected: Claude invokes `session-end` skill. Shows summary. Asks for confirmation before committing. Does NOT commit until confirmed.

**Step 7: Test compile confirmation**

Say: `compile the manuscript`

Expected: Claude invokes `compile` skill. Asks for confirmation before writing any files.
