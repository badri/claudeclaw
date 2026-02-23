import { readdir } from "fs/promises";
import { join } from "path";
import { PID_FILE, STATE_FILE, SETTINGS_FILE, JOBS_DIR } from "../paths";

function formatCountdown(ms: number): string {
  if (ms <= 0) return "now!";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return "<1m";
}

async function showStatus(): Promise<boolean> {
  let daemonRunning = false;
  let pid = "";
  try {
    pid = (await Bun.file(PID_FILE).text()).trim();
    process.kill(Number(pid), 0);
    daemonRunning = true;
  } catch {
    // not running or no pid file
  }

  if (!daemonRunning) {
    console.log(`\x1b[31m○ Daemon is not running\x1b[0m`);
    return false;
  }

  console.log(`\x1b[32m● Daemon is running\x1b[0m (PID ${pid})`);

  try {
    const settings = await Bun.file(SETTINGS_FILE).json();
    const hb = settings.heartbeat;
    const timezone =
      typeof settings?.timezone === "string" && settings.timezone.trim()
        ? settings.timezone.trim()
        : Intl.DateTimeFormat().resolvedOptions().timeZone || "system";
    const windows = Array.isArray(hb?.excludeWindows) ? hb.excludeWindows : [];
    console.log(
      `  Heartbeat: ${hb.enabled ? `every ${hb.interval}m` : "disabled"}`
    );
    if (hb.enabled) {
      console.log(`  Heartbeat timezone: ${timezone}`);
      console.log(`  Quiet windows: ${windows.length > 0 ? windows.length : "none"}`);
    }
  } catch {}

  try {
    const files = await readdir(JOBS_DIR);
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    if (mdFiles.length > 0) {
      console.log(`  Jobs: ${mdFiles.length}`);
      for (const f of mdFiles) {
        const content = await Bun.file(join(JOBS_DIR, f)).text();
        const match = content.match(/schedule:\s*["']?([^"'\n]+)/);
        const schedule = match ? match[1].trim() : "unknown";
        console.log(`    - ${f.replace(/\.md$/, "")} [${schedule}]`);
      }
    }
  } catch {}

  try {
    const state = await Bun.file(STATE_FILE).json();
    const now = Date.now();
    console.log("");
    if (state.heartbeat) {
      console.log(
        `  \x1b[31m♥\x1b[0m Next heartbeat: ${formatCountdown(state.heartbeat.nextAt - now)}`
      );
    }
    for (const job of state.jobs || []) {
      console.log(
        `  → ${job.name}: ${formatCountdown(job.nextAt - now)}`
      );
    }
  } catch {}

  return true;
}

export async function status(args: string[]) {
  await showStatus();
}
