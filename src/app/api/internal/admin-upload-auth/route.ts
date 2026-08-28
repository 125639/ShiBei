import { getSession } from "@/lib/auth";

// Nginx auth_request target for very large admin uploads. The subrequest has no
// body and only answers whether the current, revocation-aware admin session is
// valid. The actual upload routes still repeat requireAdmin() and CSRF checks;
// this endpoint is an early admission gate, not their only authorization layer.
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  return new Response(null, {
    status: session ? 204 : 401,
    headers: { "cache-control": "no-store" }
  });
}
