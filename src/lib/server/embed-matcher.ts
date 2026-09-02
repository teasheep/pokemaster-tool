// Embedding-based sync-pair matcher (replaces the ORB/opencv pipeline).
//
// Approach (validated empirically, see scripts/diag-*.mjs):
//   - Pokemon is the strong anchor: DINOv2 CLS embedding of a tight pokemon-circle
//     crop cleanly identifies the species (background-robust).
//   - Trainer disambiguates same-pokemon pairs: DINOv2 CLS embedding + fg color hist.
//   - Two-stage: rank by pokemon → shortlist → rerank by trainer.
//   - currentRarity (frame/stars) applies the only-upgrade constraint as a soft prior.
//
// No opencv-js → no native Mat memory instability. Model + cache load once (module scope).

import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";

import sharp from "sharp";

import { detectGrid, type DetectedCell } from "@/lib/server/grid-detect";
import { extractMetadata, detectMoveTypes, detectRoleIcon, detectPrimaryType, typeFamilyOf, decodeFull, cellSubSharp, warmupMetadata, type CellMetadata, type MoveTypeDetection, type DecodedImage } from "@/lib/server/metadata-extract";
import { loadPairsById } from "@/lib/pairs/loader";
import type { PairRecord } from "@/lib/pairs/types";
import { cos, histFromRGB, l2Normalize, mapWithConcurrency, topK } from "@/lib/server/_math";

// roleAsset → 角色群組 (對齊 detectRoleIcon 的 group)
function roleAssetToGroup(asset?: string | null): string | null {
  switch (asset) {
    case "ROLE_001P": case "ROLE_001S": return "strike";
    case "ROLE_002": return "support";
    case "ROLE_004": return "tech";
    case "ROLE_008": return "sprint";
    case "ROLE_016": return "field";
    case "ROLE_032": return "multi";
    default: return null;
  }
}

export type GridOpts = {
  cols: number; rows: number;
  top: number; bottom: number; left: number; right: number; gap: number;
};

/** 重新匯出, 讓 callers 用單一型別 (canonical 在 @/lib/pairs/types) */
export type PairLite = PairRecord;

export type Candidate = {
  pair: PairLite; pSim: number; teSim: number; thSim: number; score: number;
  /** 此候選若為 6★EX 且有 EX style: 由色彩判定是否穿著 EX 裝 + 信心 */
  exStyleWorn?: boolean; exStyleConf?: number;
  /** 診斷用: cell 色彩與 base / EX 立繪的相似度 (僅參考, 判定以星標徽章為準) */
  exSimBase?: number; exSimEx?: number;
};

export type CellMatch = {
  index: number; row: number; col: number;
  cellDataUrl: string;
  bestPair: PairLite | null;
  candidates: Candidate[];   // top-N (incl. best)
  metadata: CellMetadata;
  moveTypes: MoveTypeDetection;
  role: { group: string | null; confidence: number };
  primaryType: { type: string | null; family: string | null; confidence: number };
  /** EX 換裝判定 (取 best 候選): available=該拍組有 EX style; worn=偵測為穿著中 */
  exStyle: { available: boolean; worn: boolean; confidence: number };
};

// ---------- data + model (module-scope singletons) ----------

// 從 JSON 讀進來是 number[]; 一律經 toF32() 升級成 Float32Array 後 in-memory 使用。
type EmbVec = Float32Array;
type EmbEntry = {
  id: string; pEmb: EmbVec; tEmb: EmbVec; tEmbEx?: EmbVec; tHist: EmbVec;
  // EX style 參照 (僅 hasExStyle 拍組有): 真實 EX 換裝 embedding + EX/base 色彩直方圖
  tEmbExStyle?: EmbVec; tHistExStyle?: EmbVec; tHistBaseWiki?: EmbVec;
};
type EmbCache = { entries: EmbEntry[]; byId: Map<string, EmbEntry>; pairs: Map<string, PairLite> };

let cachePromise: Promise<EmbCache> | null = null;
async function getCache(): Promise<EmbCache> {
  if (cachePromise) return cachePromise;
  cachePromise = (async () => {
    const dataDir = path.join(process.cwd(), "src", "data");
    const [embRaw, pairs] = await Promise.all([
      fs.readFile(path.join(dataDir, "pair-embeddings.json"), "utf8"),
      loadPairsById(),
    ]);
    const emb = JSON.parse(embRaw) as { entries: EmbEntry[] };
    // 把 number[] 升級為 Float32Array (RAM 1/8, cosine 也快)
    const entries: EmbEntry[] = emb.entries.map((e) => ({
      id: e.id,
      pEmb: toF32(e.pEmb),
      tEmb: toF32(e.tEmb),
      tEmbEx: e.tEmbEx ? toF32(e.tEmbEx) : undefined,
      tHist: toF32(e.tHist),
      tEmbExStyle: e.tEmbExStyle ? toF32(e.tEmbExStyle) : undefined,
      tHistExStyle: e.tHistExStyle ? toF32(e.tHistExStyle) : undefined,
      tHistBaseWiki: e.tHistBaseWiki ? toF32(e.tHistBaseWiki) : undefined,
    }));
    const byId = new Map<string, EmbEntry>();
    for (const e of entries) byId.set(e.id, e);
    return { entries, byId, pairs };
  })();
  return cachePromise;
}

function toF32(arr: number[] | Float32Array): Float32Array {
  return arr instanceof Float32Array ? arr : Float32Array.from(arr);
}

type FeatureExtractor = Awaited<ReturnType<typeof import("@huggingface/transformers").pipeline<"image-feature-extraction">>>;

let extractorPromise: Promise<FeatureExtractor> | null = null;
async function getExtractor(): Promise<FeatureExtractor> {
  if (extractorPromise) return extractorPromise;
  extractorPromise = (async () => {
    const { pipeline } = await import("@huggingface/transformers");
    return pipeline("image-feature-extraction", "Xenova/dinov2-small");
  })();
  return extractorPromise;
}

/**
 * 預熱所有 module-scope singleton: embedding cache (JSON + pairs)、DINOv2 extractor,
 * 以及 metadata 偵測用的 template / OCR worker pool。
 * 供 /api/warmup 在部署後主動呼叫, 讓第一個真實使用者 request 不必承擔冷啟成本。
 */
export async function warmup(): Promise<void> {
  await Promise.all([getCache(), getExtractor(), warmupMetadata()]);
}

// ---------- math helpers (extracted to ./_math for testability) ----------

// DINOv2 CLS embedding, 批次推論。
// pipeline 接受 image 陣列做單次 batched forward (dims = [N, tokens, dim]);
// 每張影像的 CLS = 該影像 token 0 (offset = j*tokens*dim)。實測批次與逐張結果 bit-identical。
// 分塊處理 (CHUNK) 以限制記憶體; 結果順序對齊輸入。
const EMBED_CHUNK = 12; // 8-16 之間

async function clsEmbedBatch(extractor: FeatureExtractor, pngBufs: Buffer[]): Promise<Float32Array[]> {
  if (pngBufs.length === 0) return [];
  const { RawImage } = await import("@huggingface/transformers");
  const results: Float32Array[] = new Array(pngBufs.length);
  for (let start = 0; start < pngBufs.length; start += EMBED_CHUNK) {
    const chunk = pngBufs.slice(start, start + EMBED_CHUNK);
    const imgs = await Promise.all(
      chunk.map((buf) => RawImage.fromBlob(new Blob([buf as unknown as BlobPart]))),
    );
    const out = await extractor(imgs);
    const tokens = out.dims[1] as number;
    const dim = out.dims[2] as number;
    const data = out.data as Float32Array;
    for (let j = 0; j < chunk.length; j++) {
      const off = j * tokens * dim;
      const v = new Float32Array(dim);
      for (let k = 0; k < dim; k++) v[k] = data[off + k]!;
      results[start + j] = l2Normalize(v);
    }
  }
  return results;
}

// ---------- scoring weights (tunable) ----------
// 訓練家 embedding 經實測對「正解」排名 ~250/617 (近乎雜訊, 因 6★EX 改頭像 + 彩虹背景),
// 故大幅降權, 只當微弱 tiebreak; 主訊號 = 寶可夢 embedding + role/屬性 icon (確定性訊號)。
const W_POKE = 1.3;
const W_TEMB = 0.30;   // EX-conditioned 參照後訓練家較可靠, 適度提高 (同寶可夢辨別靠它)
const W_THIST = 0.10;
const POKE_SHORTLIST = 55;   // 寶可夢相似度前 N
const ROLE_CONF_MIN = 0.45;  // role 偵測信心門檻 (用於候選集擴充)
const W_ROLE = 1.8;  // soft role 加權 (boost ∝ 該 role zncc 高於平均的量)
const TOP_N = 3;

// ---------- public API ----------

export async function matchScreenshot(
  imageBuffer: Buffer,
  grid: GridOpts,
  options: { autoDetect?: boolean; filterType?: string } = {}
): Promise<{
  cells: CellMatch[];
  durationMs: number;
  refsReady: number;
  detectMode: "auto" | "manual";
  detectReason?: string;
}> {
  const t0 = Date.now();
  const [cache, extractor] = await Promise.all([getCache(), getExtractor()]);

  const meta = await sharp(imageBuffer).metadata();
  const W = meta.width ?? 0, H = meta.height ?? 0;
  if (!W || !H) throw new Error("無法讀取截圖大小");

  // grid
  let detectedCells: DetectedCell[] | null = null;
  let detectReason: string | undefined;
  if (options.autoDetect !== false) {
    const d = await detectGrid(imageBuffer, { cols: grid.cols, rows: grid.rows });
    if (d.ok) detectedCells = d.cells; else detectReason = d.reason;
  }
  let cellRects: DetectedCell[];
  if (detectedCells) cellRects = detectedCells;
  else {
    cellRects = [];
    const gL = Math.round(grid.left * W), gR = Math.round(grid.right * W);
    const gT = Math.round(grid.top * H), gB = Math.round(grid.bottom * H);
    const cw = (gR - gL) / grid.cols, ch = (gB - gT) / grid.rows;
    const pw = cw * grid.gap, ph = ch * grid.gap;
    for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++)
      cellRects.push({ index: r * grid.cols + c, row: r, col: c,
        x: Math.round(gL + c * cw + pw), y: Math.round(gT + r * ch + ph),
        width: Math.round(cw - pw * 2), height: Math.round(ch - ph * 2) });
  }

  // decode-once: 整張截圖只解碼一次成 RGB raw, 供所有 cell 的偵測器/裁切共用
  // (取代舊版每個偵測器各自 sharp(imageBuffer).extract() 重新解碼 4096px 原圖)。
  const decoded = await decodeFull(imageBuffer);

  // ── Phase 1: 每個 cell 的非 embedding 前處理 (metadata / icon / crops), 受控併發。
  //    embedding 推論「不」在這裡做 — 兩張 crop (poke/trainer) 收集起來最後一次 batched forward。
  const CELL_CONCURRENCY = 4;
  const preps: CellPrep[] = new Array(cellRects.length);
  const filterType = options.filterType;
  await mapWithConcurrency(cellRects, CELL_CONCURRENCY, async (rect, slot) => {
    preps[slot] = await prepCell(rect, imageBuffer, decoded);
  });

  // ── Phase 2: 把所有 cell 的 poke + trainer crop 收成一個大陣列, 分塊 batched DINOv2 forward。
  //    順序: [cell0.poke, cell0.trn, cell1.poke, cell1.trn, ...] → 回填各 cell 的 pEmb/tEmb。
  const embedBufs: Buffer[] = [];
  for (const p of preps) { embedBufs.push(p.pokePng, p.trnPng); }
  const embs = await clsEmbedBatch(extractor, embedBufs);

  // ── Phase 3: 用各 cell 的 embedding 計分 (純 CPU, 無 IO)。
  const results: CellMatch[] = new Array(cellRects.length);
  for (let i = 0; i < preps.length; i++) {
    const pEmb = embs[i * 2]!;
    const tEmb = embs[i * 2 + 1]!;
    results[i] = scoreCell(preps[i]!, pEmb, tEmb, cache, { filterType });
  }

  return {
    cells: results,
    durationMs: Date.now() - t0,
    refsReady: cache.entries.length,
    detectMode: detectedCells ? "auto" : "manual",
    detectReason,
  };
}

// 單一 cell 的前處理結果 (embedding 之外的一切): 給 Phase 2/3 使用。
type CellPrep = {
  rect: DetectedCell;
  cellDataUrl: string;
  metadata: CellMetadata;
  moveDet: MoveTypeDetection;
  roleDet: Awaited<ReturnType<typeof detectRoleIcon>>;
  primary: Awaited<ReturnType<typeof detectPrimaryType>>;
  pokePng: Buffer;
  trnPng: Buffer;
  tHist: Float32Array;
};

async function prepCell(
  rect: DetectedCell,
  imageBuffer: Buffer,
  decoded: DecodedImage,
): Promise<CellPrep> {
  const { x: cx, y: cy, width: cw, height: ch } = rect;
  const rectXywh = { x: cx, y: cy, width: cw, height: ch };

  // cell 子影像 (一次裁切; 後續所有 cell-local crop 從它 extract, 不碰 4096px 原圖)
  const sub = cellSubSharp(decoded, rectXywh);

  // 顯示縮圖: 改用 webp (體積較 png 小很多; 仍是 data URL)。整塊 cell = 子影像全幅。
  const cellThumb = await sub.sharp()
    .extract({ left: 0, top: 0, width: sub.width, height: sub.height })
    .resize(180, null, { fit: "contain" }).webp({ quality: 75 }).toBuffer();
  const cellDataUrl = `data:image/webp;base64,${cellThumb.toString("base64")}`;

  const [metadata, moveDet, roleDet, primary] = await Promise.all([
    extractMetadata(decoded, rectXywh),
    detectMoveTypes(sub, rectXywh),
    detectRoleIcon(decoded, rectXywh),
    detectPrimaryType(decoded, rectXywh),
  ]);

  // crops (calibrated in diagnostics) — 從 cell 子影像裁切 (cell-local 座標); 像素等同舊版從原圖裁。
  const [pokePng, trnPng, trnHistRGBObj] = await Promise.all([
    sub.sharp()
      .extract({ left: Math.round(0.58 * cw), top: Math.round(0.60 * ch), width: Math.round(0.36 * cw), height: Math.round(0.36 * ch) })
      .resize(160, 160, { fit: "contain", background: { r: 240, g: 240, b: 240 } }).flatten({ background: { r: 240, g: 240, b: 240 } }).png().toBuffer(),
    sub.sharp()
      .extract({ left: Math.round(0.09 * cw), top: Math.round(0.18 * ch), width: Math.round(0.82 * cw), height: Math.round(0.52 * ch) })
      .resize(180, 180, { fit: "fill" }).flatten({ background: { r: 240, g: 240, b: 240 } }).png().toBuffer(),
    sub.sharp()
      .extract({ left: Math.round(0.20 * cw), top: Math.round(0.20 * ch), width: Math.round(0.60 * cw), height: Math.round(0.44 * ch) })
      .resize(64, 64, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  const tHist = histFromRGB(trnHistRGBObj.data);

  return { rect, cellDataUrl, metadata, moveDet, roleDet, primary, pokePng, trnPng, tHist };
}

function scoreCell(
  prep: CellPrep,
  pEmb: Float32Array,
  tEmb: Float32Array,
  cache: EmbCache,
  options: { filterType?: string } = {},
): CellMatch {
  const { rect, cellDataUrl, metadata, moveDet, roleDet, primary, tHist } = prep;
  const { row, col, index } = rect;

  const primaryFamily = primary.confidence >= 0.45 ? primary.family : null;
  const detectedRole = roleDet.confidence >= ROLE_CONF_MIN ? roleDet.group : null;
  const roleVals = Object.values(roleDet.scores);
  const roleMean = roleVals.length ? roleVals.reduce((a, b) => a + b, 0) / roleVals.length : null;

  // 寶可夢相似度: 全量算一次 (供 shortlist + 計分), 用 bounded top-K 取前 N (O(n), 不需 full sort)。
  const pSimById = new Map<string, number>();
  for (const e of cache.entries) pSimById.set(e.id, cos(pEmb, e.pEmb));

  const candIds = new Set<string>();
  for (const e of topK(cache.entries, POKE_SHORTLIST, (x) => pSimById.get(x.id)!)) candIds.add(e.id);
  if (detectedRole) {
    for (const e of cache.entries) {
      const pair = cache.pairs.get(e.id)!;
      if (roleAssetToGroup(pair.roleAsset) === detectedRole) candIds.add(e.id);
    }
  }
  if (options.filterType) {
    for (const id of [...candIds]) {
      if (cache.pairs.get(id)?.type !== options.filterType) candIds.delete(id);
    }
    if (candIds.size === 0) {
      for (const e of cache.entries) {
        if (cache.pairs.get(e.id)?.type === options.filterType) candIds.add(e.id);
      }
    }
  }

  const scored: Candidate[] = [...candIds].map((id) => {
    const e = cache.byId.get(id)!;
    const pair = cache.pairs.get(id)!;
    const pSim = pSimById.get(id)!; // pSimById 對全部 entries 都已填入

    // ── EX 換裝判定: 由星標徽章 (metadata.exStyleActive) 決定 worn (色彩比對僅作 fallback 診斷)
    let exStyleWorn: boolean | undefined;
    let exStyleConf: number | undefined;
    let exSimBase: number | undefined;
    let exSimEx: number | undefined;
    let tRef: Float32Array;
    let thRef: Float32Array;
    if (metadata.exStyleActive && e.tHistExStyle && e.tEmbExStyle) {
      exStyleWorn = true;
      exStyleConf = 1;
      exSimBase = cos(tHist, e.tHistBaseWiki ?? e.tHist);
      exSimEx = cos(tHist, e.tHistExStyle);
      tRef = e.tEmbExStyle;
      thRef = e.tHistExStyle;
    } else if (metadata.exUnlocked && e.tEmbEx) {
      tRef = e.tEmbEx;
      thRef = e.tHist;
    } else {
      tRef = e.tEmb;
      thRef = e.tHist;
    }
    const teSim = cos(tEmb, tRef);
    const thSim = cos(tHist, thRef);
    let score = W_POKE * pSim + W_TEMB * teSim + W_THIST * thSim;
    if ((pair.basePotential ?? 5) > metadata.currentRarity) score -= 0.12;
    if (primaryFamily) {
      score += typeFamilyOf(pair.type) === primaryFamily ? 0.15 : -0.30;
    }
    if (roleMean != null) {
      const g = roleAssetToGroup(pair.roleAsset);
      if (g != null && roleDet.scores[g] != null) {
        score += W_ROLE * (roleDet.scores[g]! - roleMean);
      }
    }
    if (moveDet.count > 0) {
      const cmoves = pair.moveTypes && pair.moveTypes.length ? pair.moveTypes : [pair.type];
      if (cmoves.length === moveDet.count) score += 0.05;
      for (const t of moveDet.specific) {
        if (cmoves.includes(t)) score += 0.18; else score -= 0.10;
      }
    }
    return { pair, pSim, teSim, thSim, score, exStyleWorn, exStyleConf, exSimBase, exSimEx };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, TOP_N);

  const best = top[0];
  const exStyle = {
    available: !!(best && best.pair.hasExStyle && metadata.exUnlocked),
    worn: metadata.exStyleActive,
    confidence: metadata.exStyleActive ? 1 : 0,
  };

  return {
    index, row, col, cellDataUrl,
    bestPair: top[0]?.pair ?? null,
    candidates: top,
    metadata,
    moveTypes: moveDet,
    role: { group: detectedRole, confidence: roleDet.confidence },
    primaryType: primary,
    exStyle,
  };
}

