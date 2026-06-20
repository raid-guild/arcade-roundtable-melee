import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

let cached: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function db() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }

  if (!cached) {
    const client = postgres(process.env.DATABASE_URL, { max: 1 });
    cached = drizzle(client, { schema });
  }

  return cached;
}

export { schema };
