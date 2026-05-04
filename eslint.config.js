/**
 * ESLint v9 flat config — JANICE Returns & Exchanges app
 *
 * Flat config is de standaard vanaf ESLint 9.
 * TypeScript-eslint v8 gebruikt de nieuwe flat-config API natively.
 */

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import globals from "globals";

export default [
  // Aanbevolen JavaScript-regels
  js.configs.recommended,

  // Aanbevolen TypeScript-regels
  ...tseslint.configs.recommended,

  // Projectspecifieke instellingen voor TS/TSX-bestanden
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      react,
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
    },
    rules: {
      // React-regels
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off", // React Router 7 vereist geen import React
      "react/prop-types": "off", // TypeScript-types vervangen PropTypes

      // JSX-toegankelijkheidsregels
      ...jsxA11y.configs.recommended.rules,

      // TypeScript-specifieke regels
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
    settings: {
      react: { version: "detect" },
    },
  },

  // Versoepelde regels voor testbestanden
  // Reden: testpatronen wijken bewust af van productieconventies:
  //  - require() in vitest-tests is een geldig patroon voor dynamische imports in test-scope
  //  - Geïmporteerde maar niet rechtstreeks gebruikte identifiers (vi, mock-klassen) zijn
  //    nodig voor vitest module-mocking side-effects
  //  - TypeScript-type-only exports in schema.test.ts dienen als compile-time checks
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },

  // Uitgesloten mappen — gegenereerde bestanden en node_modules
  {
    ignores: [
      "build/",
      "dist/",
      "public/build/",
      ".react-router/",
      "node_modules/",
    ],
  },
];
