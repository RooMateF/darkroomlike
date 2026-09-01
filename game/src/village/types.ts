// 對應 resources.md § 1、§ 9.1、§ 9.3(初版只用原始採集資源,加工/科技留待之後擴充)

export type ResourceId =
  | "wood"
  | "stone"
  | "hide"
  | "leather"
  | "meat"
  | "grain"
  | "water"
  | "ration"
  | "jerky"
  | "bandage"
  | "arrow"
  | "iron"
  | "ingot"
  | "coal"
  | "steel"
  | "bullet"
  | "rail"
  | "salt"
  | "scroll"
  | "shard"
  | "oil"
  | "elixir"
  | "bigshard";

export const RESOURCE_LABEL: Record<ResourceId, string> = {
  wood: "木材",
  stone: "石材",
  hide: "生皮",
  leather: "皮革",
  meat: "生肉",
  grain: "穀物",
  water: "水",
  ration: "乾糧",
  jerky: "肉乾",
  bandage: "繃帶",
  arrow: "弓矢",
  iron: "鐵礦",
  // 冶金三階:鐵礦(礦坑產)→ 鐵(冶煉,吃木石)→ 鋼鐵(鐵+煤合煉)
  ingot: "鐵",
  coal: "煤礦",
  steel: "鋼鐵",
  // 槍械通用彈藥(左輪 1 發/擊,散彈 2 發/擊;每發傷害一致)
  bullet: "子彈",
  // 鐵軌:鋪設在遠征地圖上的永久建設(從村莊連出去;軌上省水糧、不遇敵)
  rail: "鐵軌",
  // 交易所兌換的反制道具:解除暈眩/遲緩並給予短暫免疫——對付會控制的 Boss 的針對性答案
  salt: "醒神鹽",
  scroll: "火焰卷軸",
  // 從汙染沾身的生物傷口裡挖出來的半透明晶體:無法自行加工,是交易所的硬通貨(resources.md § 9.4)
  shard: "異晶",
  // 燻製棚熬出的獸脂燈油:遠征時點亮據點燈柱的燃料(點燈壓遇敵)
  oil: "燈油",
  // 交易所換來的舊時代藥劑:戰鬥中飲用,大量回復並解除所有異常——來歷不明,效果驚人
  elixir: "舊時代藥劑",
  // 拳頭大的完整異晶(拾荒的長手的收藏核心):占 5 格,帶回村自動拆解成 50 顆異晶
  bigshard: "大異晶",
};

export interface JobDef {
  id: string;
  label: string;
  /**
   * 每個生產週期、每位工人的產出(resources.md § 9.1)。
   * 負值代表「消耗」——加工型工作(如製革工:生皮 -2 → 皮革 +1),原料不足的工人當輪不生產。
   */
  produces: Partial<Record<ResourceId, number>>;
  /** 是否需要先蓋出對應建築才能指派(design-notes.md § 5.1.1 簡化版:用建築取代「探索發現」) */
  requiresBuilding?: string;
  /** 需要先解放對應地標(如鐵礦坑)才能指派——真正的「探索發現解鎖」(design-notes.md § 5.1.1) */
  requiresLandmark?: string;
}

export interface BuildingDef {
  id: string;
  label: string;
  cost: Partial<Record<ResourceId, number>>;
  /** 蓋好後的效果描述,純顯示用 */
  effect: string;
  /** 可重複建造(如小木屋,每蓋一間就再提升人口上限) */
  repeatable?: boolean;
  /** 每多蓋一間,成本乘上這個倍率(避免無限灌房子太廉價) */
  costGrowth?: number;
  /** 每蓋滿這個數量,成本額外再乘一次 tierGrowth(級距跳升,壓住人口/產能雪球) */
  tierEvery?: number;
  tierGrowth?: number;
  /** 需要玩家至少外出探索過一次才會浮現(design-notes.md § 5.1.1:探索發現優先於研究解鎖) */
  requiresExplore?: boolean;
  /** 需要至少打通一座該等級的探勘地點才浮現(如鐵匠鋪要先打通 Lv3 遺跡) */
  requiresSiteLevel?: number;
  /** 需要先解放對應地標才浮現(如鐵道要先解放鐵礦坑) */
  requiresLandmark?: string;
  /** 需要先「見過」某種資源才浮現(如交易所要先撿過異晶,才知道有人收這東西) */
  requiresResourceSeen?: ResourceId;
}
