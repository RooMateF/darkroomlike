import type { BuildingDef, JobDef } from "./types";

// 產出速率沿用 resources.md § 9.1 的基準數值
export const JOBS: JobDef[] = [
  { id: "woodcutter", label: "伐木者", produces: { wood: 2 } },
  { id: "quarrier", label: "採石者", produces: { stone: 1 } },
  { id: "hunter", label: "獵人", produces: { hide: 1, meat: 1 } },
  { id: "farmer", label: "農夫", produces: { grain: 3 }, requiresBuilding: "farm" },
  // 加工型工作:消耗生皮產出皮革(resources.md § 2),原料不足的工人當輪不生產
  { id: "tanner", label: "製革工", produces: { hide: -2, leather: 1 }, requiresBuilding: "tannery" },
  // 燻肉師:生肉+木材燒製成肉乾(肉乾不開放手動打造,只能靠這個職業持續產出)
  // 2026-08 調價:肉乾是奢侈補品不是必需品——生肉 30+木材 30 → 肉乾 2,要吃就得養出像樣的獵肉與柴火產線
  { id: "smoker", label: "燻肉師", produces: { meat: -30, wood: -30, jerky: 2 }, requiresBuilding: "smokehouse" },
  // 探索發現解鎖(design-notes.md § 5.1.1):要先在地圖上打贏礦坑守衛、解放鐵礦坑
  // 重勞動吃肉乾(resources.md § 9.1 的醃肉邏輯):沒肉乾就不下坑
  { id: "miner", label: "鐵礦工", produces: { jerky: -1, iron: 1 }, requiresLandmark: "mine" },
  // 冶金三階(2026-08 擴充):鐵礦 → 鐵 → 鋼鐵
  // 冶煉工:爐火吃木柴、石材當爐襯——3 份鐵礦煉出 1 份鐵
  { id: "smelter", label: "冶煉工", produces: { iron: -3, wood: -10, stone: -5, ingot: 1 }, requiresBuilding: "smithy", requiresLandmark: "mine" },
  // 採煤工:北嶺煤礦坑解放後開放;和鐵礦工一樣吃肉乾
  { id: "coalminer", label: "採煤工", produces: { jerky: -1, coal: 1 }, requiresLandmark: "coalmine" },
  // 煉鋼工:鐵+煤合煉成鋼——本章工業的頂點
  { id: "steelworker", label: "煉鋼工", produces: { ingot: -2, coal: -2, steel: 1 }, requiresBuilding: "smithy", requiresLandmark: "coalmine" },
];

// 建築成本沿用 resources.md § 9.3
export const BUILDINGS: BuildingDef[] = [
  {
    id: "hut",
    label: "小木屋",
    cost: { wood: 15, stone: 10 },
    effect: "人口上限 +4",
    repeatable: true,
    costGrowth: 1.4,
    // 每蓋滿 5 棟,成本額外翻倍一次——壓住人口帶動的產能雪球,中後期擴村是實質的投資決策
    tierEvery: 5,
    tierGrowth: 2,
  },
  // 解鎖新功能的建築要有份量,是需要存一陣子才蓋得起的目標,不是順手就有
  { id: "farm", label: "田", cost: { wood: 120, stone: 60 }, effect: "解鎖「農夫」工作" },
  // 產線解鎖型建築是「存很久才蓋得起」的中期目標,資源門檻千位數起跳
  // 燻製棚:解鎖燻肉師——肉乾是探索救命糧兼礦工伙食,這條產線是中期的重要基建
  { id: "smokehouse", label: "燻製棚", cost: { wood: 1200 }, effect: "解鎖「燻肉師」工作" },
  // 第一次外出探索後浮現(見過外面的世界,才知道獸皮可以鞣製成皮革)
  { id: "tannery", label: "製革場", cost: { wood: 1000, stone: 600, hide: 100 }, effect: "解鎖「製革工」工作", requiresExplore: true },
  // 修理受損武器的地方——出現時機:打通第一座 Lv3 遺跡後(在遺跡裡找到還能用的工具與鐵砧)。
  // 蓋出來時是「工匠鋪」(只能修木/石/皮革類武器);鐵礦坑解放後自動升格為「鐵匠鋪」,才能修鐵製以上的武器
  { id: "smithy", label: "工匠鋪", cost: { wood: 150, stone: 120 }, effect: "可修理受損的武器", requiresSiteLevel: 3 },
  // 交易所:撿過異晶(知道「有人收這種東西」)才浮現;開張後用異晶兌換稀有物資(TRADES)
  { id: "trading-post", label: "交易所", cost: { wood: 1500, stone: 800 }, effect: "用異晶兌換稀有的物資", requiresExplore: true, requiresResourceSeen: "shard" },
  // 火車:本章基建的頂點——沿著鋪好的鐵軌行駛的鋼鐵巨獸;不論放在哪個時期都是巨額工程。
  // 通車後:軌上移動不再消耗水糧;鐵軌通礦坑的礦車運輸再翻倍(×4)
  { id: "train", label: "火車", cost: { wood: 3000, stone: 1500, ingot: 120, steel: 40, coal: 60 }, effect: "沿鐵軌行駛的鋼鐵巨獸:軌上移動不再消耗水與糧;鐵軌通礦坑後,運輸產能再翻倍", requiresLandmark: "coalmine" },
];

// ---- 交易所兌換清單(異晶 → 稀有物資) ----

export interface TradeDef {
  id: string;
  /** 兌換所得(進資源庫存) */
  get: import("./types").ResourceId;
  qty: number;
  /** 花費的異晶數 */
  shards: number;
  /** 一句來歷敘事(show-don't-tell:交易的對象是誰,玩家自己想) */
  flavor: string;
}

export const TRADES: TradeDef[] = [
  { id: "trade-bandage", get: "bandage", qty: 1, shards: 3, flavor: "織得極密的繃帶,這個時代沒有這種織法。" },
  { id: "trade-scroll", get: "scroll", qty: 1, shards: 6, flavor: "紙面溫熱的卷軸,和祭壇裡收著的那兩卷一模一樣。" },
  { id: "trade-elixir", get: "elixir", qty: 1, shards: 10, flavor: "小玻璃瓶裡的透明藥劑,瓶身刻著看不懂的小字。" },
  { id: "trade-salt", get: "salt", qty: 1, shards: 6, flavor: "一小瓶嗆得人流淚的結晶鹽——聞一口,骨頭裡的寒意都會被逼出去。" },
];

/** 這把武器是否屬於鐵製以上(配方吃鐵/鋼)——修理它需要升格後的鐵匠鋪 */
export function isIronTierWeapon(weaponId: string): boolean {
  const weapon = WEAPONS.find((w) => w.id === weaponId);
  return !!weapon && ((weapon.cost.iron ?? 0) > 0 || (weapon.cost.ingot ?? 0) > 0 || (weapon.cost.steel ?? 0) > 0);
}

/** 修理成本:打造成本的一半(向上取整)——受損就修,不修的話耐久會一直帶著 */
export function repairCost(weaponId: string): Partial<Record<import("./types").ResourceId, number>> {
  const weapon = WEAPONS.find((w) => w.id === weaponId);
  if (!weapon) return {};
  const cost: Partial<Record<import("./types").ResourceId, number>> = {};
  for (const [id, n] of Object.entries(weapon.cost)) {
    cost[id as import("./types").ResourceId] = Math.ceil((n ?? 0) / 2);
  }
  return cost;
}

/** 每間小木屋提升的人口上限 */
export const HUT_CAP_BONUS = 4;

// ---- 武器打造(resources.md § 3.0 武器取得曲線:村莊初版只做位階 0–1) ----

export interface WeaponDef {
  id: string;
  label: string;
  cost: Partial<Record<import("./types").ResourceId, number>>;
  /** 對應戰鬥類別(design-notes.md § 2.3.1) */
  category: "melee" | "ranged";
  /** 戰鬥端的排程參數(design-notes.md § 2.4):高位階不只是數值變大,速度也要有差異 */
  baseCost: number;
  damage: number;
  /** 攻擊符號(design-notes.md § 2.7 log 動畫) */
  symbol: string;
  /** 耐久度:每次使用 -1,歸零損壞;帶備用武器出門就有意義了 */
  durability: number;
  /** 彈藥類型(弓矢/子彈);未填 = 不吃彈藥 */
  ammo?: "arrow" | "bullet";
  /** 每次使用消耗的彈藥數(散彈 2 發;傷害與彈數成正比) */
  ammoPerUse?: number;
  /** 占用揹負空間的格數 */
  packSize: number;
  /** 只能從戰利品取得,不開放打造(cost 仍需定義——修理費以打造成本的一半計算) */
  lootOnly?: boolean;
}

// 武器造價提高、耐久拉高:一把武器是「值錢的資產」,死掉全丟——資源管理與惜命要銘記在心。
// 輕重定位(2026-08 定案):重武器 CD 拉長到 2 秒級,傷害給「超額補正」——
// 等待越久代表要多挨敵人幾下,所以重武器的 DPS 要「高於」同位階輕武器,作為風險溢價
// 輕重原則:重武器 CD 長但 DPS 有風險溢價;刀類極速但共用歸零會壓制同帶武器與道具預讀。
// 位階:木/石 → 鐵(冶煉的鐵)→ 鋼(鐵+煤)。槍械只有鋼階才做得出來。
export const WEAPONS: WeaponDef[] = [
  // 位階 0:木製——開局唯一做得出來的武器,快而輕(0.8s/3,DPS 3.8)
  { id: "wood-spear", label: "木槍", cost: { wood: 40 }, category: "melee", baseCost: 0.8, damage: 3, symbol: ">>", durability: 30, packSize: 3 },
  // 位階 1:石製——重攻擊的代表(2.0s/11,DPS 5.5):兩秒的破綻換一記真正的重斬
  { id: "stone-axe", label: "石斧", cost: { wood: 30, stone: 40 }, category: "melee", baseCost: 2.0, damage: 11, symbol: ">>>", durability: 45, packSize: 4 },
  { id: "hunting-bow", label: "獵弓", cost: { wood: 50, hide: 10 }, category: "ranged", baseCost: 1.0, damage: 4, symbol: "→", durability: 40, ammo: "arrow", ammoPerUse: 1, packSize: 3 },
  // ---- 鐵階(冶煉的鐵) ----
  { id: "iron-knife", label: "鐵刀", cost: { ingot: 6, wood: 10 }, category: "melee", baseCost: 0.4, damage: 3, symbol: ">|", durability: 40, packSize: 2 },
  { id: "iron-sword", label: "鐵劍", cost: { ingot: 10, wood: 10 }, category: "melee", baseCost: 1.0, damage: 8, symbol: ">>", durability: 55, packSize: 3 },
  { id: "iron-spear", label: "鐵槍", cost: { ingot: 8, wood: 15 }, category: "melee", baseCost: 1.2, damage: 10, symbol: ">>>", durability: 60, packSize: 4 },
  // 舊時代軍用品:軍規的緊湊設計——鐵階最好的刀(觀測台獎勵;之後可仿製)
  { id: "bayonet", label: "軍用刺刀", cost: { ingot: 8, leather: 5 }, category: "melee", baseCost: 0.4, damage: 4, symbol: ">|", durability: 50, packSize: 2 },
  // ---- 鋼階(鐵+煤合煉) ----
  { id: "steel-knife", label: "鋼刀", cost: { steel: 8, leather: 5 }, category: "melee", baseCost: 0.4, damage: 5, symbol: ">|", durability: 60, packSize: 2 },
  { id: "steel-sword", label: "鋼劍", cost: { steel: 12, wood: 20 }, category: "melee", baseCost: 1.0, damage: 13, symbol: ">>", durability: 70, packSize: 3 },
  { id: "steel-spear", label: "鋼槍", cost: { steel: 14, wood: 30 }, category: "melee", baseCost: 1.2, damage: 17, symbol: ">>>", durability: 80, packSize: 4 },
  // 槍械:鋼階限定。左輪輕快(1 發/擊)、散彈沉重(2 發/擊,單發傷害一致 → 彈數決定傷害)
  { id: "revolver", label: "左輪手槍", cost: { steel: 10, wood: 10 }, category: "ranged", baseCost: 0.6, damage: 8, symbol: "→!", durability: 50, ammo: "bullet", ammoPerUse: 1, packSize: 2 },
  { id: "shotgun", label: "散彈槍", cost: { steel: 14, wood: 20 }, category: "ranged", baseCost: 1.5, damage: 16, symbol: "→!!", durability: 45, ammo: "bullet", ammoPerUse: 2, packSize: 3 },
  // 靜默教堂(Lv5)的戰利品:輕得不可思議(呼應敘事)。lootOnly:cost 只作修理費基準
  { id: "alloy-blade", label: "異質短刃", cost: { steel: 12, leather: 20, scroll: 1 }, category: "melee", baseCost: 0.5, damage: 7, symbol: ">>|", durability: 80, packSize: 2, lootOnly: true },
];

// ---- 消耗品打造(整備出門用) ----

export interface ConsumableDef {
  id: import("./types").ResourceId;
  label: string;
  cost: Partial<Record<import("./types").ResourceId, number>>;
  yield: number;
  /** 需要先蓋出的建築(如繃帶要有製革場) */
  requiresBuilding?: string;
  /** 需要先打造過的武器(如弓矢要先有獵弓才有意義) */
  requiresWeapon?: string;
  /** 持有其中任一把武器即可(如子彈:左輪或散彈) */
  requiresWeaponAny?: string[];
  /** 需要先解放對應地標(如鐵軌要先解放鐵礦坑) */
  requiresLandmark?: string;
  /** 需要先蓋出的建築之外,額外需要的建築(如鐵軌要鐵匠鋪) */
}

// 肉乾不走手動打造——由「燻肉師」職業在燻製棚持續燒製(見 JOBS)
// 繃帶第一章「不可製造」:只能靠探索/戰利品機率拾取(稀有,回復量大)——
// 否則會直接搶走肉乾的補品定位;醫療產線(藥草/繃帶製造)留給後續章節解鎖
export const CONSUMABLES: ConsumableDef[] = [
  // 乾糧同步走高價路線(與弓矢一致的量級):遠征的糧錢是實質開銷,不是零頭
  { id: "ration", label: "乾糧", cost: { grain: 30, wood: 10 }, yield: 2 },
  // 弓矢:遠程輸出的彈藥錢——有感但不至於奢侈(2026-08 定案 30/20)
  { id: "arrow", label: "弓矢", cost: { wood: 30, stone: 20 }, yield: 3, requiresWeapon: "hunting-bow" },
  // 燈油:燻製棚熬獸脂——點亮據點燈柱的燃料(每座燈柱 3 份,壓低周圍的遭遇率)
  { id: "oil", label: "燈油", cost: { meat: 2, wood: 5 }, yield: 1, requiresBuilding: "smokehouse" },
  // 子彈:鋼階彈藥(火藥吃煤)——左輪/散彈通用
  { id: "bullet", label: "子彈", cost: { steel: 2, coal: 2 }, yield: 6, requiresWeaponAny: ["revolver", "shotgun"] },
  // 鐵軌:鋪在遠征地圖上的永久建設——從村莊一格一格連出去;軌上水 1/4 步、糧 1/8 步、不遇敵。
  // 鋪到礦坑旁,礦車自動運輸(鐵礦工產出 ×2)。2 根占 1 格,揹得動多少是推車/小貨車的事
  { id: "rail", label: "鐵軌", cost: { ingot: 1, wood: 5 }, yield: 1, requiresBuilding: "smithy", requiresLandmark: "mine" },
];

// ---- 一次性裝備升級(改變探索/戰鬥的基礎參數) ----

export interface UpgradeDef {
  id: string;
  label: string;
  cost: Partial<Record<import("./types").ResourceId, number>>;
  effect: string;
  requiresBuilding?: string;
  /** 前置升級(如鋼水壺要先有鐵水壺)——升級鏈逐級推進 */
  requiresUpgrade?: string;
}

// 一次性永久升級 = 實質上的「角色升級」:只做一遍的東西,成本就是一個存錢目標,
// 跟產線建築同一個量級的投資感(皮革要先蓋千元級的製革場再由製革工慢慢鞣出來)
export const UPGRADES: UpgradeDef[] = [
  // 呼應探索引擎「水量上限刻意壓低,由水袋升級放寬」的設計
  { id: "waterskin", label: "大水袋", cost: { leather: 100, wood: 1000 }, effect: "外出時能攜帶更多的水", requiresBuilding: "tannery" },
  // 背包:整備容量的關鍵升級——揹負空間 20 → 45,遠征規模翻倍的分水嶺
  { id: "backpack", label: "背包", cost: { leather: 150, wood: 1500 }, effect: "能攜帶更多裝備出門", requiresBuilding: "tannery" },
  // 皮甲:生命上限 +10——體質升級鏈的第一件
  { id: "leather-armor", label: "皮甲", cost: { leather: 200, wood: 2000, stone: 2000 }, effect: "生命上限 +10", requiresBuilding: "tannery" },
  // ---- 鐵階升級(鐵匠鋪) ----
  { id: "iron-flask", label: "鐵水壺", cost: { ingot: 15, leather: 50 }, effect: "水量上限 32 → 40", requiresBuilding: "smithy", requiresUpgrade: "waterskin" },
  { id: "iron-armor", label: "鐵甲", cost: { ingot: 25, leather: 100 }, effect: "生命上限 40 → 50", requiresBuilding: "smithy", requiresUpgrade: "leather-armor" },
  { id: "iron-cart", label: "推車", cost: { ingot: 20, wood: 300, leather: 30 }, effect: "揹負空間 45 → 70(鋪軌工程的運力)", requiresBuilding: "smithy", requiresUpgrade: "backpack" },
  // ---- 鋼階升級(需煤礦解放後的鋼產線) ----
  { id: "steel-flask", label: "鋼水壺", cost: { steel: 12, leather: 50 }, effect: "水量上限 40 → 50", requiresBuilding: "smithy", requiresUpgrade: "iron-flask" },
  { id: "steel-armor", label: "鋼甲", cost: { steel: 20, leather: 120 }, effect: "生命上限 50 → 65", requiresBuilding: "smithy", requiresUpgrade: "iron-armor" },
  { id: "steel-cart", label: "小貨車", cost: { steel: 15, ingot: 10, wood: 300 }, effect: "揹負空間 70 → 100", requiresBuilding: "smithy", requiresUpgrade: "iron-cart" },
];

/** 生命上限:基礎 30,皮甲 +10 */
export const BASE_MAX_HP = 30;
export const LEATHER_ARMOR_HP_BONUS = 10;

/**
 * 揹負空間(統一容量):武器(各有 packSize)、補給品、途中拾獲的戰利品全部共用。
 * 弓矢等彈藥類 3 個併 1 格(ARROWS_PER_SLOT)。
 * 基礎 20 格 ≈ 兩把初級武器 + 撐短程的乾糧就是極限;背包升級後 45 格。
 */
export function carryCapacity(upgrades: Record<string, boolean> | boolean): number {
  // 相容舊呼叫(boolean = 有沒有背包);新呼叫傳整個 upgrades
  if (typeof upgrades === "boolean") return upgrades ? 45 : 20;
  if (upgrades["steel-cart"]) return 100;
  if (upgrades["iron-cart"]) return 70;
  if (upgrades.backpack) return 45;
  return 20;
}

/** 彈藥類幾個併 1 格 */
export const ARROWS_PER_SLOT = 3;
/** 子彈小巧:6 發併 1 格 */
export const BULLETS_PER_SLOT = 6;
/** 鐵軌沉重:2 根併 1 格 */
export const RAILS_PER_SLOT = 2;
/** 被動裝備欄:同時只能讓兩個被動生效——對著 Boss 的機制換裝,而不是全部堆上 */
export const PERK_SLOTS = 2;
/** 乾糧輕便:2 份併 1 格(肉乾重,1 份 1 格) */
export const RATIONS_PER_SLOT = 2;

/** 大水袋升級後的水量上限(未升級 20) */
export const WATERSKIN_CAPACITY = 32;
