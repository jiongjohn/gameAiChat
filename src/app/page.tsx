import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { redactStateForClient } from "@/server/admin-service";
import { scopeStateForUser } from "@/server/companion-service";
import { SESSION_COOKIE, verifySessionToken } from "@/server/session";
import { companionStore } from "@/server/store";
import MobileApp from "./mobile-app";

export const dynamic = "force-dynamic";

export default async function Home() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const userId = verifySessionToken(token);
  if (!userId) {
    redirect("/login");
  }
  const full = await companionStore.read();
  if (!full.users.some((user) => user.id === userId)) {
    redirect("/login");
  }
  const initialState = redactStateForClient(scopeStateForUser(full, userId));
  return <MobileApp initialState={initialState} />;
}
