import type { Metadata } from "next";
import Link from "next/link";

import { PageHeading, PageShell } from "@/components/page-shell";
import { LEGAL_UPDATED, LegalLink, LegalSection } from "@/components/legal";
import { REPO_ISSUES_URL, REPO_URL, SITE_NAME } from "@/lib/site";

// **這頁必須是公開的** (Google OAuth 審核要求)。理由與 /privacy 相同, 見 components/legal.tsx。
export const metadata: Metadata = {
  title: "服務條款",
  description: `使用 ${SITE_NAME} 的條件與規則。`,
};

export default function TermsPage() {
  return (
    <main className="flex-1">
      <PageShell width="prose">
        <PageHeading title="服務條款" />
        <p className="text-sm text-muted-foreground">最後更新: {LEGAL_UPDATED}</p>

        <div className="mt-6 space-y-6 text-sm leading-relaxed">
          <p>
            歡迎使用 {SITE_NAME}（以下稱「本服務」）。開始使用即表示你同意以下條款。
            如果你不同意，請不要使用本服務。
          </p>

          <LegalSection title="一、本服務是什麼">
            <p>
              本服務是一個給《Pokémon Masters EX》玩家自行記錄拍組練度、並與同一個道館的
              成員共用這些資訊以安排道館戰的工具。
            </p>
            <p>
              <strong>本服務是非官方的第三方工具</strong>，與 The Pokémon Company、
              任天堂、Creatures、GAME FREAK、DeNA 均無關聯，亦未獲其贊助或認可。
              遊戲名稱、角色與圖像之權利均屬其各自所有者。
            </p>
          </LegalSection>

          <LegalSection title="二、帳號">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>需以 Google 帳號登入。你必須有權使用該帳號。</li>
              <li>請勿冒用他人身分，或以他人名義填寫遊戲名稱與社群暱稱。</li>
              <li>你要為自己帳號下的所有活動負責。</li>
              <li>
                分享連結與資料連線金鑰等同於通行憑證，請自行妥善保管；
                外流時請自行重設。
              </li>
            </ul>
          </LegalSection>

          <LegalSection title="三、你放進來的內容">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>你填寫的資料仍然屬於你。</li>
              <li>
                為了讓本服務運作，你同意我們儲存這些資料，並向
                <strong>同一個道館的其他成員</strong>顯示你的遊戲資料
                （練度、素材、出戰紀錄等）。
              </li>
              <li>
                請勿上傳違法、侵害他人權利、或令人不適的內容（包含頭貼圖片）。
              </li>
            </ul>
          </LegalSection>

          <LegalSection title="四、使用規範">
            <p>請勿：</p>
            <ul className="mt-1.5 list-disc space-y-1.5 pl-5">
              <li>嘗試存取不屬於你、也未分享給你的資料</li>
              <li>以自動化方式大量請求，影響其他人正常使用</li>
              <li>干擾、破壞本服務或其所依賴的基礎設施</li>
              <li>將本服務用於任何違法用途</li>
            </ul>
          </LegalSection>

          <LegalSection title="五、服務的可用性">
            <p>
              本服務由個人以業餘方式維運，<strong>不保證不中斷、不出錯，也不保證資料永不遺失</strong>。
              我們可能隨時新增、修改或移除功能，或暫停、終止整個服務。
              重要資料請自行留存備份（「資料連線」頁提供匯出方式）。
            </p>
          </LegalSection>

          <LegalSection title="六、免責">
            <p>
              本服務以「現狀」提供，不提供任何明示或默示的擔保。
              在法律允許的最大範圍內，對於因使用或無法使用本服務而產生的任何損失，
              我們不負賠償責任。
            </p>
          </LegalSection>

          <LegalSection title="七、終止">
            <p>
              你可以隨時停止使用並要求刪除帳號。
              若有違反本條款的情形，我們可以暫停或終止你的使用權限。
            </p>
          </LegalSection>

          <LegalSection title="八、條款變更">
            <p>
              本條款如有修改，會更新本頁最上方的「最後更新」日期。
              修改後繼續使用即視為接受新的條款。
            </p>
          </LegalSection>

          <LegalSection title="九、原始碼與授權">
            <p>
              本服務是開源專案，程式碼公開在
              <LegalLink href={REPO_URL}>GitHub</LegalLink>
              並以 MIT 授權釋出，歡迎提出 issue 或送出 PR
              （送出的貢獻同樣以 MIT 授權釋出）。
            </p>
            <p>
              <strong>MIT 只涵蓋本專案自己的程式碼。</strong>
              遊戲資料與素材（拍組名稱、訓練家立繪、寶可夢圖像等）的權利屬其各自所有者，
              不在該授權範圍內。詳見專案內的 NOTICE 檔案。
            </p>
          </LegalSection>

          <LegalSection title="十、聯絡方式">
            <p>
              對本條款有任何疑問，請到 GitHub 專案
              <LegalLink href={REPO_ISSUES_URL}>開一個 issue</LegalLink>
              與開發者聯繫。issue 是公開的，請不要在內容裡留下個人資料。
            </p>
          </LegalSection>

          <p>
            另請參閱
            <Link href="/privacy" className="mx-1 underline underline-offset-4">
              隱私權政策
            </Link>
            。
          </p>
        </div>
      </PageShell>
    </main>
  );
}
