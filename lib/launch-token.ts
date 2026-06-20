import { decodeJwt, errors as joseErrors, jwtVerify } from "jose";

export interface LaunchClaims {
  portalUserId: string;
  portalProfileId?: string;
  handle: string;
  picture?: string;
  roles: string[];
}

export class LaunchTokenError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "LaunchTokenError";
  }
}

export async function verifyLaunchToken(token: string): Promise<LaunchClaims> {
  const secret = process.env.MODULE_LAUNCH_SECRET;
  if (!secret) throw new LaunchTokenError("MODULE_LAUNCH_SECRET is not set", "missing_secret");
  const issuer = process.env.PORTAL_ISSUER;
  if (!issuer) throw new LaunchTokenError("PORTAL_ISSUER is not set", "missing_issuer");
  const moduleSlug = process.env.MODULE_SLUG;
  if (!moduleSlug) throw new LaunchTokenError("MODULE_SLUG is not set", "missing_module_slug");

  const untrusted = decodeLaunchSummary(token);

  let payload: Awaited<ReturnType<typeof jwtVerify>>["payload"];
  try {
    ({ payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ["HS256"],
      issuer,
      audience: moduleSlug,
    }));
  } catch (err) {
    throw new LaunchTokenError("launch token failed JWT verification", jwtErrorCode(err), {
      expectedIssuer: issuer,
      expectedAudience: moduleSlug,
      token: untrusted,
    });
  }

  if (payload.typ !== "portal_module_launch") {
    throw new LaunchTokenError("launch token has invalid typ claim", "invalid_typ", {
      expectedTyp: "portal_module_launch",
      actualTyp: payload.typ,
    });
  }
  if (payload.moduleSlug !== moduleSlug) {
    throw new LaunchTokenError("launch token has invalid moduleSlug claim", "invalid_module_slug", {
      expectedModuleSlug: moduleSlug,
      actualModuleSlug: payload.moduleSlug,
    });
  }

  const portalUserId = stringClaim(payload.userID) ?? stringClaim(payload.userId);
  const portalProfileId =
    stringClaim(payload.profileID) ?? stringClaim(payload.profileId);
  const fallbackIdentity = portalUserId ?? portalProfileId ?? stringClaim(payload.sub);
  const handle =
    stringClaim(payload.handle) ??
    stringClaim(payload.name) ??
    (fallbackIdentity ? `member-${fallbackIdentity}` : undefined);
  const roles = Array.isArray(payload.roles)
    ? payload.roles.filter((role): role is string => typeof role === "string")
    : [];
  const picture = stringClaim(payload.picture);

  if (!portalUserId || !handle) {
    throw new LaunchTokenError("launch token missing user identity/handle claims", "missing_identity", {
      hasUserID: payload.userID !== undefined || payload.userId !== undefined,
      hasProfileID: payload.profileID !== undefined || payload.profileId !== undefined,
      hasSub: payload.sub !== undefined,
      hasHandle: payload.handle !== undefined || payload.name !== undefined,
    });
  }

  return { portalUserId, portalProfileId, handle, picture, roles };
}

function stringClaim(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function decodeLaunchSummary(token: string) {
  try {
    const payload = decodeJwt(token);
    return {
      iss: payload.iss,
      aud: payload.aud,
      typ: payload.typ,
      moduleSlug: payload.moduleSlug,
      exp: payload.exp,
      hasUserID: payload.userID !== undefined || payload.userId !== undefined,
      hasProfileID: payload.profileID !== undefined || payload.profileId !== undefined,
      hasHandle: payload.handle !== undefined || payload.name !== undefined,
    };
  } catch {
    return { malformed: true };
  }
}

function jwtErrorCode(err: unknown) {
  if (err instanceof joseErrors.JWTExpired) return "expired";
  if (err instanceof joseErrors.JWTClaimValidationFailed) {
    return `invalid_${err.claim}`;
  }
  if (err instanceof joseErrors.JWSSignatureVerificationFailed) {
    return "invalid_signature";
  }
  return "invalid_jwt";
}
