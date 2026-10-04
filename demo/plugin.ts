import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, ViteDevServer } from "vite";

/**
 * `npm run demo`: serves the real Convex functions from an in-memory
 * backend (convex-test) inside the Vite dev server. No account, no network.
 * The browser side is src/demo/DemoClient.ts.
 */

type Backend = Awaited<ReturnType<typeof import("./backend").createBackend>>;

const STORAGE_PREFIX = "https://some-deployment.convex.cloud/api/storage/";

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body).split(STORAGE_PREFIX).join("/__demo/storage/"));
}

export function demoBackend(): Plugin {
  let backend: Promise<Backend> | null = null;
  const load = (server: ViteDevServer, empty = false) => {
    backend = server
      .ssrLoadModule("/demo/backend.ts")
      .then((m) => (m as typeof import("./backend")).createBackend({ empty }));
    return backend;
  };

  return {
    name: "fridge-demo-backend",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://demo");
        if (!url.pathname.startsWith("/__demo/")) return next();
        try {
          const b = await (backend ?? load(server));
          if (url.pathname === "/__demo/tokens") return json(res, 200, b.tokens);
          if (url.pathname === "/__demo/reset" && req.method === "POST") {
            await load(server, url.searchParams.get("empty") === "1");
            return json(res, 200, { ok: true });
          }
          if (url.pathname === "/__demo/run" && req.method === "POST") {
            const { kind, name, args } = JSON.parse((await readBody(req)).toString("utf8"));
            try {
              const value = await b.run(kind, name, args);
              return json(res, 200, { ok: true, value: value ?? null });
            } catch (e) {
              const err = e as Error & { data?: unknown };
              if (err.data === undefined) console.error(`[demo] ${kind} ${name} failed:`, err);
              return json(res, 200, { ok: false, message: err.message, data: err.data });
            }
          }
          if (url.pathname === "/__demo/storage/upload" && req.method === "POST") {
            const body = await readBody(req);
            const type = req.headers["content-type"] ?? "application/octet-stream";
            const storageId = await b.store(new Blob([new Uint8Array(body)], { type }));
            return json(res, 200, { storageId });
          }
          if (url.pathname.startsWith("/__demo/storage/") && req.method === "GET") {
            const file = await b.getBySha(decodeURIComponent(url.pathname.slice("/__demo/storage/".length)));
            if (!file) return json(res, 404, { error: "not found" });
            res.statusCode = 200;
            res.setHeader("Content-Type", file.contentType ?? "application/octet-stream");
            res.setHeader("Cache-Control", "max-age=3600");
            return res.end(Buffer.from(file.bytes));
          }
          return json(res, 404, { error: "unknown demo endpoint" });
        } catch (e) {
          console.error("[demo]", e);
          return json(res, 500, { ok: false, message: (e as Error).message });
        }
      });
    },
  };
}
