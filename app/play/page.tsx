import Link from "next/link";
import GameCanvas from "./GameCanvas";
import { devLoginEnabled } from "@/lib/dev-login";
import { getOptionalSession, portalModulesUrl } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function PlayPage() {
  const session = await getOptionalSession();
  const showDevLogin = devLoginEnabled();

  if (!session.playerId) {
    return (
      <main className="screen">
        <h1 className="title">PORTAL REQUIRED</h1>
        <p className="subtitle">ROUNDTABLE MELEE ONLY ACCEPTS PORTAL-LAUNCHED PLAYERS</p>
        <a className="coin" href={portalModulesUrl()}>
          LAUNCH FROM PORTAL
        </a>
        {showDevLogin && (
          <a className="dev-link" href="/api/dev-login">
            LOCAL DEV LOGIN
          </a>
        )}
        <Link className="dim" href="/">
          BACK TO START
        </Link>
      </main>
    );
  }

  return (
    <main>
      <GameCanvas />
    </main>
  );
}
