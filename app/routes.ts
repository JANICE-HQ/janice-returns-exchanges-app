import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  // Welkomstpagina (placeholder — wordt vervangen door retourportal UI)
  index("routes/home.tsx"),

  // Health check endpoint — GET /health
  route("health", "routes/health.ts"),

  // Sentry-testroute — alleen in development/staging beschikbaar
  // Beveiligd via loader-guard (blokkering in production)
  route("sentry-test", "routes/_dev.sentry-test.tsx"),

  // ---------------------------------------------------------------------------
  // App Proxy eindpunten — /apps/returns/*
  // Alle routes vereisen geldige Shopify App Proxy HMAC-handtekening
  // ---------------------------------------------------------------------------

  // POST /apps/returns/start — Ingelogde klant start een retour
  route("apps/returns/start", "routes/apps.returns.start.ts"),

  // POST /apps/returns/guest-lookup — Gast zoekt een bestelling op
  route("apps/returns/guest-lookup", "routes/apps.returns.guest-lookup.ts"),

  // POST /apps/returns/submit — Klant dient een retour in (DRAFT → SUBMITTED)
  route("apps/returns/submit", "routes/apps.returns.submit.ts"),

  // GET /apps/returns/:id/status — Ophalen van retorstatus
  route("apps/returns/:id/status", "routes/apps.returns.$id.status.ts"),
] satisfies RouteConfig;
