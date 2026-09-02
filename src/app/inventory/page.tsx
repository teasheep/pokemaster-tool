import { redirect } from "next/navigation";

// 「我的拍組」已併入 /pairs — 保留舊網址轉導 (別人的持有改看道館成員頁, 不再吃 ?member=)
export default function InventoryRedirect() {
  redirect("/pairs?tab=mine");
}
