import { redirect } from "next/navigation";

// 註冊已併入 Google 登入 (第一次登入自動建帳號 + 設定引導)
export default function RegisterPage() {
  redirect("/login");
}
