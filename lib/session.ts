import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export interface SessionData {
  playerId?: string;
  portalUserId?: string;
  portalProfileId?: string;
  handle?: string;
  picture?: string;
  roles?: string[];
}

function sessionOptions(): SessionOptions {
  const password =
    process.env.SESSION_SECRET ?? "dev-only-secret-change-me-32chars!!";
  if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET is not set");
  }

  return {
    cookieName: "roundtable-melee-session",
    password,
    cookieOptions: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
    },
  };
}

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions());
}

export async function getOptionalSession(): Promise<SessionData> {
  if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
    return {};
  }

  return getSession();
}

export function hasMemberRole(session: SessionData) {
  return session.roles?.includes("member") ?? false;
}

export function portalModulesUrl() {
  return process.env.PORTAL_MODULES_URL ?? "https://portal.raidguild.org/modules";
}
