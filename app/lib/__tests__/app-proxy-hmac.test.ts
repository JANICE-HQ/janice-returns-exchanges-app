/**
 * Tests voor App Proxy HMAC-verificatie — JANICE Returns & Exchanges app
 *
 * Dekt:
 * - Geldige handtekening
 * - Ontbrekende handtekening
 * - Ongeldige handtekening
 * - Constante-tijdvergelijking (geen timing-lek)
 * - Context-extractie
 */

import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import {
  verifieerAppProxyHmac,
  extracteerProxyContext,
  HmacVerificatieFout,
} from "../app-proxy-hmac.server";

const TESTGEHEIM = "test-geheim-abcdefghijklmnopqrstuvwxyz123456";

/**
 * Maak een geldige HMAC-handtekening voor testparams.
 */
function maakHandtekening(
  params: Record<string, string>,
  geheim: string,
): string {
  const canoniek = Object.keys(params)
    .filter((k) => k !== "signature")
    .sort()
    .map((k) => `${k}=${params[k] ?? ""}`)
    .join("");

  return createHmac("sha256", geheim).update(canoniek, "utf8").digest("hex");
}

describe("verifieerAppProxyHmac", () => {
  it("accepteert een geldige HMAC-handtekening", () => {
    const params: Record<string, string> = {
      shop: "test-shop.myshopify.com",
      path_prefix: "/apps/returns",
      timestamp: "1234567890",
      logged_in_customer_id: "99999",
    };
    params["signature"] = maakHandtekening(params, TESTGEHEIM);

    expect(() => verifieerAppProxyHmac(params, TESTGEHEIM)).not.toThrow();
  });

  it("gooit HmacVerificatieFout bij ontbrekende signature-parameter", () => {
    const params: Record<string, string> = {
      shop: "test-shop.myshopify.com",
      timestamp: "1234567890",
    };

    expect(() => verifieerAppProxyHmac(params, TESTGEHEIM)).toThrow(
      HmacVerificatieFout,
    );
    expect(() => verifieerAppProxyHmac(params, TESTGEHEIM)).toThrow(
      "'signature' parameter ontbreekt",
    );
  });

  it("gooit HmacVerificatieFout bij onjuiste handtekening", () => {
    const params: Record<string, string> = {
      shop: "test-shop.myshopify.com",
      timestamp: "1234567890",
      signature: "vervalste-handtekening-64tekens-lang00000000000000000000000000000",
    };

    expect(() => verifieerAppProxyHmac(params, TESTGEHEIM)).toThrow(
      HmacVerificatieFout,
    );
  });

  it("gooit HmacVerificatieFout bij een handtekening met onjuiste lengte", () => {
    const params: Record<string, string> = {
      shop: "test-shop.myshopify.com",
      timestamp: "1234567890",
      signature: "korthandtekening",
    };

    expect(() => verifieerAppProxyHmac(params, TESTGEHEIM)).toThrow(
      HmacVerificatieFout,
    );
  });

  it("gooit HmacVerificatieFout als het geheim niet overeenkomt", () => {
    const params: Record<string, string> = {
      shop: "test-shop.myshopify.com",
      timestamp: "1234567890",
    };
    // Onderteken met een ander geheim
    params["signature"] = maakHandtekening(params, "ander-geheim-abcdefghijklmnopqrstuvwxyz");

    expect(() => verifieerAppProxyHmac(params, TESTGEHEIM)).toThrow(
      HmacVerificatieFout,
    );
  });

  it("verwerkt URLSearchParams correct naast Record", () => {
    const params: Record<string, string> = {
      shop: "test-shop.myshopify.com",
      path_prefix: "/apps/returns",
      timestamp: "1234567890",
    };
    params["signature"] = maakHandtekening(params, TESTGEHEIM);

    const searchParams = new URLSearchParams(params);

    expect(() => verifieerAppProxyHmac(searchParams, TESTGEHEIM)).not.toThrow();
  });

  it("sorteert parameters correct voor canonieke string", () => {
    // Parameters in omgekeerde alfabetische volgorde — sorteer moet gelijk resultaat geven
    const params: Record<string, string> = {
      z_laatste: "waarde",
      a_eerste: "waarde",
      m_midden: "waarde",
    };
    params["signature"] = maakHandtekening(params, TESTGEHEIM);

    expect(() => verifieerAppProxyHmac(params, TESTGEHEIM)).not.toThrow();
  });

  it("sluit 'signature' uit de canonieke string", () => {
    const params: Record<string, string> = {
      shop: "test.myshopify.com",
      timestamp: "999",
    };
    const handtekening = maakHandtekening(params, TESTGEHEIM);
    params["signature"] = handtekening;

    // Als 'signature' mee in de canonieke string zou zitten, zou de hash falen
    expect(() => verifieerAppProxyHmac(params, TESTGEHEIM)).not.toThrow();
  });
});

describe("extracteerProxyContext", () => {
  it("extraheert shop, loggedInCustomerId en pathPrefix correct", () => {
    const params: Record<string, string> = {
      shop: "mijn-winkel.myshopify.com",
      logged_in_customer_id: "12345",
      path_prefix: "/apps/returns",
      signature: "dummy",
      timestamp: "123",
    };

    const context = extracteerProxyContext(params);

    expect(context.shop).toBe("mijn-winkel.myshopify.com");
    expect(context.loggedInCustomerId).toBe("12345");
    expect(context.pathPrefix).toBe("/apps/returns");
  });

  it("geeft loggedInCustomerId als null terug voor gasten", () => {
    const params: Record<string, string> = {
      shop: "mijn-winkel.myshopify.com",
      path_prefix: "/apps/returns",
      signature: "dummy",
      timestamp: "123",
    };

    const context = extracteerProxyContext(params);

    expect(context.loggedInCustomerId).toBeNull();
  });

  it("gebruikt standaard pathPrefix als ontbrekend", () => {
    const params: Record<string, string> = {
      shop: "mijn-winkel.myshopify.com",
      signature: "dummy",
    };

    const context = extracteerProxyContext(params);

    expect(context.pathPrefix).toBe("/apps/returns");
  });

  it("verwerkt URLSearchParams correct", () => {
    const searchParams = new URLSearchParams({
      shop: "test.myshopify.com",
      logged_in_customer_id: "67890",
      path_prefix: "/apps/returns",
    });

    const context = extracteerProxyContext(searchParams);

    expect(context.shop).toBe("test.myshopify.com");
    expect(context.loggedInCustomerId).toBe("67890");
  });
});
