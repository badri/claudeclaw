# X.com MCP + Daily Intelligence Flow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire the `mcp-twikit` MCP server into the business agent so claudeclaw can fetch live X data, then create two daily jobs: niche signal scanning and own-account analytics.

**Architecture:** Use the existing `mcp-twikit` package (wraps twikit, no build needed) via `uvx`. Add it to the business agent's `extra-mcp.json` alongside the existing Reddit MCP. Two cron jobs consume it: `x-scan` (competitor/niche signals, runs same time as reddit-scan) and `x-analytics` (own account performance, runs weekly). Credentials stored as environment variables in the MCP config.

**Tech Stack:** Python, twikit (via mcp-twikit), `uvx`, claudeclaw per-agent jobs, extra-mcp.json pattern established in cc-2cs.

**Beads Epic:** cc-2cs

---

### Task 1: Install mcp-twikit and verify it works

**Files:**
- No code changes — just install and smoke test

**Step 1: Install uvx if not present**

```bash
which uvx || pip3 install uv
```

Expected: path to uvx binary.

**Step 2: Test-run mcp-twikit directly**

```bash
uvx --from git+https://github.com/adhikasp/mcp-twikit mcp-twikit --help 2>&1 | head -20
```

Expected: help output or "missing credentials" error (not import error).

**Step 3: Verify twikit auth works (one-time cookie setup)**

twikit stores a cookies file after first login. Run this once interactively so subsequent runs are cookie-based (no password needed in env after that):

```bash
python3 -c "
import asyncio, twikit
async def check():
    c = twikit.Client('en-US')
    # twikit uses cookies.json after first auth
    print('twikit importable, version:', twikit.__version__)
asyncio.run(check())
" 2>&1
```

If twikit not installed: `pip3 install twikit`

**Step 4: Commit note**

No code to commit here — just a prerequisite check.

---

### Task 2: Configure mcp-twikit in business agent's extra-mcp.json

**Files:**
- Modify: `~/.claudeclaw/agents/business/extra-mcp.json`

**Step 1: Check current contents**

```bash
cat ~/.claudeclaw/agents/business/extra-mcp.json
```

Currently contains: reddit MCP entry.

**Step 2: Update extra-mcp.json to add X server**

Replace the file with:

```json
{
  "mcpServers": {
    "reddit": {
      "command": "/Library/Frameworks/Python.framework/Versions/3.11/bin/python3",
      "args": ["/Users/lakshminp/claude-reddit-2/reddit_mcp/reddit_server.py"],
      "type": "stdio"
    },
    "x": {
      "command": "uvx",
      "args": ["--from", "git+https://github.com/adhikasp/mcp-twikit", "mcp-twikit"],
      "env": {
        "TWITTER_USERNAME": "@YOUR_USERNAME",
        "TWITTER_EMAIL": "your@email.com",
        "TWITTER_PASSWORD": "your_password"
      }
    }
  }
}
```

Replace the placeholder credentials with real ones.

**Step 3: Restart daemon to pick up new MCP config**

```bash
kill $(cat ~/.claudeclaw/claudeclaw.pid) 2>/dev/null; sleep 1
bun run --cwd ~/claude-tools/claudeclaw src/index.ts start 2>/tmp/claw-startup.log &
sleep 4 && cat /tmp/claw-startup.log | head -20
```

**Step 4: Verify MCP merges correctly**

```bash
cat ~/.claudeclaw/agents/business/mcp.json
```

Expected: merged JSON with `claudeclaw-memory`, `reddit`, and `x` servers all present.

---

### Task 3: Create the x-scan daily job

**Files:**
- Create: `~/.claudeclaw/agents/business/jobs/x-scan.md`

**Step 1: Create the job file**

```
---
schedule: 0 9 * * *
recurring: true
notify: true
---
Read ~/claude-smallbets/CLAUDE.md for context on the portfolio and evaluation criteria.

Search X for today's signals in your niche using the x MCP tools (search_twitter):
- Queries: "I wish there was a tool", "anyone built", "looking for a tool", "hate that there's no", "why is there no app"
- Filter to: SaaS, indie hacking, developer tools, solo founder pain points
- Also search your key topic areas from CLAUDE.md

For each signal found, evaluate through the small bets lens:
1. Distribution: How would anyone find a solution?
2. Build cost: Is this an afternoon with Claude Code?
3. Signal speed: How fast would you know if it works?
4. Cross-pollination: Product idea, or better as a blog post?
5. Fit: Does it compound existing skills/audience/products?

Cross-reference with today's Reddit scan (already in memory) — flag anything that appears on both platforms as a strong signal.

Output a ranked shortlist (max 5) with buy/skip/blog-fodder verdict per item.
Save findings and verdicts to memory so duplicates aren't surfaced in future runs.
```

**Step 2: Verify hot-reload picks it up (wait up to 30s)**

```bash
sleep 35 && cat ~/.claudeclaw/state.json | python3 -m json.tool | grep -A3 '"jobs"'
```

Expected: `x-scan` and `reddit-scan` both appear in jobs list.

---

### Task 4: Create the x-analytics weekly job

**Files:**
- Create: `~/.claudeclaw/agents/business/jobs/x-analytics.md`

**Step 1: Create the job file**

```
---
schedule: 0 8 * * 1
recurring: true
notify: true
---
Fetch your X timeline using get_timeline (x MCP tool). Focus on the past week.

Analyze your own recent tweets for:
1. Which got the most engagement (likes, retweets, replies)?
2. What topics/formats performed best?
3. Any tweet that underperformed but should have done well — what went wrong?
4. Patterns: thread vs single tweet, question vs statement, morning vs evening?

Then check what's resonating in your niche this week (search_twitter for your key topics).

Output:
- Top 3 performing tweets this week with engagement stats
- 1-sentence pattern insight ("threads about X outperform single tweets by 2x")
- 3 content ideas for next week based on what's working
- 1 thing to stop doing

Save the weekly summary to memory for trend tracking over time.
```

**Step 2: Verify hot-reload**

```bash
sleep 35 && cat ~/.claudeclaw/state.json | python3 -m json.tool | grep -A10 '"jobs"'
```

Expected: `x-scan`, `x-analytics`, and `reddit-scan` all in jobs list.

---

### Task 5: Smoke test x-scan manually

**Step 1: Run x-scan as a one-shot to verify MCP tools work**

```bash
bun run --cwd ~/claude-tools/claudeclaw src/index.ts send --agent=business "Use the x MCP tools to search Twitter for 'I wish there was a tool that' and return the top 5 results. Just the titles/text, no analysis needed."
```

**Step 2: Check the log**

```bash
ls -lt ~/.claudeclaw/logs/ | head -3
cat ~/.claudeclaw/logs/$(ls -t ~/.claudeclaw/logs/ | head -1)
```

Expected: 5 tweet excerpts in the output. If you see `Error: TWITTER_USERNAME not set` — credentials in extra-mcp.json need updating.

**Step 3: Fix any auth issues**

If twikit complains about login/cookies on first run, you may need to do a one-time interactive auth:

```bash
python3 - <<'EOF'
import asyncio, twikit

async def login():
    client = twikit.Client('en-US')
    await client.login(
        auth_info_1='@YOUR_USERNAME',
        auth_info_2='your@email.com',
        password='your_password'
    )
    client.save_cookies('~/.claudeclaw/agents/business/x-cookies.json')
    print("Cookies saved!")

asyncio.run(login())
EOF
```

Then update `extra-mcp.json` to pass the cookies path via env if mcp-twikit supports it (check `uvx --from git+https://github.com/adhikasp/mcp-twikit mcp-twikit --help`).

---

### Task 6: Update reddit-scan to cross-reference X findings

**Files:**
- Modify: `~/.claudeclaw/agents/business/jobs/reddit-scan.md`

**Step 1: Add X cross-reference instruction to the existing job**

Append to the prompt (after the evaluation criteria):

```
After completing the Reddit scan, check memory for any X signals saved today by x-scan.
If an idea appears on both Reddit and X, bump it to the top of the shortlist — dual-platform
signal is a strong buy indicator.
```

This is non-breaking — if x-scan hasn't run yet, memory just won't have X data and it silently skips.

---

## SuperX Product Direction (future tasks in cc-2cs epic)

The claudeclaw infra you have is already the engine. The product layer:

- **Data layer:** mcp-twikit (reads), official API or twikit (writes/scheduling)
- **Analysis layer:** business agent jobs accumulating memory over weeks
- **Surface layer:** claudeclaw web UI (`--web`) as the dashboard, Telegram for push
- **Differentiation vs SuperX:** yours is AI-native — not just stats, but "here's what to do next and why"

Break these out as separate beads issues when ready to build the product layer.
