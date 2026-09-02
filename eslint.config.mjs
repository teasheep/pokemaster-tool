import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored 3rd-party JS (pomatools deobfuscated bundle, opencv WASM glue)
    "assets/**",
    "public/opencv/**",
    // One-off dev/diag scripts — kept for reproducibility, not subject to project lint
    "scripts/dev/**",
    // supabase CLI 本地 stack 的產生檔 (不是專案原始碼)
    "supabase/.temp/**",
    "supabase/.branches/**",
    // OpenNext/wrangler 的建置產物 (跟 .next 同性質, 不是專案原始碼)
    ".open-next/**",
    ".wrangler/**",
  ]),
]);

export default eslintConfig;
