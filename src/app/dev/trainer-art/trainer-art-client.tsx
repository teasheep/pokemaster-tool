"use client";

// 取景工具的 UI。三件事:
//   1. 左邊是**真正的 SyncPairCard**, 圖換成即時裁出來的預覽 (不是裸圖 —— 見 page 的檔頭)
//   2. 上面一排原生縮圖當尺, 隨時可以對照「官方的正確答案」長什麼樣
//   3. 拉滑桿 → 300ms 後打 API 重裁 → 滿意再按「寫入」落地並存回參數
//
// 這頁只在本機跑, 所以刻意不做骨架/樂觀更新那些站上的講究。

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { SyncPairCard } from "@/components/sync-pair-card";
import type { ClientPairRecord } from "@/lib/pairs/types";

type Item = {
  id: string;
  note: string;
  url: string;
  gain: number;
  dx: number;
  dy: number;
  pair: ClientPairRecord | null;
};

type Params = { gain: number; dx: number; dy: number };

const SLIDERS: { key: keyof Params; label: string; min: number; max: number; step: number; hint: string }[] = [
  { key: "gain", label: "遠近", min: 0.5, max: 3, step: 0.01, hint: "大 = 更近" },
  { key: "dx", label: "左右", min: -60, max: 60, step: 1, hint: "正 = 往右" },
  { key: "dy", label: "上下", min: -60, max: 60, step: 1, hint: "正 = 往下" },
];

function Row({ item }: { item: Item }) {
  const [p, setP] = useState<Params>({ gain: item.gain, dx: item.dx, dy: item.dy });
  /** 已落地的值 — 用來標示「改過還沒寫入」 */
  const [saved, setSaved] = useState<Params>({ gain: item.gain, dx: item.dx, dy: item.dy });
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const urlRef = useRef<string | null>(null);

  const dirty = p.gain !== saved.gain || p.dx !== saved.dx || p.dy !== saved.dy;

  const render = useCallback(async (next: Params) => {
    const res = await fetch("/api/dev/trainer-art", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, ...next }),
    });
    if (!res.ok) {
      toast.error(`${item.note} 預覽失敗`, { description: await res.text() });
      return;
    }
    const blob = await res.blob();
    // 舊的 blob URL 要收掉, 不然拉一次滑桿就漏一份記憶體
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = URL.createObjectURL(blob);
    setPreview(urlRef.current);
  }, [item.id, item.note]);

  // 拉滑桿時節流: 停 300ms 才重算 (sharp 一次約 50ms, 但別讓每一格都送一次)
  useEffect(() => {
    const t = setTimeout(() => void render(p), 300);
    return () => clearTimeout(t);
  }, [p, render]);

  // 卸載時把最後一個 blob URL 收掉
  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/dev/trainer-art", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, ...p, save: true }),
      });
      if (!res.ok) {
        toast.error("寫入失敗", { description: await res.text() });
        return;
      }
      setSaved(p);
      toast.success(`${item.note} 已寫入`, {
        description: `gain ${p.gain} / dx ${p.dx} / dy ${p.dy} — 參數已存回 trainer-art.json`,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-start gap-4 rounded-xl border bg-card p-3">
      <div className="flex shrink-0 flex-col items-center gap-1">
        {item.pair ? (
          <SyncPairCard
            pair={item.pair}
            size="lg"
            showName={false}
            minimal
            eager
            trainerImgSrc={preview ?? undefined}
          />
        ) : (
          <div className="flex h-32 w-32 items-center justify-center rounded-xl border border-dashed text-xs text-muted-foreground">
            catalog 查無
          </div>
        )}
        <span className="text-[11px] text-muted-foreground">{preview ? "預覽" : "載入中…"}</span>
      </div>

      <div className="min-w-64 flex-1 space-y-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold">{item.note}</h2>
          <code className="text-[11px] text-muted-foreground">{item.id}</code>
          {dirty ? (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-300">
              改過, 還沒寫入
            </span>
          ) : null}
        </div>

        {SLIDERS.map((s) => (
          <label key={s.key} className="flex items-center gap-2 text-xs">
            <span className="w-8 shrink-0 text-muted-foreground">{s.label}</span>
            <input
              type="range"
              min={s.min}
              max={s.max}
              step={s.step}
              value={p[s.key]}
              onChange={(e) => setP((v) => ({ ...v, [s.key]: Number(e.target.value) }))}
              className="min-w-0 flex-1"
            />
            <span className="w-12 shrink-0 text-right tabular-nums">{p[s.key]}</span>
            <span className="w-14 shrink-0 text-[10px] text-muted-foreground">{s.hint}</span>
          </label>
        ))}

        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" onClick={() => void save()} disabled={busy || !dirty}>
            寫入並存參數
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setP(saved)}
            disabled={!dirty}
          >
            復原
          </Button>
        </div>
      </div>
    </div>
  );
}

export function TrainerArtClient({
  items,
  refs,
}: {
  items: Item[];
  refs: ClientPairRecord[];
}) {
  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4">
      <div>
        <h1 className="text-lg font-semibold">訓練家立繪取景 (本機工具)</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          brybry 對這幾位給的是全身圖, 要自己裁成頭肩胸像。
          <strong>標準是下面那排原生縮圖</strong> —— 官方遊戲內就是那樣顯示, 對齊它們即可。
          按「寫入」會同時更新 PNG/WebP 與 src/data/trainer-art.json,
          之後 <code>npm run art:trainer</code> 重跑會產出同一張。
        </p>
      </div>

      <div className="rounded-xl border bg-muted/30 p-3">
        <h2 className="mb-2 text-xs font-medium text-muted-foreground">
          取景基準 (原生縮圖 = 正確答案)
        </h2>
        <div className="flex flex-wrap gap-2">
          {refs.map((p) => (
            <SyncPairCard key={p.pairId} pair={p} size="lg" showName={false} minimal eager />
          ))}
        </div>
      </div>

      {items.map((it) => (
        <Row key={it.id} item={it} />
      ))}
    </main>
  );
}
