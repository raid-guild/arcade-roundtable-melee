import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { devLoginEnabled, defaultDevHandle } from "@/lib/dev-login";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!devLoginEnabled()) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const handle =
    cleanHandle(req.nextUrl.searchParams.get("handle")) ?? defaultDevHandle();
  const playerId = cleanUuid(req.nextUrl.searchParams.get("playerId")) ?? randomUUID();
  const portalUserId = `dev:${playerId}`;

  const session = await getSession();
  session.playerId = playerId;
  session.portalUserId = portalUserId;
  session.portalProfileId = `dev-profile:${playerId}`;
  session.handle = handle;
  session.picture = undefined;
  session.roles = ["member"];
  await session.save();

  return new NextResponse(null, {
    status: 303,
    headers: { Location: "/play" },
  });
}

function cleanHandle(value: string | null) {
  if (!value) return undefined;
  const trimmed = value.trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24);
  return trimmed || undefined;
}

function cleanUuid(value: string | null) {
  if (!value) return undefined;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  )
    ? value
    : undefined;
}
