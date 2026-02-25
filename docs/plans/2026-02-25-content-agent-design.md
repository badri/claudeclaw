# Content Agent Design

**Date:** 2026-02-25
**Agent:** `~/.claudeclaw/agents/content/` (shell already exists)
**Approach:** Hybrid — scheduled daily brief + on-demand transforms + weekly SEO audit

---

## Goal

Reduce the user's daily content work to 15-30 min of editing. The agent handles signal aggregation, ideation, outlining, and SEO review. The user brings direction, expertise, and final voice polish.

---

## Architecture

### Agent Setup

Fill out the existing `~/.claudeclaw/agents/content/` shell:

- **AGENTS.md** — agent identity + full voice model (from `~/lakshminp.com/CLAUDE.md`), content rules (3 Ds, no fluff, 800 words max), source paths, output conventions
- **extra-mcp.json** — Reddit MCP (reuse business agent config) + Playwright MCP (for HN and Ahrefs)
- **Two scheduled jobs:** `morning-brief.md`, `seo-audit.md`
- No claudeclaw core changes needed

### MCP Servers

| Server | Purpose |
|--------|---------|
| Reddit MCP | Same config as business agent |
| Playwright MCP | HN scraping, Ahrefs UI automation |
| Memory MCP | Already configured (memory-mcp.json exists) |

### Credentials (one-time user setup)

| Tool | Method |
|------|--------|
| GSC | API credentials → env var in extra-mcp.json |
| GA4 | API credentials → env var in extra-mcp.json |
| Ahrefs | Playwright session with saved cookies (same pattern as X) |

---

## Input Sources

| Source | How | Used by |
|--------|-----|---------|
| Reddit/X signals | Business agent memory (already saved daily) | Morning brief |
| Hacker News | Playwright → `news.ycombinator.com/best` | Morning brief |
| agentic-coding-research | File reads from `~/agentic-coding-research/insights/` | Morning brief |
| Past essays | File reads from `~/lakshminp.com/content/essays/` (last 14) | Morning brief, SEO audit |
| User-provided conversation/note | Pasted inline in on-demand prompt | On-demand only |
| GSC | GA4 API | SEO audit |
| GA4 | GA4 API | SEO audit |
| Ahrefs | Playwright UI automation | SEO audit |

---

## Jobs

### 1. Morning Brief (`morning-brief.md`)

**Schedule:** `0 7 * * *` (daily 7am)

**Prompt logic:**
1. Read `~/lakshminp.com/CLAUDE.md` for voice model, content rules, 3 Ds
2. Pull signals:
   - Business agent memory → today's Reddit + X findings
   - Playwright → HN Best, extract top 10 titles relevant to Claude Code / solo SaaS / indie hacking / infra / vibe coding
   - `~/agentic-coding-research/insights/` → 5 most recently modified files
   - `~/lakshminp.com/content/essays/` → last 14 titles (dedup)
3. Check last weekly SEO audit → flag if any idea has a keyword-first angle worth prioritizing
4. Synthesize 3-5 ideas ranked by: cross-platform signal strength, 3D fit, freshness
5. For each idea output:
   - Source(s) that triggered it
   - 3 scroll-stopping headline options
   - 4 section headers
   - 2-3 sentences of direction per section
   - 3D tag: [Develop] / [Deploy] / [Distribute]
   - SEO flag if applicable
6. Save to `~/lakshminp.com/content/drafts/YYYY-MM-DD-ideas.md`
7. Save idea titles to memory (dedup future runs)

### 2. SEO Audit (`seo-audit.md`)

**Schedule:** `0 8 * * 0` (Sundays 8am)

**Prompt logic:**
1. Pull ranking data from GSC API (search queries, impressions, clicks, avg position)
2. Pull traffic data from GA4 API (top landing pages, bounce rate, time on page)
3. Use Playwright → Ahrefs: keyword gaps, DR trends, backlink opportunities
4. Scan `~/lakshminp.com/content/essays/` for on-page issues:
   - Missing H2s
   - No target keyword in title
   - Thin content (<400 words)
   - No internal links
5. Output to `~/lakshminp.com/content/research/seo-audit-YYYY-MM-DD.md`:
   - Top 5 pages by traffic + current avg position
   - 3-5 keyword gaps (search intent you could own)
   - 3 on-page quick wins for existing essays
   - 3 new essay ideas, keyword-first with estimated search volume
6. Save summary to memory for morning brief cross-reference

---

## On-Demand Usage

No job file needed — user triggers via:

```bash
bd send --agent=content "turn this conversation into a post angle: [paste]"
bd send --agent=content "brainstorm angles around the VMKit launch"
bd send --agent=content "I just published [essay]. generate LinkedIn + Reddit versions."
```

The agent reads AGENTS.md for voice/rules on every invocation. Memory persists ideas already surfaced so it doesn't repeat itself.

---

## Output Conventions

| Output | Location |
|--------|----------|
| Daily ideas + outlines | `~/lakshminp.com/content/drafts/YYYY-MM-DD-ideas.md` |
| SEO audit report | `~/lakshminp.com/content/research/seo-audit-YYYY-MM-DD.md` |
| On-demand outputs | Printed to session log (user copies what they need) |

---

## Out of Scope (for now)

- Auto-publishing to Substack/LinkedIn/Medium (atomization pipeline — future)
- Full content calendar generation (future)
- Writing complete drafts (agent stops at outline; user writes from there)
