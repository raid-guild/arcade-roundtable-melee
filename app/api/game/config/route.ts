import { NextResponse } from "next/server";
import { buildGameConfig } from "@/game/shared/config-values.mjs";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ config: buildGameConfig(process.env) });
}
