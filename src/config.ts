import { join } from "path";

const HEARTBEAT_DIR = join(process.cwd(), ".claude", "heartbeat");
const SETTINGS_FILE = join(HEARTBEAT_DIR, "settings.json");

export interface HeartbeatConfig {
  enabled: boolean;
  interval: number;
  prompt: string;
}

export interface TelegramConfig {
  token: string;
  allowedUserIds: number[];
}

export interface Settings {
  heartbeat: HeartbeatConfig;
  telegram: TelegramConfig;
}

let cached: Settings | null = null;

export async function loadSettings(): Promise<Settings> {
  if (cached) return cached;
  const raw = await Bun.file(SETTINGS_FILE).json();
  cached = {
    heartbeat: {
      enabled: raw.heartbeat?.enabled ?? false,
      interval: raw.heartbeat?.interval ?? 15,
      prompt: raw.heartbeat?.prompt ?? "",
    },
    telegram: {
      token: raw.telegram?.token ?? "",
      allowedUserIds: raw.telegram?.allowedUserIds ?? [],
    },
  };
  return cached;
}

export function getSettings(): Settings {
  if (!cached) throw new Error("Settings not loaded. Call loadSettings() first.");
  return cached;
}
