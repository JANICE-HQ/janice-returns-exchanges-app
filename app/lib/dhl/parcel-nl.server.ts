/**
 * DHL Parcel NL Returns API client — JANICE Returns & Exchanges app
 *
 * Implementeert OAuth2 token-caching in Redis + label-aanmaak voor retouren.
 * Ondersteunt zowel QR-printless als PDF-labels.
 *
 * Configuratie via env-variabelen:
 *   DHL_PARCEL_NL_API_URL       — basis-URL (standaard: https://api-gw.dhlparcel.nl)
 *   DHL_PARCEL_NL_USER_ID       — gebruikers-ID
 *   DHL_PARCEL_NL_KEY           — API-sleutel
 *   DHL_PARCEL_NL_ACCOUNT_ID    — accountnummer
 *
 * Als env-variabelen ontbreken, gooit DhlNotConfiguredError.
 * 5xx-fouten worden één keer herprobeerd (exponentiële backoff).
 * 4xx-fouten gooien DhlValidationError zonder herstelpoging.
 */

import * as Sentry from "@sentry/node";
import { logFout } from "~/lib/structured-logger.server";

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

export interface Address {
  /** Volledige naam (persoon of bedrijf) */
  name: string;
  /** Straat + huisnummer */
  addressLine1: string;
  /** Aanvulling, bijv. "Appartement 2B" */
  addressLine2?: string;
  /** Postcode, bijv. "1234 AB" */
  postalCode: string;
  /** Stad */
  city: string;
  /** ISO 3166-1 alpha-2 landcode, bijv. "NL" */
  countryCode: string;
  /** Telefoonnummer (optioneel, aanbevolen voor DHL) */
  phone?: string;
  /** E-mailadres (optioneel) */
  email?: string;
}

export interface DhlReturnLabelInput {
  /** Intern retour-ID voor correlatie */
  returnId: string;
  /** GoedGepickt-magazijnadres als ontvanger */
  receiverWarehouseAddress: Address;
  /** Klantadres als afzender */
  senderCustomerAddress: Address;
  /** Gewicht in grammen (standaard: 500) */
  weight?: number;
  /** Gebruik QR-printless drop-off (standaard: true) */
  isQrPrintless?: boolean;
}

export interface DhlReturnLabelResult {
  /** DHL-barcode / trackingnummer */
  trackingNumber: string;
  /** PDF-URL voor afdrukken (aanwezig bij isQrPrintless=false) */
  labelUrl?: string;
  /** QR-tokendata voor printvrijje inlevering (aanwezig bij isQrPrintless=true) */
  qrToken?: string;
  /** Vervaldatum van het retourlabel (typisch +30 dagen) */
  expiresAt: Date;
}

// ---------------------------------------------------------------------------
// Foutklassen
// ---------------------------------------------------------------------------

/**
 * Gooit wanneer DHL-credentials ontbreken in de omgeving.
 * Blokkeert het aanmaken van labels totdat Sean de credentials invult.
 */
export class DhlNotConfiguredError extends Error {
  constructor(missend: string[]) {
    super(
      `DHL Parcel NL is niet geconfigureerd. Ontbrekende env-variabelen: ${missend.join(", ")}. ` +
      `Voeg deze toe aan .env zodra de DHL-credentials beschikbaar zijn.`,
    );
    this.name = "DhlNotConfiguredError";
  }
}

/**
 * Gooit bij 4xx-fouten van de DHL API.
 * Niet automatisch herprobeerbaar.
 */
export class DhlValidationError extends Error {
  public readonly statusCode: number;
  public readonly responseBody: unknown;

  constructor(message: string, statusCode: number, responseBody: unknown) {
    super(`DHL validatiefout (${statusCode}): ${message}`);
    this.name = "DhlValidationError";
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

// ---------------------------------------------------------------------------
// DHL-configuratie — lees env-vars runtime (niet bij module-laden)
// ---------------------------------------------------------------------------

interface DhlConfig {
  apiUrl: string;
  userId: string;
  apiKey: string;
  accountId: string;
}

/**
 * Laad DHL-configuratie uit process.env.
 * Gooit DhlNotConfiguredError als een of meer variabelen ontbreken.
 */
function laadDhlConfig(): DhlConfig {
  const apiUrl = process.env.DHL_PARCEL_NL_API_URL ?? "https://api-gw.dhlparcel.nl";
  const userId = process.env.DHL_PARCEL_NL_USER_ID ?? "";
  const apiKey = process.env.DHL_PARCEL_NL_KEY ?? "";
  const accountId = process.env.DHL_PARCEL_NL_ACCOUNT_ID ?? "";

  const missend: string[] = [];
  if (!userId) missend.push("DHL_PARCEL_NL_USER_ID");
  if (!apiKey) missend.push("DHL_PARCEL_NL_KEY");
  if (!accountId) missend.push("DHL_PARCEL_NL_ACCOUNT_ID");

  if (missend.length > 0) {
    throw new DhlNotConfiguredError(missend);
  }

  return { apiUrl, userId, apiKey, accountId };
}

// ---------------------------------------------------------------------------
// OAuth2 token-caching via Redis
// ---------------------------------------------------------------------------

interface DhlToken {
  accessToken: string;
  expiresAt: number; // Unix-tijdstempel in ms
}

/** In-memory cache als Redis niet beschikbaar is (voor tests) */
let tokenCache: DhlToken | null = null;

const REDIS_TOKEN_KEY = "dhl:parcel_nl:access_token";

/**
 * Haal een geldig DHL-toegangstoken op.
 * Controleert eerst Redis, daarna in-memory cache.
 * Vraagt een nieuw token aan als het verlopen is.
 */
export async function haalDhlTokenOp(config: DhlConfig): Promise<string> {
  // Probeer Redis-cache
  const redis = await probeerRedisVerbinding();
  if (redis) {
    const gecachedToken = await redis.get(REDIS_TOKEN_KEY);
    if (gecachedToken) {
      return gecachedToken;
    }
  }

  // Controleer in-memory cache
  if (tokenCache && tokenCache.expiresAt > Date.now()) {
    return tokenCache.accessToken;
  }

  // Vraag nieuw token aan
  const nieuwToken = await vraagDhlTokenAan(config);

  // Sla op in Redis (TTL = expires_in - 60s)
  if (redis && nieuwToken.expiresIn > 60) {
    const ttlSeconden = nieuwToken.expiresIn - 60;
    await redis.set(REDIS_TOKEN_KEY, nieuwToken.accessToken, "EX", ttlSeconden);
  }

  // Sla ook op in in-memory cache
  tokenCache = {
    accessToken: nieuwToken.accessToken,
    expiresAt: Date.now() + (nieuwToken.expiresIn - 60) * 1000,
  };

  return nieuwToken.accessToken;
}

/**
 * Vraag een nieuw OAuth2-token aan bij DHL.
 */
async function vraagDhlTokenAan(config: DhlConfig): Promise<{ accessToken: string; expiresIn: number }> {
  const url = `${config.apiUrl}/authenticate/api-key`;

  const reactie = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      userId: config.userId,
      key: config.apiKey,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!reactie.ok) {
    const body = await reactie.json().catch(() => null);
    throw new DhlValidationError(
      `DHL authenticatie mislukt`,
      reactie.status,
      body,
    );
  }

  const data = await reactie.json() as {
    accessToken?: string;
    expiresIn?: number;
  };

  if (!data.accessToken) {
    throw new Error("DHL token-antwoord mist accessToken-veld");
  }

  return {
    accessToken: data.accessToken,
    expiresIn: data.expiresIn ?? 3600,
  };
}

/**
 * Probeer een Redis-verbinding op te zetten.
 * Retourneert null als Redis niet beschikbaar is (voor tests).
 */
async function probeerRedisVerbinding() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return null;

  try {
    const { default: Redis } = await import("ioredis");
    const client = new Redis(redisUrl, {
      lazyConnect: true,
      connectTimeout: 2000,
      maxRetriesPerRequest: 1,
    });
    await client.connect();
    return client;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Interne cache-invalidatie (voor tests)
// ---------------------------------------------------------------------------

/** Reset de in-memory token-cache (alleen voor tests) */
export function _resetTokenCacheVoorTests(): void {
  tokenCache = null;
}

// ---------------------------------------------------------------------------
// Hoofd-functie: label aanmaken
// ---------------------------------------------------------------------------

/**
 * Maak een DHL retourlabel aan.
 *
 * Retourneert trackingNumber + qrToken (printless) of labelUrl (PDF).
 *
 * @throws DhlNotConfiguredError — als env-vars ontbreken
 * @throws DhlValidationError   — bij 4xx van DHL API
 * @throws Error                — bij netwerk-/timeout-fouten
 */
export async function createReturnLabel(
  input: DhlReturnLabelInput,
): Promise<DhlReturnLabelResult> {
  const config = laadDhlConfig();

  return Sentry.startSpan(
    {
      op: "http.client",
      name: "DHL createReturnLabel",
      attributes: {
        "return.id": input.returnId,
        "dhl.is_qr_printless": String(input.isQrPrintless ?? true),
      },
    },
    async () => {
      const toegangsToken = await haalDhlTokenOp(config);

      const gewicht = input.weight ?? 500;
      const isQrPrintless = input.isQrPrintless ?? true;

      const aanvraagBody = {
        accountId: config.accountId,
        receiver: {
          name: input.receiverWarehouseAddress.name,
          address: {
            addressLine1: input.receiverWarehouseAddress.addressLine1,
            addressLine2: input.receiverWarehouseAddress.addressLine2,
            postalCode: input.receiverWarehouseAddress.postalCode,
            city: input.receiverWarehouseAddress.city,
            countryCode: input.receiverWarehouseAddress.countryCode,
          },
        },
        sender: {
          name: input.senderCustomerAddress.name,
          address: {
            addressLine1: input.senderCustomerAddress.addressLine1,
            addressLine2: input.senderCustomerAddress.addressLine2,
            postalCode: input.senderCustomerAddress.postalCode,
            city: input.senderCustomerAddress.city,
            countryCode: input.senderCustomerAddress.countryCode,
          },
          ...(input.senderCustomerAddress.phone && {
            contact: { phone: input.senderCustomerAddress.phone },
          }),
        },
        options: {
          PRINTLESS_RETURN: isQrPrintless,
        },
        pieces: [
          {
            weight: gewicht / 1000, // DHL verwacht kg
            quantity: 1,
          },
        ],
      };

      // Log aanvraag (zonder auth-header)
      process.stdout.write(
        JSON.stringify({
          level: "INFO",
          ts: new Date().toISOString(),
          event: "dhl_label_request",
          returnId: input.returnId,
          url: `${config.apiUrl}/labels`,
          isQrPrintless,
        }) + "\n",
      );

      const reactie = await uitvoerenMetHerpoging(
        () =>
          fetch(`${config.apiUrl}/labels`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${toegangsToken}`,
            },
            body: JSON.stringify(aanvraagBody),
            signal: AbortSignal.timeout(10_000),
          }),
        {
          maxPogingen: 2,
          basisVertraging: 1000,
          returnId: input.returnId,
        },
      );

      if (!reactie.ok) {
        const body = await reactie.json().catch(() => null);
        process.stderr.write(
          JSON.stringify({
            level: "ERROR",
            ts: new Date().toISOString(),
            event: "dhl_label_error",
            returnId: input.returnId,
            status: reactie.status,
          }) + "\n",
        );
        throw new DhlValidationError(
          `DHL label-aanmaak mislukt`,
          reactie.status,
          body,
        );
      }

      const data = await reactie.json() as {
        trackingNumber?: string;
        labelUrl?: string;
        qrCodeData?: string;
        expiryDate?: string;
      };

      if (!data.trackingNumber) {
        throw new Error("DHL label-antwoord mist trackingNumber-veld");
      }

      // Log succesvol antwoord
      process.stdout.write(
        JSON.stringify({
          level: "INFO",
          ts: new Date().toISOString(),
          event: "dhl_label_created",
          returnId: input.returnId,
          trackingNumber: data.trackingNumber,
        }) + "\n",
      );

      const vervalDatum = data.expiryDate
        ? new Date(data.expiryDate)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      return {
        trackingNumber: data.trackingNumber,
        labelUrl: data.labelUrl,
        qrToken: data.qrCodeData,
        expiresAt: vervalDatum,
      };
    },
  );
}

// ---------------------------------------------------------------------------
// Hulpfunctie: exponentiële herpoging bij 5xx
// ---------------------------------------------------------------------------

interface HerpogingOpties {
  maxPogingen: number;
  basisVertraging: number;
  returnId: string;
}

/**
 * Voer een fetch-aanroep uit met automatische herpoging bij 5xx-fouten.
 * 4xx-fouten worden NIET herprobeerd.
 */
async function uitvoerenMetHerpoging(
  aanroep: () => Promise<Response>,
  opties: HerpogingOpties,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let poging = 1; poging <= opties.maxPogingen; poging++) {
    try {
      const reactie = await aanroep();

      // 4xx → direct terugkeren (niet herproberen)
      if (reactie.status >= 400 && reactie.status < 500) {
        return reactie;
      }

      // 5xx → herprobeer als er pogingen over zijn
      if (reactie.status >= 500 && poging < opties.maxPogingen) {
        const vertraging = opties.basisVertraging * Math.pow(2, poging - 1);
        process.stderr.write(
          JSON.stringify({
            level: "WARN",
            ts: new Date().toISOString(),
            event: "dhl_retry",
            returnId: opties.returnId,
            poging,
            status: reactie.status,
            vertraging_ms: vertraging,
          }) + "\n",
        );
        await wacht(vertraging);
        continue;
      }

      return reactie;
    } catch (fout) {
      lastError = fout instanceof Error ? fout : new Error(String(fout));

      if (poging < opties.maxPogingen) {
        const vertraging = opties.basisVertraging * Math.pow(2, poging - 1);
        logFout(fout, { event: "dhl_network_error_retry", returnId: opties.returnId, poging });
        await wacht(vertraging);
      }
    }
  }

  throw lastError ?? new Error("DHL API niet bereikbaar na maximale pogingen");
}

function wacht(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
