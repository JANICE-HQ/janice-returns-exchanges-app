/**
 * State machine voor JANICE retourverzoeken — PR #2
 *
 * Implementeert 11 states en de toegestane overgangen conform PRD §6.1.
 * Elke transitie wordt atomair uitgevoerd in een DB-transactie:
 *  1. Valideer dat de transitie toegestaan is
 *  2. Update `returns.state` en `returns.updated_at`
 *  3. Insert een `return_state_history` rij
 *
 * Downstream events (Klaviyo, BullMQ) worden gestubbed — implementatie in PR #4.
 *
 * Alle bedragen in EUR, alle tijdstempels als timestamptz.
 */

import { eq } from "drizzle-orm";
import * as Sentry from "@sentry/node";
import { z } from "zod";
import { db } from "../../db/index.js";
import { returns, returnStateHistory } from "../../db/schema.js";
import type { Return } from "../../db/schema.js";

// ---------------------------------------------------------------------------
// State-definitie
// ---------------------------------------------------------------------------

export const StateEnum = z.enum([
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
  "LABEL_ISSUED",
  "IN_TRANSIT",
  "RECEIVED",
  "INSPECTING",
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
]);

export type State = z.infer<typeof StateEnum>;

/** Terminal states — geen verdere overgangen mogelijk */
export const TERMINAL_STATES: ReadonlySet<State> = new Set([
  "COMPLETED",
  "REJECTED",
  "CANCELLED",
  "EXPIRED",
]);

// ---------------------------------------------------------------------------
// Actor-definitie
// ---------------------------------------------------------------------------

export const ActorTypeEnum = z.enum(["customer", "system", "ops_user"]);

export type ActorType = z.infer<typeof ActorTypeEnum>;

export interface Actor {
  type: ActorType;
  /** Shopify customer_id of medewerker-ID (optioneel voor systeemacties) */
  id?: string;
}

// ---------------------------------------------------------------------------
// Toegestane overgangen — exhaustief gedefinieerd per PRD §6.1
// ---------------------------------------------------------------------------

export const TOEGESTANE_OVERGANGEN: Readonly<Record<State, ReadonlyArray<State>>> = {
  DRAFT: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["LABEL_ISSUED", "CANCELLED"],
  LABEL_ISSUED: ["IN_TRANSIT", "EXPIRED", "CANCELLED"],
  IN_TRANSIT: ["RECEIVED"],
  RECEIVED: ["INSPECTING"],
  INSPECTING: ["COMPLETED", "REJECTED"],
  // Terminal states: geen verdere overgangen
  COMPLETED: [],
  REJECTED: [],
  CANCELLED: [],
  EXPIRED: [],
};

// ---------------------------------------------------------------------------
// Foutklassen
// ---------------------------------------------------------------------------

/**
 * Gooit wanneer een state-overgang niet is toegestaan.
 * Inclusief zowel de huidige als de gewenste state voor debugbaarheid.
 */
export class InvalidTransitionError extends Error {
  public readonly fromState: State;
  public readonly toState: State;
  public readonly allowedTransitions: ReadonlyArray<State>;

  constructor(fromState: State, toState: State) {
    const toegestaan = TOEGESTANE_OVERGANGEN[fromState];
    super(
      `Ongeldige state-overgang: ${fromState} → ${toState}. ` +
        `Toegestane overgangen vanuit ${fromState}: [${toegestaan.join(", ") || "geen — terminal state"}]`,
    );
    this.name = "InvalidTransitionError";
    this.fromState = fromState;
    this.toState = toState;
    this.allowedTransitions = toegestaan;
  }
}

/**
 * Gooit wanneer het retourverzoek niet gevonden wordt.
 */
export class ReturnNotFoundError extends Error {
  public readonly returnId: string;

  constructor(returnId: string) {
    super(`Retourverzoek niet gevonden: ${returnId}`);
    this.name = "ReturnNotFoundError";
    this.returnId = returnId;
  }
}

// ---------------------------------------------------------------------------
// Validatie schemas (Zod)
// ---------------------------------------------------------------------------

const TransitionInputSchema = z.object({
  returnId: z.string().min(1, "returnId is verplicht"),
  to: StateEnum,
  actor: z.object({
    type: ActorTypeEnum,
    id: z.string().optional(),
  }),
  note: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type TransitionInput = z.infer<typeof TransitionInputSchema>;

// ---------------------------------------------------------------------------
// Publieke API
// ---------------------------------------------------------------------------

/**
 * Controleer of een transitie van `from` naar `to` is toegestaan.
 * Pure functie — geen side-effects, geen DB-aanroepen.
 *
 * @example
 * canTransition("DRAFT", "SUBMITTED")  // true
 * canTransition("COMPLETED", "DRAFT")  // false
 */
export function canTransition(from: State, to: State): boolean {
  return (TOEGESTANE_OVERGANGEN[from] as ReadonlyArray<State>).includes(to);
}

/**
 * Voer een state-transitie uit op een retourverzoek.
 *
 * Atomair via DB-transactie:
 *  1. Laad het huidige retourverzoek
 *  2. Valideer de transitie
 *  3. Update `returns.state` en `returns.updated_at`
 *  4. Insert een `return_state_history` rij
 *
 * @param returnId - ID van het retourverzoek
 * @param to       - Gewenste doelstate
 * @param actor    - Wie de transitie initieert
 * @param note     - Optionele toelichting
 * @param metadata - Optionele JSON-payload (bijv. carrier-event)
 * @returns Het bijgewerkte retourverzoek
 * @throws {InvalidTransitionError} Als de transitie niet is toegestaan
 * @throws {ReturnNotFoundError}    Als het retourverzoek niet bestaat
 * @throws {z.ZodError}             Als de invoer niet valide is
 */
export async function transition(
  returnId: string,
  to: State,
  actor: Actor,
  note?: string,
  metadata?: Record<string, unknown>,
): Promise<Return> {
  // Valideer invoer via Zod
  const invoer = TransitionInputSchema.parse({ returnId, to, actor, note, metadata });

  return Sentry.startSpan(
    {
      op: "return.state.transition",
      name: `state-overgang → ${invoer.to}`,
      attributes: {
        "return.id": invoer.returnId,
        "return.to_state": invoer.to,
        "actor.type": invoer.actor.type,
        "actor.id": invoer.actor.id ?? "system",
      },
    },
    async () => {
      return await db.transaction(async (tx) => {
        // 1. Laad huidig retourverzoek
        const [huidigRetour] = await tx
          .select()
          .from(returns)
          .where(eq(returns.id, invoer.returnId))
          .limit(1);

        if (!huidigRetour) {
          throw new ReturnNotFoundError(invoer.returnId);
        }

        const huidigeState = huidigRetour.state as State;

        // 2. Valideer overgang
        if (!canTransition(huidigeState, invoer.to)) {
          throw new InvalidTransitionError(huidigeState, invoer.to);
        }

        const nu = new Date();

        // 3. Update returns.state en updated_at
        const [bijgewerktRetour] = await tx
          .update(returns)
          .set({
            state: invoer.to,
            updatedAt: nu,
          })
          .where(eq(returns.id, invoer.returnId))
          .returning();

        if (!bijgewerktRetour) {
          throw new Error(
            `Kon retourverzoek ${invoer.returnId} niet bijwerken`,
          );
        }

        // 4. Insert history rij
        await tx.insert(returnStateHistory).values({
          id: generateId(),
          returnId: invoer.returnId,
          fromState: huidigeState,
          toState: invoer.to,
          actorType: invoer.actor.type,
          actorId: invoer.actor.id ?? null,
          note: invoer.note ?? null,
          metadata: invoer.metadata ?? null,
          createdAt: nu,
        });

        // 5. Emit downstream event (stub — PR #4 implementeert echte integraties)
        emitStateChangedEvent({
          returnId: invoer.returnId,
          fromState: huidigeState,
          toState: invoer.to,
          actor: invoer.actor,
          timestamp: nu,
        });

        return bijgewerktRetour;
      });
    },
  );
}

/**
 * Geeft de volledige state-history terug voor een retourverzoek,
 * gesorteerd van oud naar nieuw.
 */
export async function getStateHistory(returnId: string) {
  return db
    .select()
    .from(returnStateHistory)
    .where(eq(returnStateHistory.returnId, returnId))
    .orderBy(returnStateHistory.createdAt);
}

// ---------------------------------------------------------------------------
// Event-emissie (stub — PR #4 implementeert Klaviyo + BullMQ)
// ---------------------------------------------------------------------------

interface StateChangedEvent {
  returnId: string;
  fromState: State;
  toState: State;
  actor: Actor;
  timestamp: Date;
}

/**
 * Stub voor downstream event-emissie.
 * PR #4 vervangt dit met echte Klaviyo-triggers en BullMQ-jobs.
 */
function emitStateChangedEvent(event: StateChangedEvent): void {
  // TODO (PR #4): Klaviyo event triggeren op relevante state-overgangen
  // TODO (PR #4): BullMQ-job enqueueen voor zware verwerking (DHL-label genereren, etc.)
  void event; // Voorkom TypeScript 'unused variable' waarschuwing
}

// ---------------------------------------------------------------------------
// Hulpfuncties
// ---------------------------------------------------------------------------

/**
 * Genereer een uniek ID voor history-rijen.
 * Gebruikt crypto.randomUUID() als tijdelijke implementatie.
 * PR #3 kan cuid2 introduceren als gewenst.
 */
function generateId(): string {
  return crypto.randomUUID();
}
