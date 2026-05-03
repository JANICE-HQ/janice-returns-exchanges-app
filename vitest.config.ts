/**
 * Vitest configuratie — JANICE Returns & Exchanges app
 *
 * Ondersteunt:
 * - TypeScript via esbuild (ingebouwd in Vitest)
 * - Path aliases (~/) via tsconfig.json
 * - Server-side (Node.js) testomgeving
 * - Coverage-rapportage via @vitest/coverage-v8
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Resolutie van path aliases (~/...) conform tsconfig.json
    // Vite heeft ingebouwde tsconfig-pad-resolutie — geen plugin nodig
    tsconfigPaths: true,
  },
  test: {
    // Node-omgeving voor server-side tests (loaders, actions, services)
    environment: "node",

    // Testbestanden inclusief patronen
    include: [
      "app/**/*.test.ts",
      "app/**/*.test.tsx",
      "db/**/*.test.ts",
    ],

    // Exclude build-artifacts en node_modules
    exclude: [
      "**/node_modules/**",
      "**/build/**",
      "**/.react-router/**",
    ],

    // Globale test-helpers (describe, it, expect) — geen import nodig
    globals: true,

    // Coverage-configuratie
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage",
      // Minimale coverage-drempel: 80% per de projectvereisten
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
      // Bestanden die meegerekend worden in coverage
      // PR #3: App Proxy eindpunten, middleware en helpers worden gemeten.
      // PR #2-bestanden (services/*) zijn al gedekt in eerdere PR.
      include: [
        "app/services/**/*.ts",
        "app/lib/app-proxy-hmac.server.ts",
        "app/lib/idempotency.server.ts",
        "app/lib/guest-jwt.server.ts",
        "app/lib/rate-limiter.server.ts",
        "app/lib/request-schemas.ts",
        "app/lib/shopify-queries.server.ts",
        "app/lib/structured-logger.server.ts",
        "app/routes/apps.returns.start.ts",
        "app/routes/apps.returns.guest-lookup.ts",
        "app/routes/apps.returns.submit.ts",
        "app/routes/apps.returns.$id.status.ts",
        "db/schema.ts",
      ],
      exclude: [
        "**/*.test.*",
        "**/*.d.ts",
        "**/+types/**",
        "app/lib/__tests__/**",
        "app/routes/__tests__/**",
      ],
    },
  },
});
