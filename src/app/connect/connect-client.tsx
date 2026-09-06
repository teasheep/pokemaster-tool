"use client";

// 資料連線 — 一把跟著「人」走的唯讀金鑰: 你看得到哪些道館, 你的 AI 就讀得到哪些。
// 這頁刻意不寫教學文: 金鑰列 + 三種接法的可複製指令 + 可展開的回傳結構, 看到就會用。

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Check, Copy, Eye, EyeOff, KeyRound, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

// origin 是「外部世界的值」不是 state: 訂閱函式永遠不會回呼 (網址列不會自己變),
// 只是 useSyncExternalStore 要求的形狀。放模組層是為了維持同一個參照。
const subscribeOrigin = () => () => {};
const readOrigin = () => window.location.origin;
const readOriginOnServer = () => "";

/** 未按下「顯示」時金鑰的樣子 */
const MASK = "•".repeat(12);

const ROLE_LABELS: Record<string, string> = {
  admin: "管理員",
  member: "成員",
  advisor: "顧問",
};

function CopyButton({
  text,
  label,
  title = "複製",
  icon,
}: {
  text: string;
  label?: string;
  title?: string;
  icon?: ReactNode;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      title={title}
      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors hover:bg-accent"
    >
      {done ? (
        <Check className="h-3.5 w-3.5 text-emerald-500" />
      ) : (
        (icon ?? <Copy className="h-3.5 w-3.5" />)
      )}
      {label}
    </button>
  );
}

const TABS = [
  { id: "chat", label: "貼給 AI" },
  { id: "code", label: "Claude Code" },
  { id: "desktop", label: "Claude Desktop" },
] as const;

export function ConnectClient({
  token,
  gyms,
}: {
  token: string | null;
  gyms: { name: string; role: string }[];
}) {
  const [key, setKey] = useState(token);
  const [show, setShow] = useState(false);
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("chat");
  const [busy, setBusy] = useState(false);

  // origin 只有瀏覽器知道, 但**不能在 render 時直接讀 window** — server render 出來是
  // 空字串、client 第一次 render 是完整網址, 兩邊文字對不起來就是 hydration mismatch
  // (React #418, 線上實測有噴)。改成掛載後才補上: 首次 render 兩邊都是空的, 一致。
  // 用 useSyncExternalStore 而不是 useEffect+setState — 後者是在 effect 裡同步 setState,
  // 會觸發串聯 render (eslint react-hooks/set-state-in-effect 擋), 這裡本來就只是「讀外部值」。
  const origin = useSyncExternalStore(subscribeOrigin, readOrigin, readOriginOnServer);
  const endpoint = `${origin}/api/export`;
  const url = `${endpoint}?key=${key ?? ""}`;
  const masked = `${endpoint}?key=${MASK}`;
  // 未顯示時把金鑰整串換掉 (replaceAll: 同一段可能出現兩次; key 為 null 時原樣回傳 —
  // replace("") 會從第 0 個字插進去)
  const hide = (text: string) => (key ? text.replaceAll(key, MASK) : text);

  const snippets: Record<(typeof TABS)[number]["id"], string> = {
    // 聊天視窗只餵得了一個網址 (帶不了標頭) → 這一格維持 ?key=
    chat: `讀取 ${url}\n這是我的道館現況, 依這份資料規劃道館戰。`,
    // 能自己下指令的工具走標頭: 金鑰不會落在伺服器的存取記錄與瀏覽器歷史裡。
    // 兩種寫法都給 —— Windows PowerShell 的 `curl` 是 Invoke-WebRequest 的別名,
    // 吃不到 -s / -H, 直接參數繫結失敗 (AGENTS: 開發環境是 PowerShell 5.1)。
    // curl.exe 才是真的 curl; macOS / Linux 用第一行。
    code: [
      `curl -sH "Authorization: Bearer ${key ?? ""}" ${endpoint}`,
      `# Windows PowerShell:`,
      `curl.exe -sH "Authorization: Bearer ${key ?? ""}" ${endpoint}`,
    ].join("\n"),
    desktop: JSON.stringify(
      { mcpServers: { "pm-gym": { command: "npx", args: ["-y", "mcp-server-fetch"] } } },
      null,
      2
    ),
  };

  async function rotate() {
    if (!confirm("重設金鑰? 舊的立刻失效。")) return;
    setBusy(true);
    const { data, error } = await createClient().rpc("rotate_my_export_token");
    setBusy(false);
    if (error) {
      toast.error("重設失敗", { description: error.message });
      return;
    }
    setKey(data ?? null);
    setShow(true);
    toast.success("已產生新金鑰");
  }

  return (
    <div className="space-y-5">
      {/* 金鑰 */}
      <div className="flex items-center gap-1.5 rounded-xl border bg-card p-2">
        <code className="min-w-0 flex-1 truncate px-1 font-mono text-xs">
          {show ? url : masked}
        </code>
        <button
          onClick={() => setShow((v) => !v)}
          title={show ? "隱藏" : "顯示"}
          className="rounded-md border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
        <CopyButton text={url} title="複製網址 (金鑰在 ?key=)" />
        <CopyButton
          text={key ?? ""}
          title="只複製金鑰 (放進 Authorization 標頭)"
          icon={<KeyRound className="h-3.5 w-3.5" />}
        />
        <button
          onClick={rotate}
          disabled={busy}
          title="重設金鑰 (舊的立刻失效)"
          className="rounded-md border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* 兩種載體都收 — 標頭不會進存取記錄/瀏覽紀錄, 但不是每個工具都帶得了標頭 */}
      <p className="-mt-3 px-1 text-xs leading-relaxed text-muted-foreground">
        金鑰兩種帶法都通:{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono">
          Authorization: Bearer 金鑰
        </code>{" "}
        標頭 (建議), 或網址的 <code className="rounded bg-muted px-1 py-0.5 font-mono">?key=</code>{" "}
        (工具帶不了標頭時用)。
      </p>

      {/* 這把金鑰讀得到的範圍 = 你的身分 */}
      <div className="flex flex-wrap items-center gap-1.5">
        {gyms.length === 0 ? (
          <span className="text-sm text-muted-foreground">尚未加入任何道館</span>
        ) : (
          gyms.map((g) => (
            <Badge key={g.name} variant="secondary" className="gap-1 font-normal">
              {g.name}
              <span className="text-muted-foreground">{ROLE_LABELS[g.role] ?? g.role}</span>
            </Badge>
          ))
        )}
      </div>

      {/* 三種接法 — 指令本身就是說明 */}
      <div>
        <div className="flex gap-1 border-b">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "border-b-2 px-3 py-2 text-sm transition-colors",
                tab === t.id
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative mt-2">
          <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 pr-16 text-xs leading-relaxed">
            <code>{show ? snippets[tab] : hide(snippets[tab])}</code>
          </pre>
          <div className="absolute right-2 top-2">
            <CopyButton text={snippets[tab]} />
          </div>
        </div>
      </div>

      {/* 回傳結構 — 需要時才展開 */}
      <details className="rounded-xl border bg-card/50">
        <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium">回傳內容</summary>
        <pre className="overflow-x-auto border-t px-4 py-3 text-xs leading-relaxed">
          <code>{`{
  "owner":  { "name": "…" },
  "me":     { "pairs": [{ "name", "type", "role", "star", "potential", "superAwakening", "sixEx" }] },
  "gyms": [{
    "name", "myRole",
    "members":  [{ "name", "role", "availability", "tickets": { "remaining", "cap" }, "candies",
                   "typeFocus": { "want": [], "invested": [] },
                   "pairs": [{ "name", "type", "role", "grade", "superAwakening" }] }],
    "gymPairs": [{ "name", "type" }],
    "teams":    [{ "name", "type", "tag", "note", "pairs": [{ "name", "minGrade" }] }],
    "battle":   { "name", "status", "currentRound",
                  "stages": [{ "seq", "weakType", "logs": [{ "memberId", "round", "role", "ticketsUsed" }] }] }
  }]
}

grade 0-10: 0 = 未持有 ・ 1-5 = 寶1-寶5 ・ 6-10 = 超覺醒1-5
typeFocus: 成員自選的屬性 — want = 想投入資源 ・ invested = 已投入較多 (裝備/等級/潛能)`}</code>
        </pre>
      </details>
    </div>
  );
}
