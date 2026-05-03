/**
 * Gast-JWT hulpfuncties — JANICE Returns & Exchanges app
 *
 * Genereert en verifieert kortstondige JWT-tokens (15 minuten) voor
 * gastklanten die via /apps/returns/guest-lookup een retour starten.
 *
 * Implementatie via de `jose`-library (Web Crypto API, geen native node:crypto JWT).
 * Algoritme: HS256 (HMAC-SHA256)
 * Geheim: JWT_SECRET omgevingsvariabele
 *
 * Token-payload:
 * {
 *   orderId: string,       // Shopify GID bijv. "gid://shopify/Order/12345"
 *   customerEmail: string, // E-mailadres van de klant
 *   expiresAt: string,     // ISO-8601 vervaldatum
 * }
 */

import { SignJWT, jwtVerify, errors as joseErrors } from "jose";

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

export interface GastTokenPayload {
  /** Shopify Order GID */
  orderId: string;
  /** E-mailadres van de gastklant */
  customerEmail: string;
  /** ISO-8601 vervaldatum van het token */
  expiresAt: string;
}

/** Fout bij ongeldige JWT */
export class GastTokenFout extends Error {
  public readonly reden: string;
  constructor(reden: string) {
    super(`Ongeldig gast-JWT: ${reden}`);
    this.name = "GastTokenFout";
    this.reden = reden;
  }
}

// ---------------------------------------------------------------------------
// Geldigheid
// ---------------------------------------------------------------------------

/** Token is 15 minuten geldig */
const TOKEN_GELDIGHEID_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------------------
// Hulpfuncties
// ---------------------------------------------------------------------------

function getJwtSecret(): Uint8Array {
  const geheim = process.env["JWT_SECRET"];
  if (!geheim || geheim.length < 32) {
    throw new Error(
      "JWT_SECRET ontbreekt of is te kort (minimaal 32 tekens vereist)",
    );
  }
  return new TextEncoder().encode(geheim);
}

// ---------------------------------------------------------------------------
// Publieke API
// ---------------------------------------------------------------------------

/**
 * Genereer een kortlopend JWT voor een gastklant.
 *
 * @param orderId       - Shopify Order GID
 * @param customerEmail - E-mailadres van de klant
 * @returns Gesigneerde JWT-string
 */
export async function genereerGastToken(
  orderId: string,
  customerEmail: string,
): Promise<string> {
  const geheim = getJwtSecret();
  const nu = new Date();
  const vervalDatum = new Date(nu.getTime() + TOKEN_GELDIGHEID_MS);

  const token = await new SignJWT({
    orderId,
    customerEmail,
    expiresAt: vervalDatum.toISOString(),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(nu)
    .setExpirationTime(vervalDatum)
    .setIssuer("janice-returns-app")
    .sign(geheim);

  return token;
}

/**
 * Verifieer en decodeer een gast-JWT.
 *
 * @param token - JWT-string uit de aanvraag
 * @returns Gedecodeerde payload
 * @throws {GastTokenFout} als het token ongeldig of verlopen is
 */
export async function verifieerGastToken(
  token: string,
): Promise<GastTokenPayload> {
  const geheim = getJwtSecret();

  try {
    const { payload } = await jwtVerify(token, geheim, {
      issuer: "janice-returns-app",
      algorithms: ["HS256"],
    });

    const orderId = payload["orderId"];
    const customerEmail = payload["customerEmail"];
    const expiresAt = payload["expiresAt"];

    if (
      typeof orderId !== "string" ||
      typeof customerEmail !== "string" ||
      typeof expiresAt !== "string"
    ) {
      throw new GastTokenFout(
        "Token-payload ontbreekt verplichte velden (orderId, customerEmail, expiresAt)",
      );
    }

    return { orderId, customerEmail, expiresAt };
  } catch (fout) {
    if (fout instanceof GastTokenFout) throw fout;

    if (fout instanceof joseErrors.JWTExpired) {
      throw new GastTokenFout("Token is verlopen");
    }
    if (fout instanceof joseErrors.JWSSignatureVerificationFailed) {
      throw new GastTokenFout("Token-handtekening is ongeldig");
    }
    if (fout instanceof joseErrors.JWTInvalid) {
      throw new GastTokenFout("Token-formaat is ongeldig");
    }

    throw new GastTokenFout(
      fout instanceof Error ? fout.message : "Onbekende JWT-fout",
    );
  }
}
