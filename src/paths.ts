/**
 * Central path registry for claudeclaw.
 *
 * All runtime data lives under ~/.claudeclaw/ — a global, user-level directory
 * that mirrors openclaw's ~/.openclaw/ layout so config is portable and not
 * tied to a specific project working directory.
 *
 * Directory layout:
 *
 *   ~/.claudeclaw/
 *     settings.json          — daemon configuration
 *     state.json             — countdown / next-run state for statusline
 *     session.json           — active Claude session ID
 *     daemon.pid             — running daemon PID
 *     workspace/
 *       AGENTS.md            — agent identity / persona (mirrors openclaw)
 *       SOUL.md              — behavioral guidelines (mirrors openclaw)
 *       MEMORY.md            — persistent memory, groomed across sessions
 *       memory/              — dated daily journal entries (YYYY-MM-DD.md)
 *       skills/              — user-authored skills (mirrors openclaw)
 *       jobs/                — cron job definitions (*.md with frontmatter)
 *     logs/                  — per-run execution logs
 *     inbox/
 *       telegram/            — Telegram message inbox
 *     whisper/               — voice transcription temp files
 */

import { join } from "path";
import { homedir } from "os";

export const CLAUDECLAW_DIR = join(homedir(), ".claudeclaw");

// Top-level files
export const SETTINGS_FILE = join(CLAUDECLAW_DIR, "settings.json");
export const STATE_FILE = join(CLAUDECLAW_DIR, "state.json");
export const SESSION_FILE = join(CLAUDECLAW_DIR, "session.json");
export const PID_FILE = join(CLAUDECLAW_DIR, "daemon.pid");

// Workspace (mirrors openclaw ~/.openclaw/workspace/)
export const WORKSPACE_DIR = join(CLAUDECLAW_DIR, "workspace");
export const AGENTS_MD = join(WORKSPACE_DIR, "AGENTS.md");
export const SOUL_MD = join(WORKSPACE_DIR, "SOUL.md");
export const MEMORY_MD = join(WORKSPACE_DIR, "MEMORY.md");
export const MEMORY_DIR = join(WORKSPACE_DIR, "memory");
export const SKILLS_DIR = join(WORKSPACE_DIR, "skills");
export const JOBS_DIR = join(WORKSPACE_DIR, "jobs");

// Runtime dirs
export const LOGS_DIR = join(CLAUDECLAW_DIR, "logs");
export const TELEGRAM_INBOX_DIR = join(CLAUDECLAW_DIR, "inbox", "telegram");
export const SLACK_INBOX_DIR = join(CLAUDECLAW_DIR, "inbox", "slack");
export const WHISPER_DIR = join(CLAUDECLAW_DIR, "whisper");

// MCP config written at startup so runner.ts can pass --mcp-config to claude
export const MEMORY_MCP_CONFIG = join(CLAUDECLAW_DIR, "memory-mcp.json");

// MCP config for @playwright/mcp browser control (written when browser.enabled is true)
export const BROWSER_MCP_CONFIG = join(CLAUDECLAW_DIR, "browser-mcp.json");

// MCP config for the agent bridge (send_to_agent tool — written at startup)
export const AGENT_BRIDGE_MCP_CONFIG = join(CLAUDECLAW_DIR, "agent-bridge-mcp.json");

// SQLite database for cached memory chunk embeddings
export const MEMORY_EMBEDDINGS_DB = join(CLAUDECLAW_DIR, "memory-embeddings.db");

// Per-agent workspace root
export const AGENTS_DIR = join(CLAUDECLAW_DIR, "agents");

export interface AgentPaths {
  workspaceDir: string;
  agentsMd: string;
  soulMd: string;
  memoryMd: string;
  memoryDir: string;
  sessionFile: string;
  memoryMcpConfig: string;
  mcpConfig: string;
  jobsDir: string;
}

/**
 * Resolve all workspace paths for a given agent.
 *
 * The 'main' agent maps to the legacy global paths so existing installs
 * require no migration. All other agents get an isolated workspace under
 * ~/.claudeclaw/agents/<id>/ (or a custom override directory).
 */
export function getAgentPaths(agentId: string, customWorkspace?: string): AgentPaths {
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
      jobsDir: JOBS_DIR,
    };
  }

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
    jobsDir: join(workspaceDir, "jobs"),
  };
}
