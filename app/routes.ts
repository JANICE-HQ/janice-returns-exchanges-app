import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  // Welkomstpagina (placeholder — wordt vervangen door retourportal UI)
  index("routes/home.tsx"),

  // Health check endpoint — GET /health
  route("health", "routes/health.ts"),

  // Sentry-testroute — alleen in development/staging beschikbaar
  // Beveiligd via loader-guard (blokkering in production)
  route("sentry-test", "routes/_dev.sentry-test.tsx"),
] satisfies RouteConfig;
