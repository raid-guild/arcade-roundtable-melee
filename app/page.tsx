import Link from "next/link";
import { getOptionalSession, portalModulesUrl } from "@/lib/session";
import { GAME_CONFIG } from "@/game/shared/config";
import { devLoginEnabled } from "@/lib/dev-login";

export const dynamic = "force-dynamic";

export default async function StartScreen() {
  const session = await getOptionalSession();
  const showDevLogin = devLoginEnabled();

  return (
    <main className="screen">
      <h1 className="title">ROUNDTABLE MELEE</h1>
      <p className="subtitle">
        DUNGEON SCRAP FOR PORTAL-LAUNCHED RAIDERS
        <br />
        {GAME_CONFIG.matchDurationSeconds / 60} MINUTES | {GAME_CONFIG.maxPlayers} PLAYERS | ONE ROUND
      </p>

      {session.playerId ? (
        <Link className="coin" href="/play">
          ENTER THE DUNGEON
        </Link>
      ) : (
        <a className="coin" href={portalModulesUrl()}>
          LAUNCH FROM PORTAL
        </a>
      )}

      {!session.playerId && showDevLogin && (
        <a className="dev-link" href="/api/dev-login">
          LOCAL DEV LOGIN
        </a>
      )}

      <div className="score-guide" aria-label="Scoring guide">
        <div className="score-guide__item">SLAY {GAME_CONFIG.slayScore}</div>
        <div className="score-guide__item">DEATH {GAME_CONFIG.deathScore}</div>
        <div className="score-guide__item">CHEST {GAME_CONFIG.chestScore}</div>
        <div className="score-guide__item">FREEZE {GAME_CONFIG.freezeSeconds}s</div>
      </div>

      <div className="controls-guide" aria-label="Controls">
        <span>ARROWS MOVE</span>
        <span>SPACE ATTACK</span>
        <span>HAMS HEAL</span>
        <span>CHESTS SCORE</span>
      </div>

      {session.handle ? (
        <p className="dim">ENTERING AS {session.handle.toUpperCase()}</p>
      ) : (
        <p className="dim">ALL PLAYERS MUST LAUNCH FROM THE RAID GUILD PORTAL</p>
      )}
      {session.playerId && (
        <Link className="dev-link" href="/results">
          RECENT MELEES
        </Link>
      )}
    </main>
  );
}
