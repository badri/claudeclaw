import { join } from "path";
import { unlink } from "fs/promises";
import { randomUUID } from "crypto";

const HEARTBEAT_DIR = join(process.cwd(), ".claude", "heartbeat");
const SESSION_FILE = join(HEARTBEAT_DIR, "session.json");

interface GlobalSession {
  sessionId: string;
  createdAt: string;
  lastUsedAt: string;
}

let current: GlobalSession | null = null;

async function loadSession(): Promise<GlobalSession | null> {
  if (current) return current;
  try {
    current = await Bun.file(SESSION_FILE).json();
    return current;
  } catch {
    return null;
  }
}

async function saveSession(session: GlobalSession): Promise<void> {
  current = session;
  await Bun.write(SESSION_FILE, JSON.stringify(session, null, 2) + "\n");
}

export async function getOrCreateSession(): Promise<{ sessionId: string; isNew: boolean }> {
  const existing = await loadSession();
  if (existing) {
    existing.lastUsedAt = new Date().toISOString();
    await saveSession(existing);
    return { sessionId: existing.sessionId, isNew: false };
  }

  const session: GlobalSession = {
    sessionId: randomUUID(),
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
  };
  await saveSession(session);
  return { sessionId: session.sessionId, isNew: true };
}

export async function resetSession(): Promise<void> {
  current = null;
  try {
    await unlink(SESSION_FILE);
  } catch {
    // already gone
  }
}
