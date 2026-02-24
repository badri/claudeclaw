/**
 * Stdio MCP server exposing inter-agent communication tools:
 *
 *   send_to_agent   — delegate a message to a domain agent, get its reply
 *   agent_status    — query one or all agents for a status summary (daily digest)
 *
 * Each call spawns `bun run <claudeclaw>/src/index.ts send <message> --agent <id>`,
 * which resumes the target agent's existing Claude session and returns its reply.
 * The target agent must have an active session (daemon bootstrapped it).
 */

import { join } from "path";
import { readFileSync } from "fs";
import { homedir } from "os";

// ── Paths ──────────────────────────────────────────────────────────────────

const CLAUDECLAW_DIR = join(homedir(), ".claudeclaw");
const SETTINGS_FILE = join(CLAUDECLAW_DIR, "settings.json");

// Path to claudeclaw's main entry point, resolved relative to this file
const CLAUDECLAW_INDEX = join(import.meta.dir, "..", "index.ts");

// ── Helpers ────────────────────────────────────────────────────────────────

function loadAgentIds(): string[] {
  try {
    const raw = JSON.parse(readFileSync(SETTINGS_FILE, "utf8"));
    const list: string[] = ["main"];
    for (const a of (raw?.agents?.list ?? [])) {
      if (a.id && a.id !== "main") list.push(a.id);
    }
    return list;
  } catch {
    return ["main"];
  }
}

async function sendToAgent(agentId: string, message: string): Promise<string> {
  const proc = Bun.spawn(
    ["bun", "run", CLAUDECLAW_INDEX, "send", message, "--agent", agentId],
    { stdout: "pipe", stderr: "pipe" }
  );

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;

  if (proc.exitCode !== 0) {
    return `Error (exit ${proc.exitCode}): ${stderr.trim() || stdout.trim() || "unknown"}`;
  }
  return stdout.trim() || "(no output)";
}

const STATUS_PROMPT =
  "Give me a brief status summary (3-5 lines max). Cover: " +
  "(1) what you've been working on recently, " +
  "(2) anything pending or in-progress, " +
  "(3) anything flagged or urgent. " +
  "Be terse — this is for a digest rollup, not a full report.";

async function queryAgentStatus(agentId: string): Promise<{ agentId: string; status: string }> {
  const status = await sendToAgent(agentId, STATUS_PROMPT);
  return { agentId, status };
}

// ── MCP protocol ───────────────────────────────────────────────────────────

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: unknown;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
};

function respond(id: string | number | null, result: unknown) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result } as JsonRpcResponse) + "\n");
}

function respondError(id: string | number | null, code: number, message: string) {
  process.stdout.write(
    JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } } as JsonRpcResponse) + "\n"
  );
}

async function handleRequest(req: JsonRpcRequest) {
  const { id, method, params } = req;

  if (method === "initialize") {
    respond(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "claudeclaw-agent-bridge", version: "1.0.0" },
    });
    return;
  }

  if (method === "notifications/initialized") return;

  if (method === "tools/list") {
    const agentIds = loadAgentIds();
    respond(id, {
      tools: [
        {
          name: "agent_status",
          description:
            `Query one or more agents for a brief status summary. ` +
            `Use this to build a daily digest or check what each domain agent has been up to. ` +
            `Queries run in parallel. Available agents: ${agentIds.join(", ")}.`,
          inputSchema: {
            type: "object",
            properties: {
              agentIds: {
                type: "array",
                items: { type: "string" },
                description: `Agent IDs to query. Defaults to all agents: ${agentIds.join(", ")}`,
              },
            },
            required: [],
          },
        },
        {
          name: "send_to_agent",
          description:
            `Delegate a message to a specialized claudeclaw agent and get their response. ` +
            `Use this to route tasks to domain agents mid-response. ` +
            `Available agents: ${agentIds.join(", ")}. ` +
            `The target agent resumes its own session — context is coherent across calls. ` +
            `You can call this multiple times in one response to fan out to multiple agents.`,
          inputSchema: {
            type: "object",
            properties: {
              agentId: {
                type: "string",
                description: `ID of the target agent. One of: ${agentIds.join(", ")}`,
                enum: agentIds,
              },
              message: {
                type: "string",
                description: "The message or task to send to the agent.",
              },
            },
            required: ["agentId", "message"],
          },
        },
      ],
    });
    return;
  }

  if (method === "tools/call") {
    const p = params as { name: string; arguments: Record<string, unknown> };
    const args = p.arguments ?? {};

    if (p.name === "agent_status") {
      const allIds = loadAgentIds();
      const requested = Array.isArray(args.agentIds)
        ? (args.agentIds as string[]).filter((id) => allIds.includes(id))
        : allIds;

      if (requested.length === 0) {
        respondError(id, -32602, `No valid agent IDs. Available: ${allIds.join(", ")}`);
        return;
      }

      const results = await Promise.all(requested.map(queryAgentStatus));
      const text = results
        .map(({ agentId, status }) => `## ${agentId}\n${status}`)
        .join("\n\n");
      respond(id, { content: [{ type: "text", text }] });
      return;
    }

    if (p.name === "send_to_agent") {
      const agentId = String(args.agentId ?? "");
      const message = String(args.message ?? "");

      if (!agentId) {
        respondError(id, -32602, "agentId is required");
        return;
      }
      if (!message) {
        respondError(id, -32602, "message is required");
        return;
      }

      const result = await sendToAgent(agentId, message);
      respond(id, { content: [{ type: "text", text: result }] });
      return;
    }

    respondError(id, -32601, `Unknown tool: ${p.name}`);
    return;
  }

  if (id !== null && id !== undefined) {
    respondError(id, -32601, `Method not found: ${method}`);
  }
}

// ── Main loop ──────────────────────────────────────────────────────────────

async function main() {
  let buf = "";
  for await (const chunk of Bun.stdin.stream()) {
    buf += new TextDecoder().decode(chunk);
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        await handleRequest(JSON.parse(trimmed) as JsonRpcRequest);
      } catch {}
    }
  }
}

main().catch((err) => {
  process.stderr.write(`[agent-bridge] fatal: ${err}\n`);
  process.exit(1);
});
