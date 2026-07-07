import { redactStateForClient } from "@/server/admin-service";
import { registerUser } from "@/server/companion-service";
import { createSessionToken, isSessionConfigured, sessionCookie } from "@/server/session";
import { companionStore } from "@/server/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSessionConfigured()) {
    return Response.json({ error: "Session is not configured." }, { status: 503 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    inviteCode?: string;
    username?: string;
    password?: string;
  };
  if (!body.inviteCode || !body.username || !body.password) {
    return Response.json({ error: "邀请码、用户名和密码均为必填。" }, { status: 400 });
  }

  const now = new Date().toISOString();
  try {
    let userId = "";
    const state = await companionStore.update((current) => {
      const result = registerUser(current, {
        inviteCode: body.inviteCode!,
        username: body.username!,
        password: body.password!,
        now
      });
      userId = result.user.id;
      return result.state;
    });

    return Response.json(
      { ok: true, user: redactStateForClient(state).users.find((item) => item.id === userId) },
      { headers: { "Set-Cookie": sessionCookie(createSessionToken(userId)) } }
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "注册失败。" },
      { status: 400 }
    );
  }
}
