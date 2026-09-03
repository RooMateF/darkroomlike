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
  /** 名刀鬼雪:命中疊加敵方凍結值(Boss 抗性減半) */
  freeze?: number;
  /** 重武器(斧/大劍):命中疊加敵方踉蹌值——design-notes §2.11 的「重擊→眩暈」,2026-09 實裝 */
  stagger?: number;
  /** 槍械彈匣容量(2026-09 定案:單位=子彈):每擊扣 ammoPerUse,扣光→該行動變「換彈」 */
  magazine?: number;
  /** 每擊消耗彈數(彈匣扣帳用;實際庫存扣帳在戰鬥頁) */
  ammoPerUse?: number;
  /** 霰彈(2026-09 用戶定案):每擊射出這麼多顆彈丸,各自命中隨機一隻活敵——damage 是單顆彈丸傷害 */
  pellets?: number;
  /** 全體(2026-09 用戶定案):對所有活敵造成同等傷害——法術大多屬此類(火焰卷軸=標準全體) */
  aoe?: boolean;
  /** 連發(自動步槍):每擊對「目前目標」連打 N 發,damage=單發傷害;目標倒了剩餘子彈掃向下一隻 */
  burst?: number;
  /** 連發各發傷害(2026-09:自動步槍 6/5/5——後座力遞減);缺項用 damage 補 */
  burstDamages?: number[];
  /** 換彈充能秒數(搭配 magazine) */
  reloadCost?: number;
  /** 道具類:強力道具用完後,下一輪道具回轉拖長為這個秒數(預設 1s;2026-09 用戶定案) */
  slowReuse?: number;
  /** 連斬(劍類,2026-09 用戶定案):同一把連續出手,每多一擊傷害 +perStack(比例),最多疊 max;
   * 中間插入任何別的行動(換武器/道具/舉盾/換彈)就斷 */
  combo?: { perStack: number; max: number };
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
  /** 混亂值(哼歌類敵人):累積滿 100,下一個充能完成的行動被隨機執行 */
  confusion?: number;
  /** 蓄力描寫:敵人開始準備這一招時的一句敘述(「牠抬起了手」)——招式不取名,用動作預告 */
  tell?: string;
  /** 大招(2026-09):完美格擋這一招才觸發 3 秒硬直;小招的前搖只是異常/控制預警 */
  heavy?: boolean;
  /** 迷宮觸手:命中偷走一件裝備(偷竊本體由戰鬥頁執行,每場只偷一次) */
  steal?: boolean;
  /** 穿盾(教堂百手壓下):普通格擋的減傷上限壓到 50%,只有完全格擋能無傷 */
  pierceBlock?: boolean;
}
