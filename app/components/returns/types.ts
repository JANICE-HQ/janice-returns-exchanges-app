/**
 * Gedeelde TypeScript-types voor de JANICE Returns Portal componenten
 */

export type ReasonCode =
  | "TOO_BIG"
  | "TOO_SMALL"
  | "COLOR_DIFFERENT"
  | "DAMAGED"
  | "LATE_DELIVERY"
  | "WRONG_ITEM"
  | "NOT_AS_DESCRIBED"
  | "CHANGED_MIND";

export type Resolution = "refund" | "exchange" | "store_credit";

export type ReturnMethod = "qr" | "label";

export type ReturnState =
  | "DRAFT"
  | "SUBMITTED"
  | "APPROVED"
  | "REJECTED"
  | "LABEL_ISSUED"
  | "IN_TRANSIT"
  | "RECEIVED"
  | "INSPECTING"
  | "COMPLETED"
  | "CANCELLED"
  | "EXPIRED";

export interface LineItem {
  id: string;
  productTitle: string;
  variantTitle: string | null;
  quantity: number;
  unitPrice: string;
  imageUrl?: string | null;
  sku?: string | null;
  isEligible?: boolean;
  eligibilityBlockerKey?: string | null;
}

export interface SelectedLineItem {
  shopifyLineItemId: string;
  quantity: number;
  reasonCode: ReasonCode;
  reasonSubnote?: string;
}

export interface ReturnItem {
  id: string;
  shopifyLineItemId: string;
  productTitle: string;
  variantTitle: string | null;
  quantity: number;
  unitPrice: string;
  reasonCode: ReasonCode;
  reasonSubnote?: string | null;
}

export interface StateHistoryEntry {
  fromState: ReturnState | null;
  toState: ReturnState;
  actorType: "customer" | "system" | "ops_user";
  createdAt: string;
  note?: string | null;
}

export interface ReturnDetail {
  id: string;
  state: ReturnState;
  resolution: Resolution | null;
  totalRefundAmount: string | null;
  totalRefundCurrency: string;
  items: ReturnItem[];
  history: StateHistoryEntry[];
  dhlLabelUrl: string | null;
  dhlTrackingNumber: string | null;
  expiresAt: string | null;
}

export interface OrderInfo {
  id: string;
  name: string;
  createdAt: string;
  totalPrice: string;
  currency: string;
}

/** Formatteert een bedrag conform JANICE brand rules: "249,95 EUR" */
export function formatPrice(amount: string | number, currency = "EUR"): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  const formatted = num.toFixed(2).replace(".", ",");
  return `${formatted} ${currency}`;
}
