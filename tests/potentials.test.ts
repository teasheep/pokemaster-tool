// 潛能 (最多 5 個) + 備註 + 卡牆「顯示」多選下拉 (2026-09-29)。
//
// 這幾條壞掉都沒有徵兆 —— 名稱變成一串數字、道館側板改得動卻存不進去、
// 重整後「顯示」選單跳回預設 —— 所以用測試釘住。

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CARD_INFO_KEYS,
  DEFAULT_CARD_INFO,
  MAX_LUCKY_SKILLS,
  MAX_NOTES,
  cookieHeading,
  cookieIcon,
  parseCardInfo,
  serializeCardInfo,
  skillIcon,
  splitTier,
  type PotentialData,
} from "@/lib/pairs/potentials";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const data = JSON.parse(read("src/data/pair-potentials.json")) as PotentialData;
const catalogIds = new Set(
  (JSON.parse(read("src/data/pomatools-pairs.json")).records as { pairId: string }[]).map((r) => r.pairId)
);

describe("潛能資料 (src/data/pair-potentials.json)", () => {
  it("每一個有特殊潛能的拍組都對得到圖鑑 (對不到 = 那張卡的側板永遠沒有特殊潛能)", () => {
    const missing = Object.keys(data.pairs).filter((id) => !catalogIds.has(id));
    expect(missing, "主角拍組 18xxx 要對回 player-*, 見 scripts/fetch-potentials.mjs").toEqual([]);
    expect(Object.keys(data.pairs).length).toBeGreaterThan(400);
  });

  it("每一個潛能 id 都有繁中名稱 (沒有的話畫面上是一串數字)", () => {
    const used = new Set([...data.general.flatMap((g) => g.skills), ...Object.values(data.pairs).flatMap((l) => l.flatMap((c) => c.skills))]);
    for (const id of used) {
      expect(data.skills[id]?.[0], `潛能 ${id} 沒有名字`).toBeTruthy();
      expect(data.skills[id]![0]).not.toMatch(/^\d+$/);
    }
  });

  it("特殊潛能餅乾只有四種分類, 而且分組標題都不帶拍組名", () => {
    for (const list of Object.values(data.pairs)) {
      for (const c of list) {
        expect(["exclusive", "tower1", "tower2", "gym"]).toContain(c.kind);
        expect(c.skills.length).toBeGreaterThan(0);
        expect(cookieHeading(c)).toMatch(/^(專用|塔潛能餅乾|道館對戰)/);
      }
    }
  });

  it("一般潛能的同一效果會被排在同一列 (splitTier)", () => {
    expect(splitTier("沙暴時威力提升3")).toEqual(["沙暴時威力提升", "3"]);
    expect(splitTier("上場時攻擊提升G2")).toEqual(["上場時攻擊提升G", "2"]);
    expect(splitTier("必中化")).toEqual(["必中化", ""]);
  });

  it("一般潛能依五種餅乾分組, 一個潛能只在一組 (pomatools 的分法), 每組都有圖示", () => {
    expect(data.general.map((g) => g.key)).toEqual(["red", "blue", "yellow", "pink", "purple"]);
    const all = data.general.flatMap((g) => g.skills);
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBeGreaterThan(200);
    for (const k of [...data.general.map((g) => g.key), "exclusive", "tower1", "tower2", "gym"] as const) {
      const icon = cookieIcon(k);
      expect(fs.existsSync(path.join(process.cwd(), "public", icon)), `${icon} 不存在 (跑 npm run data:potentials)`).toBe(true);
    }
  });

  it("圖示以「這個拍組」為準: 在它的特殊潛能餅乾裡就用那種餅乾, 否則看一般餅乾的顏色", () => {
    // 18045902 (上場時攻擊提升2) 同時是 10026000000 的專用潛能與特別潛能餅乾的一般潛能
    expect(skillIcon(data, "10026000000", "18045902")).toBe(cookieIcon("exclusive"));
    // 特殊餅乾四種各自一張圖 (專用 ≠ 塔1: 使用者抓到專用餅乾是星星那張)
    const [first] = data.pairs["10000000000"]!;
    expect(skillIcon(data, "10000000000", first!.skills[0]!)).toBe(cookieIcon(first!.kind));
    expect(new Set(["exclusive", "tower1", "tower2", "gym"].map((k) => cookieIcon(k as "gym"))).size).toBe(4);
    expect(skillIcon(data, "10000000000", "18045902")).toBe(cookieIcon("purple"));
    expect(skillIcon(data, "10000000000", "13010203")).toBe(cookieIcon("red"));
  });

  it("**資料檔沒有在模組頂層被 import** (140KB, 只能走 loadPotentials 的 dynamic import)", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name) && /^import .*pair-potentials\.json/m.test(fs.readFileSync(p, "utf8")))
          offenders.push(p);
      }
    };
    walk(path.join(process.cwd(), "src"));
    expect(offenders).toEqual([]);
  });
});

describe("上限: 前端與資料庫是同一個數字 (0076)", () => {
  const sql = read("supabase/migrations/0076_pair_potentials_notes.sql");
  it("潛能最多 5 個", () => {
    expect(MAX_LUCKY_SKILLS).toBe(5);
    expect(sql).toMatch(/cardinality\(lucky_skills\) <= 5/);
    expect(sql).toMatch(/limit 5/);
  });
  it("備註最多 500 字", () => {
    expect(MAX_NOTES).toBe(500);
    expect(sql).toMatch(/char_length\(notes\) <= 500/);
    expect(sql).toMatch(/left\(btrim\(p_notes\), 500\)/);
  });
  it("set_member_pair 的新參數是 null = 不要動 (左下角寶數循環不帶它們)", () => {
    expect(sql).toMatch(/coalesce\(v_lucky, public\.member_pairs\.lucky_skills\)/);
    expect(sql).toMatch(/when v_notes is null then public\.member_pairs\.notes/);
    // 簽章換掉一定要先 drop 舊的並重收權限 (0040 / 0058 的前科)
    expect(sql).toMatch(/drop function if exists public\.set_member_pair\(uuid, text, text, int, int, int, int, int, boolean\)/);
    expect(sql).toMatch(/revoke all on function public\.set_member_pair\([^)]*text\[\], text\) from public, anon/);
  });
});

describe("道館側板: 潛能與備註要真的存得進去", () => {
  const client = read("src/app/gyms/[id]/members/members-client.tsx");
  it("側板 onChange 有這兩軸 (少一行 = 改得動卻存不進去, AGENTS 的前科)", () => {
    expect(client).toMatch(/luckySkills:\s*\n?\s*next\.luckySkills\.join/);
    expect(client).toMatch(/notes: \(next\.notes \?\? ""\) !== \(cur\.notes \?\? ""\)/);
  });
  it("RPC **只在真的改了才帶**新參數 (前端比 migration 早落地時, 寶數循環照樣能用)", () => {
    expect(client).toMatch(/job\.extra\.luckySkills !== undefined \? \{ p_lucky_skills/);
    expect(client).toMatch(/job\.extra\.notes !== undefined \? \{ p_notes/);
  });
  it("讀 member_pairs 用 select(\"*\") (明列一個還沒套上的欄位整頁就 400)", () => {
    expect(client).not.toMatch(/\.select\("id, pair_label, pair_id, grade/);
  });
});

describe("卡牆的「顯示」多選下拉", () => {
  it("預設 = 只有拍檔石盤 (選單出現之前的樣子), 而且預設不寫進網址", () => {
    expect([...DEFAULT_CARD_INFO]).toEqual(["grid"]);
    expect(serializeCardInfo(["grid"])).toBe(null);
    expect(parseCardInfo(undefined)).toEqual(["grid"]);
  });
  it("全關要寫成 none (否則會被當成「沒帶 = 預設」, 重整就跳回石盤)", () => {
    expect(serializeCardInfo([])).toBe("none");
    expect(parseCardInfo("none")).toEqual([]);
  });
  it("來回一致, 順序固定, 不認得的值丟掉", () => {
    expect(parseCardInfo(serializeCardInfo(["notes", "level"])!)).toEqual(["level", "notes"]);
    expect(parseCardInfo("potential,hack,grid")).toEqual(["grid", "potential"]);
    expect([...CARD_INFO_KEYS]).toEqual(["grid", "level", "potential", "notes"]);
  });
  it("等級畫在卡面右上角: 有傳 level 就畫, 不被 minimal 擋掉 (卡牆一律傳 minimal)", () => {
    const card = read("src/components/sync-pair-card.tsx");
    expect(card).toContain("{level != null && (");
    expect(card).not.toContain("!minimal && level != null");
    expect(read("src/components/gym/pair-type-grid.tsx")).toContain('level={show.includes("level")');
  });
  it("拍檔石盤在名稱下面自己一行, 不擠在名稱前面", () => {
    const grid = read("src/components/gym/pair-type-grid.tsx");
    const nameEnd = grid.indexOf("{item.pair ? pairName(item.pair) : (item.fallbackLabel");
    expect(nameEnd).toBeGreaterThan(0);
    expect(grid.indexOf("<SyncGridTag")).toBeGreaterThan(nameEnd);
  });
  it("潛能與備註全部列出來, 不截斷 (使用者:「都要開關顯示了, 就是要全部列出來」)", () => {
    const grid = read("src/components/gym/pair-type-grid.tsx");
    expect(grid).not.toMatch(/truncate|line-clamp-1/);
  });
  it("兩個頁面: client 寫 show, page.tsx 讀 show (對不起來 = 重整就跳回預設)", () => {
    for (const [client, page] of [
      ["src/app/pairs/pairs-hub.tsx", "src/app/pairs/page.tsx"],
      ["src/app/gyms/[id]/members/members-client.tsx", "src/app/gyms/[id]/members/page.tsx"],
    ] as const) {
      expect(read(client)).toMatch(/show: serializeCardInfo\(show\)/);
      expect(read(page)).toMatch(/searchParams[\s\S]{0,300}show\?:/);
      expect(read(page)).toMatch(/parseCardInfo\(/);
    }
  });
});
