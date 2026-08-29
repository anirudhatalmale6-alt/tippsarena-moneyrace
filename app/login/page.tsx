import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authenticate, createSessionToken, SESSION_COOKIE } from "@/lib/auth.ts";
import { query } from "@/lib/db.ts";

export const dynamic = "force-dynamic";

async function login(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const admin = await authenticate(email, password);
  if (!admin) redirect("/login?error=1");

  const jar = await cookies();
  jar.set(SESSION_COOKIE, await createSessionToken(admin.id), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 3600,
    // Only over https when there is one. Set on the reverse proxy in
    // production; leaving it unconditional would lock him out over plain http.
    secure: process.env.ADMIN_HTTPS === "1",
  });
  redirect("/");
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const count = await query<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM admin_users WHERE is_active",
  );
  const noAdmins = (count[0]?.n ?? 0) === 0;

  return (
    <div className="login-wrap">
      <div className="login-box">
        <div className="brand" style={{ textAlign: "center" }}>
          TippsArena
          <small>MoneyRace Admin</small>
        </div>

        {params.error ? (
          <div className="notice bad">Email or password is wrong.</div>
        ) : null}

        {noAdmins ? (
          <div className="notice warn">
            There is no account yet. Create one on the server with:
            <div className="mono" style={{ marginTop: 6 }}>
              node scripts/create-admin.ts &quot;email&quot; &quot;password&quot; &quot;Name&quot;
            </div>
          </div>
        ) : null}

        <form action={login} className="panel">
          <label htmlFor="email">E-Mail</label>
          <input id="email" name="email" type="email" required autoComplete="username" />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />
          <button type="submit" style={{ width: "100%" }}>
            SIGN IN
          </button>
        </form>
      </div>
    </div>
  );
}
