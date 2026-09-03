import type { Metadata } from "next";

import { NOINDEX } from "@/lib/site";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { loadPairsForClient } from "@/lib/pairs/loader";
import { SharedCollection, type SharedEntry } from "./shared-collection";

export const dynamic = "force-dynamic";

type Params = { token: string };

type SharedRow = {
  pair_id: string;
  owned: boolean;
  level: number;
  promotion: number;
  potential: number;
  super_awakening: number;
  ex_unlocked: boolean;
};

/**
 * ⚠ **一定要 noindex**。分享連結的 token 是半秘密 —— 誰拿到網址誰就看得到,
 * 所以它被搜尋引擎收錄等於把成員的收藏攤在搜尋結果上。
 * `robots.txt` 也 Disallow 了 `/share/`, 兩層都要 (兩個機制擋的東西不一樣, 見 lib/site.ts)。
 */
export const metadata: Metadata = {
  title: "分享的拍組收藏",
  description: "Pokémon Masters EX 拍組收藏清單, 不需登入即可瀏覽。",
  openGraph: { title: "分享的拍組收藏", type: "website" },
  ...NOINDEX,
};

export default async function SharePage({ params }: { params: Promise<Params> }) {
  const { token } = await params;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <Notice title="分享頁尚未啟用" body="Supabase 還沒設定, 分享功能無法使用。" />;
  }

  const supabase = await createClient();
  const [{ data, error }, { data: meta }, catalog] = await Promise.all([
    supabase.rpc("get_shared_collection", { p_token: token }),
    supabase.rpc("get_share_meta", { p_token: token }),
    loadPairsForClient().catch(() => []),
  ]);

  if (error?.message?.includes("does not exist")) {
    return <Notice title="分享頁尚未啟用" body="請先在 Supabase 執行 migration SQL。" />;
  }
  if (error || !data) notFound();

  const owner = Array.isArray(meta) ? meta[0] : null;
  // 連結有效但收藏是空的 → 不是 404, 給空狀態
  if (!owner && (data as SharedRow[]).length === 0) notFound();

  const pairsById = new Map(catalog.map((p) => [p.pairId, p]));
  const entries: SharedEntry[] = (data as SharedRow[])
    .map((r) => {
      const pair = pairsById.get(r.pair_id);
      return pair
        ? {
            pair,
            promotion: r.promotion,
            potential: r.potential,
            superAwakening: r.super_awakening,
            exUnlocked: r.ex_unlocked,
            level: r.level,
          }
        : null;
    })
    .filter((x): x is SharedEntry => x !== null);

  return (
    <>
      <main className="flex-1">
        <PageShell>
          <SharedCollection
            ownerName={owner?.display_name ?? "訓練家"}
            ownerAvatar={owner?.avatar_url ?? null}
            entries={entries}
            catalogTotal={catalog.length}
          />

          <div className="mt-10 rounded-xl border border-dashed bg-card/50 p-6 text-center">
            <p className="text-sm text-muted-foreground">
              這是唯讀的分享頁 — 想管理自己的拍組收藏?
            </p>
            <Button asChild className="mt-3">
              <Link href="/login">用 Google 登入</Link>
            </Button>
          </div>
        </PageShell>
      </main>
    </>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <>
      <main className="flex-1">
        <PageShell width="prose" className="py-12 text-center">
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{body}</p>
        </PageShell>
      </main>
    </>
  );
}
