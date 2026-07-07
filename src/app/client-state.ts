import type { CompanionState } from "@/domain/types";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type StateLoadResult =
  | { ok: true; state: CompanionState }
  | { ok: false; error: string; unauthorized?: boolean };

export async function loadCompanionState(fetcher: Fetcher = fetch): Promise<StateLoadResult> {
  try {
    const response = await fetcher("/api/state");
    if (!response.ok) {
      return {
        ok: false,
        error: `角色频道初始化失败：HTTP ${response.status}`,
        unauthorized: response.status === 401
      };
    }
    const state = (await response.json()) as CompanionState;
    return { ok: true, state };
  } catch {
    return { ok: false, error: "连接角色频道失败，请确认本地服务正在运行。" };
  }
}
