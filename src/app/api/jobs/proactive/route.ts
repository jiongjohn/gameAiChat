import { applyProactiveResults, runProactiveScan } from "@/server/companion-service";
import { companionStore } from "@/server/store";

export const dynamic = "force-dynamic";

export async function POST() {
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
