/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "../convex/schema";
import { seed } from "./seed";

// Loaded through Vite's SSR loader so TypeScript and import.meta.glob work.
const modules = import.meta.glob("../convex/**/*.ts");

export async function createBackend({ empty = false }: { empty?: boolean } = {}) {
  const t = convexTest(schema, modules);
  const tokens = empty ? {} : await seed(t);
  return {
    tokens,
    async run(kind: "query" | "mutation" | "action", name: string, args: Record<string, unknown>) {
      if (kind === "query") return await t.query(makeFunctionReference<"query">(name), args);
      if (kind === "mutation") return await t.mutation(makeFunctionReference<"mutation">(name), args);
      if (kind === "action") return await t.action(makeFunctionReference<"action">(name), args);
      throw new Error(`Unknown kind ${kind}`);
    },
    async store(blob: Blob) {
      return await t.run((ctx) => ctx.storage.store(blob));
    },
    async getBySha(sha: string) {
      return await t.run(async (ctx) => {
        const files = await ctx.db.system.query("_storage").collect();
        const file = files.find((f) => f.sha256 === sha);
        if (!file) return null;
        const blob = await ctx.storage.get(file._id);
        return blob ? { bytes: await blob.arrayBuffer(), contentType: file.contentType ?? null } : null;
      });
    },
  };
}
