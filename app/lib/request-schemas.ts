/**
 * Zod-validatieschema's voor alle App Proxy eindpunten — JANICE Returns & Exchanges app
 *
 * Elk eindpunt valideert de aanvraagtekst via een Zod-schema.
 * Ongeldige invoer resulteert in HTTP 400 met een gestructureerde foutarray.
 */

import { z } from "zod";
import { ReasonCodeEnum, ResolutionEnum } from "~/services/reason-codes";

// ---------------------------------------------------------------------------
// Gedeelde sub-schema's
// ---------------------------------------------------------------------------

/** Line-item in een retourverzoek */
export const LineItemSchema = z.object({
  shopifyLineItemId: z
    .string()
    .min(1, "shopifyLineItemId is verplicht")
    .regex(
      /^gid:\/\/shopify\/LineItem\/\d+$/,
      "shopifyLineItemId moet een geldig Shopify GID zijn (gid://shopify/LineItem/...)",
    ),
  quantity: z
    .number()
    .int("quantity moet een geheel getal zijn")
    .positive("quantity moet groter dan 0 zijn"),
  reasonCode: ReasonCodeEnum,
  reasonSubnote: z.string().max(500, "reasonSubnote mag maximaal 500 tekens zijn").optional(),
});

export type LineItemInput = z.infer<typeof LineItemSchema>;

// ---------------------------------------------------------------------------
// POST /apps/returns/start
// ---------------------------------------------------------------------------

export const StartReturnSchema = z.object({
  shopifyOrderId: z
    .string()
    .min(1, "shopifyOrderId is verplicht")
    .regex(
      /^gid:\/\/shopify\/Order\/\d+$/,
      "shopifyOrderId moet een geldig Shopify GID zijn (gid://shopify/Order/...)",
    ),
  lineItems: z
    .array(LineItemSchema)
    .min(1, "Minimaal één line item is vereist"),
  idempotencyKey: z
    .string()
    .uuid("idempotencyKey moet een geldig UUID zijn"),
});

export type StartReturnInput = z.infer<typeof StartReturnSchema>;

// ---------------------------------------------------------------------------
// POST /apps/returns/guest-lookup
// ---------------------------------------------------------------------------

export const GuestLookupSchema = z.object({
  orderName: z
    .string()
    .min(1, "orderName is verplicht")
    .regex(
      /^#?\d+$/,
      "orderName moet een bestelnummer zijn, bijv. '#1042' of '1042'",
    ),
  email: z
    .string()
    .email("email moet een geldig e-mailadres zijn")
    .toLowerCase(),
  idempotencyKey: z
    .string()
    .uuid("idempotencyKey moet een geldig UUID zijn"),
});

export type GuestLookupInput = z.infer<typeof GuestLookupSchema>;

// ---------------------------------------------------------------------------
// POST /apps/returns/submit
// ---------------------------------------------------------------------------

export const SubmitReturnSchema = z
  .object({
    returnId: z.string().min(1).optional(),
    guestToken: z.string().min(1).optional(),
    lineItems: z
      .array(LineItemSchema)
      .min(1, "Minimaal één line item is vereist"),
    resolution: ResolutionEnum,
    exchangeForVariantId: z
      .string()
      .regex(
        /^gid:\/\/shopify\/ProductVariant\/\d+$/,
        "exchangeForVariantId moet een geldig Shopify GID zijn",
      )
      .optional(),
    idempotencyKey: z
      .string()
      .uuid("idempotencyKey moet een geldig UUID zijn"),
  })
  .refine(
    (data) => data.returnId != null || data.guestToken != null,
    "Ofwel returnId ofwel guestToken is verplicht",
  )
  .refine(
    (data) => !(data.returnId != null && data.guestToken != null),
    "Slechts één van returnId of guestToken mag opgegeven worden",
  )
  .refine(
    (data) =>
      data.resolution !== "exchange" || data.exchangeForVariantId != null,
    "exchangeForVariantId is verplicht bij resolution='exchange'",
  );

export type SubmitReturnInput = z.infer<typeof SubmitReturnSchema>;

// ---------------------------------------------------------------------------
// Validatie-hulpfunctie
// ---------------------------------------------------------------------------

export interface ValidationFout {
  pad: string;
  bericht: string;
}

/**
 * Parseer en valideer een aanvraagtekst met een Zod-schema.
 * Gooit een gestructureerde 400-fout als de validatie mislukt.
 */
export function parseValideer<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
):
  | { succes: true; data: T }
  | { succes: false; fouten: ValidationFout[] } {
  const resultaat = schema.safeParse(data);

  if (!resultaat.success) {
    const fouten: ValidationFout[] = resultaat.error.issues.map((issue) => ({
      pad: issue.path.join(".") || "root",
      bericht: issue.message,
    }));
    return { succes: false, fouten };
  }

  return { succes: true, data: resultaat.data };
}
