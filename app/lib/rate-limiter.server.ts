/**
 * Redis-gebaseerde rate limiter — JANICE Returns & Exchanges app
 *
 * Gebruikt Redis INCR + EXPIRE voor eenvoudige vensterbegrenzing.
 * Sleutel: `ratelimit:<endpoint>:<identifier>` met TTL in seconden.
 *
 * Gebruik:
 *   import { controleerRateLimit } from "~/lib/rate-limiter.server";
 *
 *   const resultaat = await controleerRateLimit({
 *     identifier: ip,
 *     endpoint: "guest-lookup",
 *     maxPogingen: 5,
 *     vensterSeconds: 900, // 15 minuten
 *   });
 *   if (resultaat.overschreden) {
 *     return Response.json({ error: "rate_limited" }, {
 *       status: 429,
 *       headers: { "Retry-After": String(resultaat.retryAfterSeconds) },
 *     });
 *   }
 */

import Redis from "ioredis";

// ---------------------------------------------------------------------------
// Redis-verbinding (lazy singleton)
// ---------------------------------------------------------------------------

let redisClient: Redis | null = null;

function getRedis(): Redis {
  if (!redisClient) {
    const url = process.env["REDIS_URL"];
    if (!url) {
      throw new Error("REDIS_URL ontbreekt in omgevingsvariabelen");
    }
    redisClient = new Redis(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: false,
    });
  }
  return redisClient;
}

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

export interface RateLimitInput {
  /** Unieke identifier, bijv. IP-adres */
  identifier: string;
  /** Endpoint-naam voor de Redis-sleutel */
  endpoint: string;
  /** Maximaal toegestane pogingen per venster */
  maxPogingen: number;
  /** Venstergrootte in seconden */
  vensterSeconds: number;
}

export interface RateLimitResultaat {
  /** True als het limiet overschreden is */
  overschreden: boolean;
  /** Huidig aantal pogingen */
  huidigAantal: number;
  /** Maximaal toegestane pogingen */
  maxPogingen: number;
  /** Seconden tot reset — null als niet overschreden */
  retryAfterSeconds: number | null;
}

// ---------------------------------------------------------------------------
// Publieke API
// ---------------------------------------------------------------------------

/**
 * Controleer of een identifier het rate limit heeft overschreden.
 * Verhoogt de teller bij elke aanroep (inclusief de eerste).
 *
 * IP-bron: gebruik X-Forwarded-For (eerste hop) of request.ip.
 * Documentatie: X-Forwarded-For wordt gebruikt als primaire bron omdat de app
 * achter een Shopify-proxy draait. Eerste IP in X-Forwarded-For = werkelijke klant-IP.
 *
 * @param input - Configuratie voor de rate limit controle
 * @returns Resultaat inclusief overschrijdingsstatus en retry-after
 */
export async function controleerRateLimit(
  input: RateLimitInput,
): Promise<RateLimitResultaat> {
  const redis = getRedis();
  const sleutel = `ratelimit:${input.endpoint}:${input.identifier}`;

  // Verhoog teller atomair
  const huidigAantal = await redis.incr(sleutel);

  // Stel TTL in bij de eerste hit (SETEX-semantiek via EXPIRE)
  if (huidigAantal === 1) {
    await redis.expire(sleutel, input.vensterSeconds);
  }

  if (huidigAantal > input.maxPogingen) {
    // Haal de resterende TTL op voor Retry-After header
    const ttl = await redis.ttl(sleutel);
    return {
      overschreden: true,
      huidigAantal,
      maxPogingen: input.maxPogingen,
      retryAfterSeconds: ttl > 0 ? ttl : input.vensterSeconds,
    };
  }

  return {
    overschreden: false,
    huidigAantal,
    maxPogingen: input.maxPogingen,
    retryAfterSeconds: null,
  };
}

/**
 * Extraheer het client-IP-adres uit een Request.
 *
 * Strategie (in volgorde):
 *  1. X-Forwarded-For header (eerste IP = werkelijke klant achter Shopify-proxy)
 *  2. X-Real-IP header
 *  3. Terugval naar "unknown"
 *
 * Let op: X-Forwarded-For is vertrouwbaar achter de Shopify App Proxy omdat
 * Shopify de header instelt. Bij directe blootstelling zonder proxy is dit
 * manipuleerbaar — gebruik dan de socket-IP.
 */
export function extracteerClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const eersteIp = forwarded.split(",")[0]?.trim();
    if (eersteIp) return eersteIp;
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  return "unknown";
}

/**
 * Sluit de Redis-verbinding — gebruik in tests of graceful shutdown.
 */
export async function sluitRedisForbinding(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
