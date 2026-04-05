/**
 * Service health probes for MCP connections and external dependencies.
 *
 * Checks: Slack token validity, OpenAI embeddings key, Claude CLI auth.
 * Each probe returns a simple ok/fail + message. The combined runner
 * executes all relevant probes and returns a summary.
 */

import type { Settings } from "./config";

export interface ProbeResult {
  service: string;
  ok: boolean;
  message: string;
  checkedAt: number;
}

export interface HealthProbeReport {
  ok: boolean;
  probes: ProbeResult[];
  checkedAt: number;
}

// --- Individual probes ---

async function probeSlack(botToken: string): Promise<ProbeResult> {
  const service = "slack";
  try {
    const res = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Bearer ${botToken}`,
      },
    });
    if (!res.ok) {
      return { service, ok: false, message: `HTTP ${res.status}`, checkedAt: Date.now() };
    }
    const data = (await res.json()) as { ok: boolean; error?: string; team?: string; user?: string };
    if (!data.ok) {
      return { service, ok: false, message: `auth.test failed: ${data.error ?? "unknown"}`, checkedAt: Date.now() };
    }
    return { service, ok: true, message: `${data.user}@${data.team}`, checkedAt: Date.now() };
  } catch (err) {
    return { service, ok: false, message: `${err}`, checkedAt: Date.now() };
  }
}

async function probeOpenAIEmbeddings(apiKey: string, baseUrl: string, model: string): Promise<ProbeResult> {
  const service = "openai_embeddings";
  const url = `${baseUrl || "https://api.openai.com"}/v1/embeddings`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || "text-embedding-3-small",
        input: "health check",
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { service, ok: false, message: `HTTP ${res.status}: ${body.slice(0, 120)}`, checkedAt: Date.now() };
    }
    return { service, ok: true, message: "ok", checkedAt: Date.now() };
  } catch (err) {
    return { service, ok: false, message: `${err}`, checkedAt: Date.now() };
  }
}

async function probeClaudeCli(): Promise<ProbeResult> {
  const service = "claude_cli";
  try {
    const proc = Bun.spawn(["claude", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    await proc.exited;
    const exitCode = proc.exitCode;

    if (exitCode !== 0) {
      const combined = (stdout + stderr).trim();
      if (/auth|login|sign.?in|session.?expired|unauthorized/i.test(combined)) {
        return { service, ok: false, message: `auth expired: ${combined.slice(0, 120)}`, checkedAt: Date.now() };
      }
      return { service, ok: false, message: `exit ${exitCode}: ${combined.slice(0, 120)}`, checkedAt: Date.now() };
    }
    return { service, ok: true, message: stdout.trim().slice(0, 80), checkedAt: Date.now() };
  } catch (err) {
    return { service, ok: false, message: `${err}`, checkedAt: Date.now() };
  }
}

// --- Combined probe runner ---

export async function runHealthProbe(settings: Settings): Promise<HealthProbeReport> {
  const probes: Promise<ProbeResult>[] = [];

  // Slack — only if tokens configured
  if (settings.slack.botToken) {
    probes.push(probeSlack(settings.slack.botToken));
  }

  // OpenAI embeddings — only if provider is openai
  const emb = settings.memory.embeddings;
  if (emb.provider === "openai") {
    const apiKey = emb.api || process.env.OPENAI_API_KEY || "";
    if (apiKey) {
      probes.push(probeOpenAIEmbeddings(apiKey, emb.baseUrl, emb.model));
    }
  }

  // Claude CLI — always check
  probes.push(probeClaudeCli());

  const results = await Promise.all(probes);
  const allOk = results.every((r) => r.ok);

  return {
    ok: allOk,
    probes: results,
    checkedAt: Date.now(),
  };
}

/** Format a probe report as a human-readable alert string (for Slack/Telegram). */
export function formatProbeAlert(report: HealthProbeReport): string | null {
  const failures = report.probes.filter((p) => !p.ok);
  if (failures.length === 0) return null;

  const lines = failures.map((f) => `• ${f.service}: ${f.message}`);
  return `🚨 *Health probe failures*\n${lines.join("\n")}`;
}
