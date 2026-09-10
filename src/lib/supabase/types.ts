// 此檔可由 `npx supabase gen types typescript --project-id <id>` 自動產生。
// 目前手寫對應我們的 schema, 之後可以替換成生成版本。

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string | null;
          line_name: string | null;
          avatar_url: string | null;
          onboarded_at: string | null;
          /** 個人資料匯出金鑰 (0037) — 給外部 AI 讀「這個人看得到的東西」 */
          export_token: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          display_name?: string | null;
          line_name?: string | null;
          avatar_url?: string | null;
          onboarded_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string | null;
          line_name?: string | null;
          avatar_url?: string | null;
          onboarded_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      // 唯一的使用者收藏表 (string pairId = brybry 11 碼); catalog 由 JSON 提供。
      user_collection: {
        Row: {
          id: string;
          user_id: string;
          pair_id: string;
          owned: boolean;
          level: number;
          promotion: number;
          potential: number;
          super_awakening: number;
          ex_unlocked: boolean;
          sync_grid: number;
          ex_role_unlocked: boolean;
          ex_style_worn: boolean;
          lucky_skills: string[];
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          pair_id: string;
          owned?: boolean;
          level?: number;
          promotion?: number;
          potential?: number;
          super_awakening?: number;
          ex_unlocked?: boolean;
          sync_grid?: number;
          ex_role_unlocked?: boolean;
          ex_style_worn?: boolean;
          lucky_skills?: string[];
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          pair_id?: string;
          owned?: boolean;
          level?: number;
          promotion?: number;
          potential?: number;
          super_awakening?: number;
          ex_unlocked?: boolean;
          sync_grid?: number;
          ex_role_unlocked?: boolean;
          ex_style_worn?: boolean;
          lucky_skills?: string[];
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      shares: {
        Row: {
          token: string;
          user_id: string;
          created_at: string;
          expires_at: string | null;
        };
        Insert: {
          token?: string;
          user_id: string;
          created_at?: string;
          expires_at?: string | null;
        };
        Update: {
          token?: string;
          user_id?: string;
          created_at?: string;
          expires_at?: string | null;
        };
        Relationships: [];
      };
      // ── 道館賽 (0005) ──
      gyms: {
        Row: {
          id: string;
          name: string;
          /** 唯讀匯出金鑰 (0035) — 給外部 AI 讀道館現況; 只有管理員能經 RPC 取得 */
          export_token: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      // 邀請碼 (只有管理員可讀/輪替; 建館時由 trigger 自動建立)
      gym_invites: {
        Row: {
          gym_id: string;
          code: string;
          /** 顧問邀請碼 — 用這組加入 = 唯讀顧問, 不佔 20 人名額 */
          advisor_code: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          gym_id: string;
          code?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          gym_id?: string;
          code?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      gym_members: {
        Row: {
          id: string;
          gym_id: string;
          user_id: string | null;
          display_name: string;
          role: GymMemberRole;
          line_name: string | null;
          availability: string | null;
          avatar_url: string | null;
          /** 頭像圓圈的自訂文字 (0062, 1-3 字; null = 從社群名取字) */
          badge_text: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          user_id?: string | null;
          display_name: string;
          role?: GymMemberRole;
          line_name?: string | null;
          availability?: string | null;
          avatar_url?: string | null;
          badge_text?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          gym_id?: string;
          user_id?: string | null;
          display_name?: string;
          role?: GymMemberRole;
          line_name?: string | null;
          availability?: string | null;
          avatar_url?: string | null;
          badge_text?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      member_pairs: {
        Row: {
          id: string;
          gym_id: string;
          member_id: string;
          pair_label: string;
          pair_id: string | null;
          grade: number;
          super_awakening: number;
          level: number;
          promotion: number | null;
          sync_grid: number | null;
          ex_role_unlocked: boolean | null;
          ex_style_worn: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          member_id: string;
          pair_label: string;
          pair_id?: string | null;
          grade?: number;
          super_awakening?: number;
          level?: number;
          promotion?: number | null;
          sync_grid?: number | null;
          ex_role_unlocked?: boolean | null;
          ex_style_worn?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          gym_id?: string;
          member_id?: string;
          pair_label?: string;
          pair_id?: string | null;
          grade?: number;
          super_awakening?: number;
          level?: number;
          promotion?: number | null;
          sync_grid?: number | null;
          ex_role_unlocked?: boolean | null;
          ex_style_worn?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      /** 全站變化紀錄 (DB trigger 寫入; 管理員看全館, 成員看自己) */
      gym_activity: {
        Row: {
          id: string;
          gym_id: string;
          member_id: string | null;
          actor_id: string | null;
          kind: string;
          target: string | null;
          /** 拍組紀錄的 pair_id (顯示卡片縮圖用) */
          target_id: string | null;
          old_value: string | null;
          new_value: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };



      // status / current_round 已 drop (0047) — 狀態由賽期日期推導, 目前輪由 battle_logs 最大輪推導
      gym_battles: {
        Row: {
          id: string;
          gym_id: string;
          name: string;
          starts_on: string | null;
          ends_on: string | null;
          summary: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          name: string;
          starts_on?: string | null;
          ends_on?: string | null;
          summary?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          gym_id?: string;
          name?: string;
          starts_on?: string | null;
          ends_on?: string | null;
          summary?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      battle_stages: {
        Row: {
          id: string;
          gym_id: string;
          battle_id: string;
          seq: number;
          weak_type: SyncPairType;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          battle_id: string;
          seq: number;
          weak_type: SyncPairType;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          gym_id?: string;
          battle_id?: string;
          seq?: number;
          weak_type?: SyncPairType;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      // 挑戰隊伍庫 (0010): 每屬性 3-5 套隊伍, 每套 3 拍組 + 要求寶數
      gym_teams: {
        Row: {
          id: string;
          gym_id: string;
          type: SyncPairType;
          name: string;
          tag: TeamTag;
          note: string | null;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          type: SyncPairType;
          name: string;
          tag?: TeamTag;
          note?: string | null;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          gym_id?: string;
          type?: SyncPairType;
          name?: string;
          tag?: TeamTag;
          note?: string | null;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      gym_team_pairs: {
        Row: {
          id: string;
          team_id: string;
          gym_id: string;
          slot: number;
          pair_id: string;
          min_grade: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          team_id: string;
          gym_id: string;
          slot: number;
          pair_id: string;
          min_grade?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          team_id?: string;
          gym_id?: string;
          slot?: number;
          pair_id?: string;
          min_grade?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      // 成員糖果庫存 (0015): universal=黃糖, 其餘 18 屬性糖
      member_candies: {
        Row: {
          id: string;
          gym_id: string;
          member_id: string;
          candy_type: string;
          count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          member_id: string;
          candy_type: string;
          count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          gym_id?: string;
          member_id?: string;
          candy_type?: string;
          count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      // 成員的屬性資源方向 (0056): kind = want (想投入) / invested (已投入較多)
      // 只有「有這一列 / 沒這一列」兩種狀態 → 沒有 Update (切換 = insert 或 delete)
      member_type_focus: {
        Row: {
          id: string;
          gym_id: string;
          member_id: string;
          kind: string;
          type: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          member_id: string;
          kind: string;
          type: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          gym_id?: string;
          member_id?: string;
          kind?: string;
          type?: string;
          created_at?: string;
        };
        Relationships: [];
      };

      // 攻略庫 (0012): 打法筆記共筆
      gym_guides: {
        Row: {
          id: string;
          gym_id: string;
          type: SyncPairType | null;
          title: string;
          content: string;
          created_by: string | null;
          author_name: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          type?: SyncPairType | null;
          title: string;
          content?: string;
          created_by?: string | null;
          author_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          gym_id?: string;
          type?: SyncPairType | null;
          title?: string;
          content?: string;
          created_by?: string | null;
          author_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      // 關卡 ↔ 隊伍 (0011): 一關可綁多套隊伍 (降抗/物攻/特攻/收尾各一套…)
      stage_teams: {
        Row: {
          id: string;
          gym_id: string;
          battle_id: string;
          stage_id: string;
          team_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          battle_id: string;
          stage_id: string;
          team_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          gym_id?: string;
          battle_id?: string;
          stage_id?: string;
          team_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      // 道館拍組庫 (0008): ★ 名單 (該屬性建議練的拍組)
      gym_pairs: {
        Row: {
          id: string;
          gym_id: string;
          pair_label: string;
          pair_id: string | null;
          type: SyncPairType;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          pair_label: string;
          pair_id?: string | null;
          type: SyncPairType;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          gym_id?: string;
          pair_label?: string;
          pair_id?: string | null;
          type?: SyncPairType;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      // 戰鬥紀錄 (0006): 每場出戰回報, 剩餘券與分數統計的資料源
      // (round_label / notes 已 drop, 0047 — 輪次標籤一律 roundLabel(round) 派生)
      battle_logs: {
        Row: {
          id: string;
          gym_id: string;
          battle_id: string;
          member_id: string;
          stage_id: string | null;
          role: BattleLogRole;
          tickets_used: number;
          round: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          battle_id: string;
          member_id: string;
          stage_id?: string | null;
          role?: BattleLogRole;
          tickets_used?: number;
          round?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          gym_id?: string;
          battle_id?: string;
          member_id?: string;
          stage_id?: string | null;
          role?: BattleLogRole;
          tickets_used?: number;
          round?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      /** 每關每輪一句敘述 (0044) — 管理員可編, 全館可讀 */
      stage_round_notes: {
        Row: {
          id: string;
          gym_id: string;
          battle_id: string;
          stage_id: string;
          round: number;
          note: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          battle_id: string;
          stage_id: string;
          round: number;
          note: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          gym_id?: string;
          battle_id?: string;
          stage_id?: string;
          round?: number;
          note?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      member_tickets: {
        Row: {
          id: string;
          gym_id: string;
          battle_id: string;
          member_id: string;
          remaining: number;
          cap: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          gym_id: string;
          battle_id: string;
          member_id: string;
          remaining?: number;
          cap?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          gym_id?: string;
          battle_id?: string;
          member_id?: string;
          remaining?: number;
          cap?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      get_shared_collection: {
        Args: { p_token: string };
        Returns: {
          pair_id: string;
          owned: boolean;
          level: number;
          promotion: number;
          potential: number;
          super_awakening: number;
          ex_unlocked: boolean;
          sync_grid: number;
          ex_role_unlocked: boolean;
        }[];
      };
      /** 分享頁的公開擁有者資訊 (RLS 讀不到 profiles, 走 security definer) */
      get_share_meta: {
        Args: { p_token: string };
        Returns: {
          display_name: string;
          avatar_url: string | null;
          created_at: string;
          expires_at: string | null;
        }[];
      };
      /**
       * 加入道館 — 只要邀請碼/顧問碼, 名字取自 profiles (0040)。
       * 0061 起回 `{ gym_id }` 或 `{ error }` (jsonb): 試碼要記錄失敗, 而丟例外會讓
       * 那筆紀錄跟著交易一起回滾。判讀一律走 `lib/gym/gym-rpc.ts` 的 readGymRpc ——
       * 它同時吃得下舊版的 uuid 字串 (部署與 migration 之間那幾分鐘)。
       */
      join_gym: {
        Args: { p_code: string };
        Returns: Json;
      };
      /**
       * 建立道館 — 原子地認領建館碼 + 建道館 + 自己成為管理員 (0041 / 0060)。
       * `p_code` 是一次性的建館碼 (封測, 作者發)。回傳形狀同 join_gym。
       */
      create_gym: {
        Args: { p_name: string; p_code: string };
        Returns: Json;
      };
      /** 個人資料匯出金鑰 (0037) — 跟著人走, 不跟道館走 */
      get_my_export_token: { Args: Record<string, never>; Returns: string };
      rotate_my_export_token: { Args: Record<string, never>; Returns: string };
      /** 券數增減 — p_delta 調剩餘, p_cap_delta 調上限 (0043); row 不存在以 30/30 建立 */
      adjust_member_ticket: {
        Args: {
          p_gym: string;
          p_battle: string;
          p_member: string;
          p_delta?: number;
          p_cap_delta?: number;
        };
        Returns: number;
      };
      /**
       * 成員拍組寶數的唯一寫入路徑 (0030) — 成員自己或該館管理員可呼叫。
       * 已綁定帳號的成員會一併更新他的 user_collection, 避免單向同步互相蓋掉。
       */
      set_member_pair: {
        Args: {
          p_member: string;
          p_pair_id: string | null;
          p_pair_label: string;
          p_potential: number;
          p_super_awakening: number;
          /** null = 不要動等級 (0058) */
          p_level?: number | null;
        };
        Returns: undefined;
      };
    };
    Enums: {
      sync_pair_type: SyncPairType;
      sync_pair_role: SyncPairRole;
    };
  };
};

export type SyncPairType =
  | "normal"
  | "fire"
  | "water"
  | "electric"
  | "grass"
  | "ice"
  | "fighting"
  | "poison"
  | "ground"
  | "flying"
  | "psychic"
  | "bug"
  | "rock"
  | "ghost"
  | "dragon"
  | "dark"
  | "steel"
  | "fairy";

export type SyncPairRole = "strike" | "tech" | "support" | "field" | "sprint" | "multi";

// ── 道館賽 (0005) 的欄位 union — 對應 SQL check constraints ──
/** advisor = 顧問 (唯讀觀察者, 不佔 20 人名額) */
export type GymMemberRole = "admin" | "member" | "advisor";
export type AttackCategory = "physical" | "special";
/** 由賽期日期推導 (battleStatusFromDates), 不是 DB 欄位 (0047 drop) */
export type BattleStatus = "planning" | "active" | "finished";
export type BattleLogRole = "main" | "assist" | "debuff";
export type TeamTag = "debuff" | "physical" | "special" | "closer";
