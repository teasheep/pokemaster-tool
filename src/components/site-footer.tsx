import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60 py-6 text-center text-xs text-muted-foreground">
      {/* 致謝擺在版權之上 — 這站是這群人一起用出來的 */}
      <p className="text-foreground/70">
        特別感謝小鳴及跑路的所有成員, 還有麵包坊的所有教練師傅
      </p>
      {/* 隱私權政策與服務條款要**從站上連得到** —— Google OAuth 審核除了要網址,
          也會看它們是不是真的掛在應用程式裡。頁尾在每一頁都有, 是最穩的位置。 */}
      <p className="mt-1.5">
        <Link href="/privacy" className="underline underline-offset-4 hover:text-foreground">
          隱私權政策
        </Link>
        <span className="mx-2">・</span>
        <Link href="/terms" className="underline underline-offset-4 hover:text-foreground">
          服務條款
        </Link>
      </p>
      <p className="mt-1.5">
        © {new Date().getFullYear()} 教練休息室 ・ 非官方第三方工具, 與
        The Pokemon Company / DeNA 無關
      </p>
    </footer>
  );
}
