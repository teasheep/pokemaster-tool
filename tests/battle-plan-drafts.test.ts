// 排刀表的分頁 (0087 試排 → 0088 全館看得到)。
// 0087 (2026-11-07 使用者:「不要可以套用成正式 自己才看的到 可以儲存下載圖片就好」);
// 0088 (同日:「改成所有人都可以加排刀表 … 分頁1 分頁2...的長相 然後標註是誰 在什麼時候加的就好 也可以自己命名」)。
// 這幾條壞掉都沒有徵兆: 別人改得到你的分頁、或分頁改到正式那張, 畫面上看起來都只是「排刀表變了」。

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  PLAN_DEFAULT_FIELDS,
  PLAN_DRAFT_COLS,
  blankPlanDoc,
  normalizePlanDoc,
} from "@/app/gyms/[id]/battles/[battleId]/battle-plan-data";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const stripSqlComments = (s: string) => s.replace(/--.*$/gm, "");
const M87 = stripSqlComments(read("supabase/migrations/0087_battle_plan_drafts.sql"));
const M88 = stripSqlComments(read("supabase/migrations/0088_battle_plan_tabs_shared.sql"));
const UI = read("src/app/gyms/[id]/battles/[battleId]/battle-plan.tsx");
const PAGE = read("src/app/gyms/[id]/battles/[battleId]/page.tsx");

/** 同一個名字的 policy 以「最後一次 create」為準 (0088 蓋掉 0087 的 select / delete) */
const policy = (op: string) => {
  const all = [...`${M87}\n${M88}`.matchAll(new RegExp(`create policy "battle_plan_drafts_${op}"[\\s\\S]*?;`, "g"))];
  expect(all.length, op).toBeGreaterThan(0);
  return all.at(-1)![0];
};

describe("分頁的權限: 全館看得到, 只有建立的人改得動", () => {
  it("讀: 這一館的人都讀得到 (is_gym_member, 含顧問; 不再限定本人)", () => {
    const sel = policy("select");
    expect(sel).toContain("is_gym_member(gym_id)");
    expect(sel).not.toContain("user_id");
  });

  it("新增 / 修改: 照舊只有本人, 而且要是正式成員 (管理員也改不到別人的)", () => {
    for (const op of ["insert", "update"]) {
      const p = policy(op);
      expect(p, op).toContain("user_id = auth.uid()");
      expect(p, op).toContain("is_gym_editor(gym_id)");
      expect(p, op).not.toContain("is_gym_member");
      expect(p, op).not.toContain("is_gym_admin");
    }
    // update 的 using 與 with check 兩邊都要擋 (不然能把自己的列改成別人的 user_id)
    expect(policy("update").match(/user_id = auth\.uid\(\)/g)!.length).toBe(2);
  });

  it("刪除: 建立的人, 或管理員 (人離開之後他的分頁要收得掉)", () => {
    const del = policy("delete");
    expect(del).toContain("user_id = auth.uid()");
    expect(del).toContain("is_gym_editor(gym_id)");
    expect(del).toContain("is_gym_admin(gym_id)");
  });

  it("0088 改的每一條都先 drop 再 create (permissive policy 是 OR 起來的, 名字打錯 = 舊的寬鬆那條還在)", () => {
    const created = [...M88.matchAll(/create policy "([^"]+)"/g)].map((m) => m[1]);
    expect(created.length).toBeGreaterThan(0);
    for (const name of created) expect(M88).toContain(`drop policy if exists "${name}"`);
  });

  it("畫面: 分頁只有建立的人改得動; 刪除是建立的人或管理員", () => {
    expect(UI).toMatch(/const editable = active \? canEdit && active\.user_id === myUserId : canEdit/);
    // 改分頁的唯一入口要再擋一次 (畫面上沒有可按的東西不代表沒有人叫得到它)
    expect(UI).toMatch(/const cur = active && editable && draftsRef\.current/);
    expect(UI).toMatch(/const canDeleteDraft = !!active && \(\(mine && canEdit\) \|\| isAdmin\)/);
  });

  it("＋ 分頁 = 預設的長相: 不看正在看的那張 (「不要 我要新開的就是預設的長相」)", () => {
    expect(UI).toMatch(/plan: blankPlanDoc\(\) \}/);
    // 多加的欄位、改過的欄位名、格子、敘述都不可以帶過去
    expect(UI).not.toMatch(/structuredClone\(plan\)/);
    expect(UI).not.toMatch(/plan\.rows\.map\(\(r\) => \(\{ id: r\.id, label: r\.label/);
    const doc = blankPlanDoc();
    expect(doc.rows.map((r) => [r.label, r.wide])).toEqual([
      ["物攻", false],
      ["特攻", false],
      ["降抗", true],
    ]);
    expect(doc.note).toBe("");
    expect(doc.rows.every((r) => Object.keys(r.cells).length === 0)).toBe(true);
    // 存進資料庫再讀回來 (normalizePlanDoc) 要一模一樣, 而且每一列都有自己的 id
    expect(normalizePlanDoc(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    expect(new Set(doc.rows.map((r) => r.id)).size).toBe(doc.rows.length);
  });

  it("預設欄位 = 0083 新賽事帶的那三個 (兩邊走鐘的話, 分頁跟正式那張的預設就不一樣了)", () => {
    const file = fs.readdirSync("supabase/migrations").find((f) => f.startsWith("0083_"))!;
    const sql = stripSqlComments(read(`supabase/migrations/${file}`));
    PLAN_DEFAULT_FIELDS.forEach((f, i) => {
      expect(sql).toContain(`'${f.label}', ${f.wide}, ${i + 1})`);
    });
  });

  it("要標得出是誰加的: 查詢欄位帶 user_id, page.tsx 傳 user_id → 成員的對照", () => {
    expect(PLAN_DRAFT_COLS.split(",").map((s) => s.trim())).toContain("user_id");
    expect(PAGE).toMatch(/memberIdByUser:/);
  });
});

describe("分頁不碰正式那張", () => {
  it("沒有「套用成正式」: migration 不碰正式那三張表, 畫面也沒有套用那顆鈕", () => {
    for (const M of [M87, M88])
      for (const t of ["battle_plan_fields", "battle_plan_slots", "battle_plans "]) expect(M).not.toContain(t);
    // 註解裡引用了使用者那句「不要可以套用成正式」, 只看程式本身
    expect(UI.replace(/\/\/.*$/gm, "")).not.toMatch(/套用/);
  });

  it("刪除照樣進封存 (有 gym_id 的道館資料表都要)", () => {
    expect(M87).toMatch(/array\['battle_plan_drafts'\]/);
    expect(M87).toContain("archive_deleted_rows()");
  });

  it("page.tsx 讀 ?draft= 並從 battle-plan-data 拿欄位字串 (不可以從 use client 的檔案拿)", () => {
    expect(PAGE).toMatch(/draft\?: string/);
    expect(PAGE).toMatch(/from\("battle_plan_drafts"\)\s*\.select\(PLAN_DRAFT_COLS\)/);
    expect(PAGE).toMatch(/from "\.\/battle-plan-data"/);
  });

  it("分頁的寫入只走 battle_plan_drafts; 每一支寫正式表的 handler 都先看是不是在分頁", () => {
    // 寫正式那三張表的地方, 前面一定有 if (active) 的分岔 (不然分頁裡的動作會寫到正式那張)
    for (const fn of ["toggleMember", "saveCellText", "saveFieldLabel", "deleteField", "addField", "saveNote"]) {
      const body = UI.match(new RegExp(`const ${fn} = async \\([\\s\\S]*?\\n  };`));
      expect(body, fn).toBeTruthy();
      const firstWrite = body![0].search(/supabase\s*\.from\("battle_plan/);
      const guard = body![0].search(/if \(active\)/);
      expect(guard, `${fn} 要有 if (active)`).toBeGreaterThan(-1);
      if (firstWrite > -1) expect(guard, `${fn} 的分岔要在寫入之前`).toBeLessThan(firstWrite);
    }
    // 分頁一定要排隊送 (只合併不排隊 = 兩趟可能後到先至, 舊的蓋掉新的)
    expect(UI).toMatch(/draftQueue\.current\.get\(id\) \?\? Promise\.resolve\(\)/);
  });

  it("匯出的圖標題寫分頁名、副標寫誰加的 —— 貼到賴群時不會被當成正式那張", () => {
    expect(UI).toMatch(/`排刀表：\$\{draftName\}`/);
    expect(UI).toMatch(/\$\{tabByline\(active\)\}/);
  });
});

describe("normalizePlanDoc: 資料庫裡的形狀不保證, 讀不懂的丟掉, 不要整塊畫不出來", () => {
  it("垃圾輸入 → 空的一份", () => {
    for (const raw of [null, undefined, 3, "x", [], { rows: "x" }]) {
      expect(normalizePlanDoc(raw)).toEqual({ rows: [], note: "" });
    }
  });

  it("沒有 id 的列丟掉; 成員去重; 空格子不留; 字數照畫面上限截斷", () => {
    const doc = normalizePlanDoc({
      rows: [
        { label: "沒有 id" },
        {
          id: "f1",
          label: "一二三四五六七八九十一二三四五六七八九十多出來",
          wide: "yes",
          cells: {
            s1: { members: ["a", "a", 3, "b"], text: "x".repeat(80) },
            s2: { members: [], text: "" },
            s3: "壞掉",
          },
        },
      ],
      note: 42,
    });
    expect(doc.rows).toHaveLength(1);
    expect(doc.rows[0].label).toHaveLength(20);
    expect(doc.rows[0].wide).toBe(false);
    expect(doc.rows[0].cells.s1.members).toEqual(["a", "b"]);
    expect(doc.rows[0].cells.s1.text).toHaveLength(60);
    expect(Object.keys(doc.rows[0].cells)).toEqual(["s1"]);
    expect(doc.note).toBe("");
  });
});
