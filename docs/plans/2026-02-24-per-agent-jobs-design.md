# Per-Agent Jobs Design

**Date:** 2026-02-24  
**Status:** Approved

## Problem

Jobs in claudeclaw currently run against the global/main agent workspace.
There is no way to assign a scheduled job to a specific agent, meaning the job
runs without that agent's AGENTS.md, memory, or identity context.

## Decision

Approach B: each job spawns a **fresh session** for the target agent. The agent's
memory.md persists across runs so it accumulates knowledge over time, but there
is no collision risk with an in-progress conversation.

## Directory Structure

```
~/.claudeclaw/workspace/jobs/       # existing global (main agent) jobs
~/.claudeclaw/agents/<id>/jobs/     # new per-agent job directories
```

## Changes

### `src/paths.ts`
- Add `jobsDir: string` to `AgentPaths` interface
- `main` agent → `WORKSPACE_DIR/jobs` (backward compatible)
- Other agents → `join(AGENTS_DIR, id, "jobs")`

### `src/jobs.ts`
- `loadJobs(dir?: string)` — accepts optional dir, falls back to global `JOBS_DIR`
- `Job` interface gets `agentId?: string` field (set by caller, not parsed from file)
- `clearJobSchedule(name, dir?)` — same optional dir pattern

### `src/commands/start.ts`
- On startup: load jobs from main workspace + each agent in `settings.agents.list`
- Flatten into one `currentJobs: JobWithAgent[]` array
- Each entry carries its source `agentId`
- Cron tick: `run(job.name, prompt, job.agentId)` — passes agent to existing run()
- Hot-reload (every 30s): reload all agents' jobs using same multi-source pattern
- Startup log: show per-agent job grouping

## Job File Format

Unchanged. Drop a `.md` file in the agent's `jobs/` directory:

```markdown
---
schedule: 0 9 * * *
recurring: true
notify: true
---
Your prompt here.
```

## Backward Compatibility

- Global `~/.claudeclaw/workspace/jobs/` continues to work as the main agent's jobs
- No migration required
- Web UI continues to manage global jobs only (out of scope for this change)

## Out of Scope

- Web UI support for per-agent jobs
- Per-agent job management CLI commands
