/**
 * Idempotentie-helper — JANICE Returns & Exchanges app
 *
 * Voorkomt dubbele verwerking van identieke verzoeken binnen een opgegeven TTL.
 * Slaat het HTTP-antwoord op in de `idempotency_keys`-tabel.
 *
 * Gedrag:
 *  1. Zoek `key` op in de tabel
 *  2. Gevonden + niet verlopen + zelfde endpoint → geef gecachet antwoord terug
 *  3. Gevonden + zelfde endpoint + verlopen → behandel als nieuw
 *  4. Gevonden + ANDER endpoint → geef 409 terug (key hergebruikt voor ander endpoint)
 *  5. Niet gevonden → voer handler uit, sla op met ON CONFLICT DO NOTHING, herlees bij race
 *
 * Gebruik:
 *   import { withIdempotency } from "~/lib/idempotency.server";
 *
 *   const { status, body, cached } = await withIdempotency(
 *     key, "POST /apps/returns/start", 24,
 *     async () => ({ status: 201, body: { id: "..." } })
 *   );
 */

import { eq, and, gt } from "drizzle-orm";
import { db } from "../../db/index.js";
import { idempotencyKeys } from "../../db/schema.js";

// ---------------------------------------------------------------------------
// Foutklasse
// ---------------------------------------------------------------------------

export class IdempotencyMismatchFout extends Error {
  public readonly code = "idempotency_key_reused_for_different_endpoint";
  public readonly opgeslagenEndpoint: string;
  public readonly gevraagdEndpoint: string;

  constructor(opgeslagen: string, gevraagd: string) {
    super(
      `Idempotency-sleutel hergebruikt voor een ander endpoint. ` +
        `Opgeslagen: '${opgeslagen}', Gevraagd: '${gevraagd}'`,
    );
    this.name = "IdempotencyMismatchFout";
    this.opgeslagenEndpoint = opgeslagen;
    this.gevraagdEndpoint = gevraagd;
  }
}

// ---------------------------------------------------------------------------
// Hoofd-functie
// ---------------------------------------------------------------------------

export interface IdempotencyResultaat<T> {
  status: number;
  body: T;
  cached: boolean;
}

/**
 * Voer een handler uit met idempotentiegarantie.
 *
 * @param key        - Client-geleverde UUID (idempotency key)
 * @param endpoint   - Canonical endpoint-naam, bijv. "POST /apps/returns/start"
 * @param ttlUren    - Geldigheid in uren (standaard 24)
 * @param handler    - Async functie die { status, body } retourneert
 * @returns Gecachet of vers resultaat met `cached` vlag
 * @throws {IdempotencyMismatchFout} als key al bestaat voor een ander endpoint
 */
export async function withIdempotency<T>(
  key: string,
  endpoint: string,
  ttlUren: number = 24,
  handler: () => Promise<{ status: number; body: T }>,
): Promise<IdempotencyResultaat<T>> {
  const nu = new Date();

  // Stap 1: Zoek bestaande sleutel op
  const [bestaande] = await db
    .select()
    .from(idempotencyKeys)
    .where(eq(idempotencyKeys.key, key))
    .limit(1);

  if (bestaande) {
    // Stap 2a: Endpoint-mismatch → altijd 409, ook als verlopen
    if (bestaande.endpoint !== endpoint) {
      throw new IdempotencyMismatchFout(bestaande.endpoint, endpoint);
    }

    // Stap 2b: Gevonden + zelfde endpoint + nog geldig → geef cache terug
    if (bestaande.expiresAt > nu) {
      return {
        status: bestaande.responseStatus,
        body: bestaande.responseBody as T,
        cached: true,
      };
    }

    // Stap 2c: Verlopen → val door naar handler (behandel als nieuw)
  }

  // Stap 3: Voer de handler uit
  const resultaat = await handler();

  // Stap 4: Bewaar het resultaat met ON CONFLICT DO NOTHING (race-conditie-veilig)
  const vervalDatum = new Date(nu.getTime() + ttlUren * 60 * 60 * 1000);

  try {
    await db
      .insert(idempotencyKeys)
      .values({
        key,
        endpoint,
        responseStatus: resultaat.status,
        responseBody: resultaat.body as Record<string, unknown>,
        expiresAt: vervalDatum,
        createdAt: nu,
      })
      .onConflictDoNothing();
  } catch {
    // Race-conditie: een andere instantie heeft de sleutel al opgeslagen.
    // Lees de opgeslagen waarde opnieuw op.
    const [opgeslagen] = await db
      .select()
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.key, key),
          gt(idempotencyKeys.expiresAt, nu),
        ),
      )
      .limit(1);

    if (opgeslagen) {
      if (opgeslagen.endpoint !== endpoint) {
        throw new IdempotencyMismatchFout(opgeslagen.endpoint, endpoint);
      }
      return {
        status: opgeslagen.responseStatus,
        body: opgeslagen.responseBody as T,
        cached: true,
      };
    }
  }

  return {
    status: resultaat.status,
    body: resultaat.body,
    cached: false,
  };
}
