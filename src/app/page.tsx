import { redactStateForClient } from "@/server/admin-service";
import { companionStore } from "@/server/store";
import MobileApp from "./mobile-app";

export const dynamic = "force-dynamic";

export default async function Home() {
  const initialState = redactStateForClient(await companionStore.read());
  return <MobileApp initialState={initialState} />;
}
