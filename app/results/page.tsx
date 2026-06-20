import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getOptionalSession, portalModulesUrl } from "@/lib/session";

export const dynamic = "force-dynamic";

interface ResultMatch {
  id: string;
  status: string;
  endedAt: Date | null;
  players: {
    handle: string;
    characterId: string;
    score: number;
    slays: number;
    deaths: number;
    finalRank: number;
  }[];
}

export default async function ResultsPage() {
  const session = await getOptionalSession();
  const matches = session.playerId ? await loadRecentMatches() : [];

  return (
    <main className="screen screen--results">
      <h1 className="title">RECENT MELEES</h1>
      {!session.playerId && (
        <>
          <p className="subtitle">PORTAL SESSION REQUIRED</p>
          <a className="coin" href={portalModulesUrl()}>
            LAUNCH FROM PORTAL
          </a>
        </>
      )}

      {session.playerId && matches.length === 0 && (
        <p className="subtitle">NO SAVED MATCHES YET</p>
      )}

      {matches.length > 0 && (
        <div className="results-list">
          {matches.map((match) => (
            <section className="result-card" key={match.id}>
              <header>
                <span>{match.status.toUpperCase()}</span>
                <span>{match.endedAt ? match.endedAt.toLocaleString() : "NO END TIME"}</span>
              </header>
              <div className="result-rows">
                {match.players.map((player) => (
                  <div key={`${match.id}-${player.finalRank}`}>
                    <span>
                      {player.finalRank}. {player.handle.toUpperCase()} /{" "}
                      {player.characterId.toUpperCase()}
                    </span>
                    <span>
                      {player.score} | {player.slays}K {player.deaths}D
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <Link className="dev-link" href="/play">
        BACK TO MELEE
      </Link>
    </main>
  );
}

async function loadRecentMatches(): Promise<ResultMatch[]> {
  if (!process.env.DATABASE_URL) return [];

  const matches = await db()
    .select({
      id: schema.roundtableMatches.id,
      status: schema.roundtableMatches.status,
      endedAt: schema.roundtableMatches.endedAt,
    })
    .from(schema.roundtableMatches)
    .orderBy(desc(schema.roundtableMatches.endedAt))
    .limit(10);

  const results: ResultMatch[] = [];
  for (const match of matches) {
    const players = await db()
      .select({
        handle: schema.players.handle,
        characterId: schema.roundtableMatchPlayers.characterId,
        score: schema.roundtableMatchPlayers.score,
        slays: schema.roundtableMatchPlayers.slays,
        deaths: schema.roundtableMatchPlayers.deaths,
        finalRank: schema.roundtableMatchPlayers.finalRank,
      })
      .from(schema.roundtableMatchPlayers)
      .innerJoin(
        schema.players,
        eq(schema.roundtableMatchPlayers.playerId, schema.players.id)
      )
      .where(eq(schema.roundtableMatchPlayers.matchId, match.id))
      .orderBy(schema.roundtableMatchPlayers.finalRank);

    results.push({ ...match, players });
  }

  return results;
}
