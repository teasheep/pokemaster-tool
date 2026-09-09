"use client";

// 「你正在改的是別人的資料」防呆 (2026-09-09 使用者回報的成員意見:
// 「管理員還是可以改別人的資料, 但加一層防呆, 請他確認這是修改別人的資料,
//   然後可以加一個今天不再提示的 check」)。
//
// 這不是假設性的問題: 2026-09-09 的變動紀錄裡就有一筆管理員幫成員點左下角,
// 多按了一下把對方的寶5 轉成「未持有」—— 循環到底會歸零, 而那一下沒有任何提示。
//
// 三個設計決定:
//   1. **一位成員只問一次**, 不是每一次寫入都問。左下角的寶數循環是連點的手勢,
//      每點一次跳一個對話框等於把那個功能廢掉。換一個人就會再問一次 —— 那才是重點
//      (「我以為我在改自己的」)。
//   2. **「今天不再提示」記在 localStorage 不是資料庫**: 這是這台裝置上的偏好,
//      不是這個人的設定。日期用台北時區, 跨日自動恢復提示。
//   3. **改自己的資料完全不受影響** —— 一個字都不會多問。
//
// 用法: 在知道「現在在看誰」的那一層建一次 (MembersClient), 把 run 傳給各個面板,
// 兩個面板共用同一份「問過了」的狀態 —— 拍組那邊確認過, 切到資源分頁不會再問一次。

import { useCallback, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

const SKIP_PREFIX = "pm-gym:edit-others-skip:v1:";

/** 台北日期 (YYYY-MM-DD) —— 全站的「今天」都以台北為準 */
function today(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
}

function skippedToday(userId: string): boolean {
  try {
    return window.localStorage.getItem(SKIP_PREFIX + userId) === today();
  } catch {
    // 無痕模式 / 擋了 storage → 當成沒勾, 照樣提示 (寧可多問一次)
    return false;
  }
}

function skipForToday(userId: string) {
  try {
    window.localStorage.setItem(SKIP_PREFIX + userId, today());
  } catch {
    // 記不起來就是明天再問一次, 不影響任何功能
  }
}

export type EditOthersGuard = {
  /** 包住寫入: 需要確認就先跳對話框, 按了確定才真的做 */
  run: (action: () => void) => void;
  /** 放在畫面上 (自己管開關) */
  dialog: React.ReactNode;
};

export function useEditOthersGuard({
  userId,
  memberId,
  memberName,
  isSelf,
}: {
  /** 目前登入者的 auth id —— 「今天不再提示」是跟著人記的 */
  userId: string;
  /** 現在在看誰 (換人就要再確認一次) */
  memberId: string;
  memberName: string;
  isSelf: boolean;
}): EditOthersGuard {
  /** 這一輪已經確認過的成員 (換人自動失效 —— 比對 id 而不是存布林) */
  const [ackedId, setAckedId] = useState<string | null>(null);
  const [pending, setPending] = useState<{ action: () => void } | null>(null);
  const [dontAsk, setDontAsk] = useState(false);

  const run = useCallback(
    (action: () => void) => {
      if (isSelf || ackedId === memberId || skippedToday(userId)) {
        action();
        return;
      }
      // 存成物件包起來: setState 直接吃函式會被當成 updater
      setPending({ action });
    },
    [isSelf, ackedId, memberId, userId]
  );

  const confirm = () => {
    if (dontAsk) skipForToday(userId);
    setAckedId(memberId);
    pending?.action();
    setPending(null);
  };

  const dialog = (
    <AlertDialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>這是別人的資料</AlertDialogTitle>
          <AlertDialogDescription>
            你正在修改 <strong className="font-semibold text-foreground">{memberName}</strong>{" "}
            的資料，不是你自己的。確定要改嗎？
          </AlertDialogDescription>
        </AlertDialogHeader>
        {/* 觸控命中區給整列 (44px), 手機上不用瞄準那個小方塊 */}
        <Label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-normal">
          <Checkbox checked={dontAsk} onCheckedChange={(v) => setDontAsk(v === true)} />
          今天不再提示
        </Label>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={confirm}>確定修改</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { run, dialog };
}
