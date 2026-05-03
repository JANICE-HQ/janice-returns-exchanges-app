/**
 * Tests voor return-state-machine.ts — JANICE Returns & Exchanges app
 *
 * Dekt:
 *  - Alle 11 states
 *  - Alle toegestane overgangen
 *  - Alle niet-toegestane overgangen
 *  - DB-transactie: state update + history insert
 *  - InvalidTransitionError en ReturnNotFoundError
 *  - canTransition() hulpfunctie
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  canTransition,
  transition,
  getStateHistory,
  InvalidTransitionError,
  ReturnNotFoundError,
  TOEGESTANE_OVERGANGEN,
  TERMINAL_STATES,
  StateEnum,
  type State,
  type Actor,
} from "./return-state-machine.js";

// ---------------------------------------------------------------------------
// DB mock via vi.hoisted — voorkomt hoisting-problemen met vi.mock
// ---------------------------------------------------------------------------

const {
  mockTxSelect,
  mockTxUpdate,
  mockTxInsert,
  mockTx,
  mockDb,
} = vi.hoisted(() => {
  const mockTxSelect = vi.fn();
  const mockTxUpdate = vi.fn();
  const mockTxInsert = vi.fn();

  const mockTx = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: mockTxSelect,
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: mockTxUpdate,
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: mockTxInsert,
    })),
  };

  const mockDb = {
    transaction: vi.fn((fn: (tx: typeof mockTx) => Promise<unknown>) =>
      fn(mockTx),
    ),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn().mockResolvedValue([]),
        })),
      })),
    })),
  };

  return { mockTxSelect, mockTxUpdate, mockTxInsert, mockTx, mockDb };
});

vi.mock("../../db/index.js", () => ({
  db: mockDb,
}));

vi.mock("../../db/schema.js", () => ({
  returns: { id: "id", state: "state", updatedAt: "updated_at" },
  returnStateHistory: {},
}));

// Sentry stub — geen echte Sentry-aanroepen in tests
vi.mock("@sentry/node", () => ({
  startSpan: vi.fn((_opts: unknown, fn: () => Promise<unknown>) => fn()),
  init: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function maakTestRetour(overschrijvingen: Partial<{
  id: string;
  shopifyOrderId: string;
  shopifyOrderName: string;
  customerEmail: string;
  state: string;
  customerId: string | null;
  resolution: string | null;
  totalRefundAmount: string | null;
  totalRefundCurrency: string;
  dhlLabelUrl: string | null;
  dhlTrackingNumber: string | null;
  returnMethod: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
}> = {}) {
  return {
    id: "retour_test_001",
    shopifyOrderId: "gid://shopify/Order/12345",
    shopifyOrderName: "#1042",
    customerEmail: "klant@janice.com",
    state: "DRAFT",
    customerId: null,
    resolution: null,
    totalRefundAmount: null,
    totalRefundCurrency: "EUR",
    dhlLabelUrl: null,
    dhlTrackingNumber: null,
    returnMethod: null,
    createdAt: new Date("2026-05-01"),
    updatedAt: new Date("2026-05-01"),
    expiresAt: null,
    ...overschrijvingen,
  };
}

const systeemActor: Actor = { type: "system" };
const klantActor: Actor = { type: "customer", id: "cust_123" };

// ---------------------------------------------------------------------------
// canTransition() — pure functie, geen mocks nodig
// ---------------------------------------------------------------------------

describe("canTransition()", () => {
  it("staat DRAFT → SUBMITTED toe", () => {
    expect(canTransition("DRAFT", "SUBMITTED")).toBe(true);
  });

  it("staat DRAFT → CANCELLED toe", () => {
    expect(canTransition("DRAFT", "CANCELLED")).toBe(true);
  });

  it("staat SUBMITTED → APPROVED toe", () => {
    expect(canTransition("SUBMITTED", "APPROVED")).toBe(true);
  });

  it("staat SUBMITTED → REJECTED toe", () => {
    expect(canTransition("SUBMITTED", "REJECTED")).toBe(true);
  });

  it("staat SUBMITTED → CANCELLED toe", () => {
    expect(canTransition("SUBMITTED", "CANCELLED")).toBe(true);
  });

  it("staat APPROVED → LABEL_ISSUED toe", () => {
    expect(canTransition("APPROVED", "LABEL_ISSUED")).toBe(true);
  });

  it("staat APPROVED → CANCELLED toe", () => {
    expect(canTransition("APPROVED", "CANCELLED")).toBe(true);
  });

  it("staat LABEL_ISSUED → IN_TRANSIT toe", () => {
    expect(canTransition("LABEL_ISSUED", "IN_TRANSIT")).toBe(true);
  });

  it("staat LABEL_ISSUED → EXPIRED toe", () => {
    expect(canTransition("LABEL_ISSUED", "EXPIRED")).toBe(true);
  });

  it("staat LABEL_ISSUED → CANCELLED toe", () => {
    expect(canTransition("LABEL_ISSUED", "CANCELLED")).toBe(true);
  });

  it("staat IN_TRANSIT → RECEIVED toe", () => {
    expect(canTransition("IN_TRANSIT", "RECEIVED")).toBe(true);
  });

  it("staat RECEIVED → INSPECTING toe", () => {
    expect(canTransition("RECEIVED", "INSPECTING")).toBe(true);
  });

  it("staat INSPECTING → COMPLETED toe", () => {
    expect(canTransition("INSPECTING", "COMPLETED")).toBe(true);
  });

  it("staat INSPECTING → REJECTED toe", () => {
    expect(canTransition("INSPECTING", "REJECTED")).toBe(true);
  });

  // Niet-toegestane overgangen
  it("weigert DRAFT → APPROVED (sla stap over)", () => {
    expect(canTransition("DRAFT", "APPROVED")).toBe(false);
  });

  it("weigert SUBMITTED → LABEL_ISSUED (sla stap over)", () => {
    expect(canTransition("SUBMITTED", "LABEL_ISSUED")).toBe(false);
  });

  it("weigert IN_TRANSIT → COMPLETED (sla stap over)", () => {
    expect(canTransition("IN_TRANSIT", "COMPLETED")).toBe(false);
  });

  it("weigert terug naar DRAFT vanuit elke state", () => {
    const states: State[] = ["SUBMITTED", "APPROVED", "COMPLETED", "CANCELLED"];
    for (const state of states) {
      expect(canTransition(state, "DRAFT")).toBe(false);
    }
  });

  it("weigert RECEIVED → COMPLETED (sla INSPECTING over)", () => {
    expect(canTransition("RECEIVED", "COMPLETED")).toBe(false);
  });

  // Terminal states
  it("weigert elke overgang vanuit COMPLETED", () => {
    const alleStates = StateEnum.options as State[];
    for (const to of alleStates) {
      expect(canTransition("COMPLETED", to)).toBe(false);
    }
  });

  it("weigert elke overgang vanuit REJECTED", () => {
    const alleStates = StateEnum.options as State[];
    for (const to of alleStates) {
      expect(canTransition("REJECTED", to)).toBe(false);
    }
  });

  it("weigert elke overgang vanuit CANCELLED", () => {
    const alleStates = StateEnum.options as State[];
    for (const to of alleStates) {
      expect(canTransition("CANCELLED", to)).toBe(false);
    }
  });

  it("weigert elke overgang vanuit EXPIRED", () => {
    const alleStates = StateEnum.options as State[];
    for (const to of alleStates) {
      expect(canTransition("EXPIRED", to)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// TERMINAL_STATES set
// ---------------------------------------------------------------------------

describe("TERMINAL_STATES", () => {
  it("bevat COMPLETED, REJECTED, CANCELLED, EXPIRED", () => {
    expect(TERMINAL_STATES.has("COMPLETED")).toBe(true);
    expect(TERMINAL_STATES.has("REJECTED")).toBe(true);
    expect(TERMINAL_STATES.has("CANCELLED")).toBe(true);
    expect(TERMINAL_STATES.has("EXPIRED")).toBe(true);
  });

  it("bevat geen actieve states", () => {
    expect(TERMINAL_STATES.has("DRAFT")).toBe(false);
    expect(TERMINAL_STATES.has("SUBMITTED")).toBe(false);
    expect(TERMINAL_STATES.has("INSPECTING")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TOEGESTANE_OVERGANGEN volledigheidscontrole
// ---------------------------------------------------------------------------

describe("TOEGESTANE_OVERGANGEN volledigheid", () => {
  it("definieert overgangen voor alle 11 states", () => {
    const alleStates = StateEnum.options as State[];
    for (const state of alleStates) {
      expect(TOEGESTANE_OVERGANGEN[state]).toBeDefined();
    }
  });

  it("terminal states hebben lege overgangsarray", () => {
    for (const terminalState of TERMINAL_STATES) {
      expect(TOEGESTANE_OVERGANGEN[terminalState]).toHaveLength(0);
    }
  });

  it("heeft precies 11 states gedefinieerd", () => {
    expect(Object.keys(TOEGESTANE_OVERGANGEN)).toHaveLength(11);
  });
});

// ---------------------------------------------------------------------------
// transition() — met DB-mocks
// ---------------------------------------------------------------------------

describe("transition()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset de db mock na clearAllMocks
    mockDb.transaction.mockImplementation(
      (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
    );
  });

  it("werkt state bij van DRAFT naar SUBMITTED", async () => {
    const huidigRetour = maakTestRetour({ state: "DRAFT" });
    const bijgewerktRetour = maakTestRetour({ state: "SUBMITTED" });

    mockTxSelect.mockResolvedValue([huidigRetour]);
    mockTxUpdate.mockResolvedValue([bijgewerktRetour]);
    mockTxInsert.mockResolvedValue([{ id: "hist_001" }]);

    const resultaat = await transition(
      "retour_test_001",
      "SUBMITTED",
      klantActor,
      "Klant heeft retour ingediend",
    );

    expect(resultaat.state).toBe("SUBMITTED");
    expect(mockTxUpdate).toHaveBeenCalled();
    expect(mockTxInsert).toHaveBeenCalled();
  });

  it("werkt state bij van SUBMITTED naar APPROVED via systeemactor", async () => {
    const huidigRetour = maakTestRetour({ state: "SUBMITTED" });
    const bijgewerktRetour = maakTestRetour({ state: "APPROVED" });

    mockTxSelect.mockResolvedValue([huidigRetour]);
    mockTxUpdate.mockResolvedValue([bijgewerktRetour]);
    mockTxInsert.mockResolvedValue([{}]);

    const resultaat = await transition(
      "retour_test_001",
      "APPROVED",
      systeemActor,
    );

    expect(resultaat.state).toBe("APPROVED");
  });

  it("voert DB-transactie atomair uit", async () => {
    const huidigRetour = maakTestRetour({ state: "APPROVED" });
    const bijgewerktRetour = maakTestRetour({ state: "LABEL_ISSUED" });

    mockTxSelect.mockResolvedValue([huidigRetour]);
    mockTxUpdate.mockResolvedValue([bijgewerktRetour]);
    mockTxInsert.mockResolvedValue([{}]);

    await transition("retour_test_001", "LABEL_ISSUED", systeemActor);

    // Transactie moet gebruikt zijn
    expect(mockDb.transaction).toHaveBeenCalledOnce();
  });

  it("gooit InvalidTransitionError bij ongeldige overgang", async () => {
    const huidigRetour = maakTestRetour({ state: "COMPLETED" });

    mockTxSelect.mockResolvedValue([huidigRetour]);

    await expect(
      transition("retour_test_001", "DRAFT", systeemActor),
    ).rejects.toThrow(InvalidTransitionError);
  });

  it("InvalidTransitionError bevat from en to state", async () => {
    const huidigRetour = maakTestRetour({ state: "IN_TRANSIT" });

    mockTxSelect.mockResolvedValue([huidigRetour]);

    try {
      await transition("retour_test_001", "COMPLETED", systeemActor);
      expect.fail("Zou een fout moeten gooien");
    } catch (fout) {
      expect(fout).toBeInstanceOf(InvalidTransitionError);
      const transitionFout = fout as InvalidTransitionError;
      expect(transitionFout.fromState).toBe("IN_TRANSIT");
      expect(transitionFout.toState).toBe("COMPLETED");
    }
  });

  it("gooit ReturnNotFoundError als retour niet bestaat", async () => {
    mockTxSelect.mockResolvedValue([]);

    await expect(
      transition("niet_bestaand_id", "SUBMITTED", klantActor),
    ).rejects.toThrow(ReturnNotFoundError);
  });

  it("ReturnNotFoundError bevat het retour-ID", async () => {
    mockTxSelect.mockResolvedValue([]);

    try {
      await transition("onbekend_123", "SUBMITTED", klantActor);
      expect.fail("Zou een fout moeten gooien");
    } catch (fout) {
      expect(fout).toBeInstanceOf(ReturnNotFoundError);
      const notFoundFout = fout as ReturnNotFoundError;
      expect(notFoundFout.returnId).toBe("onbekend_123");
    }
  });

  it("voegt history-rij in met juiste velden", async () => {
    const huidigRetour = maakTestRetour({ state: "RECEIVED" });
    const bijgewerktRetour = maakTestRetour({ state: "INSPECTING" });

    mockTxSelect.mockResolvedValue([huidigRetour]);
    mockTxUpdate.mockResolvedValue([bijgewerktRetour]);
    mockTxInsert.mockResolvedValue([{}]);

    await transition(
      "retour_test_001",
      "INSPECTING",
      { type: "ops_user", id: "medewerker_456" },
      "Artikel ontvangen in magazijn",
    );

    const insertAanroep = mockTxInsert.mock.calls[0]?.[0];
    expect(insertAanroep).toBeDefined();
    expect(insertAanroep?.fromState).toBe("RECEIVED");
    expect(insertAanroep?.toState).toBe("INSPECTING");
    expect(insertAanroep?.actorType).toBe("ops_user");
    expect(insertAanroep?.actorId).toBe("medewerker_456");
    expect(insertAanroep?.note).toBe("Artikel ontvangen in magazijn");
  });

  it("slaat metadata op in history-rij", async () => {
    const huidigRetour = maakTestRetour({ state: "LABEL_ISSUED" });
    const bijgewerktRetour = maakTestRetour({ state: "IN_TRANSIT" });

    mockTxSelect.mockResolvedValue([huidigRetour]);
    mockTxUpdate.mockResolvedValue([bijgewerktRetour]);
    mockTxInsert.mockResolvedValue([{}]);

    const metadata = { dhlEvent: "TRANSIT_START", timestamp: "2026-05-03T10:00:00Z" };

    await transition("retour_test_001", "IN_TRANSIT", systeemActor, undefined, metadata);

    const insertAanroep = mockTxInsert.mock.calls[0]?.[0];
    expect(insertAanroep?.metadata).toEqual(metadata);
  });

  it("gooit ZodError bij ongeldige actor type", async () => {
    const { ZodError } = await import("zod");

    await expect(
      transition(
        "retour_test_001",
        "SUBMITTED",
        { type: "onbekend_actor" } as unknown as Actor,
      ),
    ).rejects.toThrow(ZodError);
  });

  it("accepteert actor zonder id (systeem)", async () => {
    const huidigRetour = maakTestRetour({ state: "DRAFT" });
    const bijgewerktRetour = maakTestRetour({ state: "CANCELLED" });

    mockTxSelect.mockResolvedValue([huidigRetour]);
    mockTxUpdate.mockResolvedValue([bijgewerktRetour]);
    mockTxInsert.mockResolvedValue([{}]);

    // Mag niet gooien
    await expect(
      transition("retour_test_001", "CANCELLED", { type: "system" }),
    ).resolves.toBeDefined();
  });

  it("history-rij heeft actorId=null voor systeem zonder id", async () => {
    const huidigRetour = maakTestRetour({ state: "DRAFT" });
    const bijgewerktRetour = maakTestRetour({ state: "SUBMITTED" });

    mockTxSelect.mockResolvedValue([huidigRetour]);
    mockTxUpdate.mockResolvedValue([bijgewerktRetour]);
    mockTxInsert.mockResolvedValue([{}]);

    await transition("retour_test_001", "SUBMITTED", { type: "system" });

    const insertAanroep = mockTxInsert.mock.calls[0]?.[0];
    expect(insertAanroep?.actorId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getStateHistory()
// ---------------------------------------------------------------------------

describe("getStateHistory()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("geeft history terug gesorteerd op created_at", async () => {
    const historyRijen = [
      { id: "h1", returnId: "r1", fromState: null, toState: "DRAFT", actorType: "customer", createdAt: new Date("2026-05-01") },
      { id: "h2", returnId: "r1", fromState: "DRAFT", toState: "SUBMITTED", actorType: "customer", createdAt: new Date("2026-05-02") },
    ];

    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue(historyRijen),
        }),
      }),
    });

    const resultaat = await getStateHistory("r1");
    expect(resultaat).toHaveLength(2);
    expect(resultaat[0]?.toState).toBe("DRAFT");
    expect(resultaat[1]?.toState).toBe("SUBMITTED");
  });
});
