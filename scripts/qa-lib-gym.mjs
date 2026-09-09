// QA 腳本共用: 建一個隔離的測試道館。
//
// 0060 起 create_gym 需要一次性的建館碼, 而且回傳從 uuid 改成 jsonb。
// 兩支 QA 腳本都要建館, 所以把「發一組碼 → 建館 → 收好碼以便清掉」收在這裡一份。
//
// **套 migration 前後都要跑得起來**: 部署 (推 tag → CI → Workers) 與套 migration 是
// 兩個動作, 中間那幾分鐘也該驗得動。所以碼表不存在、或舊簽章還在時, 一律自動退回舊路。

const MISSING_TABLE = /schema cache|does not exist/i;

/**
 * @param admin  service role client (發碼要用 —— gym_create_codes 沒有任何 RLS policy)
 * @param asUser 測試帳號的 client (建館要用他的身分, 他才會是管理員)
 * @returns { gymId, code }  code 可能是 null (還沒套 migration); 收尾時交給 dropTestGymCode
 */
export async function createTestGym(admin, asUser, name) {
  let code = null;
  const { data: made, error: cErr } = await admin
    .from("gym_create_codes")
    .insert({ note: `QA: ${name}` })
    .select("code")
    .single();
  if (made) code = made.code;
  else if (cErr && !MISSING_TABLE.test(cErr.message)) throw new Error("發建館碼: " + cErr.message);

  let { data, error } = code
    ? await asUser.rpc("create_gym", { p_name: name, p_code: code })
    : await asUser.rpc("create_gym", { p_name: name });
  // 碼表在但函式還是舊簽章 (只套了一半) —— PGRST202 = 找不到那個函式
  if (error?.code === "PGRST202") {
    ({ data, error } = await asUser.rpc("create_gym", { p_name: name }));
  }
  if (error) throw new Error("建道館: " + error.message);

  // 舊版回 uuid 字串, 新版回 { gym_id }
  const gymId = typeof data === "string" ? data : data?.gym_id;
  if (!gymId) throw new Error("建道館: " + JSON.stringify(data));
  return { gymId, code };
}

/** 收尾: 把 QA 用掉的建館碼刪掉 (不要在正式資料裡留下一堆 QA 的紀錄) */
export async function dropTestGymCode(admin, code) {
  if (code) await admin.from("gym_create_codes").delete().eq("code", code);
}
