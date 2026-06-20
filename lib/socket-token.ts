import { SignJWT, jwtVerify } from "jose";
import type { SocketIdentity } from "@/game/shared/protocol";

export async function signSocketToken(identity: SocketIdentity) {
  const secret = socketSecret();
  return new SignJWT({ ...identity, typ: "roundtable_socket" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(secret));
}

export async function verifySocketToken(token: string): Promise<SocketIdentity> {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(socketSecret()), {
    algorithms: ["HS256"],
  });

  if (payload.typ !== "roundtable_socket") {
    throw new Error("invalid socket token type");
  }

  const playerId = asString(payload.playerId);
  const portalUserId = asString(payload.portalUserId);
  const handle = asString(payload.handle);
  const roles = Array.isArray(payload.roles)
    ? payload.roles.filter((role): role is string => typeof role === "string")
    : [];

  if (!playerId || !portalUserId || !handle) {
    throw new Error("socket token missing identity");
  }

  return { playerId, portalUserId, handle, roles };
}

function socketSecret() {
  const secret = process.env.SOCKET_TOKEN_SECRET ?? process.env.SESSION_SECRET;
  if (!secret) throw new Error("SOCKET_TOKEN_SECRET or SESSION_SECRET is not set");
  return secret;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}
