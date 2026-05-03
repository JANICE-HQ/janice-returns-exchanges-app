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
      include: ["app/**/*.ts", "app/**/*.tsx", "db/**/*.ts"],
      exclude: [
        "app/routes/_dev.*",   // Dev-only routes tellen niet mee
        "app/entry.server.tsx",
        "**/*.test.*",
        "**/*.d.ts",
        "**/+types/**",
      ],
    },
  },
});
