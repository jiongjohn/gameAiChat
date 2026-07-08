import { timingSafeEqual } from "node:crypto";
import { applyProactiveResults, runProactiveScan } from "@/server/companion-service";
import { companionStore } from "@/server/store";

export const dynamic = "force-dynamic";

function extractCallerSecret(request: Request): string | null {
  const headerSecret = request.headers.get("x-cron-secret");
  if (headerSecret) {
    return headerSecret;
  }
  const authorization = request.headers.get("authorization");
  if (authorization && authorization.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length);
  }
  return null;
}

function isAuthorized(provided: string | null, expected: string): boolean {
  if (!provided) {
    return false;
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ error: "proactive job not configured" }, { status: 503 });
  }

  if (!isAuthorized(extractCallerSecret(request), secret)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date().toISOString();
  const snapshot = await companionStore.read();
  const candidates = await runProactiveScan(snapshot, now);

  if (candidates.length === 0) {
    return Response.json({ scanned: snapshot.conversations.length, sent: 0, blocked: 0 });
  }

  let sent = 0;
  let blocked = 0;
  const state = await companionStore.update((current) => {
    const result = applyProactiveResults(current, candidates, now);
    sent = result.sent;
    blocked = result.blocked;
    return result.state;
  });

  return Response.json({ scanned: state.conversations.length, sent, blocked });
}
