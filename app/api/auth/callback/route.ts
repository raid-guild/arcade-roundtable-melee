import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { LaunchTokenError, verifyLaunchToken } from "@/lib/launch-token";
import { getSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return redirectToLaunchError("missing_token");

  try {
    const claims = await verifyLaunchToken(token);

    const [player] = await db()
      .insert(schema.players)
      .values({
        portalUserId: claims.portalUserId,
        portalProfileId: claims.portalProfileId,
        handle: claims.handle,
        picture: claims.picture,
        roles: claims.roles,
        lastSeenAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.players.portalUserId,
        set: {
          portalProfileId: claims.portalProfileId,
          handle: claims.handle,
          picture: claims.picture,
          roles: claims.roles,
          lastSeenAt: new Date(),
        },
      })
      .returning();

    const session = await getSession();
    session.playerId = player.id;
    session.portalUserId = claims.portalUserId;
    session.portalProfileId = claims.portalProfileId;
    session.handle = claims.handle;
    session.picture = claims.picture;
    session.roles = claims.roles;
    await session.save();

    return redirectTo("/play");
  } catch (err) {
    const reason = launchErrorCode(err);
    console.error("Portal launch rejected", launchErrorLog(err));
    return redirectToLaunchError(reason);
  }
}

function redirectToLaunchError(reason: string) {
  return redirectTo(`/launch-error?reason=${encodeURIComponent(reason)}`);
}

function redirectTo(location: string) {
  return new NextResponse(null, {
    status: 303,
    headers: { Location: location },
  });
}

function launchErrorCode(err: unknown) {
  if (err instanceof LaunchTokenError) return err.code;
  if (err instanceof Error && err.message === "SESSION_SECRET is not set") {
    return "missing_session_secret";
  }
  if (err instanceof Error && err.message === "DATABASE_URL is not set") {
    return "missing_database_url";
  }
  return "callback_failed";
}

function launchErrorLog(err: unknown) {
  if (err instanceof LaunchTokenError) {
    return { code: err.code, message: err.message, details: err.details };
  }
  if (err instanceof Error) {
    return { code: launchErrorCode(err), message: err.message };
  }
  return { code: "callback_failed" };
}
