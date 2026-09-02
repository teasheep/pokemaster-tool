// 檢查 member_pairs 是否有同 (member_id, pair_id) 多列 (pair_label 寫法不一造成)
import { readFileSync } from "node:fs";
import pg from "pg";

const env = {};
for (const line of readFileSync("C:/code/pokemon-master-inventory/.env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const client = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
const { rows } = await client.query(`
  select member_id, pair_id, count(*) as n, array_agg(pair_label) as labels, array_agg(grade) as grades
  from public.member_pairs
  where pair_id is not null
  group by member_id, pair_id
  having count(*) > 1
  order by n desc
`);
console.log("重複 (member_id, pair_id) 組數:", rows.length);
for (const r of rows.slice(0, 20)) console.log(" ", r.member_id.slice(0, 8), r.pair_id, r.labels, r.grades);
if (rows.length > 0 && process.argv.includes("--fix")) {
  // 保留 grade 最高的一列, 刪其餘
  const { rowCount } = await client.query(`
    delete from public.member_pairs mp
    using public.member_pairs keep
    where mp.pair_id is not null
      and keep.pair_id = mp.pair_id
      and keep.member_id = mp.member_id
      and keep.id <> mp.id
      and (keep.grade > mp.grade or (keep.grade = mp.grade and keep.id < mp.id))
  `);
  console.log("已刪除重複列:", rowCount);
}
await client.end();
