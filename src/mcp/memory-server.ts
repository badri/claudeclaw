/**
 * Minimal stdio MCP server exposing memory_search and memory_get tools.
 *
 * Launched by the claude CLI via --mcp-config. Reads MEMORY.md +
 * memory/*.md from ~/.claudeclaw/workspace/ and provides keyword-based
 * search (section chunking + TF-IDF-like scoring) and line-range reads.
 *
 * MCP protocol: JSON-RPC 2.0 over stdin/stdout, newline-delimited.
 */

import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const WORKSPACE_DIR = join(homedir(), ".claudeclaw", "workspace");
const MEMORY_MD = join(WORKSPACE_DIR, "MEMORY.md");
const MEMORY_DIR = join(WORKSPACE_DIR, "memory");

// ── Types ──────────────────────────────────────────────────────────────────

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

type MemoryChunk = {
  path: string;         // relative path, e.g. "MEMORY.md" or "memory/2026-02-23.md"
  absPath: string;
  startLine: number;    // 1-indexed
  endLine: number;
  text: string;
};

// ── File helpers ───────────────────────────────────────────────────────────

function listMemoryFiles(): Array<{ rel: string; abs: string }> {
  const files: Array<{ rel: string; abs: string }> = [];

  if (existsSync(MEMORY_MD)) {
    files.push({ rel: "MEMORY.md", abs: MEMORY_MD });
  }

  if (existsSync(MEMORY_DIR)) {
    try {
      for (const name of readdirSync(MEMORY_DIR)) {
        if (!name.endsWith(".md")) continue;
        const abs = join(MEMORY_DIR, name);
        if (statSync(abs).isFile()) {
          files.push({ rel: `memory/${name}`, abs });
        }
      }
    } catch {}
  }

  return files;
}

function readFileSync(abs: string): string {
  try {
    return Bun.file(abs).text() as unknown as string; // sync-ish via readFileSync
  } catch {
    return "";
  }
}

// Chunk a markdown file by headings and paragraphs.
// Each chunk captures a heading (if any) + its following content lines.
function chunkFile(rel: string, abs: string, content: string): MemoryChunk[] {
  const lines = content.split("\n");
  const chunks: MemoryChunk[] = [];
  let chunkStart = 1;
  let chunkLines: string[] = [];

  function flush(endLine: number) {
    const text = chunkLines.join("\n").trim();
    if (text) {
      chunks.push({ path: rel, absPath: abs, startLine: chunkStart, endLine, text });
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    if (line.startsWith("#")) {
      // Start a new chunk at each heading
      flush(lineNo - 1);
      chunkStart = lineNo;
      chunkLines = [line];
    } else if (line.trim() === "" && chunkLines.length > 0) {
      // Blank line ends a paragraph chunk if current chunk is non-heading and long enough
      const isHeadingChunk = chunkLines[0]?.startsWith("#");
      if (!isHeadingChunk && chunkLines.join("").trim().length > 0) {
        flush(lineNo - 1);
        chunkStart = lineNo + 1;
        chunkLines = [];
      } else {
        chunkLines.push(line);
      }
    } else {
      chunkLines.push(line);
    }
  }
  flush(lines.length);

  return chunks;
}

// ── Search ─────────────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .match(/[\p{L}\p{N}_]+/gu) ?? [];
}

function scoreChunk(chunk: MemoryChunk, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const chunkTokens = tokenize(chunk.text);
  if (chunkTokens.length === 0) return 0;

  // Build term frequency map for the chunk
  const tf = new Map<string, number>();
  for (const t of chunkTokens) {
    tf.set(t, (tf.get(t) ?? 0) + 1);
  }

  let hits = 0;
  let weightedScore = 0;
  for (const qt of queryTokens) {
    const freq = tf.get(qt) ?? 0;
    if (freq > 0) {
      hits++;
      weightedScore += freq / chunkTokens.length; // TF contribution
    }
  }

  if (hits === 0) return 0;

  // Blend: coverage (fraction of query terms hit) + TF score
  const coverage = hits / queryTokens.length;
  return 0.7 * coverage + 0.3 * weightedScore;
}

async function memorySearch(params: {
  query: string;
  maxResults?: number;
  minScore?: number;
}): Promise<{ results: Array<{ path: string; startLine: number; endLine: number; score: number; snippet: string }> }> {
  const { query, maxResults = 5, minScore = 0.05 } = params;
  const queryTokens = tokenize(query);

  // Read and chunk all memory files
  const allChunks: MemoryChunk[] = [];
  for (const { rel, abs } of listMemoryFiles()) {
    const content = await Bun.file(abs).text();
    allChunks.push(...chunkFile(rel, abs, content));
  }

  if (allChunks.length === 0) {
    return { results: [] };
  }

  // Score + filter + sort
  const scored = allChunks
    .map((chunk) => ({ chunk, score: scoreChunk(chunk, queryTokens) }))
    .filter(({ score }) => score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  return {
    results: scored.map(({ chunk, score }) => ({
      path: chunk.path,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      score: Math.round(score * 1000) / 1000,
      snippet: `${chunk.text.slice(0, 800)}\n\nSource: ${chunk.path}#L${chunk.startLine}-L${chunk.endLine}`,
    })),
  };
}

async function memoryGet(params: {
  path: string;
  from?: number;
  lines?: number;
}): Promise<{ path: string; text: string }> {
  const rel = params.path.replace(/^[./]+/, "");

  // Only allow reads from the workspace memory files
  let absPath: string;
  if (rel === "MEMORY.md" || rel === "memory.md") {
    absPath = MEMORY_MD;
  } else if (rel.startsWith("memory/")) {
    absPath = join(MEMORY_DIR, rel.slice("memory/".length));
  } else {
    return { path: rel, text: "" };
  }

  if (!existsSync(absPath)) {
    return { path: rel, text: "" };
  }

  try {
    const content = await Bun.file(absPath).text();
    const allLines = content.split("\n");

    const from = params.from != null ? Math.max(1, params.from) : 1;
    const count = params.lines != null ? Math.max(1, params.lines) : allLines.length;
    const sliced = allLines.slice(from - 1, from - 1 + count);

    return { path: rel, text: sliced.join("\n") };
  } catch {
    return { path: rel, text: "" };
  }
}

// ── MCP protocol ───────────────────────────────────────────────────────────

function respond(id: string | number | null, result: unknown) {
  const msg: JsonRpcResponse = { jsonrpc: "2.0", id, result };
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function respondError(id: string | number | null, code: number, message: string) {
  const msg: JsonRpcResponse = { jsonrpc: "2.0", id, error: { code, message } };
  process.stdout.write(JSON.stringify(msg) + "\n");
}

async function handleRequest(req: JsonRpcRequest) {
  const { id, method, params } = req;

  if (method === "initialize") {
    respond(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "claudeclaw-memory", version: "1.0.0" },
    });
    return;
  }

  if (method === "notifications/initialized") {
    return; // no response needed for notifications
  }

  if (method === "tools/list") {
    respond(id, {
      tools: [
        {
          name: "memory_search",
          description:
            "Recall step: keyword-search MEMORY.md + memory/*.md before answering questions about prior work, decisions, preferences, or todos. Returns top snippets with path and line numbers.",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query" },
              maxResults: { type: "number", description: "Max results to return (default 5)" },
              minScore: { type: "number", description: "Min relevance score 0-1 (default 0.05)" },
            },
            required: ["query"],
          },
        },
        {
          name: "memory_get",
          description:
            "Read specific lines from MEMORY.md or memory/*.md. Use after memory_search to pull only the needed lines and keep context small.",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string", description: "Relative path: MEMORY.md or memory/YYYY-MM-DD.md" },
              from: { type: "number", description: "Start line (1-indexed, default 1)" },
              lines: { type: "number", description: "Number of lines to read (default: all)" },
            },
            required: ["path"],
          },
        },
      ],
    });
    return;
  }

  if (method === "tools/call") {
    const p = params as { name: string; arguments: Record<string, unknown> };
    const args = p.arguments ?? {};

    if (p.name === "memory_search") {
      const result = await memorySearch({
        query: String(args.query ?? ""),
        maxResults: typeof args.maxResults === "number" ? args.maxResults : undefined,
        minScore: typeof args.minScore === "number" ? args.minScore : undefined,
      });
      respond(id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      });
      return;
    }

    if (p.name === "memory_get") {
      const result = await memoryGet({
        path: String(args.path ?? "MEMORY.md"),
        from: typeof args.from === "number" ? args.from : undefined,
        lines: typeof args.lines === "number" ? args.lines : undefined,
      });
      respond(id, {
        content: [{ type: "text", text: result.text || "(empty)" }],
      });
      return;
    }

    respondError(id, -32601, `Unknown tool: ${p.name}`);
    return;
  }

  // Unknown method
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
        const req = JSON.parse(trimmed) as JsonRpcRequest;
        // Notifications have no id and we don't respond to them
        await handleRequest(req);
      } catch {
        // malformed JSON — ignore
      }
    }
  }
}

main().catch((err) => {
  process.stderr.write(`[memory-server] fatal: ${err}\n`);
  process.exit(1);
});
