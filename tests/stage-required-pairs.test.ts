// 關卡的必要拍組 (0089, 2026-11-08 使用者:「可以在道館戰那邊設定關卡的必要拍組吧 跟隊伍庫放一起 …
// 然後排刀的時候可以切換顯示屬性拍組跟必要拍組」; 0090 同日:「必要拍組還是可以設定寶數 然後跟隊伍一樣
// 顯示誰綠燈誰黃燈這樣 紅燈可以拿掉了 上面的也是」)。
// 這幾條壞掉都沒有徵兆: 權限寬了沒人會發現、重抓漏了只是「別人加的要整頁重整才看得到」、
// 圖鑑子集漏了只是一張卡掉成灰字 id、順序沒存只是重新整理後兩張卡對調。

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  MAX_STAGE_REQUIRED_PAIRS,
  STAGE_REQUIRED_PAIR_COLS,
} from "@/app/gyms/[id]/battles/[battleId]/battle-plan-data";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const noComments = (s: string) => s.replace(/--.*$/gm, "");
const M89 = noComments(read("supabase/migrations/0089_stage_required_pairs.sql"));
const M90 = noComments(read("supabase/migrations/0090_stage_required_pairs_grade.sql"));
const M = `${M89}\n${M90}`;
const DIR = "src/app/gyms/[id]/battles/[battleId]";
const PAGE = read(`${DIR}/page.tsx`);
const CLIENT = read(`${DIR}/battle-client.tsx`);
const BOARD = read(`${DIR}/stage-board.tsx`);
const PLAN = read(`${DIR}/battle-plan.tsx`);
const SHEET = read("src/components/gym/team-sheet.tsx");

const policy = (sql: string, op: string) => {
  const m = sql.match(new RegExp(`create policy "stage_required_pairs_${op}"[\\s\\S]*?;`));
  return m?.[0] ?? null;
};

describe("必要拍組的權限: 跟挑戰隊伍 (stage_teams) 同一套", () => {
  it("讀 = 這一館的人 (含顧問); 加 / 改 / 刪 = 管理員", () => {
    expect(policy(M, "select")).toContain("is_gym_member(gym_id)");
    for (const op of ["insert", "update", "delete"]) {
      expect(policy(M, op), op).toContain("is_gym_admin(gym_id)");
      expect(policy(M, op), op).not.toContain("is_gym_editor");
    }
  });

  it("update 是 0090 才加的 (改寶數 / 順序), 0089 本身沒有", () => {
    expect(policy(M89, "update")).toBeNull();
    expect(policy(M90, "update")).not.toBeNull();
    expect(M90).toMatch(/grant update on public\.stage_required_pairs to authenticated/);
  });

  it("加的與改的時候關卡 / 賽事 / 道館三個 id 都要對得上 (不然掛得到別館的關卡)", () => {
    for (const op of ["insert", "update"]) {
      const p = policy(M, op)!;
      expect(p, op).toMatch(/s\.battle_id = stage_required_pairs\.battle_id/);
      expect(p, op).toMatch(/s\.gym_id = stage_required_pairs\.gym_id/);
    }
  });

  it("每一條 policy 都先 drop 再 create; 同一關同一組只有一列", () => {
    for (const m of M.matchAll(/create policy "([^"]+)"/g)) expect(M).toContain(`drop policy if exists "${m[1]}"`);
    expect(M).toMatch(/unique \(stage_id, pair_id\)/);
  });

  it("寶數跟隊伍同一條軸 (1-10); 已存在的列預設寶1 = 不替任何人提高門檻", () => {
    expect(M90).toMatch(/min_grade smallint not null default 1 check \(min_grade between 1 and 10\)/);
    expect(M90).toMatch(/sort_order smallint not null default 0/);
  });
});

describe("必要拍組的資料流", () => {
  it("page.tsx 撈它 (照編輯器的順序)、而且把它併進圖鑑子集 (名單外的那一張才畫得出來)", () => {
    expect(PAGE).toMatch(/from\("stage_required_pairs"\)\s*\.select\(STAGE_REQUIRED_PAIR_COLS\)[\s\S]{0,80}\.order\("sort_order"\)/);
    expect(PAGE).toMatch(/for \(const rp of requiredPairs \?\? \[\]\) neededPairIds\.add\(rp\.pair_id\)/);
  });

  it("看板操作後的重抓也抓它 (欄位與順序同一組), 不然別人加的要整頁重整才看得到", () => {
    expect(CLIENT).toMatch(/from\("stage_required_pairs"\)\s*\.select\(STAGE_REQUIRED_PAIR_COLS\)[\s\S]{0,80}\.order\("sort_order"\)/);
    expect(CLIENT).toMatch(/setRequiredPairs\(rp\)/);
  });

  it("查詢欄位就是畫面用到的三個 (含寶數)", () => {
    expect(STAGE_REQUIRED_PAIR_COLS.split(",").map((s) => s.trim()).sort()).toEqual([
      "min_grade",
      "pair_id",
      "stage_id",
    ]);
    expect(MAX_STAGE_REQUIRED_PAIRS).toBeGreaterThan(0);
  });

  it("存檔 = 整份 upsert (寶數 + 順序) + 刪掉不在清單裡的; 不要裸 insert", () => {
    expect(BOARD).toMatch(/from\("stage_required_pairs"\)\.upsert\([\s\S]*?min_grade: p\.minGrade,\s*sort_order: i/);
    expect(BOARD).toMatch(/onConflict: "stage_id,pair_id"/);
    expect(BOARD).toMatch(/del\.not\("pair_id", "in"/);
    expect(BOARD).not.toMatch(/from\("stage_required_pairs"\)\s*\.insert\(/);
  });

  it("upsert 失敗就不刪 (平行送的話: 加不進去、原本的反而被刪光)", () => {
    const body = BOARD.slice(BOARD.indexOf('from("stage_required_pairs").upsert('), BOARD.indexOf("let del = supabase"));
    expect(body).toMatch(/if \(error\) \{[\s\S]*?return;\s*\}/);
    expect(BOARD).not.toMatch(/Promise\.all\(jobs\)/);
  });

  it("連點寶數要合併 + 排隊 (跟隊伍庫同一套), 最後一趟才重抓", () => {
    expect(BOARD).toMatch(/useCoalescedWrite<\{ next: PickedPair\[\] \}>/);
    expect(BOARD).toMatch(/if \(queue\.current !== run\) return;/);
  });

  it("看板上的卡片也要能補抓整本 (needed ids 含必要拍組)", () => {
    expect(BOARD).toMatch(/requiredPairs\.map\(\(p\) => p\.pair_id\)/);
  });

  it("排在下面的面板等 click 才收 (mousedown 就收的話「完成」會跳走, 要按兩次)", () => {
    const PICKER = read("src/components/gym/pair-picker.tsx");
    expect(PICKER).toMatch(/floating \? \(\["mousedown", "touchstart"\] as const\) : \(\["click"\] as const\)/);
  });

  it("新加的拍組預設這一組的最高 (能超覺醒 = 超覺醒5, 不能 = 寶5); 隊伍庫照舊寶5", () => {
    const PICKER = read("src/components/gym/pair-picker.tsx");
    expect(PICKER).toMatch(/addAtMax && pairById\.get\(pairId\)\?\.hasAwakening === true \? 10 : 5/);
    expect(BOARD).toMatch(/<PairPicker[\s\S]*?addAtMax[\s\S]*?onChange=\{save\}/);
    expect(SHEET).not.toMatch(/addAtMax/);
  });

  it("展開的名單底部要留空間 (🍬 徽章往下凸 4px, 不留就被 overflow-hidden 切掉)", () => {
    expect(SHEET).toMatch(/<div className="overflow-hidden">[\s\S]*?<div className="space-y-1\.5 pb-1\.5 pt-1\.5">/);
  });

  it("編輯器就是隊伍庫那一個 (寶數下拉 + 搜尋面板), 不要另外刻一份", () => {
    expect(BOARD).toMatch(/<PairPicker[\s\S]*?inlinePanel[\s\S]*?growUpTo=\{MAX_STAGE_REQUIRED_PAIRS\}/);
    expect(BOARD).not.toMatch(/<PairSearchPanel/);
  });
});

describe("綠燈 / 黃燈: 隊伍與必要拍組同一支, 沒有紅燈", () => {
  it("隊伍的燈號只剩綠 / 黃 (「紅燈可以拿掉了 上面的也是」)", () => {
    const type = SHEET.match(/export type TeamFitGroups = \{[\s\S]*?\};/)?.[0] ?? "";
    expect(type).toContain("green");
    expect(type).toContain("yellow");
    expect(type).not.toMatch(/\bred\b/);
    expect(SHEET).not.toMatch(/key: "red"/);
  });

  it("隊伍與必要拍組都走 fitGroupsOf (判斷只有一份)", () => {
    expect(BOARD.match(/fitGroupsOf\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3); // 定義 + 隊伍 + 必要拍組
    expect(BOARD).toMatch(/if \(m\.role === "advisor"\) continue;/);
  });
});

describe("排刀側板: 必要拍組跟道館拍組合成一個分頁「必要/道館拍組」", () => {
  it("只有兩個分頁; 有設必要拍組的關第一個叫「必要/道館拍組」, 沒設的叫「道館拍組」", () => {
    expect(PLAN).toMatch(/\["gym", keyReq\.length > 0 \? "必要\/道館拍組" : "道館拍組"\]/);
    expect(PLAN).not.toMatch(/\["key", "必要拍組"\]/);
    expect(PLAN).toMatch(/useState<"gym" \| "all">\("gym"\)/);
  });

  it("必要那一排只在「必要/道館拍組」分頁 (所有屬性拍組那頁照舊一排)", () => {
    expect(PLAN).toMatch(/const keyPool = \(pairScope === "gym" \? keyReq : \[\]\)/);
  });

  it("必要那一排全部列出來 (沒有的反灰); 道館那一排只列有的、跟必要重複的不再列", () => {
    expect(PLAN).toMatch(/\.filter\(\(p\) => !keyIds\.has\(p\.pairId\)\)/);
    expect(PLAN).toMatch(/\.filter\(\(x\) => x\.grade > 0\)\s*\.sort\(\(a, b\) => b\.grade - a\.grade\)/);
    expect(PLAN).toMatch(/owned=\{grade > 0\}/);
  });

  it("排序也是先必要再道館: 綠燈 → 黃燈 → 必要有幾組 → 必要寶數 → 道館寶數", () => {
    expect(PLAN).toMatch(/tier: !hasAll \? 0 : key\.every\(\(x\) => x\.grade >= x\.need\) \? 2 : 1/);
    expect(PLAN).toMatch(
      /b\.tier - a\.tier \|\|\s*b\.count - a\.count \|\|\s*b\.keyScore - a\.keyScore \|\|\s*b\.restScore - a\.restScore/,
    );
    expect(PLAN).toMatch(/need && grade > 0 && grade < need/);
  });
});
