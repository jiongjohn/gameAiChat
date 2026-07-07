import { redactStateForClient } from "@/server/admin-service";
import { companionStore } from "@/server/store";
import AdminApp from "../admin-app";

export const dynamic = "force-dynamic";

export default async function Page() {
  const state = redactStateForClient(await companionStore.read());
  return <AdminApp activeSection="models" initialState={state} />;
}
