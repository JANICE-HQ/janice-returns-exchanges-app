/**
 * Health check endpoint — JANICE Returns & Exchanges app
 *
 * GET /health
 *
 * Antwoord: JSON met statussen voor env, db, redis en shopify.
 * Status 200 als alles ok of skipped — status 503 als een check faalt.
 *
 * Formaat:
 * {
 *   ok: boolean,
 *   ts: string,          // ISO-tijdstempel
 *   checks: {
 *     env:     { status: "ok" | "fail" | "skipped", details?: string },
 *     db:      { status: "ok" | "fail" | "skipped", details?: string },
 *     redis:   { status: "ok" | "fail" | "skipped", details?: string },
 *     shopify: { status: "ok" | "fail" | "skipped", details?: string }
 *   }
 * }
 */

import type { LoaderFunctionArgs } from "react-router";

type CheckStatus = "ok" | "fail" | "skipped";

interface CheckResultaat {
  status: CheckStatus;
  details?: string;
}

interface HealthAntwoord {
  ok: boolean;
  ts: string;
  checks: {
    env: CheckResultaat;
    db: CheckResultaat;
    redis: CheckResultaat;
    shopify: CheckResultaat;
  };
}

// ---------------------------------------------------------------------------
// Helperfuncties per check
// ---------------------------------------------------------------------------

/**
 * Controleer of alle vereiste env-vars aanwezig zijn.
 * Importeer env.server.ts NIET hier — dat zou bij ontbrekende vars crashen
 * vóórdat we een nette foutreactie kunnen sturen.
 */
function controleerEnv(): CheckResultaat {
  const vereist = [
    "SHOPIFY_ADMIN_TOKEN",
    "SHOPIFY_SHOP_DOMAIN",
    "DATABASE_URL",
    "REDIS_URL",
    "DHL_API_KEY",
    "DHL_USER_ID",
    "DHL_RETURN_ACCOUNT_ID",
    "DHL_WEBHOOK_SECRET",
    "GOEDGEPICKT_WEBHOOK_SECRET",
    "KLAVIYO_PRIVATE_API_KEY",
    "SENTRY_DSN_RETURNS_APP",
    "APP_URL",
    "NODE_ENV",
  ] as const;

  const ontbrekend = vereist.filter((k) => !process.env[k]);

  if (ontbrekend.length > 0) {
    return {
      status: "fail",
      details: `Ontbrekende env-vars: ${ontbrekend.join(", ")}`,
    };
  }

  return { status: "ok" };
}

/**
 * Controleer PostgreSQL via een simpele SELECT 1.
 */
async function controleerDatabase(): Promise<CheckResultaat> {
  const dbUrl = process.env["DATABASE_URL"];

  if (!dbUrl) {
    return { status: "skipped", details: "DATABASE_URL niet ingesteld" };
  }

  try {
    // Dynamische import om te voorkomen dat de DB-client crasht als DATABASE_URL ontbreekt
    const postgres = (await import("postgres")).default;
    const sql = postgres(dbUrl, {
      max: 1,
      idle_timeout: 5,
      connect_timeout: 5,
    });

    await sql`SELECT 1 AS ping`;
    await sql.end();

    return { status: "ok" };
  } catch (fout) {
    return {
      status: "fail",
      details:
        fout instanceof Error
          ? `DB-verbinding mislukt: ${fout.message}`
          : "DB-verbinding mislukt",
    };
  }
}

/**
 * Controleer Redis via PING.
 */
async function controleerRedis(): Promise<CheckResultaat> {
  const redisUrl = process.env["REDIS_URL"];

  if (!redisUrl) {
    return { status: "skipped", details: "REDIS_URL niet ingesteld" };
  }

  try {
    const { default: Redis } = await import("ioredis");
    const redis = new Redis(redisUrl, {
      lazyConnect: true,
      connectTimeout: 5000,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });

    await redis.connect();
    const antwoord = await redis.ping();
    await redis.quit();

    if (antwoord !== "PONG") {
      return {
        status: "fail",
        details: `Onverwacht PING-antwoord: ${antwoord}`,
      };
    }

    return { status: "ok" };
  } catch (fout) {
    return {
      status: "fail",
      details:
        fout instanceof Error
          ? `Redis-verbinding mislukt: ${fout.message}`
          : "Redis-verbinding mislukt",
    };
  }
}

/**
 * Controleer Shopify Admin GraphQL API via een simpele shop-query.
 */
async function controleerShopify(): Promise<CheckResultaat> {
  const token = process.env["SHOPIFY_ADMIN_TOKEN"];
  const domein = process.env["SHOPIFY_SHOP_DOMAIN"];

  if (!token || !domein) {
    return {
      status: "skipped",
      details: "SHOPIFY_ADMIN_TOKEN of SHOPIFY_SHOP_DOMAIN niet ingesteld",
    };
  }

  try {
    const url = `https://${domein}/admin/api/2025-01/graphql.json`;
    const antwoord = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query: "{ shop { name } }" }),
      signal: AbortSignal.timeout(8000),
    });

    if (!antwoord.ok) {
      return {
        status: "fail",
        details: `Shopify API-fout: HTTP ${antwoord.status} ${antwoord.statusText}`,
      };
    }

    const json = (await antwoord.json()) as {
      data?: { shop?: { name?: string } };
      errors?: Array<{ message: string }>;
    };

    if (json.errors?.length) {
      return {
        status: "fail",
        details: `Shopify GraphQL-fout: ${json.errors[0]?.message ?? "onbekend"}`,
      };
    }

    if (!json.data?.shop?.name) {
      return {
        status: "fail",
        details: "Shopify-antwoord bevat geen winkelnaam",
      };
    }

    return { status: "ok" };
  } catch (fout) {
    return {
      status: "fail",
      details:
        fout instanceof Error
          ? `Shopify-verbinding mislukt: ${fout.message}`
          : "Shopify-verbinding mislukt",
    };
  }
}

// ---------------------------------------------------------------------------
// Route loader
// ---------------------------------------------------------------------------
export async function loader(_args: LoaderFunctionArgs) {
  const tijdstempel = new Date().toISOString();

  // Alle checks parallel uitvoeren voor snellere reactie
  const [envCheck, dbCheck, redisCheck, shopifyCheck] = await Promise.all([
    Promise.resolve(controleerEnv()),
    controleerDatabase(),
    controleerRedis(),
    controleerShopify(),
  ]);

  const checks = {
    env: envCheck,
    db: dbCheck,
    redis: redisCheck,
    shopify: shopifyCheck,
  };

  // Alles is ok als alle checks "ok" of "skipped" zijn
  const alleOk = Object.values(checks).every(
    (c) => c.status === "ok" || c.status === "skipped",
  );

  const antwoord: HealthAntwoord = {
    ok: alleOk,
    ts: tijdstempel,
    checks,
  };

  return Response.json(antwoord, {
    status: alleOk ? 200 : 503,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    },
  });
}
