#!/usr/bin/env node
/**
 * 部署到 Cloudflare Workers (一鍵):
 *   node scripts/deploy-cloudflare.mjs           # build + deploy
 *   node scripts/deploy-cloudflare.mjs --preview # build + 本地 workerd 預覽
 *
 * 重點: 以 DEPLOY_TARGET=cloudflare 建置 → next.config 的 pageExtensions 會把
 * 辨識功能 (page.node.tsx / route.node.ts) 從路由中排除, Workers 不會碰到原生模組;
 * 同時強制關閉 NEXT_PUBLIC_ENABLE_RECOGNITION, 蓋掉 .env.local 的本機設定。
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const preview = process.argv.includes("--preview");

const env = {
  ...process.env,
  DEPLOY_TARGET: "cloudflare",
  NEXT_PUBLIC_ENABLE_RECOGNITION: "", // 蓋掉 .env.local 的 =1 (shell env 優先權最高)
};

// 認證: 優先用環境變數; 否則讀 .cloudflare-token (gitignored, 自己用記事本存,
// 內容就是 dash.cloudflare.com → My Profile → API Tokens 建的 token 一行)
const tokenFile = join(repoRoot, ".cloudflare-token");
if (!env.CLOUDFLARE_API_TOKEN && existsSync(tokenFile)) {
  env.CLOUDFLARE_API_TOKEN = readFileSync(tokenFile, "utf-8").trim();
}
const accountFile = join(repoRoot, ".cloudflare-account-id");
if (!env.CLOUDFLARE_ACCOUNT_ID && existsSync(accountFile)) {
  env.CLOUDFLARE_ACCOUNT_ID = readFileSync(accountFile, "utf-8").trim();
}

function run(cmd, args) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", env, shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run("npx", ["opennextjs-cloudflare", "build"]);
run("npx", ["opennextjs-cloudflare", preview ? "preview" : "deploy"]);
