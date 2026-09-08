// 法遵頁 (隱私權政策 / 服務條款) 共用的小東西。
//
// 這兩頁是 Google OAuth 審核要求的（要有公開、不需登入就打得開的隱私權政策與服務條款網址），
// 所以它們在 proxy.ts 的 PUBLIC_ROUTES 裡, 而且**不設 NOINDEX** —— 法遵頁本來就是公開文件。
//
// 「最後更新」的日期兩頁共用一份, 免得改了一頁忘了另一頁。**改內容時記得把它一起改**。

/** 兩頁共用的「最後更新」日期 */
export const LEGAL_UPDATED = "2026-09-08";

export function LegalSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-2 text-base font-semibold">{title}</h2>
      <div className="space-y-2 text-muted-foreground">{children}</div>
    </section>
  );
}
