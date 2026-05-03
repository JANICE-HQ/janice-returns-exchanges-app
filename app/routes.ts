import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  // Welkomstpagina (placeholder)
  index("routes/home.tsx"),

  // Health check endpoint — GET /health
  route("health", "routes/health.ts"),

  // Sentry-testroute — alleen in development/staging beschikbaar
  route("sentry-test", "routes/_dev.sentry-test.tsx"),

  // ---------------------------------------------------------------------------
  // App Proxy API eindpunten — /apps/returns/* (JSON responses)
  // Alle routes vereisen geldige Shopify App Proxy HMAC-handtekening
  // ---------------------------------------------------------------------------

  // POST /apps/returns/start — Ingelogde klant start een retour (API)
  route("apps/returns/start", "routes/apps.returns.start.ts"),

  // POST /apps/returns/guest-lookup — Gast zoekt een bestelling op (API)
  route("apps/returns/guest-lookup", "routes/apps.returns.guest-lookup.ts"),

  // POST /apps/returns/submit — Klant dient een retour in (DRAFT → SUBMITTED) (API)
  route("apps/returns/submit", "routes/apps.returns.submit.ts"),

  // GET /apps/returns/:id/status — Ophalen van retorstatus (API)
  route("apps/returns/:id/status", "routes/apps.returns.$id.status.ts"),

  // ---------------------------------------------------------------------------
  // Klantgericht retourportal UI — /apps/returns/* (HTML responses)
  // Track A PR — 5-stap retourflow
  // ---------------------------------------------------------------------------

  // GET /apps/returns — Landingspagina (login of gast)
  route("apps/returns", "routes/apps.returns._index.tsx"),

  // GET /apps/returns/guest — Gast bestelling opzoeken
  route("apps/returns/guest", "routes/apps.returns.guest.tsx"),

  // GET /apps/returns/start/:orderId — Stap 1: Artikelen selecteren
  route("apps/returns/start/:orderId", "routes/apps.returns.start.$orderId.tsx"),

  // GET /apps/returns/reason/:returnId — Stap 2: Reden per artikel
  route("apps/returns/reason/:returnId", "routes/apps.returns.reason.$returnId.tsx"),

  // GET /apps/returns/resolution/:returnId — Stap 3: Afhandeling kiezen
  route("apps/returns/resolution/:returnId", "routes/apps.returns.resolution.$returnId.tsx"),

  // GET /apps/returns/method/:returnId — Stap 4: Verzendmethode
  route("apps/returns/method/:returnId", "routes/apps.returns.method.$returnId.tsx"),

  // GET /apps/returns/confirm/:returnId — Stap 5: Bevestigen
  route("apps/returns/confirm/:returnId", "routes/apps.returns.confirm.$returnId.tsx"),

  // GET /apps/returns/success/:returnId — Succesboodschap
  route("apps/returns/success/:returnId", "routes/apps.returns.success.$returnId.tsx"),

  // GET /apps/returns/status/:returnId — Publieke statuspagina
  route("apps/returns/status/:returnId", "routes/apps.returns.status.$returnId.tsx"),
] satisfies RouteConfig;
