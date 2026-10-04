import { getFunctionName, type FunctionReference } from "convex/server";
import { ConvexError, type Value } from "convex/values";

/**
 * Stand-in for ConvexReactClient used by `npm run demo`: it talks to the
 * in-memory backend served by the Vite dev server (demo/plugin.ts) and
 * re-runs live queries after every write, so the app behaves the same way.
 */

type Result = { value: unknown } | { error: Error };
type Entry = { name: string; args: Record<string, Value>; listeners: Set<() => void>; result?: Result; json?: string };
type Kind = "query" | "mutation" | "action";

async function call(kind: Kind, name: string, args: unknown) {
  const res = await fetch("/__demo/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, name, args }),
  });
  const body = (await res.json()) as { ok: true; value: unknown } | { ok: false; message: string; data?: unknown };
  if (body.ok) return body.value;
  if (body.data !== undefined) throw new ConvexError(body.data as Value);
  throw new Error(body.message);
}

export class DemoClient {
  private entries = new Map<string, Entry>();
  private connectionListeners = new Set<(s: unknown) => void>();

  constructor() {
    // Pick up changes made by scheduled functions or other tabs.
    window.setInterval(() => void this.refreshAll(), 3000);
  }

  private key(name: string, args: unknown) {
    return `${name}:${JSON.stringify(args ?? {})}`;
  }

  private async refresh(key: string) {
    const e = this.entries.get(key);
    if (!e) return;
    let result: Result;
    let json: string;
    try {
      const value = await call("query", e.name, e.args);
      result = { value };
      json = JSON.stringify(value);
    } catch (err) {
      result = { error: err as Error };
      json = `error:${(err as Error).message}`;
    }
    if (json === e.json) return;
    e.result = result;
    e.json = json;
    e.listeners.forEach((l) => l());
  }

  private async refreshAll() {
    await Promise.all([...this.entries.keys()].map((k) => this.refresh(k)));
  }

  watchQuery(query: FunctionReference<"query">, args?: Record<string, Value>) {
    const name = getFunctionName(query);
    const key = this.key(name, args);
    return {
      onUpdate: (callback: () => void) => {
        let e = this.entries.get(key);
        if (!e) {
          e = { name, args: args ?? {}, listeners: new Set() };
          this.entries.set(key, e);
        }
        e.listeners.add(callback);
        if (!e.result) void this.refresh(key);
        return () => {
          const cur = this.entries.get(key);
          if (!cur) return;
          cur.listeners.delete(callback);
          if (cur.listeners.size === 0) {
            window.setTimeout(() => {
              if (this.entries.get(key)?.listeners.size === 0) this.entries.delete(key);
            }, 5000);
          }
        };
      },
      localQueryResult: () => {
        const r = this.entries.get(key)?.result;
        if (!r) return undefined;
        if ("error" in r) throw r.error;
        return r.value;
      },
      localQueryLogs: () => undefined,
      journal: () => undefined,
    };
  }

  async query(query: FunctionReference<"query">, args?: Record<string, Value>) {
    return await call("query", getFunctionName(query), args ?? {});
  }

  async mutation(mutation: FunctionReference<"mutation">, args?: Record<string, Value>) {
    const value = await call("mutation", getFunctionName(mutation), args ?? {});
    await this.refreshAll();
    return value;
  }

  async action(action: FunctionReference<"action">, args?: Record<string, Value>) {
    const value = await call("action", getFunctionName(action), args ?? {});
    await this.refreshAll();
    return value;
  }

  connectionState() {
    return {
      hasInflightRequests: false,
      isWebSocketConnected: true,
      timeOfOldestInflightRequest: null,
      hasEverConnected: true,
      connectionCount: 1,
      connectionRetries: 0,
      inflightMutations: 0,
      inflightActions: 0,
    };
  }

  subscribeToConnectionState(cb: (s: unknown) => void) {
    this.connectionListeners.add(cb);
    return () => this.connectionListeners.delete(cb);
  }

  close() {}
}
