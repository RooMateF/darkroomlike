import type { BuildingDef, JobDef } from "./types";

// 產出速率沿用 resources.md § 9.1 的基準數值
export const JOBS: JobDef[] = [
  { id: "woodcutter", label: "伐木者", produces: { wood: 2 } },
  { id: "quarrier", label: "採石者", produces: { stone: 1 } },
  { id: "hunter", label: "獵人", produces: { hide: 1, meat: 1 } },
  { id: "farmer", label: "農夫", produces: { grain: 3 }, requiresBuilding: "farm" },
  // 加工型工作:消耗生皮產出皮革(resources.md § 2),原料不足的工人當輪不生產
  { id: "tanner", label: "製革工", produces: { hide: -10, leather: 1 }, requiresBuilding: "tannery" },
  // 燻肉師:生肉+木材燒製成肉乾(肉乾不開放手動打造,只能靠這個職業持續產出)
  // 2026-08 調價:肉乾是奢侈補品不是必需品——生肉 30+木材 30 → 肉乾 2,要吃就得養出像樣的獵肉與柴火產線
  { id: "smoker", label: "燻肉師", produces: { meat: -5, wood: -5, jerky: 1 }, requiresBuilding: "smokehouse" }, // 2026-09 用戶定案:15/15→5/5
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
    costGrowth: 1.25, // 2026-09 用戶反饋級距太大:1.4→1.3→1.25(人口另有天花板,曲線不必靠陡峭封頂)
    // 每蓋滿 5 棟,成本額外翻倍一次——壓住人口帶動的產能雪球,中後期擴村是實質的投資決策
    tierEvery: 5,
    tierGrowth: 1.4, // 同上:每滿 5 棟 ×2→×1.5→×1.4
  },
  // 解鎖新功能的建築要有份量,是需要存一陣子才蓋得起的目標,不是順手就有
  { id: "farm", label: "田", cost: { wood: 120, stone: 60 }, effect: "解鎖「農夫」工作" },
  // 產線解鎖型建築是「存很久才蓋得起」的中期目標,資源門檻千位數起跳
  // 燻製棚:解鎖燻肉師——肉乾是探索救命糧兼礦工伙食,這條產線是中期的重要基建
  { id: "smokehouse", label: "燻製棚", cost: { wood: 1200 }, effect: "解鎖「燻肉師」工作" },
  // 第一次外出探索後浮現(見過外面的世界,才知道獸皮可以鞣製成皮革)
  { id: "tannery", label: "製革場", cost: { wood: 1000, stone: 600, hide: 100 }, effect: "解鎖「製革工」工作", requiresExplore: true },
  // 修理受損武器的地方——出現時機:打通第一座 Lv3 遺跡後(在遺跡裡找到還能用的工具與鐵砧)。
  // 蓋出來時是「工匠鋪」(只能修木/石/皮革類武器);鐵礦坑解放後可花材料升格為「鐵匠鋪」,才能修鐵製以上的武器
  { id: "smithy", label: "工匠鋪", cost: { wood: 1500, stone: 1200 }, effect: "可修理受損的武器", requiresSiteLevel: 3 }, // 2026-09 用戶定案:×10,對齊產線建築的千位數門檻
  // 交易所:撿過異晶(知道「有人收這種東西」)才浮現;開張後用異晶兌換稀有物資(TRADES)
  { id: "trading-post", label: "交易所", cost: { wood: 1500, stone: 800 }, effect: "用異晶兌換稀有的物資", requiresExplore: true, requiresResourceSeen: "shard" },
  // (火車建築 2026-09 用戶定案移除:鐵軌連通礦坑即直接 ×4,不必另外造車)
];

// 工匠鋪→鐵匠鋪升格費(2026-09 用戶定案:礦坑解放後不再免費自動升格):
// 爐膛與鐵砧要換成吃得動鐵的規格——鐵礦正是剛解放的礦坑產出,升格本身就是第一張鐵礦訂單
export const SMITHY_IRON_UPGRADE_COST: Partial<Record<import("./types").ResourceId, number>> = { wood: 4000, stone: 3000, iron: 80 }; // 2026-09 用戶定案:木石×10

// ---- 交易所兌換清單(異晶 → 稀有物資) ----

export interface TradeDef {
  id: string;
  /** 兌換所得(進資源庫存);永久改造品(grantModification)不填 */
  get?: import("./types").ResourceId;
  qty?: number;
  /** 兌換即飲下的永久改造(一次性商品,喝了就是永久);顯示名稱用 label */
  grantModification?: string;
  label?: string;
  /** 花費的異晶數 */
  shards: number;
  /** 一句來歷敘事(show-don't-tell:交易的對象是誰,玩家自己想) */
  flavor: string;
  /** 冰冷的系統效果(2026-09 用戶定案:主觀描述與數據分行)——沒有的品項不顯示 */
  effect?: string;
  /** 見過這種資源才上架(撿過/打過掉落)——沒見過的東西攤子上不會擺 */
  requiresResourceSeen?: import("./types").ResourceId;
  /** 熟客門檻:累積交易滿 N 次,買家才亮出這件私貨(交易所獨賣品的解鎖路徑) */
  minTrades?: number;
  /** 遠征門檻:出門超過 N 次才悄然上架(不提示,自己發現) */
  minExpeditions?: number;
}

export const TRADES: TradeDef[] = [
  { id: "trade-bandage", get: "bandage", qty: 1, shards: 3, flavor: "織得極密的繃帶,這個時代製造不出這種材料。", effect: "戰鬥道具:回復 20 HP,解除流血。", requiresResourceSeen: "bandage" },
  { id: "trade-scroll", get: "scroll", qty: 1, shards: 6, flavor: "封印著未知力量的卷軸,邊角有燒灼過的痕跡。", effect: "戰鬥道具(一次性):對場上所有敵人各造成 12 傷害。", requiresResourceSeen: "scroll" },
  // 交易所獨賣品:攤子上一開始看不到——交易熟了,買家才從行囊深處拿出來
  { id: "trade-salt", get: "salt", qty: 1, shards: 6, flavor: "一小瓶嗆得人流淚的結晶鹽——聞一口,骨頭裡的寒意都會被逼出去。", effect: "戰鬥道具:解除暈眩/遲緩/混亂,之後 6 秒內免疫這些效果;亦可於敵方蓄力時預先使用。", minTrades: 2 },
  { id: "trade-elixir", get: "elixir", qty: 1, shards: 10, flavor: "小玻璃瓶裡的透明藥劑,瓶身刻著看不懂的小字。", effect: "戰鬥道具:回復 15 HP,解除中毒與流血。", minTrades: 4 },
  // 基礎物資(用異晶換大宗):對方對「石頭」的行情好得出奇
  { id: "trade-wood", get: "wood", qty: 120, shards: 2, flavor: "一捆捆切得整整齊齊的木料,斷口平滑得像用什麼燙過。", requiresResourceSeen: "wood" },
  { id: "trade-stone", get: "stone", qty: 80, shards: 2, flavor: "方正得過分的石塊,每一塊的重量幾乎一模一樣。", requiresResourceSeen: "stone" },
  // 加工品(2026-09 用戶定案):木石以外的大宗直接賣加工過的——生肉/生皮/鐵礦原料改走以物易物
  { id: "trade-ingot", get: "ingot", qty: 10, shards: 3, flavor: "打得方正的鐵條,一根根疊得整齊,邊角連毛刺都沒有。", requiresResourceSeen: "ingot" },
  { id: "trade-leather", get: "leather", qty: 10, shards: 2, flavor: "鞣得極軟的皮革,對摺再對摺也不見一道裂紋。", requiresResourceSeen: "leather" },
  { id: "trade-jerky", get: "jerky", qty: 10, shards: 2, flavor: "燻得透的肉乾,油紙一打開就是一股火塘的味道。", requiresResourceSeen: "jerky" },
  // 改造藥劑(2026-09 用戶定案):一次性的身體改造,喝了就是永久——只有一瓶,買走就沒了
  {
    id: "trade-crisis-awareness",
    label: "改造藥劑-危機意識",
    shards: 50,
    grantModification: "crisis-awareness",
    minExpeditions: 15,
    flavor: "一小瓶綠得發亮的藥劑,瓶塞用蠟封得嚴嚴實實。買家比劃了半天,你只看懂一件事:只有這一瓶。",
    effect: "永久改造:每場戰鬥開場的第一次充能,全部行動條速度 ×2;放出任一行動後恢復正常。",
  },
];

// ---- 以物易物(2026-09 用戶定案):原物料之間 100 換 1(原 20 太強),見過的原料才能上桌 ----
export const BARTER_RATE = 100;
export const BARTER_RAW: import("./types").ResourceId[] = ["wood", "stone", "meat", "hide", "grain", "iron", "coal"];

/** 這把武器是否屬於鐵製以上(配方吃鐵/鋼)——修理它需要升格後的鐵匠鋪 */
export function isIronTierWeapon(weaponId: string): boolean {
  const weapon = WEAPONS.find((w) => w.id === weaponId);
  return !!weapon && ((weapon.cost.iron ?? 0) > 0 || (weapon.cost.ingot ?? 0) > 0 || (weapon.cost.steel ?? 0) > 0);
}

/** 修理一律吃皮革(2026-09 用戶定案):每次修理的皮革下限——配方本身沒皮革的(木槍/石斧/弓/木盾)也要用上 */
export const REPAIR_LEATHER_MIN = 10;

/** 修理成本(2026-09 用戶定案:按缺損比例計費):打造成本 × 缺損耐久比例(向上取整),
 * 皮革另有下限 REPAIR_LEATHER_MIN——掉兩成耐久就付兩成的料,快壞了才修就接近重打一把 */
export function repairCost(weaponId: string, missingFrac = 1): Partial<Record<import("./types").ResourceId, number>> {
  const weapon = WEAPONS.find((w) => w.id === weaponId);
  if (!weapon) return {};
  const frac = Math.min(1, Math.max(0, missingFrac));
  const cost: Partial<Record<import("./types").ResourceId, number>> = {};
  for (const [id, n] of Object.entries(weapon.cost)) {
    cost[id as import("./types").ResourceId] = Math.ceil((n ?? 0) * frac);
  }
  cost.leather = Math.max(cost.leather ?? 0, REPAIR_LEATHER_MIN);
  return cost;
}

/** 損毀特殊武器(鬼雪等)的修復費:cost 全額(異晶)+皮革至少 REPAIR_LEATHER_MIN */
export function brokenRepairCost(weaponId: string): Partial<Record<import("./types").ResourceId, number>> {
  const weapon = WEAPONS.find((w) => w.id === weaponId);
  if (!weapon) return {};
  const cost: Partial<Record<import("./types").ResourceId, number>> = { ...weapon.cost };
  cost.leather = Math.max(cost.leather ?? 0, REPAIR_LEATHER_MIN);
  return cost;
}

/** 每間小木屋提升的人口上限 */
export const HUT_CAP_BONUS = 4;
/** 人口天花板(2026-09 用戶定案):中央地圖 100,每開啟一張相鄰地圖 +50——小木屋蓋到頂就停 */
export const POP_CAP_BASE = 100;
export const POP_CAP_PER_MAP = 50;

// ---- 武器打造(resources.md § 3.0 武器取得曲線:村莊初版只做位階 0–1) ----

export interface WeaponDef {
  id: string;
  label: string;
  cost: Partial<Record<import("./types").ResourceId, number>>;
  /** 對應戰鬥類別(design-notes.md § 2.3.1);shield 不進攻擊列,提供「格擋」動作 */
  category: "melee" | "ranged" | "shield";
  /** 戰鬥端的排程參數(design-notes.md § 2.4):高位階不只是數值變大,速度也要有差異 */
  baseCost: number;
  damage: number;
  /** 重武器:命中疊加敵方踉蹌值(滿 100 → 踉蹌 2.5s;巨體減半) */
  stagger?: number;
  /** 槍械彈匣:打空後該行動變「換彈」——點選則全行動清空並凍結 reload 秒(2026-09 改版) */
  magazine?: number;
  reload?: number;
  /** 槍械不耗耐久(2026-09 用戶定案):使用不掉耐久,但死亡照樣全失 */
  noWear?: boolean;
  /** 霰彈:每擊彈丸數(damage=單顆傷害,各自打隨機活敵) */
  pellets?: number;
  /** 格擋輔助(匕首):帶在身上,完美格擋窗延長這麼多秒(2026-09 用戶定案「微調格擋時間」) */
  parry?: number;
  /** 壓制(劍類):砍在敵方動作條 ≥ threshold 時把牠的條往回推 push(大招 heavyPush),巨體減半 */
  suppress?: { push: number; heavyPush: number; threshold: number };
  /** 招架(特殊武器):出手瞬間抓 window 秒的完美窗,抓中=完美格擋+照常傷害+bonus 額外傷害 */
  riposte?: { window: number; bonus: number };
  /** 連發:每擊對單體連打 N 發(damage=單發傷害) */
  burst?: number;
  /** 連發各發傷害(後座力遞減);缺項用 damage 補 */
  burstDamages?: number[];
  /** 盾牌限定:格擋參數(reduce=半格擋減傷比例、cd=冷卻秒數) */
  block?: { reduce: number; cd: number };
  /** 名刀特效:命中疊加敵方凍結值 */
  freeze?: number;
  /** 特殊武器不會消失:耐久歸零變成(損毀)留在背包,鐵匠鋪用異晶修復 */
  unbreakable?: boolean;
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
  { id: "wood-spear", label: "木槍", cost: { wood: 40 }, category: "melee", baseCost: 0.9, damage: 3, symbol: ">>", durability: 30, packSize: 3 },
  // 位階 1:石製——重攻擊的代表(2.0s/11,DPS 5.5):兩秒的破綻換一記真正的重斬
  { id: "stone-axe", label: "石斧", cost: { wood: 30, stone: 40 }, category: "melee", baseCost: 1.8, damage: 11, symbol: ">>>", durability: 45, packSize: 4, stagger: 20 },
  // 獵弓(2026-09 定位確認):槍械時代的另一條遠程路——輕便、箭矢便宜量大、永不換彈
  { id: "hunting-bow", label: "獵弓", cost: { wood: 50, hide: 10 }, category: "ranged", baseCost: 1.0, damage: 4, symbol: "→", durability: 40, ammo: "arrow", ammoPerUse: 1, packSize: 2 },
  // ---- 鐵階(冶煉的鐵) ----
  // 2026-09 用戶定案:武器類的鐵需求 ×5(鐵產線的產能就是軍備的天花板);
  // 鐵/鋼階全面補皮革(握柄/劍鞘/槍托)——皮革到後期仍是軍備的固定開銷
  { id: "iron-knife", label: "鐵刀", cost: { ingot: 30, wood: 10, leather: 5 }, category: "melee", baseCost: 0.6, damage: 6, symbol: ">|", durability: 40, packSize: 2 },
  // 匕首(2026-09 用戶定案):貼身的格擋輔助——帶著它,完美格擋窗 0.1s→0.15s;只占 1 格
  // 匕首鏈(2026-09 用戶定案):格擋輔助的代價是脆——鐵 20 耐久、鋼 30;速度同款,鋼傷微增
  { id: "dagger", label: "鐵匕首", cost: { ingot: 25, leather: 5 }, category: "melee", baseCost: 0.35, damage: 3, symbol: ">·", durability: 20, packSize: 1, parry: 0.05 },
  // 劍類的定位(2026-09 用戶定案):壓制——砍在敵人蓄力過半時,把牠的動作條往回推 25%(大招 15%,巨體減半)。
  // 斧頭是「打倒」、鬼雪是「凍住」,劍是「讓牠一直出不了手」;太早砍沒效果,要盯著敵方的條下刀
  { id: "iron-sword", label: "鐵劍", cost: { ingot: 50, wood: 10, leather: 10 }, category: "melee", baseCost: 1.0, damage: 8, symbol: ">>", durability: 55, packSize: 3, suppress: { push: 0.25, heavyPush: 0.15, threshold: 0.5 } },
  { id: "iron-spear", label: "鐵槍", cost: { ingot: 40, wood: 15, leather: 10 }, category: "melee", baseCost: 0.9, damage: 10, symbol: ">>>", durability: 60, packSize: 4 },
  // 重擊線(石斧的後繼):慢而沉,疊踉蹌——控場向的選擇
  { id: "iron-axe", label: "鐵斧", cost: { ingot: 60, wood: 20, leather: 15 }, category: "melee", baseCost: 1.8, damage: 18, symbol: ">>>>", durability: 55, packSize: 4, stagger: 30 },
  // 舊時代軍用品:軍規的緊湊設計——鐵階最好的刀(觀測台獎勵;之後可仿製)
  { id: "bayonet", label: "軍用刺刀", cost: { ingot: 40, leather: 5 }, category: "melee", baseCost: 0.5, damage: 5, symbol: ">|", durability: 50, packSize: 2 },
  // ---- 鋼階(鐵+煤合煉) ----
  { id: "steel-knife", label: "鋼刀", cost: { steel: 8, leather: 5 }, category: "melee", baseCost: 0.6, damage: 8, symbol: ">|", durability: 60, packSize: 2 },
  { id: "steel-dagger", label: "鋼匕首", cost: { steel: 6, leather: 5 }, category: "melee", baseCost: 0.35, damage: 4, symbol: ">·", durability: 30, packSize: 1, parry: 0.05 },
  { id: "steel-sword", label: "鋼劍", cost: { steel: 12, wood: 20, leather: 10 }, category: "melee", baseCost: 1.0, damage: 13, symbol: ">>", durability: 70, packSize: 3, suppress: { push: 0.25, heavyPush: 0.15, threshold: 0.5 } },
  { id: "steel-spear", label: "鋼槍", cost: { steel: 14, wood: 30, leather: 10 }, category: "melee", baseCost: 1.2, damage: 16, symbol: ">>>", durability: 80, packSize: 4 },
  // 重擊線頂點:兩秒一記的斷崖重斬,踉蹌疊得最快
  { id: "steel-greatsword", label: "鋼大劍", cost: { steel: 18, wood: 30, leather: 20 }, category: "melee", baseCost: 1.7, damage: 26, symbol: ">>>>>", durability: 75, packSize: 5, stagger: 50 },
  // 槍械:鋼階限定。左輪輕快(1 發/擊)、散彈沉重(2 發/擊,單發傷害一致 → 彈數決定傷害)
  { id: "revolver", label: "左輪手槍", cost: { steel: 10, wood: 10, leather: 10 }, category: "ranged", baseCost: 0.5, damage: 8, symbol: "→!", durability: 50, ammo: "bullet", ammoPerUse: 1, packSize: 2, magazine: 6, reload: 1.2, noWear: true },
  // 散彈槍(2026-09 改版):5 顆彈丸(各 6 傷)各自砸向隨機活敵——群戰神器;單體=全部糊臉 30/擊
  { id: "shotgun", label: "散彈槍", cost: { steel: 14, wood: 20, leather: 15 }, category: "ranged", baseCost: 1.3, damage: 6, symbol: "→!!", durability: 45, ammo: "bullet", ammoPerUse: 5, packSize: 3, magazine: 10, reload: 1.6, noWear: true, pellets: 5 },
  // 舊時代自動步槍(2026-09 核可;lootOnly——未來城市地圖的戰利品):彈雨,用彈藥經濟拴著
  { id: "auto-rifle", label: "舊時代自動步槍", cost: { steel: 30, leather: 10 }, category: "ranged", baseCost: 1.0, damage: 6, symbol: "→!!!", durability: 60, ammo: "bullet", ammoPerUse: 3, packSize: 4, magazine: 30, reload: 2.2, noWear: true, lootOnly: true, burst: 3, burstDamages: [6, 5, 5] },
  // 靜默教堂(Lv5)的戰利品:輕得不可思議(呼應敘事)。lootOnly:cost 只作修理費基準
  // 招架(2026-09 用戶定案):出手瞬間抓 0.1s 完美窗——抓中對方攻擊落地的那一刻,整擊無效(大招照完美格擋規則踉蹌 3s),
  // 這一刀照常命中並額外 +10 傷害;鐵匕首的格擋輔助(+0.05s)一樣延長這個窗
  { id: "alloy-blade", label: "異質短刃", cost: { steel: 12, leather: 20, scroll: 1 }, category: "melee", baseCost: 0.5, damage: 7, symbol: ">>|", durability: 80, packSize: 2, lootOnly: true, riposte: { window: 0.1, bonus: 10 } },
  // ---- 盾牌(格擋鏈,2026-09 用戶定案):啟動 0.5s 防禦窗,前 0.1s 完全格擋(整擊無效);
  // 之後半格擋依盾減傷(附帶效果照吃)。CD 與減傷率由盾決定;半格擋耗 1 耐久,完全格擋免費
  { id: "wood-shield", label: "木盾", cost: { wood: 50, hide: 5 }, category: "shield", baseCost: 0, damage: 0, symbol: "[]", durability: 20, packSize: 3, block: { reduce: 0.5, cd: 5 } },
  { id: "iron-shield", label: "鐵盾", cost: { ingot: 50, wood: 10, leather: 10 }, category: "shield", baseCost: 0, damage: 0, symbol: "[]", durability: 35, packSize: 3, block: { reduce: 0.65, cd: 4 } },
  { id: "steel-shield", label: "鋼盾", cost: { steel: 12, leather: 5 }, category: "shield", baseCost: 0, damage: 0, symbol: "[]", durability: 50, packSize: 3, block: { reduce: 0.8, cd: 3.5 } },
  // 名刀——鬼雪(迷宮寶箱,2026-09 用戶定案):快劍手感,命中疊敵方凍結值 24(Boss 抗性減半;計量每秒消退 1——實戰 2 秒節奏下與舊版 +20 無消退的凍結週期相同);
  // 不會損壞消失——耐久歸零變(損毀)留在背包,鐵匠鋪花異晶 30 修復(cost 即修復費)
  { id: "oniyuki", label: "鬼雪", cost: { shard: 30 }, category: "melee", baseCost: 0.9, damage: 9, symbol: ">*", durability: 60, packSize: 2, lootOnly: true, freeze: 24, unbreakable: true },
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
  /** 冰冷的功能備註(2026-09 用戶要求):物資列下方一行,講它拿來幹嘛 */
  note?: string;
}

// 肉乾不走手動打造——由「燻肉師」職業在燻製棚持續燒製(見 JOBS)
// 繃帶第一章「不可製造」:只能靠探索/戰利品機率拾取(稀有,回復量大)——
// 否則會直接搶走肉乾的補品定位;醫療產線(藥草/繃帶製造)留給後續章節解鎖
export const CONSUMABLES: ConsumableDef[] = [
  // 乾糧同步走高價路線(與弓矢一致的量級):遠征的糧錢是實質開銷,不是零頭
  { id: "ration", label: "乾糧", cost: { grain: 30, wood: 10 }, yield: 2, note: "遠征口糧。" },
  // 弓矢:遠程輸出的彈藥錢——有感但不至於奢侈(2026-08 定案 30/20)
  { id: "arrow", label: "弓矢", cost: { wood: 30, stone: 20 }, yield: 3, requiresWeapon: "hunting-bow", note: "弓箭使用的箭矢" },
  // 燈油:燻製棚熬獸脂——一罐點亮一座燈柱(壓低周圍遭遇率);罐子笨重,揹著占 3 格
  { id: "oil", label: "燈油", cost: { meat: 6, wood: 15 }, yield: 1, requiresBuilding: "smokehouse", note: "降地原野的遇敵率" },
  // 子彈:鋼階彈藥(火藥吃煤)——左輪/散彈通用
  // 2026-09 用戶定案:一顆子彈=鋼30+煤30——槍械威力不動,用彈藥經濟拴死(每一發都是財政決定)
  { id: "bullet", label: "子彈", cost: { steel: 30, coal: 30 }, yield: 1, requiresWeaponAny: ["revolver", "shotgun"], note: "槍械彈藥" },
  // 鐵軌:鋪在遠征地圖上的永久建設——從村莊一格一格連出去;軌上水糧零消耗、不遇敵(2026-09 定案)。
  // 鋪到礦坑旁,礦車自動運輸(鐵礦工產出 ×4;火車建築已移除)。2 根占 1 格,揹得動多少是推車/小貨車的事
  { id: "rail", label: "鐵軌", cost: { ingot: 2, wood: 50, stone: 20 }, yield: 1, requiresBuilding: "smithy", requiresLandmark: "mine", note: "鋪上鐵軌後，在上面行走不會消耗水跟糧食；鐵軌連通礦坑後，礦車自動運輸，鐵礦工的產量變為四倍" }, // 2026-09 用戶定案:枕木與道碴也是真實開銷
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
  // 2026-09 用戶定案:升級品的皮革需求 ×5(製革產線是整條升級鏈的瓶頸)
  { id: "waterskin", label: "大水袋", cost: { leather: 500, wood: 1000 }, effect: "外出時能攜帶更多的水", requiresBuilding: "tannery" },
  // 背包:整備容量的關鍵升級——揹負空間 20 → 45,遠征規模翻倍的分水嶺
  { id: "backpack", label: "背包", cost: { leather: 750, wood: 1500 }, effect: "能攜帶更多裝備出門", requiresBuilding: "tannery" },
  // 皮甲:生命上限 +10——體質升級鏈的第一件
  { id: "leather-armor", label: "皮甲", cost: { leather: 1000, wood: 2000, stone: 2000 }, effect: "生命上限 30 → 50", requiresBuilding: "tannery" },
  // ---- 鐵階升級(鐵匠鋪) ----
  // 2026-09 用戶定案:升級類的鐵需求 ×10(鐵產線跑起來後,鐵才是真正的訂單大宗)
  { id: "iron-flask", label: "鐵水壺", cost: { ingot: 150, leather: 250 }, effect: "水量上限 32 → 45", requiresBuilding: "smithy", requiresUpgrade: "waterskin" },
  { id: "iron-armor", label: "鐵甲", cost: { ingot: 250, leather: 500 }, effect: "生命上限 50 → 70", requiresBuilding: "smithy", requiresUpgrade: "leather-armor" },
  { id: "iron-cart", label: "推車", cost: { ingot: 200, wood: 300, leather: 150 }, effect: "揹負空間 45 → 70(鋪軌工程的運力)", requiresBuilding: "smithy", requiresUpgrade: "backpack" },
  // ---- 鋼階升級(需煤礦解放後的鋼產線) ----
  { id: "steel-flask", label: "鋼水壺", cost: { steel: 12, leather: 250 }, effect: "水量上限 45 → 50", requiresBuilding: "smithy", requiresUpgrade: "iron-flask" },
  { id: "steel-armor", label: "鋼甲", cost: { steel: 20, leather: 600 }, effect: "生命上限 70 → 90", requiresBuilding: "smithy", requiresUpgrade: "iron-armor" },
  { id: "steel-cart", label: "小貨車", cost: { steel: 15, ingot: 100, wood: 300 }, effect: "揹負空間 70 → 100", requiresBuilding: "smithy", requiresUpgrade: "iron-cart" },
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
export const ARROWS_PER_SLOT = 5; // 2026-09:箭矢輕,5 支併 1 格(對照子彈 1 發 1 格)
/** 子彈小巧:6 發併 1 格 */
/** 攜帶上限(2026-09 用戶定案):近戰 3 把(含重複)、遠程/槍械 2 把、盾 1 面;道具無限制 */
export const WEAPON_CARRY_LIMITS: Record<"melee" | "ranged" | "shield", number> = { melee: 3, ranged: 2, shield: 1 };

export const BULLETS_PER_SLOT = 1; // 2026-09 用戶定案:子彈一發一格——槍械是揹出門的奢侈
/** 鐵軌沉重:2 根併 1 格 */
export const RAILS_PER_SLOT = 2;
// 燈油一罐占 3 格(一罐=一座燈柱的量;與其揹三小瓶不如揹一罐)
export const OIL_SLOTS = 3;

// 精工品:打造小遊戲「完美」的產物——同型武器的上位版本,耐久上限 +25%
export const FINE_DURABILITY_MULT = 1.25;
export function fineMaxDurability(weaponId: string): number {
  const w = WEAPONS.find((x) => x.id === weaponId);
  return w ? Math.round(w.durability * FINE_DURABILITY_MULT) : 0;
}
/** 被動裝備欄:同時只能讓兩個被動生效——對著 Boss 的機制換裝,而不是全部堆上 */
export const PERK_SLOTS = 2;
/** 乾糧輕便:2 份併 1 格(肉乾重,1 份 1 格) */
export const RATIONS_PER_SLOT = 2;

/** 大水袋升級後的水量上限(未升級 20) */
export const WATERSKIN_CAPACITY = 32;
