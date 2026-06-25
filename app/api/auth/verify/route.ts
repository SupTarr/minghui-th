import { NextResponse } from "next/server";
import { authorize } from "@/lib/auth";

// Lightweight, side-effect-free check the UI calls right after Google sign-in
// to learn whether the account is on the server allow-list — without hitting a
// real action endpoint. Mirrors the { reason } shape the other routes return.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authorize(req);
  if (!auth.authorized) {
    return NextResponse.json(
      { authorized: false, reason: auth.reason },
      { status: auth.status },
    );
  }
  return NextResponse.json({ authorized: true });
}
