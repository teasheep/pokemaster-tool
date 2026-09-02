"use client";

// 隊伍庫分頁的資料殼 — 介面本體是共用的 TeamLibrary
// (關卡側板 TeamSheet 用的是同一份, 差別只在多了「加入本關」)

import { useMemo, useState } from "react";

import { TeamLibrary, type TeamPairRow, type TeamRow } from "@/components/gym/team-sheet";
import { createClient } from "@/lib/supabase/client";
import type { ClientPairRecord } from "@/lib/pairs/types";
import type { SyncPairType } from "@/lib/supabase/types";

export function TeamsClient({
  gymId,
  isAdmin,
  initialTeams,
  initialTeamPairs,
  gymPairs,
  catalog,
  fullCatalogUrl,
}: {
  gymId: string;
  isAdmin: boolean;
  initialTeams: TeamRow[];
  initialTeamPairs: TeamPairRow[];
  gymPairs: { pairId: string; type: SyncPairType }[];
  /** 圖鑑子集 (道館名單 ∪ 已在隊伍裡) — 整本由 fullCatalogUrl 按需抓 */
  catalog: ClientPairRecord[];
  fullCatalogUrl: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [teams, setTeams] = useState(initialTeams);
  const [teamPairs, setTeamPairs] = useState(initialTeamPairs);

  const refetch = async () => {
    // 欄位與 page.tsx 的初始查詢同一組 (TeamRow / TeamPairRow 就是這些欄位)
    const [{ data: t }, { data: tp }] = await Promise.all([
      supabase.from("gym_teams").select("id, type, name, tag, note, sort_order").eq("gym_id", gymId),
      supabase
        .from("gym_team_pairs")
        .select("id, team_id, slot, pair_id, min_grade")
        .eq("gym_id", gymId),
    ]);
    if (t) setTeams(t);
    if (tp) setTeamPairs(tp);
  };

  return (
    <TeamLibrary
      gymId={gymId}
      isAdmin={isAdmin}
      teams={teams}
      teamPairs={teamPairs}
      gymPairs={gymPairs}
      catalog={catalog}
      fullCatalogUrl={fullCatalogUrl}
      onChanged={refetch}
    />
  );
}
