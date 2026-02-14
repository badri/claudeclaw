import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { JOBS_DIR } from "../constants";

export interface QuickJobInput {
  time?: unknown;
  prompt?: unknown;
}

export async function createQuickJob(input: QuickJobInput): Promise<{ name: string; schedule: string }> {
  const time = typeof input.time === "string" ? input.time.trim() : "";
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";

  if (!/^\d{2}:\d{2}$/.test(time)) {
    throw new Error("Invalid time. Use HH:MM.");
  }
  if (!prompt) {
    throw new Error("Prompt is required.");
  }
  if (prompt.length > 10_000) {
    throw new Error("Prompt too long.");
  }

  const hour = Number(time.slice(0, 2));
  const minute = Number(time.slice(3, 5));
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error("Time out of range.");
  }

  const schedule = `${minute} ${hour} * * *`;
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const name = `quick-${stamp}-${hour.toString().padStart(2, "0")}${minute.toString().padStart(2, "0")}`;
  const path = join(JOBS_DIR, `${name}.md`);
  const content = `---\nschedule: "${schedule}"\n---\n${prompt}\n`;

  await mkdir(JOBS_DIR, { recursive: true });
  await writeFile(path, content, "utf-8");
  return { name, schedule };
}
