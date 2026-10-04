import { ConvexError } from "convex/values";

export type AppErrorData = { code: string; message: string };

export function errorData(e: unknown): AppErrorData {
  if (e instanceof ConvexError) {
    const d = e.data as Partial<AppErrorData> | string;
    if (typeof d === "string") return { code: "ERROR", message: d };
    return { code: d?.code ?? "ERROR", message: d?.message ?? "Something went wrong." };
  }
  if (e && typeof e === "object" && "data" in e) {
    const d = (e as { data: Partial<AppErrorData> }).data;
    if (d?.code) return { code: d.code, message: d.message ?? "Something went wrong." };
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (/network|fetch|connection/i.test(msg)) {
    return { code: "OFFLINE", message: "Can't reach the fridge right now. Check the Wi-Fi and try again." };
  }
  return { code: "ERROR", message: "Something went wrong. Try again in a moment." };
}
