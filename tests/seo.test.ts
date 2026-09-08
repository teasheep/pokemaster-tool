// SEO 的兩條**安全性相關**的不變量, 加上一條會靜默壞掉的。
//
// 為什麼值得寫測試: 這些東西壞掉都不會有人發現 ——
// 沒有畫面、沒有錯誤、沒有紅字, 只有幾週後在 Google 上看到不該出現的東西。
//
// 紅了怎麼辦:
//   - 「/share/ 沒有被 Disallow」→ 分享連結的 token 是半秘密, 被收錄等於把成員的收藏
//     攤在搜尋結果上。把那一行加回去, 並確認 share 頁自己也還有 noindex。
//   - 「/api/ 沒有被 Disallow」→ `/api/export?key=` 的金鑰在 query string 裡。
//   - 「sitemap 出現需要登入的網址」→ 那些網址對爬蟲一律是 302 到 /login,
//     整份 sitemap 的可信度會被拉低, 而且什麼流量都換不到。

import { describe, expect, it } from "vitest";

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { NOINDEX, SITE_URL } from "@/lib/site";

/** 絕對不能被爬的 (內容外洩 / 金鑰在網址裡) */
const MUST_DISALLOW = ["/share/", "/api/"];

/** 需要登入或沒有內容的路徑 —— 不該出現在 sitemap */
const MUST_NOT_BE_IN_SITEMAP = [
  "/share",
  "/api",
  "/auth",
  "/login",
  "/register",
  "/welcome",
  "/gyms",
  "/connect",
  "/profile",
  "/resources",
  "/inventory",
  "/upload",
];

describe("robots.txt", () => {
  const rules = [robots().rules].flat();

  it("擋掉分享連結與帶金鑰的 API", () => {
    const disallow = rules.flatMap((r) => [r.disallow ?? []].flat());
    for (const path of MUST_DISALLOW) expect(disallow).toContain(path);
  });

  it("首頁與拍組圖鑑要放行 (全站只有這兩頁值得被收錄)", () => {
    const allow = rules.flatMap((r) => [r.allow ?? []].flat());
    expect(allow).toContain("/");
    const disallow = rules.flatMap((r) => [r.disallow ?? []].flat());
    expect(disallow).not.toContain("/pairs");
  });

  it("指向正式網域的 sitemap", () => {
    expect(robots().sitemap).toBe(`${SITE_URL}/sitemap.xml`);
  });
});

describe("sitemap.xml", () => {
  const urls = sitemap().map((e) => e.url);

  it("只列不需要登入、而且真的有內容的頁", () => {
    // 法遵頁 (privacy/terms) 也在裡面: Google OAuth 審核要求它們是公開、不需登入的網址,
    // 列進 sitemap 是刻意的宣告。要加別的頁進來之前先想清楚它是不是真的該被收錄。
    expect(urls).toEqual([
      `${SITE_URL}/`,
      `${SITE_URL}/pairs`,
      `${SITE_URL}/privacy`,
      `${SITE_URL}/terms`,
    ]);
  });

  it("**法遵頁一定要在公開路由裡** — 被登入牆擋住 Google OAuth 審核就過不了", async () => {
    const fs = await import("node:fs");
    const proxy = fs.readFileSync("src/lib/supabase/proxy.ts", "utf8");
    const list = proxy.slice(proxy.indexOf("PUBLIC_ROUTES"), proxy.indexOf("];", proxy.indexOf("PUBLIC_ROUTES")));
    for (const p of ["/privacy", "/terms"]) {
      expect(list, `${p} 不在 PUBLIC_ROUTES`).toContain(`"${p}"`);
    }
  });

  it("不含任何需要登入或半秘密的路徑", () => {
    for (const u of urls) {
      const path = new URL(u).pathname;
      for (const bad of MUST_NOT_BE_IN_SITEMAP) {
        expect(path === bad || path.startsWith(`${bad}/`)).toBe(false);
      }
    }
  });

  it("網址一律用正式網域 (metadataBase 用的是同一個常數)", () => {
    for (const u of urls) expect(u.startsWith(`${SITE_URL}/`)).toBe(true);
  });
});

describe("法遵頁的聯絡方式", () => {
  // 兩個管道是**分工不是備援**: 個人資料的事走 email (issue 是公開的),
  // 功能建議走 issue。兩頁都要同時有這兩個 ——
  // 壞掉沒有徵兆 (頁面照樣渲染, 只是「聯絡方式」變成一句沒有連結的空話),
  // 而 Google OAuth 審核看的正是這一段。
  it("兩頁都給得出可觸及的信箱 (刪除帳號的請求要走這裡)", async () => {
    const fs = await import("node:fs");
    for (const page of ["src/app/privacy/page.tsx", "src/app/terms/page.tsx"]) {
      const src = fs.readFileSync(page, "utf8");
      expect(src, `${page} 沒有 mailto:CONTACT_EMAIL`).toContain("mailto:${CONTACT_EMAIL}");
    }
  });

  it("兩頁都連到 GitHub issue (功能建議與問題回報)", async () => {
    const fs = await import("node:fs");
    for (const page of ["src/app/privacy/page.tsx", "src/app/terms/page.tsx"]) {
      const src = fs.readFileSync(page, "utf8");
      expect(src, `${page} 沒有連到 REPO_ISSUES_URL`).toContain("REPO_ISSUES_URL");
    }
  });

  it("頁尾也連得到原始碼與 issue (法遵頁指的就是這裡)", async () => {
    const fs = await import("node:fs");
    const footer = fs.readFileSync("src/components/site-footer.tsx", "utf8");
    expect(footer).toContain("REPO_URL");
    expect(footer).toContain("REPO_ISSUES_URL");
  });
});

describe("私密頁的 metadata", () => {
  it("NOINDEX 同時關掉索引與跟隨, 並清掉繼承來的 canonical", () => {
    expect(NOINDEX.robots.index).toBe(false);
    expect(NOINDEX.robots.follow).toBe(false);
    // 繼承 root layout 的 canonical="/" 會變成「我的正規網址是首頁」, 與 noindex 矛盾
    expect(NOINDEX.alternates.canonical).toBeNull();
  });
});
