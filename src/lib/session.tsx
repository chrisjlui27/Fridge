import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { errorData } from "./errors";
import { clearPrefix, safeGet, safeSet } from "./storage";
import { useLastKnown } from "./cache";
import { useToast } from "../components/Toast";
import { ProfilePicker } from "../components/ProfilePicker";
import { Welcome } from "../pages/Welcome";

export type Who = NonNullable<FunctionReturnType<typeof api.auth.whoami>>;
export type Member = Who["members"][number];
export type MemberId = Id<"members">;

const TOKEN_KEY = "fridge.session";

type ActorRequest = { only?: MemberId; title?: string };

type SessionValue = {
  token: string;
  who: Who;
  tz: string;
  viewer: Member | null;
  members: Member[];
  member: (id: MemberId | null | undefined) => Member | undefined;
  isWall: boolean;
  isParent: boolean;
  signOut: () => void;
  /** On the wall: ask who's doing this (and their PIN). Resolves false if cancelled. */
  requestActor: (req?: ActorRequest) => Promise<boolean>;
  /** On the wall: "I'm done" - the next person has to tap in again. */
  endActing: () => void;
  /** Called when a mutation fails: toasts, signs out, or asks who's acting. */
  handleError: (e: unknown) => Promise<"retry" | "handled">;
};

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => safeGet(TOKEN_KEY));
  const setToken = useCallback((t: string | null) => {
    if (t === null) clearPrefix("fridge.cache.");
    safeSet(TOKEN_KEY, t);
    setTokenState(t);
  }, []);
  const live = useQuery(api.auth.whoami, token ? { sessionToken: token } : "skip");
  // Offline reloads (the wall tablet after a Wi-Fi blip) start from the last
  // known identity instead of hanging on the splash screen.
  const cached = useLastKnown(`whoami.${token?.slice(-8) ?? "none"}`, live ?? undefined);
  const who = live === null ? null : cached.value;

  useEffect(() => {
    // The token was revoked or the person was removed.
    if (token && live === null) setToken(null);
  }, [token, live, setToken]);

  if (!token || who === null) return <Welcome onSignedIn={setToken} />;
  if (who === undefined) return <Splash />;
  return (
    <SignedIn token={token} who={who} setToken={setToken}>
      {children}
    </SignedIn>
  );
}

function SignedIn({
  token,
  who,
  setToken,
  children,
}: {
  token: string;
  who: Who;
  setToken: (t: string | null) => void;
  children: ReactNode;
}) {
  const toast = useToast();
  const signOutMutation = useMutation(api.auth.signOut);
  const stopActing = useMutation(api.auth.stopActing);
  const touch = useMutation(api.auth.touch);
  const [picker, setPicker] = useState<(ActorRequest & { resolve: (ok: boolean) => void }) | null>(null);
  // After a successful PIN, trust it locally until whoami catches up.
  const actingHint = useRef<{ id: MemberId; until: number } | null>(null);

  const isWall = who.session.kind === "wall";
  const tz = who.household.timezone;
  const byId = useMemo(() => new Map(who.members.map((m) => [m._id, m])), [who.members]);

  useEffect(() => {
    // Keep "last seen" fresh so idle devices aren't cleaned up.
    void touch({ sessionToken: token }).catch(() => {});
    const id = window.setInterval(() => void touch({ sessionToken: token }).catch(() => {}), 6 * 3600_000);
    return () => window.clearInterval(id);
  }, [token, touch]);

  // Wall: the tapped-in profile ends after a couple of idle minutes.
  const actingUntil = who.session.actingUntil;
  useEffect(() => {
    if (!isWall || !actingUntil) return;
    const ms = actingUntil - Date.now();
    const id = window.setTimeout(() => {
      actingHint.current = null;
      void stopActing({ sessionToken: token }).catch(() => {});
    }, Math.max(0, ms));
    return () => window.clearTimeout(id);
  }, [isWall, actingUntil, stopActing, token]);

  const signOut = useCallback(() => {
    void signOutMutation({ sessionToken: token }).catch(() => {});
    setToken(null);
  }, [signOutMutation, token, setToken]);

  const endActing = useCallback(() => {
    actingHint.current = null;
    void stopActing({ sessionToken: token }).catch(() => {});
  }, [stopActing, token]);

  const viewer = who.viewer;
  const requestActor = useCallback(
    (req: ActorRequest = {}) => {
      if (viewer && (!req.only || viewer._id === req.only)) return Promise.resolve(true);
      const hint = actingHint.current;
      if (hint && hint.until > Date.now() && (!req.only || req.only === hint.id)) return Promise.resolve(true);
      if (!isWall) return Promise.resolve(false);
      return new Promise<boolean>((resolve) => setPicker({ ...req, resolve }));
    },
    [viewer, isWall],
  );

  const handleError = useCallback(
    async (e: unknown): Promise<"retry" | "handled"> => {
      const { code, message } = errorData(e);
      if (code === "SIGNED_OUT") {
        setToken(null);
        return "handled";
      }
      if (code === "PICK_PROFILE" && isWall) {
        actingHint.current = null;
        return (await new Promise<boolean>((resolve) => setPicker({ resolve }))) ? "retry" : "handled";
      }
      toast.show(message, { tone: "error" });
      return "handled";
    },
    [isWall, setToken, toast],
  );

  const value = useMemo<SessionValue>(
    () => ({
      token,
      who,
      tz,
      viewer,
      members: who.members,
      member: (id) => (id ? byId.get(id) : undefined),
      isWall,
      isParent: who.isParentAccount,
      signOut,
      requestActor,
      endActing,
      handleError,
    }),
    [token, who, tz, viewer, byId, isWall, signOut, requestActor, endActing, handleError],
  );

  return (
    <SessionContext.Provider value={value}>
      {children}
      {picker && (
        <ProfilePicker
          members={picker.only ? who.members.filter((m) => m._id === picker.only) : who.members}
          title={picker.title ?? "Who's doing this?"}
          onDone={(memberId) => {
            if (memberId) actingHint.current = { id: memberId, until: Date.now() + 90_000 };
            picker.resolve(memberId !== null);
            setPicker(null);
          }}
        />
      )}
    </SessionContext.Provider>
  );
}

function Splash() {
  return (
    <div className="splash" aria-busy="true">
      <div className="splash-magnet" />
      <p className="muted">Opening the fridge…</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hooks that add the session token for you.

type WithoutToken<F extends FunctionReference<"query" | "mutation" | "action">> = Omit<
  FunctionArgs<F>,
  "sessionToken"
>;

/** useQuery + the session token. Pass "skip" to skip. */
export function useQ<Q extends FunctionReference<"query">>(
  query: Q,
  args: WithoutToken<Q> | "skip",
): FunctionReturnType<Q> | undefined {
  const { token } = useSession();
  return useQuery(
    query as FunctionReference<"query">,
    args === "skip" ? "skip" : ({ ...args, sessionToken: token } as FunctionArgs<Q>),
  ) as FunctionReturnType<Q> | undefined;
}

/**
 * useMutation + the session token + friendly errors. On the wall it first
 * asks who's acting. Resolves to undefined if it failed (already toasted).
 */
export function useM<M extends FunctionReference<"mutation">>(mutation: M) {
  const { token, isWall, viewer, requestActor, handleError } = useSession();
  const run = useMutation(mutation);
  return useCallback(
    async (args: WithoutToken<M>): Promise<FunctionReturnType<M> | undefined> => {
      if (isWall && !viewer && !(await requestActor())) return undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return (await run({ ...args, sessionToken: token } as FunctionArgs<M>)) as FunctionReturnType<M>;
        } catch (e) {
          if ((await handleError(e)) !== "retry") return undefined;
        }
      }
      return undefined;
    },
    [run, token, isWall, viewer, requestActor, handleError],
  );
}

/** useAction + the session token + friendly errors. */
export function useA<A extends FunctionReference<"action">>(action: A) {
  const { token, handleError } = useSession();
  const run = useAction(action);
  return useCallback(
    async (args: WithoutToken<A>): Promise<FunctionReturnType<A> | undefined> => {
      try {
        return (await run({ ...args, sessionToken: token } as FunctionArgs<A>)) as FunctionReturnType<A>;
      } catch (e) {
        await handleError(e);
        return undefined;
      }
    },
    [run, token, handleError],
  );
}
