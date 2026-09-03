import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site";

/**
 * `/sitemap.xml`。
 *
 * **只有兩頁**, 而且這是誠實的: 站上其餘的路由不是需要登入 (道館、個人設定),
 * 就是不該被收錄的中繼頁 (登入、onboarding) 或半秘密內容 (`/share/<token>`)。
 * 塞一堆會 302 或 404 給爬蟲的網址只會拉低整站的評價, 不會多換到流量。
 *
 * 沒有 `lastModified`: 這兩頁的內容跟著 catalog 走 (拍組上架就變),
 * 但精確到「哪一天」對兩個網址的 sitemap 沒有意義, 給錯反而是雜訊。
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${SITE_URL}/`,
      changeFrequency: "monthly",
      priority: 1,
    },
    {
      // 拍組圖鑑 —— 全站唯一「不登入也有實質內容」的頁 (664 組拍組)
      url: `${SITE_URL}/pairs`,
      changeFrequency: "weekly",
      priority: 0.8,
    },
  ];
}
