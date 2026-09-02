export function SiteFooter() {
  return (
    <footer className="border-t border-border/60 py-6 text-center text-xs text-muted-foreground">
      {/* 致謝擺在版權之上 — 這站是這群人一起用出來的 */}
      <p className="text-foreground/70">
        特別感謝小鳴及跑路的所有成員, 還有麵包坊的所有教練師傅
      </p>
      <p className="mt-1.5">
        © {new Date().getFullYear()} 教練休息室 ・ 非官方第三方工具, 與
        The Pokemon Company / DeNA 無關
      </p>
    </footer>
  );
}
