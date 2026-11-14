import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Les montants sont des entiers en centimes : toute conversion par nombre
    // à virgule flottante est interdite dans le code de l'application.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "parseFloat", message: "Pas de nombre flottant : utilisez parseAmount (src/lib/money)." },
      ],
      "no-restricted-properties": [
        "error",
        { object: "Number", property: "parseFloat", message: "Pas de nombre flottant : utilisez parseAmount (src/lib/money)." },
        { property: "toFixed", message: "Pas d'arrondi flottant : utilisez formatMoney (src/lib/money)." },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
