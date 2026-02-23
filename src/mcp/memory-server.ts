/**
 * Stdio MCP server exposing memory_search and memory_get tools.
 *
 * Search strategy (in order of preference):
 *   1. Hybrid: 0.7 × cosine(embedding) + 0.3 × keyword — when an embedding
 *      provider (openai or ollama) is configured in settings.json
 *   2. Keyword-only — when provider = "none" or embedding call fails
 *
 * Embeddings are cached in ~/.claudeclaw/memory-embeddings.db (bun:sqlite).
 * Only changed or new chunks are re-embedded on each run.
 *
 * Providers:
 *   openai — calls OpenAI /v1/embeddings (batched). Needs api key in config
 *            or OPENAI_API_KEY env var. Default model: text-embedding-3-small.
 *   ollama — calls local Ollama /api/embed. Default model: nomic-embed-text.
 *            Requires Ollama running at localhost:11434 (or configured baseUrl).
 */

import { existsSync, readdirSync, statSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import { Database } from "bun:sqlite";

// ── Paths ──────────────────────────────────────────────────────────────────

const CLAUDECLAW_DIR = join(homedir(), ".claudeclaw");
const WORKSPACE_DIR = join(CLAUDECLAW_DIR, "workspace");
const MEMORY_MD = join(WORKSPACE_DIR, "MEMORY.md");
const MEMORY_DIR = join(WORKSPACE_DIR, "memory");
const SETTINGS_FILE = join(CLAUDECLAW_DIR, "settings.json");
const DB_PATH = join(CLAUDECLAW_DIR, "memory-embeddings.db");

// ── Config ─────────────────────────────────────────────────────────────────

type EmbeddingsProvider = "openai" | "ollama" | "none";

interface EmbeddingsConfig {
  provider: EmbeddingsProvider;
  model: string;
  api: string;
  baseUrl: string;
}

function loadEmbeddingsConfig(): EmbeddingsConfig {
  try {
    const raw = JSON.parse(readFileSync(SETTINGS_FILE, "utf8"));
    const e = raw?.memory?.embeddings;
    const providers = new Set(["openai", "ollama", "none"]);
    const provider: EmbeddingsProvider =
      typeof e?.provider === "string" && providers.has(e.provider) ? e.provider : "none";
    return {
      provider,
      model: typeof e?.model === "string" ? e.model.trim() : "",
      api: typeof e?.api === "string" ? e.api.trim() : "",
      baseUrl: typeof e?.baseUrl === "string" ? e.baseUrl.trim() : "",
    };
  } catch {
    return { provider: "none", model: "", api: "", baseUrl: "" };
  }
}

// ── SQLite setup ───────────────────────────────────────────────────────────

let db: Database | null = null;

function getDb(): Database {
  if (db) return db;
  db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id          TEXT    PRIMARY KEY,
      path        TEXT    NOT NULL,
      abs_path    TEXT    NOT NULL,
      start_line  INTEGER NOT NULL,
      end_line    INTEGER NOT NULL,
      text        TEXT    NOT NULL,
      text_hash   TEXT    NOT NULL,
      embedding   BLOB,
      embedded_at INTEGER
    );
  `);
  return db;
}

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
  id: string;
  path: string;
  absPath: string;
  startLine: number;
  endLine: number;
  text: string;
  textHash: string;
};

// ── File helpers ───────────────────────────────────────────────────────────

function listMemoryFiles(): Array<{ rel: string; abs: string }> {
  const files: Array<{ rel: string; abs: string }> = [];
  if (existsSync(MEMORY_MD)) files.push({ rel: "MEMORY.md", abs: MEMORY_MD });
  if (existsSync(MEMORY_DIR)) {
    try {
      for (const name of readdirSync(MEMORY_DIR)) {
        if (!name.endsWith(".md")) continue;
        const abs = join(MEMORY_DIR, name);
        if (statSync(abs).isFile()) files.push({ rel: `memory/${name}`, abs });
      }
    } catch {}
  }
  return files;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function chunkFile(rel: string, abs: string, content: string): MemoryChunk[] {
  const lines = content.split("\n");
  const chunks: MemoryChunk[] = [];
  let chunkStart = 1;
  let chunkLines: string[] = [];

  function flush(endLine: number) {
    const text = chunkLines.join("\n").trim();
    if (!text) return;
    const id = sha256(`${rel}:${chunkStart}:${endLine}`);
    const textHash = sha256(text);
    chunks.push({ id, path: rel, absPath: abs, startLine: chunkStart, endLine, text, textHash });
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    if (line.startsWith("#")) {
      flush(lineNo - 1);
      chunkStart = lineNo;
      chunkLines = [line];
    } else if (line.trim() === "" && chunkLines.length > 0 && !chunkLines[0]?.startsWith("#")) {
      flush(lineNo - 1);
      chunkStart = lineNo + 1;
      chunkLines = [];
    } else {
      chunkLines.push(line);
    }
  }
  flush(lines.length);

  return chunks;
}

// ── Embedding providers ────────────────────────────────────────────────────

async function embedOpenAI(texts: string[], cfg: EmbeddingsConfig): Promise<number[][] | null> {
  const apiKey = cfg.api || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    process.stderr.write("[memory-server] OpenAI: no api key (set memory.embeddings.api or OPENAI_API_KEY)\n");
    return null;
  }
  const model = cfg.model || "text-embedding-3-small";
  const base = cfg.baseUrl || "https://api.openai.com";

  try {
    const res = await fetch(`${base}/v1/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, input: texts }),
    });
    if (!res.ok) {
      process.stderr.write(`[memory-server] OpenAI error: ${res.status} ${await res.text()}\n`);
      return null;
    }
    const data = await res.json() as { data: Array<{ embedding: number[] }> };
    return data.data.map((d) => d.embedding);
  } catch (e) {
    process.stderr.write(`[memory-server] OpenAI fetch failed: ${e}\n`);
    return null;
  }
}

async function embedOllama(texts: string[], cfg: EmbeddingsConfig): Promise<number[][] | null> {
  const model = cfg.model || "nomic-embed-text";
  const base = cfg.baseUrl || "http://localhost:11434";

  const results: number[][] = [];
  for (const text of texts) {
    try {
      // Try the newer batch endpoint first (/api/embed), fall back to /api/embeddings
      const res = await fetch(`${base}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, input: text }),
      });
      if (res.ok) {
        const data = await res.json() as { embeddings: number[][] };
        results.push(data.embeddings[0]);
        continue;
      }
      // Fallback to legacy endpoint
      const res2 = await fetch(`${base}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt: text }),
      });
      if (!res2.ok) {
        process.stderr.write(`[memory-server] Ollama error: ${res2.status}\n`);
        return null;
      }
      const data2 = await res2.json() as { embedding: number[] };
      results.push(data2.embedding);
    } catch (e) {
      process.stderr.write(`[memory-server] Ollama fetch failed: ${e}\n`);
      return null;
    }
  }
  return results;
}

async function computeEmbeddings(texts: string[], cfg: EmbeddingsConfig): Promise<number[][] | null> {
  if (cfg.provider === "openai") return embedOpenAI(texts, cfg);
  if (cfg.provider === "ollama") return embedOllama(texts, cfg);
  return null;
}

function embeddingToBlob(embedding: number[]): Buffer {
  return Buffer.from(new Float32Array(embedding).buffer);
}

function blobToEmbedding(blob: Buffer | null): number[] | null {
  if (!blob || blob.byteLength === 0) return null;
  return Array.from(new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4));
}

// ── Embedding sync ─────────────────────────────────────────────────────────

async function syncEmbeddings(chunks: MemoryChunk[], cfg: EmbeddingsConfig): Promise<void> {
  if (cfg.provider === "none") return;

  const database = getDb();
  const needsEmbed: MemoryChunk[] = [];

  for (const chunk of chunks) {
    const row = database
      .query<{ text_hash: string; embedding: Buffer | null }, [string]>(
        "SELECT text_hash, embedding FROM chunks WHERE id = ?"
      )
      .get(chunk.id);

    if (!row || row.text_hash !== chunk.textHash || !row.embedding) {
      needsEmbed.push(chunk);
    }
  }

  if (needsEmbed.length === 0) return;

  process.stderr.write(`[memory-server] Embedding ${needsEmbed.length} chunk(s) via ${cfg.provider}...\n`);

  // Batch in groups of 50 to avoid oversized requests
  const BATCH = 50;
  for (let i = 0; i < needsEmbed.length; i += BATCH) {
    const batch = needsEmbed.slice(i, i + BATCH);
    const vectors = await computeEmbeddings(batch.map((c) => c.text), cfg);
    if (!vectors) {
      process.stderr.write("[memory-server] Embedding failed — falling back to keyword search\n");
      return;
    }

    const upsert = database.prepare(
      `INSERT INTO chunks (id, path, abs_path, start_line, end_line, text, text_hash, embedding, embedded_at)
       VALUES ($id, $path, $abs_path, $start_line, $end_line, $text, $text_hash, $embedding, $embedded_at)
       ON CONFLICT(id) DO UPDATE SET
         text = $text, text_hash = $text_hash, embedding = $embedding, embedded_at = $embedded_at`
    );

    const insertMany = database.transaction((items: typeof batch) => {
      items.forEach((chunk, j) => {
        upsert.run({
          $id: chunk.id,
          $path: chunk.path,
          $abs_path: chunk.absPath,
          $start_line: chunk.startLine,
          $end_line: chunk.endLine,
          $text: chunk.text,
          $text_hash: chunk.textHash,
          $embedding: embeddingToBlob(vectors[j]),
          $embedded_at: Date.now(),
        });
      });
    });
    insertMany(batch);
  }

  // Upsert chunks that didn't need embedding (metadata only, no overwrite of existing embeddings)
  const metaUpsert = database.prepare(
    `INSERT INTO chunks (id, path, abs_path, start_line, end_line, text, text_hash)
     VALUES ($id, $path, $abs_path, $start_line, $end_line, $text, $text_hash)
     ON CONFLICT(id) DO NOTHING`
  );
  const insertMeta = database.transaction((items: MemoryChunk[]) => {
    items
      .filter((c) => !needsEmbed.find((n) => n.id === c.id))
      .forEach((chunk) => {
        metaUpsert.run({
          $id: chunk.id,
          $path: chunk.path,
          $abs_path: chunk.absPath,
          $start_line: chunk.startLine,
          $end_line: chunk.endLine,
          $text: chunk.text,
          $text_hash: chunk.textHash,
        });
      });
  });
  insertMeta(chunks);

  // Remove stale chunks (IDs no longer present in current files)
  const currentIds = new Set(chunks.map((c) => c.id));
  const stored = database
    .query<{ id: string }, []>("SELECT id FROM chunks")
    .all();
  const toDelete = stored.filter((r) => !currentIds.has(r.id)).map((r) => r.id);
  if (toDelete.length > 0) {
    const del = database.prepare("DELETE FROM chunks WHERE id = ?");
    database.transaction(() => toDelete.forEach((id) => del.run(id)))();
  }
}

// ── Scoring ────────────────────────────────────────────────────────────────

function cosine(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8);
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
}

function keywordScore(chunk: MemoryChunk, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const tokens = tokenize(chunk.text);
  if (tokens.length === 0) return 0;
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  let hits = 0, weighted = 0;
  for (const qt of queryTokens) {
    const freq = tf.get(qt) ?? 0;
    if (freq > 0) { hits++; weighted += freq / tokens.length; }
  }
  if (hits === 0) return 0;
  return 0.7 * (hits / queryTokens.length) + 0.3 * weighted;
}

// ── Search ─────────────────────────────────────────────────────────────────

async function memorySearch(params: {
  query: string;
  maxResults?: number;
  minScore?: number;
}): Promise<{ results: Array<{ path: string; startLine: number; endLine: number; score: number; snippet: string }> }> {
  const { query, maxResults = 5, minScore = 0.05 } = params;
  const queryTokens = tokenize(query);

  // Load all current chunks from files
  const allChunks: MemoryChunk[] = [];
  for (const { rel, abs } of listMemoryFiles()) {
    const content = await Bun.file(abs).text();
    allChunks.push(...chunkFile(rel, abs, content));
  }

  if (allChunks.length === 0) return { results: [] };

  const cfg = loadEmbeddingsConfig();

  // Try semantic path
  if (cfg.provider !== "none") {
    await syncEmbeddings(allChunks, cfg);

    // Embed the query
    const queryVectors = await computeEmbeddings([query], cfg);
    if (queryVectors) {
      const queryVec = queryVectors[0];
      const database = getDb();
      const VECTOR_W = 0.7;
      const KEYWORD_W = 0.3;

      const scored = allChunks.map((chunk) => {
        const row = database
          .query<{ embedding: Buffer | null }, [string]>(
            "SELECT embedding FROM chunks WHERE id = ?"
          )
          .get(chunk.id);

        const embedding = row ? blobToEmbedding(row.embedding) : null;
        const semantic = embedding ? cosine(queryVec, embedding) : 0;
        const keyword = keywordScore(chunk, queryTokens);
        const score = embedding
          ? VECTOR_W * semantic + KEYWORD_W * keyword
          : keyword; // fallback if this chunk has no embedding yet
        return { chunk, score };
      });

      const results = scored
        .filter(({ score }) => score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults)
        .map(({ chunk, score }) => ({
          path: chunk.path,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          score: Math.round(score * 1000) / 1000,
          snippet: `${chunk.text.slice(0, 800)}\n\nSource: ${chunk.path}#L${chunk.startLine}-L${chunk.endLine}`,
        }));

      return { results };
    }
    // Fall through to keyword if embedding failed
  }

  // Keyword-only fallback
  const results = allChunks
    .map((chunk) => ({ chunk, score: keywordScore(chunk, queryTokens) }))
    .filter(({ score }) => score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(({ chunk, score }) => ({
      path: chunk.path,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      score: Math.round(score * 1000) / 1000,
      snippet: `${chunk.text.slice(0, 800)}\n\nSource: ${chunk.path}#L${chunk.startLine}-L${chunk.endLine}`,
    }));

  return { results };
}

async function memoryGet(params: {
  path: string;
  from?: number;
  lines?: number;
}): Promise<{ path: string; text: string }> {
  const rel = params.path.replace(/^[./]+/, "");

  let absPath: string;
  if (rel === "MEMORY.md" || rel === "memory.md") {
    absPath = MEMORY_MD;
  } else if (rel.startsWith("memory/")) {
    absPath = join(MEMORY_DIR, rel.slice("memory/".length));
  } else {
    return { path: rel, text: "" };
  }

  if (!existsSync(absPath)) return { path: rel, text: "" };

  try {
    const content = await Bun.file(absPath).text();
    const allLines = content.split("\n");
    const from = params.from != null ? Math.max(1, params.from) : 1;
    const count = params.lines != null ? Math.max(1, params.lines) : allLines.length;
    return { path: rel, text: allLines.slice(from - 1, from - 1 + count).join("\n") };
  } catch {
    return { path: rel, text: "" };
  }
}

// ── MCP protocol ───────────────────────────────────────────────────────────

function respond(id: string | number | null, result: unknown) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result } as JsonRpcResponse) + "\n");
}

function respondError(id: string | number | null, code: number, message: string) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } } as JsonRpcResponse) + "\n");
}

async function handleRequest(req: JsonRpcRequest) {
  const { id, method, params } = req;

  if (method === "initialize") {
    respond(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "claudeclaw-memory", version: "1.1.0" },
    });
    return;
  }

  if (method === "notifications/initialized") return;

  if (method === "tools/list") {
    const cfg = loadEmbeddingsConfig();
    const searchDesc =
      cfg.provider === "none"
        ? "Keyword-search MEMORY.md + memory/*.md before answering about prior work, decisions, preferences, or todos. Returns top snippets with path and line numbers."
        : `Hybrid semantic+keyword search over MEMORY.md + memory/*.md (provider: ${cfg.provider}). Run before answering about prior work, decisions, preferences, or todos.`;

    respond(id, {
      tools: [
        {
          name: "memory_search",
          description: searchDesc,
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string" },
              maxResults: { type: "number", description: "Max results (default 5)" },
              minScore: { type: "number", description: "Min score 0-1 (default 0.05)" },
            },
            required: ["query"],
          },
        },
        {
          name: "memory_get",
          description: "Read specific lines from MEMORY.md or memory/*.md after memory_search to pull only needed content.",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string", description: "MEMORY.md or memory/YYYY-MM-DD.md" },
              from: { type: "number", description: "Start line (1-indexed)" },
              lines: { type: "number", description: "Lines to read (default: all)" },
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
      respond(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
      return;
    }

    if (p.name === "memory_get") {
      const result = await memoryGet({
        path: String(args.path ?? "MEMORY.md"),
        from: typeof args.from === "number" ? args.from : undefined,
        lines: typeof args.lines === "number" ? args.lines : undefined,
      });
      respond(id, { content: [{ type: "text", text: result.text || "(empty)" }] });
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
  process.stderr.write(`[memory-server] fatal: ${err}\n`);
  process.exit(1);
});
