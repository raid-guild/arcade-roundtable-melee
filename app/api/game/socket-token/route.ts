import { NextResponse } from "next/server";
import { signSocketToken } from "@/lib/socket-token";
import { getOptionalSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getOptionalSession();
  if (!session.playerId || !session.portalUserId || !session.handle) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const token = await signSocketToken({
    playerId: session.playerId,
    portalUserId: session.portalUserId,
    handle: session.handle,
    roles: session.roles ?? [],
  });

  return NextResponse.json({ token });
}
