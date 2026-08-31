// 對應 design-notes.md 第 2 章的核心資料模型

export const BASE_INTERVAL = 1; // 秒,對應「己方速度1 = 每秒一次行動」的基準

export interface SubAction {
  id: string;
  label: string;
  /** 以 BASE_INTERVAL 為單位的基礎花費,見 design-notes.md § 2.4 */
  baseCost: number;
  /** 攻擊符號動畫用,見 § 2.7 */
  symbol: string;
  damage: number;
  /** 回復量(道具類:繃帶/乾糧) */
  heal?: number;
}

export type CategoryId = "melee" | "ranged" | "magic" | "item";

export interface CategoryDef {
  id: CategoryId;
  label: string;
  subActions: SubAction[];
}

export type StatusKind = "poison" | "bleed";

export interface EnemyMove {
  id: string;
  label: string;
  baseCost: number;
  symbol: string;
  damage: number;
  /** 命中時疊加異常值(design-notes.md § 2.11.2 累積制,非機率制) */
  status?: { kind: StatusKind; amount: number };
  /** 控制效果:命中時暈眩(行動條凍結)或遲緩(充能減半)數秒 */
  control?: { kind: "stun" | "slow"; duration: number };
  /** 蓄力描寫:敵人開始準備這一招時的一句敘述(「牠抬起了手」)——招式不取名,用動作預告 */
  tell?: string;
}
