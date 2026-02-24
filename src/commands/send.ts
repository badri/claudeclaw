import { runUserMessage } from "../runner";
import { getSession } from "../sessions";
import { loadSettings, initConfig } from "../config";

export async function send(args: string[]) {
  let telegramFlag = false;
  let agentIdFlag: string | undefined;
  const messageParts: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--telegram") {
      telegramFlag = true;
    } else if (arg === "--agent") {
      const raw = args[i + 1];
      if (!raw || raw.startsWith("--")) {
        console.error("`--agent` requires an agent id.");
        process.exit(1);
      }
      agentIdFlag = raw;
      i++;
    } else {
      messageParts.push(arg);
    }
  }

  const message = messageParts.join(" ");
  if (!message) {
    console.error("Usage: claudeclaw send <message> [--agent <id>] [--telegram]");
    process.exit(1);
  }

  await initConfig();
  const settings = await loadSettings();

  const agentId = agentIdFlag ?? settings.agents?.default ?? "main";
  const validIds = new Set(["main", ...(settings.agents?.list ?? []).map((a) => a.id)]);
  if (!validIds.has(agentId)) {
    console.error(`Unknown agent: "${agentId}". Available: ${[...validIds].join(", ")}`);
    process.exit(1);
  }

  const session = await getSession(agentId);
  if (!session) {
    console.error(`No active session for agent "${agentId}". Start the daemon first.`);
    process.exit(1);
  }

  const result = await runUserMessage("send", message, agentId);
  console.log(result.stdout);

  if (telegramFlag) {
    const token = settings.telegram.token;
    const userIds = settings.telegram.allowedUserIds;

    if (!token || userIds.length === 0) {
      console.error("Telegram is not configured in settings.");
      process.exit(1);
    }

    const text = result.exitCode === 0
      ? result.stdout || "(empty)"
      : `error (exit ${result.exitCode}): ${result.stderr || "Unknown"}`;

    for (const userId of userIds) {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: userId, text }),
        }
      );
      if (!res.ok) {
        console.error(`Failed to send to Telegram user ${userId}: ${res.statusText}`);
      }
    }
    console.log("Sent to Telegram.");
  }

  if (result.exitCode !== 0) process.exit(result.exitCode);
}
