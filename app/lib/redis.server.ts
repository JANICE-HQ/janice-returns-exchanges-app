/**
 * Gedeelde Redis-client — JANICE Returns & Exchanges app
 *
 * Biedt een singleton ioredis-instantie voor gebruik buiten BullMQ:
 * - Token-caching (shopify-token-manager.server.ts)
 * - Toekomstige cache-behoeften
 *
 * BullMQ maakt zijn eigen verbindingen op basis van REDIS_URL — deze client
 * is NIET bedoeld voor BullMQ-queues.
 *
 * Gebruik:
 *   import { redis } from "~/lib/redis.server";
 *   await redis.get("mijn-sleutel");
 */

import Redis from "ioredis";

let redisInstantie: Redis | null = null;

/**
 * Retourneert de gedeelde Redis-client-instantie (singleton).
 * Aangemaakt bij eerste gebruik (lazy initialisatie).
 *
 * @throws {Error} Als REDIS_URL niet is ingesteld
 */
function haalRedisOp(): Redis {
  if (redisInstantie) {
    return redisInstantie;
  }

  const redisUrl = process.env["REDIS_URL"];
  if (!redisUrl) {
    throw new Error("REDIS_URL is vereist voor Redis-verbinding");
  }

  redisInstantie = new Redis(redisUrl, {
    // Automatisch herverbinden bij verbroken verbinding
    enableReadyCheck: true,
    maxRetriesPerRequest: 3,
    lazyConnect: false,

    // Label voor Redis-monitor en foutlogs
    connectionName: "janice-returns-app",
  });

  redisInstantie.on("error", (fout: Error) => {
    process.stderr.write(
      JSON.stringify({
        level: "ERROR",
        ts: new Date().toISOString(),
        event: "redis_verbindingsfout",
        error: fout.message,
        message: "Redis-verbinding verbroken — controleer REDIS_URL en Redis-beschikbaarheid",
      }) + "\n",
    );
  });

  redisInstantie.on("connect", () => {
    process.stdout.write(
      JSON.stringify({
        level: "INFO",
        ts: new Date().toISOString(),
        event: "redis_verbonden",
        message: "Redis-verbinding tot stand gebracht",
      }) + "\n",
    );
  });

  return redisInstantie;
}

/**
 * Gedeelde Redis-client-instantie.
 * Gebruik Proxy zodat aanroepen worden doorgestuurd naar de lazy-geïnitialiseerde instantie.
 */
export const redis: Redis = new Proxy({} as Redis, {
  get(_doel, eigenschap) {
    const instantie = haalRedisOp();
    const waarde = instantie[eigenschap as keyof Redis];
    if (typeof waarde === "function") {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
      return (waarde as Function).bind(instantie);
    }
    return waarde;
  },
});

/**
 * Sluit de Redis-verbinding netjes af.
 * Aanroepen bij graceful shutdown.
 */
export async function sluitRedis(): Promise<void> {
  if (redisInstantie) {
    await redisInstantie.quit();
    redisInstantie = null;
  }
}

/**
 * Resetfunctie voor tests — vervangt de instantie door een mock.
 * @internal
 */
export function _setRedisInstantieVoorTests(mock: Redis): void {
  redisInstantie = mock;
}
