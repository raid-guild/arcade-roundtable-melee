import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ matches: [] });
  }

  const matches = await db()
    .select({
      id: schema.roundtableMatches.id,
      status: schema.roundtableMatches.status,
      endedAt: schema.roundtableMatches.endedAt,
      combatStartedAt: schema.roundtableMatches.combatStartedAt,
      durationSeconds: schema.roundtableMatches.durationSeconds,
    })
    .from(schema.roundtableMatches)
    .orderBy(desc(schema.roundtableMatches.endedAt))
    .limit(10);

  const rows = [];
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

    rows.push({ ...match, players });
  }

  return NextResponse.json({ matches: rows });
}
