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
export const WHISPER_DIR = join(CLAUDECLAW_DIR, "whisper");

// MCP config written at startup so runner.ts can pass --mcp-config to claude
export const MEMORY_MCP_CONFIG = join(CLAUDECLAW_DIR, "memory-mcp.json");
