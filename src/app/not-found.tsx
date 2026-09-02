import Link from "next/link";

// 找不到頁面時的 404 UI (Server Component)
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="text-5xl font-bold tracking-tight text-muted-foreground">
        404
      </p>
      <h2 className="text-xl font-semibold">找不到頁面</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        你要找的頁面不存在, 或是已經被移除了。
      </p>
      <Link
        href="/"
        className="text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        回首頁
      </Link>
    </div>
  );
}
