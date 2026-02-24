import { join, isAbsolute } from "path";
import { mkdir } from "fs/promises";
import { existsSync } from "fs";
import { normalizeTimezoneName, resolveTimezoneOffsetMinutes } from "./timezone";
import { CLAUDECLAW_DIR, SETTINGS_FILE, JOBS_DIR, LOGS_DIR, WORKSPACE_DIR, MEMORY_DIR, SKILLS_DIR, TELEGRAM_INBOX_DIR, WHISPER_DIR } from "./paths";

const DEFAULT_SETTINGS: Settings = {
  model: "",
  api: "",
  fallback: {
    model: "",
    api: "",
  },
  timezone: "UTC",
  timezoneOffsetMinutes: 0,
  heartbeat: {
    enabled: false,
    interval: 15,
    prompt: "",
    excludeWindows: [],
  },
  telegram: { token: "", allowedUserIds: [], routes: [] },
  security: { level: "moderate", allowedTools: [], disallowedTools: [] },
  web: { enabled: false, host: "127.0.0.1", port: 4632 },
  memory: {
    embeddings: { provider: "none", model: "", api: "", baseUrl: "" },
  },
  browser: { enabled: false, engine: "chromium" },
  agents: { default: "main", list: [] },
};

export interface HeartbeatExcludeWindow {
  days?: number[];
  start: string;
  end: string;
}

export interface HeartbeatConfig {
  enabled: boolean;
  interval: number;
  prompt: string;
  excludeWindows: HeartbeatExcludeWindow[];
}

export interface TelegramRoute {
  chatId: number;
  topicId?: number;
  agentId: string;
}

export interface TelegramConfig {
  token: string;
  allowedUserIds: number[];
  /** Route table: maps chat/topic → agent. More-specific rules (chatId+topicId) win. */
  routes: TelegramRoute[];
}

export type SecurityLevel =
  | "locked"
  | "strict"
  | "moderate"
  | "unrestricted";

export interface SecurityConfig {
  level: SecurityLevel;
  allowedTools: string[];
  disallowedTools: string[];
}

export interface AgentConfig {
  /** Unique slug, e.g. 'main', 'content', 'ideas' */
  id: string;
  /** Human-readable display name */
  name?: string;
  /** Inline system prompt text or path to a .md file */
  systemPrompt?: string;
  /** Optional workspace directory override; defaults to ~/.claudeclaw/agents/<id>/ */
  workspace?: string;
}

export interface AgentsConfig {
  /** Agent id to use when none is specified. Default: 'main' */
  default: string;
  /** Explicitly configured agents. The 'main' agent always exists implicitly. */
  list: AgentConfig[];
}

export interface Settings {
  model: string;
  api: string;
  fallback: ModelConfig;
  timezone: string;
  timezoneOffsetMinutes: number;
  heartbeat: HeartbeatConfig;
  telegram: TelegramConfig;
  security: SecurityConfig;
  web: WebConfig;
  memory: MemoryConfig;
  browser: BrowserConfig;
  agents: AgentsConfig;
}

export interface ModelConfig {
  model: string;
  api: string;
}

export interface WebConfig {
  enabled: boolean;
  host: string;
  port: number;
}

export type EmbeddingsProvider = "openai" | "ollama" | "none";

export interface MemoryEmbeddingsConfig {
  provider: EmbeddingsProvider;
  /** Model name. Defaults: openai → "text-embedding-3-small", ollama → "nomic-embed-text" */
  model: string;
  /** API key for openai. Falls back to OPENAI_API_KEY env var. */
  api: string;
  /** Base URL override. Defaults: openai → "https://api.openai.com", ollama → "http://localhost:11434" */
  baseUrl: string;
}

export interface MemoryConfig {
  embeddings: MemoryEmbeddingsConfig;
}

export type BrowserEngine = "chromium" | "lightpanda";

export interface BrowserConfig {
  enabled: boolean;
  /** Browser engine to use. Default: "chromium". "lightpanda" is experimental. */
  engine: BrowserEngine;
}

let cached: Settings | null = null;

export async function initConfig(): Promise<void> {
  await mkdir(CLAUDECLAW_DIR, { recursive: true });
  await mkdir(WORKSPACE_DIR, { recursive: true });
  await mkdir(JOBS_DIR, { recursive: true });
  await mkdir(LOGS_DIR, { recursive: true });
  await mkdir(MEMORY_DIR, { recursive: true });
  await mkdir(SKILLS_DIR, { recursive: true });
  await mkdir(TELEGRAM_INBOX_DIR, { recursive: true });
  await mkdir(WHISPER_DIR, { recursive: true });

  if (!existsSync(SETTINGS_FILE)) {
    await Bun.write(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2) + "\n");
  }
}

const VALID_LEVELS = new Set<SecurityLevel>([
  "locked",
  "strict",
  "moderate",
  "unrestricted",
]);

function parseSettings(raw: Record<string, any>): Settings {
  const rawLevel = raw.security?.level;
  const level: SecurityLevel =
    typeof rawLevel === "string" && VALID_LEVELS.has(rawLevel as SecurityLevel)
      ? (rawLevel as SecurityLevel)
      : "moderate";

  const parsedTimezone = parseTimezone(raw.timezone);

  return {
    model: typeof raw.model === "string" ? raw.model.trim() : "",
    api: typeof raw.api === "string" ? raw.api.trim() : "",
    fallback: {
      model: typeof raw.fallback?.model === "string" ? raw.fallback.model.trim() : "",
      api: typeof raw.fallback?.api === "string" ? raw.fallback.api.trim() : "",
    },
    timezone: parsedTimezone,
    timezoneOffsetMinutes: parseTimezoneOffsetMinutes(raw.timezoneOffsetMinutes, parsedTimezone),
    heartbeat: {
      enabled: raw.heartbeat?.enabled ?? false,
      interval: raw.heartbeat?.interval ?? 15,
      prompt: raw.heartbeat?.prompt ?? "",
      excludeWindows: parseExcludeWindows(raw.heartbeat?.excludeWindows),
    },
    telegram: {
      token: raw.telegram?.token ?? "",
      allowedUserIds: raw.telegram?.allowedUserIds ?? [],
      routes: parseTelegramRoutes(raw.telegram?.routes),
    },
    security: {
      level,
      allowedTools: Array.isArray(raw.security?.allowedTools)
        ? raw.security.allowedTools
        : [],
      disallowedTools: Array.isArray(raw.security?.disallowedTools)
        ? raw.security.disallowedTools
        : [],
    },
    web: {
      enabled: raw.web?.enabled ?? false,
      host: raw.web?.host ?? "127.0.0.1",
      port: Number.isFinite(raw.web?.port) ? Number(raw.web.port) : 4632,
    },
    memory: {
      embeddings: parseEmbeddingsConfig(raw.memory?.embeddings),
    },
    browser: parseBrowserConfig(raw.browser),
    agents: parseAgentsConfig(raw.agents),
  };
}

function parseAgentConfig(raw: unknown): AgentConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id.trim() : "";
  if (!id) return null;
  return {
    id,
    name: typeof r.name === "string" ? r.name.trim() : undefined,
    systemPrompt: typeof r.systemPrompt === "string" ? r.systemPrompt.trim() : undefined,
    workspace: typeof r.workspace === "string" ? r.workspace.trim() : undefined,
  };
}

function parseAgentsConfig(raw: unknown): AgentsConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const defaultAgent = typeof r.default === "string" ? r.default.trim() || "main" : "main";
  const list = Array.isArray(r.list)
    ? r.list.map(parseAgentConfig).filter((a): a is AgentConfig => a !== null)
    : [];
  return { default: defaultAgent, list };
}

function parseTelegramRoutes(raw: unknown): TelegramRoute[] {
  if (!Array.isArray(raw)) return [];
  const routes: TelegramRoute[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const r = entry as Record<string, unknown>;
    const chatId = Number(r.chatId);
    const agentId = typeof r.agentId === "string" ? r.agentId.trim() : "";
    if (!Number.isFinite(chatId) || !agentId) continue;
    const route: TelegramRoute = { chatId, agentId };
    if (typeof r.topicId === "number" && Number.isFinite(r.topicId)) {
      route.topicId = r.topicId;
    }
    routes.push(route);
  }
  return routes;
}

const VALID_BROWSER_ENGINES = new Set<BrowserEngine>(["chromium", "lightpanda"]);

function parseBrowserConfig(raw: unknown): BrowserConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rawEngine = r.engine;
  const engine: BrowserEngine =
    typeof rawEngine === "string" && VALID_BROWSER_ENGINES.has(rawEngine as BrowserEngine)
      ? (rawEngine as BrowserEngine)
      : "chromium";
  return {
    enabled: r.enabled === true,
    engine,
  };
}

const VALID_EMBEDDING_PROVIDERS = new Set<EmbeddingsProvider>(["openai", "ollama", "none"]);

function parseEmbeddingsConfig(raw: unknown): MemoryEmbeddingsConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rawProvider = r.provider;
  const provider: EmbeddingsProvider =
    typeof rawProvider === "string" && VALID_EMBEDDING_PROVIDERS.has(rawProvider as EmbeddingsProvider)
      ? (rawProvider as EmbeddingsProvider)
      : "none";
  return {
    provider,
    model: typeof r.model === "string" ? r.model.trim() : "",
    api: typeof r.api === "string" ? r.api.trim() : "",
    baseUrl: typeof r.baseUrl === "string" ? r.baseUrl.trim() : "",
  };
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

function parseTimezone(value: unknown): string {
  return normalizeTimezoneName(value);
}

function parseExcludeWindows(value: unknown): HeartbeatExcludeWindow[] {
  if (!Array.isArray(value)) return [];
  const out: HeartbeatExcludeWindow[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const start = typeof (entry as any).start === "string" ? (entry as any).start.trim() : "";
    const end = typeof (entry as any).end === "string" ? (entry as any).end.trim() : "";
    if (!TIME_RE.test(start) || !TIME_RE.test(end)) continue;

    const rawDays = Array.isArray((entry as any).days) ? (entry as any).days : [];
    const parsedDays = rawDays
      .map((d: unknown) => Number(d))
      .filter((d: number) => Number.isInteger(d) && d >= 0 && d <= 6);
    const uniqueDays = Array.from(new Set<number>(parsedDays)).sort((a: number, b: number) => a - b);

    out.push({
      start,
      end,
      days: uniqueDays.length > 0 ? uniqueDays : [...ALL_DAYS],
    });
  }
  return out;
}

function parseTimezoneOffsetMinutes(value: unknown, timezoneFallback?: string): number {
  return resolveTimezoneOffsetMinutes(value, timezoneFallback);
}

export async function loadSettings(): Promise<Settings> {
  if (cached) return cached;
  const raw = await Bun.file(SETTINGS_FILE).json();
  cached = parseSettings(raw);
  return cached;
}

/** Re-read settings from disk, bypassing cache. */
export async function reloadSettings(): Promise<Settings> {
  const raw = await Bun.file(SETTINGS_FILE).json();
  cached = parseSettings(raw);
  return cached;
}

export function getSettings(): Settings {
  if (!cached) throw new Error("Settings not loaded. Call loadSettings() first.");
  return cached;
}

const PROMPT_EXTENSIONS = [".md", ".txt", ".prompt"];

/**
 * If the prompt string looks like a file path (ends with .md, .txt, or .prompt),
 * read and return the file contents. Otherwise return the string as-is.
 * Relative paths are resolved from the project root (cwd).
 */
export async function resolvePrompt(prompt: string): Promise<string> {
  const trimmed = prompt.trim();
  if (!trimmed) return trimmed;

  const isPath = PROMPT_EXTENSIONS.some((ext) => trimmed.endsWith(ext));
  if (!isPath) return trimmed;

  const resolved = isAbsolute(trimmed) ? trimmed : join(process.cwd(), trimmed);
  try {
    const content = await Bun.file(resolved).text();
    return content.trim();
  } catch {
    console.warn(`[config] Prompt path "${trimmed}" not found, using as literal string`);
    return trimmed;
  }
}
