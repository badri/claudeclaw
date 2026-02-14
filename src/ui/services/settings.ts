import { readFile, writeFile } from "fs/promises";
import { SETTINGS_FILE } from "../constants";

export async function setHeartbeatEnabled(enabled: boolean): Promise<void> {
  const raw = await readFile(SETTINGS_FILE, "utf-8");
  const data = JSON.parse(raw) as Record<string, any>;
  if (!data.heartbeat || typeof data.heartbeat !== "object") data.heartbeat = {};
  data.heartbeat.enabled = enabled;
  await writeFile(SETTINGS_FILE, JSON.stringify(data, null, 2) + "\n");
}
