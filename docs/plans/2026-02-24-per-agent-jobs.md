# Per-Agent Jobs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow each claudeclaw agent to have its own `jobs/` directory so cron jobs run in that agent's context (fresh session, agent memory preserved).

**Architecture:** Add `jobsDir` to `AgentPaths`, parameterize `loadJobs(dir?)` and `clearJobSchedule(name, dir?)`, then update `start.ts` to load and track jobs from all agents and pass `agentId` to `run()` on execution.

**Tech Stack:** TypeScript, Bun, existing claudeclaw cron/jobs/paths infrastructure.

---

### Task 1: Add `jobsDir` to `AgentPaths`

**Files:**
- Modify: `src/paths.ts:69-112`

**Step 1: Add `jobsDir` to the interface**

In `AgentPaths` interface (line 69), add one field:

```typescript
export interface AgentPaths {
  workspaceDir: string;
  agentsMd: string;
  soulMd: string;
  memoryMd: string;
  memoryDir: string;
  sessionFile: string;
  memoryMcpConfig: string;
  mcpConfig: string;
  jobsDir: string;  // add this
}
```

**Step 2: Set `jobsDir` in the `main` branch of `getAgentPaths()` (line 88)**

```typescript
if (agentId === "main" && !customWorkspace) {
  return {
    workspaceDir: WORKSPACE_DIR,
    agentsMd: AGENTS_MD,
    soulMd: SOUL_MD,
    memoryMd: MEMORY_MD,
    memoryDir: MEMORY_DIR,
    sessionFile: SESSION_FILE,
    memoryMcpConfig: MEMORY_MCP_CONFIG,
    mcpConfig: join(CLAUDECLAW_DIR, "mcp.json"),
    jobsDir: JOBS_DIR,  // add this
  };
}
```

**Step 3: Set `jobsDir` in the non-main branch (line 101)**

```typescript
const workspaceDir = customWorkspace ?? join(AGENTS_DIR, agentId);
return {
  workspaceDir,
  agentsMd: join(workspaceDir, "AGENTS.md"),
  soulMd: join(workspaceDir, "SOUL.md"),
  memoryMd: join(workspaceDir, "MEMORY.md"),
  memoryDir: join(workspaceDir, "memory"),
  sessionFile: join(workspaceDir, "session.json"),
  memoryMcpConfig: join(workspaceDir, "memory-mcp.json"),
  mcpConfig: join(workspaceDir, "mcp.json"),
  jobsDir: join(workspaceDir, "jobs"),  // add this
};
```

**Step 4: Type-check**

```bash
cd ~/claude-tools/claudeclaw && bun tsc --noEmit
```

Expected: errors about `jobsDir` missing at call sites (fixed in later tasks).

**Step 5: Commit**

```bash
git add src/paths.ts
git commit -m "feat(paths): add jobsDir to AgentPaths"
```

---

### Task 2: Parameterize `loadJobs` and `clearJobSchedule`

**Files:**
- Modify: `src/jobs.ts`

**Step 1: Add `agentId` to the `Job` interface**

Change (line 5):
```typescript
export interface Job {
  name: string;
  schedule: string;
  prompt: string;
  recurring: boolean;
  notify: true | false | "error";
  agentId: string;  // add this — set by loadJobs caller, not parsed from file
}
```

**Step 2: Replace `loadJobs` with parameterized version**

```typescript
export async function loadJobs(dir: string = JOBS_DIR, agentId: string = "main"): Promise<Job[]> {
  const jobs: Job[] = [];
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return jobs;
  }

  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const content = await Bun.file(join(dir, file)).text();
    const job = parseJobFile(file.replace(/\.md$/, ""), content);
    if (job) jobs.push({ ...job, agentId });
  }
  return jobs;
}
```

**Step 3: Replace `clearJobSchedule` with parameterized version**

```typescript
export async function clearJobSchedule(jobName: string, dir: string = JOBS_DIR): Promise<void> {
  const path = join(dir, `${jobName}.md`);
  const content = await Bun.file(path).text();
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) return;

  const filteredFrontmatter = match[1]
    .split("\n")
    .filter((line) => !line.trim().startsWith("schedule:"))
    .join("\n")
    .trim();

  const body = match[2].trim();
  const next = `---\n${filteredFrontmatter}\n---\n${body}\n`;
  await Bun.write(path, next);
}
```

**Step 4: Type-check**

```bash
bun tsc --noEmit
```

Expected: errors in `start.ts` where `Job` is used (now has required `agentId`).

**Step 5: Commit**

```bash
git add src/jobs.ts
git commit -m "feat(jobs): add dir/agentId params to loadJobs and clearJobSchedule"
```

---

### Task 3: Load all agents' jobs in `start.ts` and route execution

**Files:**
- Modify: `src/commands/start.ts`

**Step 1: Verify imports at top of file**

`getAgentPaths` and `JOBS_DIR` need to be imported. Check existing imports and add if missing:

```typescript
import { JOBS_DIR, getAgentPaths } from "../paths";
```

**Step 2: Add `loadAllJobs` helper**

Add this function inside `startDaemon`, right before the line `const jobs = await loadJobs()` (line 332):

```typescript
async function loadAllJobs(s: Settings): Promise<Job[]> {
  const agentList = s.agents?.list ?? [];
  const sources = [
    { agentId: "main", dir: JOBS_DIR },
    ...agentList.map((a) => ({ agentId: a.id, dir: getAgentPaths(a.id).jobsDir })),
  ];
  const results = await Promise.all(
    sources.map(({ agentId, dir }) => loadJobs(dir, agentId))
  );
  return results.flat();
}
```

**Step 3: Replace `loadJobs()` call at startup (line 332)**

```typescript
const jobs = await loadAllJobs(settings);
```

**Step 4: Replace `loadJobs()` in hot-reload interval (line 604)**

```typescript
const newJobs = await loadAllJobs(currentSettings);
```

**Step 5: Replace `loadJobs()` in Web UI `onJobsChanged` callback (line 467)**

```typescript
currentJobs = await loadAllJobs(currentSettings);
```

**Step 6: Pass `agentId` to `run()` in the cron tick (line 687)**

Change:
```typescript
.then((prompt) => run(job.name, prompt))
```
to:
```typescript
.then((prompt) => run(job.name, prompt, job.agentId))
```

**Step 7: Pass `dir` to `clearJobSchedule` in the cron tick finally block (line 696)**

Change:
```typescript
await clearJobSchedule(job.name);
```
to:
```typescript
await clearJobSchedule(job.name, getAgentPaths(job.agentId).jobsDir);
```

**Step 8: Update startup log to show agent per job (line 358)**

Change:
```typescript
jobs.forEach((j) => console.log(`    - ${j.name} [${j.schedule}]`));
```
to:
```typescript
jobs.forEach((j) => console.log(`    - ${j.name} [${j.schedule}] → agent: ${j.agentId}`));
```

**Step 9: Type-check**

```bash
bun tsc --noEmit
```

Expected: no errors.

**Step 10: Commit**

```bash
git add src/commands/start.ts
git commit -m "feat(start): load per-agent jobs and route execution to correct agent"
```

---

### Task 4: Smoke test + create Reddit scanner job

**Step 1: Create a test job for the business agent**

```bash
mkdir -p ~/.claudeclaw/agents/business/jobs
```

Create `~/.claudeclaw/agents/business/jobs/test-job.md`:
```
---
schedule: * * * * *
recurring: true
notify: false
---
Say "per-agent job works" and nothing else.
```

**Step 2: Restart the daemon**

```bash
claudeclaw --stop && claudeclaw start
```

**Step 3: Check startup log**

Expected output includes:
```
Jobs loaded: 1
  - test-job [* * * * *] → agent: business
```

**Step 4: Wait one minute, check logs**

```bash
ls -lt ~/.claudeclaw/logs/ | head -5
```

Open the most recent log. Expected: output from the business agent saying "per-agent job works".

**Step 5: Remove test job**

```bash
rm ~/.claudeclaw/agents/business/jobs/test-job.md
```

**Step 6: Create the Reddit scanner job**

Create `~/.claudeclaw/agents/business/jobs/reddit-scan.md`:
```
---
schedule: 0 9 * * *
recurring: true
notify: true
---
Read ~/claude-smallbets/CLAUDE.md for context on the portfolio and evaluation criteria.

Scan Reddit (r/SaaS, r/entrepreneur, r/indiehackers, r/solofounder) and Hacker News
for today's complaints, frustrations, and "I wish there was a tool that..." posts.

For each signal found, evaluate through the small bets lens:
1. Distribution: How would anyone find a solution?
2. Build cost: Is this an afternoon with Claude Code?
3. Signal speed: How fast would you know if it works?
4. Cross-pollination: Product idea, or better as a blog post?
5. Fit: Does it compound existing skills/audience/products?

Output a ranked shortlist (max 5) with buy/skip/blog-fodder verdict per item.
Save findings and verdicts to memory so duplicates aren't surfaced in future runs.
```

**Step 7: Final commit**

```bash
git add -A
git commit -m "feat: add reddit-scan job to business agent"
```
