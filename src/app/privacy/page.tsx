import type { Metadata } from "next";
import Link from "next/link";

import { PageHeading, PageShell } from "@/components/page-shell";
import { LEGAL_UPDATED, LegalLink, LegalSection } from "@/components/legal";
import { REPO_ISSUES_URL, SITE_NAME } from "@/lib/site";

// **這頁必須是公開的**: Google OAuth 審核要求隱私權政策的網址不需登入就打得開。
// 它在 proxy.ts 的 PUBLIC_ROUTES 裡, 也刻意**不**設 NOINDEX ——
// 法遵頁本來就該是公開文件, 與 AGENTS「只有 / 與 /pairs 可被收錄」那條的用意
// (不要讓需要登入或半秘密的內容進索引) 不衝突。
export const metadata: Metadata = {
  title: "隱私權政策",
  description: `${SITE_NAME} 蒐集哪些資料、怎麼用、存在哪裡, 以及你可以怎麼刪除它們。`,
};

export default function PrivacyPage() {
  return (
    <main className="flex-1">
      <PageShell width="prose">
        <PageHeading title="隱私權政策" />
        <p className="text-sm text-muted-foreground">最後更新: {LEGAL_UPDATED}</p>

        <div className="mt-6 space-y-6 text-sm leading-relaxed">
          <p>
            {SITE_NAME}（以下稱「本服務」）是一個給《Pokémon Masters EX》道館成員共用的
            非官方協作工具。這份政策說明本服務蒐集哪些資料、為什麼蒐集、存在哪裡，
            以及你可以怎麼取回或刪除它們。
          </p>

          <LegalSection title="一、我們蒐集哪些資料">
            <p className="font-medium">1. 你的帳號</p>
            <p>
              本服務只提供 Google 登入。登入時我們會從你的 Google 帳號取得
              <strong>電子郵件地址</strong>，用來識別你是誰。我們<strong>不會</strong>
              取得你的 Google 密碼，也不會存取你的 Gmail、雲端硬碟或聯絡人。
            </p>

            <p className="mt-3 font-medium">2. 你自己填的個人資料</p>
            <p>
              遊戲名稱、社群暱稱、頭貼圖片。這些都由你在「個人設定」自行填寫或上傳，
              可以隨時修改或清空。
            </p>

            <p className="mt-3 font-medium">3. 你在本服務裡建立的遊戲資料</p>
            <p>
              拍組的持有狀態與練度（寶數、超覺醒、星數、等級）、糖果等素材的數量、
              想投入資源的屬性、挑戰券數量、道館戰的出戰紀錄，以及你所屬的道館與角色。
            </p>

            <p className="mt-3 font-medium">4. 我們不做的事</p>
            <p>
              本服務<strong>沒有安裝任何分析或追蹤工具</strong>（沒有 Google Analytics、
              沒有廣告像素、沒有第三方 Cookie 追蹤），也<strong>不會</strong>
              為了廣告目的蒐集、分析或販售你的資料。
            </p>
          </LegalSection>

          <LegalSection title="二、這些資料怎麼被使用">
            <p>
              只用於提供本服務本身的功能：讓你記錄自己的練度、讓同一個道館的成員看到
              彼此的持有狀況以便安排道館戰、以及維持登入狀態。沒有其他用途。
            </p>
          </LegalSection>

          <LegalSection title="三、誰看得到你的資料">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                <strong>同道館的成員</strong>：你的遊戲名稱、頭貼、拍組練度、素材數量、
                屬性方向與出戰紀錄，同一個道館的成員看得到。這是本服務的用途本身
                —— 道館戰需要知道誰有哪些拍組。<strong>你的電子郵件地址不會顯示給其他成員。</strong>
              </li>
              <li>
                <strong>你主動分享的人</strong>：你可以自行產生一組分享連結，
                拿到連結的人不需登入就能看到你的收藏。你可以隨時停用它。
              </li>
              <li>
                <strong>你自己產生的資料連線金鑰</strong>：可用於程式化讀取你看得到的資料。
                金鑰等同密碼，請勿外流；你可以隨時重設，舊的立即失效。
                該介面<strong>不會</strong>輸出任何人的電子郵件地址。
              </li>
              <li>
                <strong>我們不會</strong>把你的資料販售、出租或提供給廣告商。
              </li>
            </ul>
          </LegalSection>

          <LegalSection title="四、資料存在哪裡">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                <strong>Supabase</strong>（資料庫、帳號驗證、頭貼儲存）。
                登入狀態以 Cookie 保存在你的瀏覽器。
              </li>
              <li>
                <strong>Cloudflare</strong>（網站主機與網路傳輸）。
              </li>
              <li>
                <strong>Google</strong>（登入驗證）。未登入時，網站會載入 Google 的登入
                元件以提供快速登入提示，這個載入行為本身會讓 Google 得知有人造訪本站。
              </li>
            </ul>
            <p className="mt-3">
              以上服務可能將資料儲存或處理於台灣以外的地區。
            </p>
          </LegalSection>

          <LegalSection title="五、資料保存多久">
            <p>
              帳號存在期間持續保存。你可以隨時要求刪除帳號，我們會刪除你的個人資料
              （帳號、名稱、頭貼）與你建立的遊戲資料。
              已寫入道館共用紀錄的內容（例如出戰紀錄）可能以不含個人識別資訊的形式保留，
              以維持道館歷史紀錄的完整。
            </p>
          </LegalSection>

          <LegalSection title="六、你的權利">
            <p>你可以隨時：</p>
            <ul className="mt-1.5 list-disc space-y-1.5 pl-5">
              <li>在「個人設定」查看與修改你的名稱與頭貼</li>
              <li>在「拍組」與「我的資源」修改或清除你的遊戲資料</li>
              <li>停用分享連結、重設資料連線金鑰</li>
              <li>要求刪除整個帳號（請以下方聯絡方式告知）</li>
            </ul>
          </LegalSection>

          <LegalSection title="七、兒童">
            <p>
              本服務不特別針對兒童設計，也不會刻意蒐集兒童的個人資料。
            </p>
          </LegalSection>

          <LegalSection title="八、政策變更">
            <p>
              本政策如有修改，會更新本頁最上方的「最後更新」日期。重大變更會在服務內另行告知。
            </p>
          </LegalSection>

          <LegalSection title="九、聯絡方式">
            <p>
              本服務是開源專案，由開發者個人維護。對本政策有任何疑問，或要求刪除帳號與資料，
              請到 GitHub 專案
              <LegalLink href={REPO_ISSUES_URL}>開一個 issue</LegalLink>
              與開發者聯繫。
            </p>
            <p>
              <strong>GitHub 的 issue 是公開的</strong>
              ，請不要在內容裡留下個人資料（電子郵件、真實姓名等）。
              只要說明你的需求即可；需要核對身分時，開發者會在該 issue 中說明作法。
            </p>
          </LegalSection>

          <p className="border-t pt-4 text-muted-foreground">
            本服務為非官方的第三方工具，與 The Pokémon Company、任天堂、DeNA
            均無關聯，亦未獲其認可。遊戲名稱與相關圖像之權利均屬其各自所有者。
          </p>

          <p>
            另請參閱
            <Link href="/terms" className="mx-1 underline underline-offset-4">
              服務條款
            </Link>
            。
          </p>
        </div>
      </PageShell>
    </main>
  );
}
