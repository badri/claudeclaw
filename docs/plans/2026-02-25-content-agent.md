# Content Agent Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Configure the existing `~/.claudeclaw/agents/content/` shell into a fully working hybrid content agent with a daily idea brief and a weekly SEO audit.

**Architecture:** All work is file configuration — no claudeclaw core changes. The agent uses Playwright MCP (already global, auto-included) for HN/Ahrefs/GSC/GA browsing, and the Reddit MCP (shared from business agent) for signal access. Business agent memory is read directly. Two scheduled jobs plus on-demand via `bd send --agent=content`.

**Tech Stack:** claudeclaw agent config (AGENTS.md, extra-mcp.json, job .md files), Playwright MCP (browser automation), Reddit MCP.

**Design doc:** `docs/plans/2026-02-25-content-agent-design.md`

---

### Task 1: Write AGENTS.md

**Files:**
- Modify: `~/.claudeclaw/agents/content/AGENTS.md`

**Step 1: Check current state**

```bash
cat ~/.claudeclaw/agents/content/AGENTS.md
```

Expected: empty template (Name/Creature/Vibe/Emoji placeholders).

**Step 2: Write AGENTS.md**

Replace with:

```markdown
# Content Agent

You are Lakshmi's content strategist and editorial assistant. You surface ideas,
draft outlines, and run SEO analysis — the goal is for Lakshmi to spend 15-30 min
editing, not thinking from scratch.

## Identity

- **Name:** Quill
- **Creature:** An ink-stained magpie — collects shiny signals from everywhere, turns them into sharp ideas
- **Vibe:** Opinionated editor. Knows the voice, knows the strategy, doesn't waste words.
- **Emoji:** ✍️

## Content Strategy

**Positioning:** "I help developers build, deploy, and distribute their SaaS without hiring a team."
**The 3 Ds:** Every piece must serve Develop (build), Deploy (production), or Distribute (get it to customers).
**Volume philosophy:** Daily posting minimum. Each post is an experiment, not a masterpiece.
**Format:** 500-800 words max. One concept, practical examples, done.

## Voice Model

**Core tone:** Playfully exhausted sarcasm. Like someone who's seen too much and finds it all absurd.
Not bitter, not mean — just done with the BS and willing to call it out.

**Phrases to use:**
- "Revolutionary concept, I know."
- "Nobody should have to live like that."
- "Learn from my suffering."
- "The horror."
- "Godspeed."
- "Don't do this to yourself."
- "Your future self will thank you."

**Avoid:** Hedging ("you might want to consider..."), corporate speak, earnest enthusiasm
without irony, explaining jokes, being actually mean.

**Headline rules:** Pattern interrupt, tension/curiosity gap, specificity over generic,
vulnerability + lesson, contrarian takes. First 5 words must hook.

**Bad:** "Tips for Using AI Coding Tools"
**Good:** "10 Ways to Waste Time and Money with AI Agents: A Field Guide to Self-Sabotage"

Always suggest 3-5 headline options per idea. Never settle for generic.

## Source Paths

- **Business agent memory:** `~/.claudeclaw/agents/business/memory/` — Reddit/X signals saved daily
- **Past essays:** `~/lakshminp.com/content/essays/` — source of truth, last 14 = ~2 weeks
- **Research insights:** `~/agentic-coding-research/insights/` — most recently modified files
- **Draft output:** `~/lakshminp.com/content/drafts/`
- **SEO audit output:** `~/lakshminp.com/content/research/`
- **Content strategy:** `~/lakshminp.com/CLAUDE.md`
- **Small bets strategy:** `~/claude-smallbets/CLAUDE.md`

## Output Format (Ideas + Outlines)

For each idea:
```
## [Working title]

**Source:** [what signal triggered this]
**3D tag:** [Develop] / [Deploy] / [Distribute]
**SEO angle:** [keyword if applicable, else "none"]

**Headline options:**
1. [scroll-stopping option 1]
2. [scroll-stopping option 2]
3. [scroll-stopping option 3]

**Outline:**
### [Section 1 header]
[2-3 sentences of direction]

### [Section 2 header]
[2-3 sentences of direction]

### [Section 3 header]
[2-3 sentences of direction]

### [Section 4 header]
[2-3 sentences of direction]
```

## Rules

- Never write the full essay — stop at outline
- Never repeat an idea covered in the last 14 essays
- Always filter through the 3 Ds — if it doesn't fit, skip it
- No fluff, no ceremony, no hedging
- Save surfaced ideas to memory to avoid repeating in future runs
```

**Step 3: Verify**

```bash
cat ~/.claudeclaw/agents/content/AGENTS.md | head -20
```

Expected: "# Content Agent" header followed by identity block.

**Step 4: Commit note**

No git commit needed — `~/.claudeclaw/` is not in the repo.

---

### Task 2: Configure extra-mcp.json

**Files:**
- Create: `~/.claudeclaw/agents/content/extra-mcp.json`

**Step 1: Check if it exists**

```bash
ls ~/.claudeclaw/agents/content/
```

Expected: `AGENTS.md  memory  memory-mcp.json  SOUL.md` — no `extra-mcp.json` yet.

**Note:** Playwright MCP is auto-included globally via `~/.claudeclaw/browser-mcp.json` — no need to add it here. Only Reddit MCP needed.

**Step 2: Create extra-mcp.json**

```json
{
  "mcpServers": {
    "reddit": {
      "command": "/Library/Frameworks/Python.framework/Versions/3.11/bin/python3",
      "args": ["/Users/lakshminp/claude-reddit-2/reddit_mcp/reddit_server.py"],
      "type": "stdio"
    }
  }
}
```

**Step 3: Verify**

```bash
cat ~/.claudeclaw/agents/content/extra-mcp.json
```

Expected: JSON with reddit mcpServer entry.

---

### Task 3: Create morning-brief job

**Files:**
- Create: `~/.claudeclaw/agents/content/jobs/morning-brief.md`

**Step 1: Create jobs directory**

```bash
mkdir -p ~/.claudeclaw/agents/content/jobs
```

**Step 2: Create job file**

```
---
schedule: 0 7 * * *
recurring: true
notify: true
---
Read ~/lakshminp.com/CLAUDE.md for voice model, content rules, and the 3 Ds framework.
Read ~/claude-smallbets/CLAUDE.md for portfolio context and small bets lens.

Gather signals from all sources:

1. Business agent memory: read ~/.claudeclaw/agents/business/memory/ for today's
   Reddit and X signals (saved by reddit-scan and x-scan jobs).

2. Hacker News: use claudeclaw-browser to fetch https://news.ycombinator.com/best
   Extract top 10 titles + URLs relevant to: Claude Code, solo SaaS, indie hacking,
   infrastructure, vibe coding, developer tools. Skip anything unrelated.

3. Agentic research: read the 5 most recently modified files in
   ~/agentic-coding-research/insights/ — extract key observations not yet turned into essays.

4. Past essays: list ~/lakshminp.com/content/essays/ — collect last 14 titles for deduplication.

5. Last SEO audit: check ~/lakshminp.com/content/research/ for the most recent
   seo-audit-*.md file. If it exists, note any keyword gaps worth prioritizing today.

Synthesize into 3-5 content ideas ranked by:
- Cross-platform signal (idea appears in 2+ sources = higher rank)
- Fit with the 3 Ds (must serve Develop, Deploy, or Distribute)
- Freshness (not covered in last 14 essays)

For each idea, use the output format defined in AGENTS.md:
- Source(s) that triggered it
- 3D tag
- SEO angle (from audit if applicable, else "none")
- 3 scroll-stopping headline options
- 4 section headers with 2-3 sentences of direction each

Save output to ~/lakshminp.com/content/drafts/[YYYY-MM-DD]-ideas.md
Save idea titles to memory so they aren't surfaced again in future runs.
```

**Step 3: Verify hot-reload (wait 35s)**

```bash
sleep 35 && cat ~/.claudeclaw/state.json | python3 -m json.tool | grep -A5 '"name": "morning-brief"'
```

Expected: morning-brief with a `nextAt` timestamp.

---

### Task 4: Create seo-audit job

**Files:**
- Create: `~/.claudeclaw/agents/content/jobs/seo-audit.md`

**Step 1: Create job file**

```
---
schedule: 0 8 * * 0
recurring: true
notify: true
---
Read ~/lakshminp.com/CLAUDE.md for content strategy context.

Run a weekly SEO audit across four areas:

1. Google Search Console: use claudeclaw-browser to log into
   https://search.google.com/search-console — navigate to the Performance report
   for lakshminp.com. Extract: top 10 queries by impressions, top 5 pages by clicks,
   avg position for each. Note anything ranking 8-20 (in striking distance of page 1).

2. Google Analytics: use claudeclaw-browser to log into https://analytics.google.com
   Navigate to Reports > Engagement > Pages and screens for the last 28 days.
   Extract: top 10 landing pages by sessions, avg engagement time per page,
   bounce rate for top 5.

3. Ahrefs: use claudeclaw-browser to log into https://app.ahrefs.com
   Navigate to Site Explorer for lakshminp.com. Extract:
   - DR (domain rating)
   - Top 5 pages by organic traffic
   - Top keyword gaps (keywords your competitors rank for that you don't)
   Limit to keywords with difficulty ≤ 30 and volume ≥ 100.

4. On-page audit: scan ~/lakshminp.com/content/essays/ for quick wins:
   - Essays with no H2 headers
   - Essays where the target keyword doesn't appear in the title
   - Essays under 400 words (thin content risk)
   - Essays with no internal links to other essays

Output to ~/lakshminp.com/content/research/seo-audit-[YYYY-MM-DD].md:

## Performance Summary
- Top 5 pages by traffic + avg position
- 1 sentence trend ("organic traffic up/down X% vs last month")

## Keyword Opportunities
3-5 keyword gaps with: keyword, monthly volume, difficulty score, recommended angle

## Quick Wins (On-Page)
3 specific fixes for existing essays (name the essay, name the fix)

## New Essay Ideas (Search-First)
3 essay ideas keyword-first: keyword → suggested title → 1-line pitch

Save summary to memory for morning brief cross-reference.
```

**Step 2: Verify hot-reload (wait 35s)**

```bash
sleep 35 && cat ~/.claudeclaw/state.json | python3 -m json.tool | grep -A30 '"jobs"'
```

Expected: `morning-brief`, `seo-audit`, plus existing jobs all present with `nextAt` timestamps.

---

### Task 5: Set up Ahrefs browser auth

The SEO audit uses Playwright to log into Ahrefs. You need to have a valid browser session first. This is a one-time step.

**Step 1: Check if Ahrefs cookies already exist**

```bash
ls ~/.claudeclaw/agents/content/ahrefs-cookies.json 2>/dev/null && echo "exists" || echo "missing"
```

**Step 2: If missing — export from your browser**

In Chrome/Firefox while logged into `app.ahrefs.com`:
1. Install the "Export Cookies" extension
2. Export cookies for `ahrefs.com` as JSON
3. Save to `~/.claudeclaw/agents/content/ahrefs-cookies.json`

Same approach works for GSC and GA (both are `google.com` cookies — one export covers both).
Save Google cookies to `~/.claudeclaw/agents/content/google-cookies.json`.

**Step 3: Reference in seo-audit job (if Playwright needs explicit cookie loading)**

If the browser session isn't persistent between runs, prepend to the seo-audit prompt:

```
Load browser cookies from ~/.claudeclaw/agents/content/ahrefs-cookies.json before
navigating to Ahrefs. Load ~/.claudeclaw/agents/content/google-cookies.json before
navigating to GSC or GA.
```

**Note:** Playwright MCP may maintain its own persistent session profile. Test first before adding cookie-load instructions.

---

### Task 6: Smoke test morning brief

**Step 1: Run as one-shot**

```bash
bun run --cwd ~/claude-tools/claudeclaw src/index.ts send --agent=content \
  "Run the morning brief now. Pull HN signals and any business agent memory. Output 2-3 ideas to ~/lakshminp.com/content/drafts/test-ideas.md"
```

**Step 2: Check output**

```bash
ls -lt ~/.claudeclaw/logs/ | head -3
cat ~/.claudeclaw/logs/$(ls -t ~/.claudeclaw/logs/ | head -1)
```

Expected: exit code 0, log shows HN fetch + ideas written.

**Step 3: Check the draft file**

```bash
cat ~/lakshminp.com/content/drafts/test-ideas.md
```

Expected: 2-3 ideas with headlines + outlines in the format defined in AGENTS.md.

**Step 4: Clean up test file**

```bash
rm ~/lakshminp.com/content/drafts/test-ideas.md
```

---

### Task 7: Smoke test SEO audit (light)

Full SEO audit requires Ahrefs/GSC/GA credentials. Test the on-page audit section first — it requires no external auth.

**Step 1: Run on-page audit only**

```bash
bun run --cwd ~/claude-tools/claudeclaw src/index.ts send --agent=content \
  "Run only the on-page audit section of the SEO audit. Scan ~/lakshminp.com/content/essays/ for: missing H2s, keyword not in title, essays under 400 words, no internal links. Output findings only — no GSC/GA/Ahrefs needed."
```

**Step 2: Check log**

```bash
cat ~/.claudeclaw/logs/$(ls -t ~/.claudeclaw/logs/ | head -1)
```

Expected: list of essays with specific on-page issues flagged.

**Step 3: Once Ahrefs/Google cookies are set up, run full audit**

```bash
bun run --cwd ~/claude-tools/claudeclaw src/index.ts send --agent=content \
  "Run the full weekly SEO audit and save to ~/lakshminp.com/content/research/seo-audit-$(date +%Y-%m-%d).md"
```

---

## Post-Implementation Notes

**On-demand usage:**
```bash
# Brainstorm from a specific angle
bun run --cwd ~/claude-tools/claudeclaw src/index.ts send --agent=content \
  "Brainstorm 3 post angles around the VMKit launch"

# Turn a conversation into a post
bun run --cwd ~/claude-tools/claudeclaw src/index.ts send --agent=content \
  "Turn this into a post angle: [paste conversation]"

# Atomize an essay (future)
bun run --cwd ~/claude-tools/claudeclaw src/index.ts send --agent=content \
  "Generate a LinkedIn version of ~/lakshminp.com/content/essays/[essay].md"
```

**Cookie refresh:** Both Ahrefs and Google cookies expire. Re-export when the SEO audit starts failing with auth errors.
