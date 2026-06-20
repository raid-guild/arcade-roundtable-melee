import { NextResponse } from "next/server";
import { getOptionalSession, hasMemberRole, portalModulesUrl } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getOptionalSession();
  return NextResponse.json({
    authenticated: Boolean(session.playerId),
    playerId: session.playerId ?? null,
    handle: session.handle ?? null,
    picture: session.picture ?? null,
    roles: session.roles ?? [],
    canStartGame: hasMemberRole(session),
    portalUrl: portalModulesUrl(),
  });
}
