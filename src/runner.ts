import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";
import { getSession, createSession } from "./sessions";
import { getSettings, type ModelConfig, type SecurityConfig, type BrowserConfig } from "./config";
import { buildClockPromptPrefix } from "./timezone";
import { LOGS_DIR, MEMORY_DIR, AGENTS_MD, SOUL_MD, MEMORY_MD, MEMORY_MCP_CONFIG, BROWSER_MCP_CONFIG } from "./paths";

// Resolve prompts relative to the claudeclaw installation, not the project dir
const PROMPTS_DIR = join(import.meta.dir, "..", "prompts");
const HEARTBEAT_PROMPT_FILE = join(PROMPTS_DIR, "heartbeat", "HEARTBEAT.md");
const PROJECT_CLAUDE_MD = join(process.cwd(), "CLAUDE.md");
const LEGACY_PROJECT_CLAUDE_MD = join(process.cwd(), ".claude", "CLAUDE.md");
const CLAUDECLAW_BLOCK_START = "<!-- claudeclaw:managed:start -->";
const CLAUDECLAW_BLOCK_END = "<!-- claudeclaw:managed:end -->";

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const RATE_LIMIT_PATTERN = /you(?:'|’)ve hit your limit/i;

// Serial queue — prevents concurrent --resume on the same session
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const task = queue.then(fn, fn);
  queue = task.catch(() => {});
  return task;
}

function extractRateLimitMessage(stdout: string, stderr: string): string | null {
  const candidates = [stdout, stderr];
  for (const text of candidates) {
    const trimmed = text.trim();
    if (trimmed && RATE_LIMIT_PATTERN.test(trimmed)) return trimmed;
  }
  return null;
}

function sameModelConfig(a: ModelConfig, b: ModelConfig): boolean {
  return a.model.trim().toLowerCase() === b.model.trim().toLowerCase() && a.api.trim() === b.api.trim();
}

function hasModelConfig(value: ModelConfig): boolean {
  return value.model.trim().length > 0 || value.api.trim().length > 0;
}

function buildChildEnv(baseEnv: Record<string, string>, model: string, api: string): Record<string, string> {
  const childEnv: Record<string, string> = { ...baseEnv };
  const normalizedModel = model.trim().toLowerCase();

  if (api.trim()) childEnv.ANTHROPIC_AUTH_TOKEN = api.trim();

  if (normalizedModel === "glm") {
    childEnv.ANTHROPIC_BASE_URL = "https://api.z.ai/api/anthropic";
    childEnv.API_TIMEOUT_MS = "3000000";
  }

  return childEnv;
}

async function runClaudeOnce(
  baseArgs: string[],
  model: string,
  api: string,
  baseEnv: Record<string, string>
): Promise<{ rawStdout: string; stderr: string; exitCode: number }> {
  const args = [...baseArgs];
  const normalizedModel = model.trim().toLowerCase();
  if (model.trim() && normalizedModel !== "glm") args.push("--model", model.trim());

  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
    env: buildChildEnv(baseEnv, model, api),
  });

  const [rawStdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;

  return {
    rawStdout,
    stderr,
    exitCode: proc.exitCode ?? 1,
  };
}

const PROJECT_DIR = process.cwd();

const DIR_SCOPE_PROMPT = [
  `CRITICAL SECURITY CONSTRAINT: You are scoped to the project directory: ${PROJECT_DIR}`,
  "You MUST NOT read, write, edit, or delete any file outside this directory.",
  "You MUST NOT run bash commands that modify anything outside this directory (no cd /, no /etc, no ~/, no ../.. escapes).",
  "If a request requires accessing files outside the project, refuse and explain why.",
].join("\n");

export async function ensureProjectClaudeMd(): Promise<void> {
  // Preflight-only initialization: never rewrite an existing project CLAUDE.md.
  if (existsSync(PROJECT_CLAUDE_MD)) return;

  const promptContent = (await loadPrompts()).trim();
  const managedBlock = [
    CLAUDECLAW_BLOCK_START,
    promptContent,
    CLAUDECLAW_BLOCK_END,
  ].join("\n");

  let content = "";

  if (existsSync(LEGACY_PROJECT_CLAUDE_MD)) {
    try {
      const legacy = await readFile(LEGACY_PROJECT_CLAUDE_MD, "utf8");
      content = legacy.trim();
    } catch (e) {
      console.error(`[${new Date().toLocaleTimeString()}] Failed to read legacy .claude/CLAUDE.md:`, e);
      return;
    }
  }

  const normalized = content.trim();
  const hasManagedBlock =
    normalized.includes(CLAUDECLAW_BLOCK_START) && normalized.includes(CLAUDECLAW_BLOCK_END);
  const managedPattern = new RegExp(
    `${CLAUDECLAW_BLOCK_START}[\\s\\S]*?${CLAUDECLAW_BLOCK_END}`,
    "m"
  );

  const merged = hasManagedBlock
    ? `${normalized.replace(managedPattern, managedBlock)}\n`
    : normalized
      ? `${normalized}\n\n${managedBlock}\n`
      : `${managedBlock}\n`;

  try {
    await writeFile(PROJECT_CLAUDE_MD, merged, "utf8");
  } catch (e) {
    console.error(`[${new Date().toLocaleTimeString()}] Failed to write project CLAUDE.md:`, e);
  }
}

// All tools exposed by @playwright/mcp — added to allowedTools when browser is enabled.
const PLAYWRIGHT_TOOLS = [
  "browser_click", "browser_close", "browser_console_messages", "browser_drag",
  "browser_evaluate", "browser_file_upload", "browser_fill_form", "browser_generate_locator",
  "browser_handle_dialog", "browser_hover", "browser_install", "browser_mouse_click_xy",
  "browser_mouse_down", "browser_mouse_drag_xy", "browser_mouse_move_xy", "browser_mouse_up",
  "browser_mouse_wheel", "browser_navigate", "browser_navigate_back", "browser_network_requests",
  "browser_pdf_save", "browser_press_key", "browser_resize", "browser_run_code",
  "browser_select_option", "browser_snapshot", "browser_tabs", "browser_take_screenshot",
  "browser_type", "browser_verify_element_visible", "browser_verify_list_visible",
  "browser_verify_text_visible", "browser_verify_value", "browser_wait_for",
];

function buildSecurityArgs(security: SecurityConfig, browser?: BrowserConfig): string[] {
  const args: string[] = ["--dangerously-skip-permissions"];

  switch (security.level) {
    case "locked":
      args.push("--tools", "Read,Grep,Glob");
      break;
    case "strict":
      args.push("--disallowedTools", "Bash,WebSearch,WebFetch");
      break;
    case "moderate":
      // all tools available, scoped to project dir via system prompt
      break;
    case "unrestricted":
      // all tools, no directory restriction
      break;
  }

  // Collect all allowedTools: user-configured + playwright tools (when browser enabled)
  const allowedTools = [...security.allowedTools];
  if (browser?.enabled && security.level !== "unrestricted") {
    allowedTools.push(...PLAYWRIGHT_TOOLS);
  }

  if (allowedTools.length > 0) {
    args.push("--allowedTools", allowedTools.join(","));
  }
  if (security.disallowedTools.length > 0) {
    args.push("--disallowedTools", security.disallowedTools.join(","));
  }

  return args;
}

/**
 * Load system prompt files. Workspace files (~/.claudeclaw/workspace/) take
 * priority over bundled templates (prompts/). Falls back gracefully if missing.
 *
 * Load order:
 *   1. AGENTS.md  — agent identity / persona
 *   2. SOUL.md    — behavioral guidelines
 *
 * MEMORY.md is no longer injected wholesale. Instead, memory_search and
 * memory_get MCP tools are available for on-demand recall.
 */
async function loadPrompts(): Promise<string> {
  const candidates: Array<{ workspace: string; fallback: string }> = [
    { workspace: AGENTS_MD, fallback: join(PROMPTS_DIR, "IDENTITY.md") },
    { workspace: SOUL_MD, fallback: join(PROMPTS_DIR, "SOUL.md") },
  ];
  const parts: string[] = [];

  for (const { workspace, fallback } of candidates) {
    const file = existsSync(workspace) ? workspace : fallback;
    try {
      const content = await Bun.file(file).text();
      if (content.trim()) parts.push(content.trim());
    } catch {
      // file missing — skip silently
    }
  }

  // Also load USER.md from bundled prompts (user-editable identity context)
  try {
    const user = await Bun.file(join(PROMPTS_DIR, "USER.md")).text();
    if (user.trim()) parts.push(user.trim());
  } catch {}

  // Memory recall instruction — tells Claude to use tools instead of relying on pre-loaded content
  if (existsSync(MEMORY_MD)) {
    parts.push(
      "## Memory Recall\n" +
      "Before answering anything about prior work, decisions, preferences, or todos: " +
      "run memory_search with a relevant query, then use memory_get to pull only the needed lines. " +
      "Citations: include Source: <path#line> when it helps verify memory snippets."
    );
  }

  return parts.join("\n\n");
}

/**
 * Write the MCP config file that registers the memory server.
 * Called once at startup so --mcp-config can point to a stable path.
 */
export async function writeMemoryMcpConfig(): Promise<void> {
  // Resolve the absolute path to the memory-server entry point
  const serverScript = join(import.meta.dir, "mcp", "memory-server.ts");
  const config = {
    mcpServers: {
      "claudeclaw-memory": {
        command: "bun",
        args: ["run", serverScript],
      },
    },
  };
  try {
    await writeFile(MEMORY_MCP_CONFIG, JSON.stringify(config, null, 2), "utf8");
  } catch (e) {
    console.error(`[${new Date().toLocaleTimeString()}] Failed to write memory MCP config:`, e);
  }
}

/**
 * Write the MCP config file that registers the @playwright/mcp browser server.
 * Called once at startup when settings.browser.enabled is true.
 */
export async function writeBrowserMcpConfig(): Promise<void> {
  // Resolve playwright-mcp binary from this package's node_modules
  const playwrightMcp = join(import.meta.dir, "..", "node_modules", ".bin", "playwright-mcp");
  const config = {
    mcpServers: {
      "claudeclaw-browser": {
        command: playwrightMcp,
        args: [],
      },
    },
  };
  try {
    await writeFile(BROWSER_MCP_CONFIG, JSON.stringify(config, null, 2), "utf8");
  } catch (e) {
    console.error(`[${new Date().toLocaleTimeString()}] Failed to write browser MCP config:`, e);
  }
}

/**
 * Auto-compact MEMORY.md if it exceeds MAX_MEMORY_CHARS characters.
 * Keeps the header line(s) and trims oldest lines from the top until it fits.
 * Prepends a note that older entries were removed.
 */
const MAX_MEMORY_CHARS = 16000; // ~4000 tokens

export async function compactMemoryIfNeeded(): Promise<void> {
  if (!existsSync(MEMORY_MD)) return;
  try {
    const content = await Bun.file(MEMORY_MD).text();
    if (content.length <= MAX_MEMORY_CHARS) return;

    // Split into lines, keep as many lines from the end as fit
    const lines = content.split("\n");
    const notice = "<!-- older entries removed by auto-compact -->";

    // Find how many trailing lines fit within limit (leaving room for the notice line)
    const budget = MAX_MEMORY_CHARS - notice.length - 2;
    let kept = 0;
    let total = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      const added = lines[i].length + 1; // +1 for newline
      if (total + added > budget) break;
      total += added;
      kept++;
    }

    const trimmed = [notice, ...lines.slice(lines.length - kept)].join("\n");
    await Bun.write(MEMORY_MD, trimmed);
    console.log(`[${new Date().toLocaleTimeString()}] MEMORY.md compacted (${content.length} → ${trimmed.length} chars)`);
  } catch {
    // best-effort — never fail a run
  }
}

/** Append a dated entry to the daily journal under ~/.claudeclaw/workspace/memory/. */
export async function appendJournalEntry(name: string, summary: string): Promise<void> {
  try {
    await mkdir(MEMORY_DIR, { recursive: true });
    const date = new Date().toISOString().split("T")[0];
    const file = join(MEMORY_DIR, `${date}.md`);
    const ts = new Date().toLocaleTimeString();
    const entry = `\n## [${ts}] ${name}\n\n${summary.trim()}\n`;
    const existing = existsSync(file) ? await Bun.file(file).text() : `# Journal — ${date}\n`;
    await Bun.write(file, existing + entry);
  } catch {
    // journal is best-effort — never fail a run because of it
  }
}

export async function loadHeartbeatPromptTemplate(): Promise<string> {
  try {
    const content = await Bun.file(HEARTBEAT_PROMPT_FILE).text();
    return content.trim();
  } catch {
    return "";
  }
}

async function execClaude(name: string, prompt: string): Promise<RunResult> {
  await mkdir(LOGS_DIR, { recursive: true });

  const existing = await getSession();
  const isNew = !existing;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logFile = join(LOGS_DIR, `${name}-${timestamp}.log`);

  const { security, model, api, fallback, browser } = getSettings();
  const primaryConfig: ModelConfig = { model, api };
  const fallbackConfig: ModelConfig = {
    model: fallback?.model ?? "",
    api: fallback?.api ?? "",
  };
  const securityArgs = buildSecurityArgs(security, browser);

  console.log(
    `[${new Date().toLocaleTimeString()}] Running: ${name} (${isNew ? "new session" : `resume ${existing.sessionId.slice(0, 8)}`}, security: ${security.level})`
  );

  // New session: use json output to capture Claude's session_id
  // Resumed session: use text output with --resume
  const outputFormat = isNew ? "json" : "text";
  const args = ["claude", "-p", prompt, "--output-format", outputFormat, ...securityArgs];

  if (!isNew) {
    args.push("--resume", existing.sessionId);
  }

  // Attach MCP server configs. Merge into a single file when both are active
  // because claude CLI only accepts one --mcp-config flag.
  const hasMemory = existsSync(MEMORY_MCP_CONFIG);
  const hasBrowser = existsSync(BROWSER_MCP_CONFIG);
  if (hasMemory && hasBrowser) {
    const mcpPath = join(homedir(), ".claudeclaw", "mcp.json");
    try {
      const memCfg = JSON.parse(await readFile(MEMORY_MCP_CONFIG, "utf8"));
      const brwCfg = JSON.parse(await readFile(BROWSER_MCP_CONFIG, "utf8"));
      const merged = { mcpServers: { ...memCfg.mcpServers, ...brwCfg.mcpServers } };
      await writeFile(mcpPath, JSON.stringify(merged, null, 2), "utf8");
      args.push("--mcp-config", mcpPath);
    } catch (e) {
      console.error(`[${new Date().toLocaleTimeString()}] Failed to merge MCP configs:`, e);
      args.push("--mcp-config", MEMORY_MCP_CONFIG);
    }
  } else if (hasMemory) {
    args.push("--mcp-config", MEMORY_MCP_CONFIG);
  } else if (hasBrowser) {
    args.push("--mcp-config", BROWSER_MCP_CONFIG);
  }

  // Build the appended system prompt: prompt files + directory scoping
  // This is passed on EVERY invocation (not just new sessions) because
  // --append-system-prompt does not persist across --resume.
  const promptContent = await loadPrompts();
  const appendParts: string[] = [
    "You are running inside ClaudeClaw.",
  ];
  if (promptContent) appendParts.push(promptContent);

  // Load the project's CLAUDE.md if it exists
  if (existsSync(PROJECT_CLAUDE_MD)) {
    try {
      const claudeMd = await Bun.file(PROJECT_CLAUDE_MD).text();
      if (claudeMd.trim()) appendParts.push(claudeMd.trim());
    } catch (e) {
      console.error(`[${new Date().toLocaleTimeString()}] Failed to read project CLAUDE.md:`, e);
    }
  }

  if (security.level !== "unrestricted") appendParts.push(DIR_SCOPE_PROMPT);
  if (appendParts.length > 0) {
    args.push("--append-system-prompt", appendParts.join("\n\n"));
  }

  // Strip CLAUDECODE env var so child claude processes don't think they're nested
  const { CLAUDECODE: _, ...cleanEnv } = process.env;
  const baseEnv = { ...cleanEnv } as Record<string, string>;

  let exec = await runClaudeOnce(args, primaryConfig.model, primaryConfig.api, baseEnv);
  const primaryRateLimit = extractRateLimitMessage(exec.rawStdout, exec.stderr);
  let usedFallback = false;

  if (primaryRateLimit && hasModelConfig(fallbackConfig) && !sameModelConfig(primaryConfig, fallbackConfig)) {
    console.warn(
      `[${new Date().toLocaleTimeString()}] Claude limit reached; retrying with fallback${fallbackConfig.model ? ` (${fallbackConfig.model})` : ""}...`
    );
    exec = await runClaudeOnce(args, fallbackConfig.model, fallbackConfig.api, baseEnv);
    usedFallback = true;
  }

  const rawStdout = exec.rawStdout;
  const stderr = exec.stderr;
  const exitCode = exec.exitCode;
  let stdout = rawStdout;
  let sessionId = existing?.sessionId ?? "unknown";
  const rateLimitMessage = extractRateLimitMessage(rawStdout, stderr);

  if (rateLimitMessage) {
    stdout = rateLimitMessage;
  }

  // For new sessions, parse the JSON to extract session_id and result text
  if (!rateLimitMessage && isNew && exitCode === 0) {
    try {
      const json = JSON.parse(rawStdout);
      sessionId = json.session_id;
      stdout = json.result ?? "";
      // Save the real session ID from Claude Code
      await createSession(sessionId);
      console.log(`[${new Date().toLocaleTimeString()}] Session created: ${sessionId}`);
    } catch (e) {
      console.error(`[${new Date().toLocaleTimeString()}] Failed to parse session from Claude output:`, e);
    }
  }

  const result: RunResult = {
    stdout,
    stderr,
    exitCode,
  };

  const output = [
    `# ${name}`,
    `Date: ${new Date().toISOString()}`,
    `Session: ${sessionId} (${isNew ? "new" : "resumed"})`,
    `Model config: ${usedFallback ? "fallback" : "primary"}`,
    `Prompt: ${prompt}`,
    `Exit code: ${result.exitCode}`,
    "",
    "## Output",
    stdout,
    ...(stderr ? ["## Stderr", stderr] : []),
  ].join("\n");

  await Bun.write(logFile, output);
  console.log(`[${new Date().toLocaleTimeString()}] Done: ${name} → ${logFile}`);

  // Append a brief journal entry so memory accumulates across sessions
  if (stdout.trim()) {
    await appendJournalEntry(name, stdout.slice(0, 500));
  }

  return result;
}

export async function run(name: string, prompt: string): Promise<RunResult> {
  return enqueue(() => execClaude(name, prompt));
}

function prefixUserMessageWithClock(prompt: string): string {
  try {
    const settings = getSettings();
    const prefix = buildClockPromptPrefix(new Date(), settings.timezoneOffsetMinutes);
    return `${prefix}\n${prompt}`;
  } catch {
    const prefix = buildClockPromptPrefix(new Date(), 0);
    return `${prefix}\n${prompt}`;
  }
}

export async function runUserMessage(name: string, prompt: string): Promise<RunResult> {
  return run(name, prefixUserMessageWithClock(prompt));
}

/**
 * Bootstrap the session: fires Claude with the system prompt so the
 * session is created immediately. No-op if a session already exists.
 */
export async function bootstrap(): Promise<void> {
  const existing = await getSession();
  if (existing) return;

  console.log(`[${new Date().toLocaleTimeString()}] Bootstrapping new session...`);
  await execClaude("bootstrap", "Wakeup, my friend!");
  console.log(`[${new Date().toLocaleTimeString()}] Bootstrap complete — session is live.`);
}
