import { ensureProjectClaudeMd, runUserMessage } from "../runner";
import { getSettings, loadSettings, type SlackRoute } from "../config";
import { resetSession } from "../sessions";
import { SLACK_INBOX_DIR } from "../paths";
import { mkdir } from "node:fs/promises";
import { extname, join } from "node:path";

// --- Slack Web API (raw fetch, zero deps) ---

const SLACK_API = "https://slack.com/api";

async function callSlackApi<T>(method: string, botToken: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${botToken}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Slack API ${method}: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { ok: boolean; error?: string } & T;
  if (!data.ok) {
    throw new Error(`Slack API ${method}: ${data.error ?? "unknown error"}`);
  }
  return data;
}

async function postMessage(botToken: string, channelId: string, text: string, threadTs?: string): Promise<void> {
  const MAX_LEN = 3000;
  const converted = mdToSlack(text);
  for (let i = 0; i < converted.length; i += MAX_LEN) {
    const body: Record<string, unknown> = {
      channel: channelId,
      text: converted.slice(i, i + MAX_LEN),
    };
    if (threadTs) body.thread_ts = threadTs;
    await callSlackApi("chat.postMessage", botToken, body);
  }
}

// --- Markdown → Slack mrkdwn conversion ---

function mdToSlack(text: string): string {
  return text
    // Code blocks first (preserve contents)
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_, _lang, code) => `\`\`\`\n${code.trim()}\n\`\`\``)
    // Headers → bold
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
    // Bold **text** or __text__ → *text*
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/__(.+?)__/g, "*$1*")
    // Italic *text* → _text_ (only single asterisk, not already converted bold)
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "_$1_")
    // Links [text](url) → <url|text>
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>")
    // Bullet points
    .replace(/^[\-\*]\s+/gm, "• ")
    // Horizontal rules
    .replace(/^---+$/gm, "")
    // Trim excess blank lines
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// --- Agent routing ---

function resolveAgentFromRoutes(channelId: string, routes: SlackRoute[], defaultAgent: string): string {
  const match = routes.find((r) => r.channelId === channelId);
  return match ? match.agentId : defaultAgent;
}

// --- Socket Mode connection ---

async function getSocketModeUrl(appToken: string): Promise<string> {
  const res = await fetch(`${SLACK_API}/apps.connections.open`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Bearer ${appToken}`,
    },
  });
  if (!res.ok) throw new Error(`apps.connections.open: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as { ok: boolean; url?: string; error?: string };
  if (!data.ok || !data.url) throw new Error(`apps.connections.open: ${data.error ?? "no URL returned"}`);
  return data.url;
}

// --- File download ---

async function downloadSlackFile(url: string, botToken: string, filename: string): Promise<string> {
  await mkdir(SLACK_INBOX_DIR, { recursive: true });
  const res = await fetch(url, { headers: { Authorization: `Bearer ${botToken}` } });
  if (!res.ok) throw new Error(`Slack file download failed: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const localPath = join(SLACK_INBOX_DIR, filename);
  await Bun.write(localPath, bytes);
  return localPath;
}

// --- Message handler ---

interface SlackFile {
  id: string;
  name?: string;
  mimetype?: string;
  url_private?: string;
}

interface SlackMessageEvent {
  type: "message" | "app_mention";
  channel: string;
  user?: string;
  text?: string;
  ts: string;
  thread_ts?: string;
  bot_id?: string;
  subtype?: string;
  files?: SlackFile[];
}

interface SlackSlashPayload {
  command: string;
  channel_id: string;
  user_id?: string;
  text?: string;
}

interface SlackEnvelope {
  type: string;
  envelope_id: string;
  payload?: {
    event?: SlackMessageEvent;
    command?: string;
    channel_id?: string;
    user_id?: string;
    text?: string;
  };
  retry_attempt?: number;
}

async function handleMessage(event: SlackMessageEvent): Promise<void> {
  const settings = getSettings();
  const config = settings.slack;

  // Skip bot messages and message subtypes (edits, deletes, etc.)
  if (event.bot_id || event.subtype) return;
  if (!event.user) return;

  const channelId = event.channel;

  // Enforce allowedChannelIds if set
  if (config.allowedChannelIds.length > 0 && !config.allowedChannelIds.includes(channelId)) {
    return;
  }

  const agentId = resolveAgentFromRoutes(channelId, config.routes, settings.agents?.default ?? "main");
  const text = event.text?.trim() ?? "";

  // Handle /reset as a text command fallback (slash commands handled separately)
  if (text === "/reset" || text === "reset") {
    await resetSession(agentId);
    const label = agentId === "main" ? "Session" : `Session for agent "${agentId}"`;
    await postMessage(config.botToken, channelId, `${label} reset. Next message starts fresh.`, event.thread_ts);
    return;
  }

  if (!text && (!event.files || event.files.length === 0)) return;

  const username = event.user;
  console.log(`[${new Date().toLocaleTimeString()}] Slack ${username} in ${channelId}: "${text.slice(0, 60)}${text.length > 60 ? "..." : ""}"`);

  const promptParts = [`[Slack from ${username} in channel ${channelId}]`];
  if (text) promptParts.push(`Message: ${text}`);

  // Download any attached image files
  if (event.files) {
    for (const file of event.files) {
      if (!file.url_private) continue;
      const isImage = file.mimetype?.startsWith("image/");
      if (!isImage) continue;
      try {
        const ext = extname(file.name ?? "") || `.${file.mimetype?.split("/")[1] ?? "bin"}`;
        const filename = `${channelId}-${event.ts.replace(".", "")}-${file.id}${ext}`;
        const localPath = await downloadSlackFile(file.url_private, config.botToken, filename);
        promptParts.push(`Image path: ${localPath}`);
        promptParts.push("The user attached an image. Inspect this image file directly before answering.");
      } catch (err) {
        console.error(`[Slack] Failed to download file: ${err instanceof Error ? err.message : err}`);
        promptParts.push("The user attached an image, but downloading it failed. Respond and ask them to resend.");
      }
    }
  }

  const prefixedPrompt = promptParts.join("\n");

  try {
    const result = await runUserMessage("slack", prefixedPrompt, agentId);
    if (result.exitCode !== 0) {
      await postMessage(config.botToken, channelId, `Error (exit ${result.exitCode}): ${result.stderr || "Unknown error"}`, event.thread_ts);
    } else {
      await postMessage(config.botToken, channelId, result.stdout || "(empty response)", event.thread_ts);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Slack] Error for ${username}: ${errMsg}`);
    await postMessage(config.botToken, channelId, `Error: ${errMsg}`, event.thread_ts);
  }
}

async function handleSlashCommand(payload: SlackSlashPayload): Promise<void> {
  const settings = getSettings();
  const config = settings.slack;
  const channelId = payload.channel_id;

  if (config.allowedChannelIds.length > 0 && !config.allowedChannelIds.includes(channelId)) return;

  const agentId = resolveAgentFromRoutes(channelId, config.routes, settings.agents?.default ?? "main");

  if (payload.command === "/reset") {
    await resetSession(agentId);
    const label = agentId === "main" ? "Session" : `Session for agent "${agentId}"`;
    await postMessage(config.botToken, channelId, `${label} reset. Next message starts fresh.`);
  }
}

// --- Socket Mode loop ---

let running = true;

async function connectSocketMode(): Promise<void> {
  const config = getSettings().slack;
  const url = await getSocketModeUrl(config.appToken);
  const ws = new WebSocket(url);

  return new Promise<void>((resolve, reject) => {
    ws.onopen = () => {
      console.log("[Slack] Socket Mode connected");
    };

    ws.onmessage = (event) => {
      let envelope: SlackEnvelope;
      try {
        envelope = JSON.parse(event.data as string) as SlackEnvelope;
      } catch {
        return;
      }

      // Always ACK to prevent retries
      if (envelope.envelope_id) {
        ws.send(JSON.stringify({ envelope_id: envelope.envelope_id, payload: {} }));
      }

      if (envelope.type === "hello") {
        // Initial handshake complete
        return;
      }

      if (envelope.type === "disconnect") {
        console.log("[Slack] Server requested disconnect, reconnecting...");
        ws.close();
        resolve();
        return;
      }

      if (envelope.type === "events_api" && envelope.payload?.event) {
        const ev = envelope.payload.event;
        if (ev.type === "message" || ev.type === "app_mention") {
          handleMessage(ev).catch((err) => {
            console.error(`[Slack] Unhandled message error: ${err}`);
          });
        }
        return;
      }

      if (envelope.type === "slash_commands" && envelope.payload) {
        const p = envelope.payload;
        handleSlashCommand({
          command: p.command ?? "",
          channel_id: p.channel_id ?? "",
          user_id: p.user_id,
          text: p.text,
        }).catch((err) => {
          console.error(`[Slack] Unhandled slash command error: ${err}`);
        });
        return;
      }
    };

    ws.onerror = (err) => {
      console.error(`[Slack] WebSocket error: ${err}`);
    };

    ws.onclose = () => {
      resolve();
    };
  });
}

async function loop(): Promise<void> {
  console.log("Slack bot started (Socket Mode)");
  const config = getSettings().slack;
  console.log(`  Allowed channels: ${config.allowedChannelIds.length === 0 ? "all" : config.allowedChannelIds.join(", ")}`);

  while (running) {
    try {
      await connectSocketMode();
    } catch (err) {
      if (!running) break;
      console.error(`[Slack] Connection error: ${err instanceof Error ? err.message : err}`);
    }
    if (!running) break;
    console.log("[Slack] Reconnecting in 5s...");
    await Bun.sleep(5000);
  }
}

// --- Exports ---

process.on("SIGTERM", () => { running = false; });
process.on("SIGINT", () => { running = false; });

/** Start Socket Mode listener in-process (called by start.ts when tokens are configured) */
export function startSocketMode(): void {
  (async () => {
    await ensureProjectClaudeMd();
    await loop();
  })().catch((err) => {
    console.error(`[Slack] Fatal: ${err}`);
  });
}

/** Send a message to a specific channel (used by heartbeat forwarding) */
export async function sendSlackMessage(botToken: string, channelId: string, text: string): Promise<void> {
  await postMessage(botToken, channelId, text);
}

/** Standalone entry point (bun run src/index.ts slack) */
export async function slack() {
  await loadSettings();
  await ensureProjectClaudeMd();
  await loop();
}
