import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site";

/**
 * `/robots.txt`。
 *
 * **這個站真正想被搜到的只有兩頁**: 首頁與 `/pairs` 拍組圖鑑。其餘不是需要登入,
 * 就是「有網址就看得到」的私密內容, 一律擋掉。
 *
 * robots 與 `noindex` 的分工 (兩個機制擋的東西不一樣, 不要以為擇一就好):
 *   - **`Disallow` = 不要來抓**。抓都沒抓, 內容就不會進索引; 但**網址本身**若從別處被連到,
 *     仍可能以「只有網址」的形式出現在搜尋結果。
 *   - **`noindex` = 抓了但不要收錄**。要生效的前提是**允許被抓** (被 Disallow 擋住就看不到那個標頭)。
 * 所以理論上兩個一起下會互相抵銷。這裡仍然兩個都下, 是刻意的取捨:
 * `/share/<token>` 的 token 是半秘密, **內容絕對不能進索引**比「網址可能露出」嚴重得多,
 * 而那些網址只在 LINE 群裡流傳、不會出現在公開網頁上, 被爬蟲發現的機會幾乎是零。
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          // 半秘密的分享連結 —— token 進了索引等於把別人的收藏攤在搜尋結果上
          "/share/",
          // 金鑰放在 query string 的唯讀匯出
          "/api/",
          // 登入流程的中繼點, 沒有內容
          "/auth/",
          "/login",
          "/register",
          "/welcome",
          // 需要登入的頁 (擋不擋都進不去, 但不要浪費爬取額度)
          "/gyms/",
          "/connect",
          "/profile",
          "/resources",
          "/inventory",
          "/upload",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
