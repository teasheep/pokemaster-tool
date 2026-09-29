"use client";

// 卡牆的「顯示」多選下拉 —— 讓使用者自己決定卡片下方要多顯示哪些資訊
// (2026-09-29 使用者:「在顯示的地方加一個多選下拉選單, 讓使用者自己決定要顯示哪些東西」)。
// 按鈕就兩個字加一個數字, 跟排序 / 篩選同一排、同一個尺寸 (不要在旁邊再掛說明)。

import { Eye } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CARD_INFO_KEYS, CARD_INFO_LABELS, type CardInfoKey } from "@/lib/pairs/potentials";

export function CardInfoSelect({
  value,
  onChange,
}: {
  value: CardInfoKey[];
  onChange: (next: CardInfoKey[]) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-1.5">
          <Eye className="h-4 w-4" />
          顯示
          {value.length ? <span className="tabular-nums text-muted-foreground">{value.length}</span> : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {CARD_INFO_KEYS.map((k) => (
          <DropdownMenuCheckboxItem
            key={k}
            checked={value.includes(k)}
            // 勾完不要關掉選單 —— 這是多選, 一次勾好幾個是常態
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={(on) =>
              onChange(CARD_INFO_KEYS.filter((x) => (x === k ? on : value.includes(x))))
            }
            className="pointer-coarse:min-h-11"
          >
            {CARD_INFO_LABELS[k]}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
