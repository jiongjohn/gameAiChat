import { authenticateUser } from "@/server/companion-service";
import { createSessionToken, isSessionConfigured, sessionCookie } from "@/server/session";
import { companionStore } from "@/server/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSessionConfigured()) {
    return Response.json({ error: "Session is not configured." }, { status: 503 });
  }
  const body = (await request.json().catch(() => ({}))) as { username?: string; password?: string };
  if (!body.username || !body.password) {
    return Response.json({ error: "用户名和密码均为必填。" }, { status: 400 });
  }

  const state = await companionStore.read();
  const user = authenticateUser(state, body.username, body.password);
  if (!user) {
    return Response.json({ error: "用户名或密码错误。" }, { status: 401 });
  }

  return Response.json(
    { ok: true, user: { id: user.id, username: user.username, nickname: user.nickname } },
    { headers: { "Set-Cookie": sessionCookie(createSessionToken(user.id)) } }
  );
}
