// 訓練家立繪的取景必須一致 —— 這條沒有任何徵兆, 只是某幾張卡上的人「比較小」。
//
// 2026-09-08 使用者回報:「伊芙（寶可夢小朋友）& 伊布」「所有包含主角的拍組」
// 「華蓮（長袖和服少女）這隻還有其他長袖也是」—— 人物的位置跟其他拍組有落差。
//
// 原因: 卡片把整張立繪塞進固定的 144×144 再裁切 (components/sync-pair-card.tsx),
// 所以「人物在畫布裡多大、在哪」完全由圖決定。brybry 原生縮圖是**頭肩胸像**
// (臉大、頭頂貼上緣、肩胸被下緣裁掉); 但通用職業 NPC 與主角給的是**全身圖**,
// 縮進同一個框就變成「小人漂浮」。
//
// **判準 = 下緣有沒有留白**: 胸像的肩胸一定被下框裁掉 (mB = 0); 全身圖整個人在框內。
// 這比量頭的大小可靠得多 —— 頭寬會被誇張髮型騙 (華蓮的雙馬尾量出來比原生基準還「大」)。
//
// 修法見 scripts/fetch-wiki-trainer-images.mjs (從 wiki 1024×1024 原圖重裁, 逐張定 band)。

import fs from "node:fs";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

const DIR = path.join(process.cwd(), "public/reference/trainer");

/** 不透明內容碰不碰得到四邊 (alpha > 64 — 門檻太低會把半透明光暈算成內容) */
async function margins(file: string) {
  const { data, info } = await sharp(path.join(DIR, file))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  let minY = H,
    maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // 這一列只要有一個不透明的像素就算有內容, 不用掃完整列
      if (data[(y * W + x) * C + 3]! > 64) {
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        break;
      }
    }
  }
  return { W, H, top: minY / H, bottom: (H - 1 - maxY) / H };
}

const files = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((f) => f.endsWith("_128.webp"))
  : [];

describe("取景工具頁只能存在於本機", () => {
  // 它 import sharp (原生模組) 而且會寫檔 —— 一旦跟著上線, Workers 載不動會整條路由炸掉,
  // 而「寫檔」本身在線上也毫無意義。做法與截圖辨識同一套: `.node.*` 副檔名讓
  // cloudflare build 的 pageExtensions 根本不把它當路由 (見 next.config.ts 檔頭)。
  it("page 與 API 都是 .node.* 副檔名", () => {
    for (const f of [
      "src/app/dev/trainer-art/page.node.tsx",
      "src/app/api/dev/trainer-art/route.node.ts",
    ]) {
      expect(fs.existsSync(path.join(process.cwd(), f)), `${f} 不見了`).toBe(true);
    }
    // 同名但沒有 .node 的版本會被線上建置當成路由 —— 絕對不可以存在
    for (const f of [
      "src/app/dev/trainer-art/page.tsx",
      "src/app/api/dev/trainer-art/route.ts",
    ]) {
      expect(fs.existsSync(path.join(process.cwd(), f)), `${f} 會被線上建置收進去`).toBe(false);
    }
  });

  it("兩支都有 production 的保險絲 (萬一哪天被建出來也要 404)", () => {
    for (const f of [
      "src/app/dev/trainer-art/page.node.tsx",
      "src/app/api/dev/trainer-art/route.node.ts",
    ]) {
      expect(fs.readFileSync(path.join(process.cwd(), f), "utf8"), `${f} 少了保險絲`).toContain(
        'process.env.NODE_ENV === "production"'
      );
    }
  });

  it("站上的元件不可以傳 trainerImgSrc (那個 prop 只給工具頁)", () => {
    const dir = path.join(process.cwd(), "src");
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(e.name) && !full.includes("trainer-art") && !e.name.startsWith("sync-pair-card")) {
          if (fs.readFileSync(full, "utf8").includes("trainerImgSrc")) offenders.push(full);
        }
      }
    };
    walk(dir);
    expect(offenders, "立繪路徑的單一來源是 trainerId").toEqual([]);
  });
});

describe("訓練家立繪的取景", () => {
  it("掃得到圖 (掃不到代表這個測試自己壞了)", () => {
    expect(files.length).toBeGreaterThan(400);
  });

  it("**畫布一律 128×128** — 尺寸不同的那幾張是沒經過取景處理的原始素材", async () => {
    const odd: string[] = [];
    for (const f of files) {
      const m = await sharp(path.join(DIR, f)).metadata();
      if (m.width !== 128 || m.height !== 128) odd.push(`${f} = ${m.width}x${m.height}`);
    }
    expect(odd, `這幾張要走 scripts/fetch-wiki-trainer-images.mjs 重裁:\n${odd.join("\n")}`).toEqual(
      []
    );
  }, 120_000);

  it("**人物的肩胸要被下框裁掉** — 下緣留白 = 全身圖被縮成小人漂浮", async () => {
    const floating: string[] = [];
    for (const f of files) {
      const m = await margins(f);
      // 留 1px 的寬容 (轉 WebP 的邊緣羽化)
      if (m.bottom > 1 / m.H) floating.push(`${f} 下緣留白 ${(m.bottom * 100).toFixed(1)}%`);
    }
    expect(
      floating,
      `這幾張是全身圖, 要加進 scripts/fetch-wiki-trainer-images.mjs 的 TARGETS:\n${floating.join("\n")}`
    ).toEqual([]);
  }, 120_000);
});
