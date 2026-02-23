import { unlink, readdir, rename } from "fs/promises";
import { join, dirname } from "path";
import { CLAUDECLAW_DIR, getAgentPaths } from "./paths";

export interface GlobalSession {
  sessionId: string;
  createdAt: string;
  lastUsedAt: string;
}

// Per-agent session cache keyed by agentId
const cache = new Map<string, GlobalSession>();

function sessionFilePath(agentId: string): string {
  return getAgentPaths(agentId).sessionFile;
}

async function loadSession(agentId: string): Promise<GlobalSession | null> {
  const cached = cache.get(agentId);
  if (cached) return cached;
  try {
    const session = await Bun.file(sessionFilePath(agentId)).json();
    cache.set(agentId, session);
    return session;
  } catch {
    return null;
  }
}

async function saveSession(agentId: string, session: GlobalSession): Promise<void> {
  cache.set(agentId, session);
  await Bun.write(sessionFilePath(agentId), JSON.stringify(session, null, 2) + "\n");
}

/** Returns the existing session or null. Never creates one. */
export async function getSession(agentId = "main"): Promise<{ sessionId: string } | null> {
  const existing = await loadSession(agentId);
  if (existing) {
    existing.lastUsedAt = new Date().toISOString();
    await saveSession(agentId, existing);
    return { sessionId: existing.sessionId };
  }
  return null;
}

/** Save a session ID obtained from Claude Code's output. */
export async function createSession(sessionId: string, agentId = "main"): Promise<void> {
  await saveSession(agentId, {
    sessionId,
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
  });
}

/** Returns session metadata without mutating lastUsedAt. */
export async function peekSession(agentId = "main"): Promise<GlobalSession | null> {
  return await loadSession(agentId);
}

export async function resetSession(agentId = "main"): Promise<void> {
  cache.delete(agentId);
  try {
    await unlink(sessionFilePath(agentId));
  } catch {
    // already gone
  }
}

export async function backupSession(agentId = "main"): Promise<string | null> {
  const existing = await loadSession(agentId);
  if (!existing) return null;

  const file = sessionFilePath(agentId);
  // Main agent keeps backups in CLAUDECLAW_DIR (legacy behaviour); others use workspace dir
  const backupDir = agentId === "main" ? CLAUDECLAW_DIR : dirname(file);

  let files: string[];
  try {
    files = await readdir(backupDir);
  } catch {
    files = [];
  }
  const indices = files
    .filter((f) => /^session_\d+\.backup$/.test(f))
    .map((f) => Number(f.match(/^session_(\d+)\.backup$/)![1]));
  const nextIndex = indices.length > 0 ? Math.max(...indices) + 1 : 1;

  const backupName = `session_${nextIndex}.backup`;
  const backupPath = join(backupDir, backupName);
  await rename(file, backupPath);
  cache.delete(agentId);

  return backupName;
}
