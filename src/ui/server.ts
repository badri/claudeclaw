import { htmlPage } from "./page/html";
import { clampInt, json } from "./http";
import type { StartWebUiOptions, WebServerHandle } from "./types";
import { buildState, buildTechnicalInfo, sanitizeSettings } from "./services/state";
import { setHeartbeatEnabled } from "./services/settings";
import { createQuickJob } from "./services/jobs";
import { readLogs } from "./services/logs";

export function startWebUi(opts: StartWebUiOptions): WebServerHandle {
  const server = Bun.serve({
    hostname: opts.host,
    port: opts.port,
    fetch: async (req) => {
      const url = new URL(req.url);

      if (url.pathname === "/" || url.pathname === "/index.html") {
        return new Response(htmlPage(), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      if (url.pathname === "/api/health") {
        return json({ ok: true, now: Date.now() });
      }

      if (url.pathname === "/api/state") {
        return json(await buildState(opts.getSnapshot()));
      }

      if (url.pathname === "/api/settings") {
        return json(sanitizeSettings(opts.getSnapshot().settings));
      }

      if (url.pathname === "/api/settings/heartbeat" && req.method === "POST") {
        try {
          const body = await req.json();
          const enabled = Boolean((body as { enabled?: unknown }).enabled);
          await setHeartbeatEnabled(enabled);
          if (opts.onHeartbeatEnabledChanged) await opts.onHeartbeatEnabledChanged(enabled);
          return json({ ok: true, enabled });
        } catch (err) {
          return json({ ok: false, error: String(err) });
        }
      }

      if (url.pathname === "/api/technical-info") {
        return json(await buildTechnicalInfo(opts.getSnapshot()));
      }

      if (url.pathname === "/api/jobs/quick" && req.method === "POST") {
        try {
          const body = await req.json();
          const result = await createQuickJob(body as { time?: unknown; prompt?: unknown });
          return json({ ok: true, ...result });
        } catch (err) {
          return json({ ok: false, error: String(err) });
        }
      }

      if (url.pathname === "/api/jobs") {
        const jobs = opts.getSnapshot().jobs.map((j) => ({
          name: j.name,
          schedule: j.schedule,
          promptPreview: j.prompt.slice(0, 160),
        }));
        return json({ jobs });
      }

      if (url.pathname === "/api/logs") {
        const tail = clampInt(url.searchParams.get("tail"), 200, 20, 2000);
        return json(await readLogs(tail));
      }

      return new Response("Not found", { status: 404 });
    },
  });

  return {
    stop: () => server.stop(),
    host: opts.host,
    port: server.port,
  };
}
