// 隨身行囊:整備頁打包 → 探索/戰鬥消耗 → 回村歸還;死亡時整包消失(design-notes.md § 3.9)
// 用 localStorage 跨頁共享,是村莊庫存以外唯一的「在外狀態」。

export const PLAYER_MAX_HP = 30;

/** 動態生命上限:基礎 30,做了皮甲升級 +10(讀村莊存檔) */
export function playerMaxHp(): number {
  try {
    const v = JSON.parse(localStorage.getItem("village-state") ?? "{}");
    const u = v.upgrades ?? {};
    if (u["steel-armor"]) return 90;
    if (u["iron-armor"]) return 70;
    if (u["leather-armor"]) return 50;
    return 30;
  } catch {
    return 30;
  }
}

export interface Carried {
  /** 攜帶的武器數量(同型可帶多把當備用) */
  weapons: Record<string, number>;
  /** 目前「使用中那一把」的剩餘耐久(壞了換下一把,重置為滿) */
  durability: Record<string, number>;
  rations: number;
  /** 出發時帶的乾糧量,補給點回填的上限 */
  maxRations: number;
  /** 肉乾:重(1 份 1 格)但能回血——乾糧見底時的救命糧,也可在戰鬥中食用 */
  jerky?: number;
  bandages: number;
  arrows: number;
  /** 槍械通用子彈(左輪 1 發/擊、散彈 2 發/擊) */
  bullets?: number;
  /** 鐵軌(2 根 1 格):鋪設在地圖上成為永久建設 */
  rails?: number;
  /** 火焰卷軸:一次性法術道具(法術系統解鎖前的第一次接觸) */
  scrolls?: number;
  /** 燈油:點亮據點燈柱的燃料(每座 3 份) */
  oil?: number;
  /** 舊時代藥劑(交易所兌換):戰鬥中飲用,大量回復並解除所有異常 */
  elixirs?: number;
  /** 醒神鹽(交易所兌換):解除暈眩/遲緩並免疫 6 秒——控制型 Boss 的反制道具 */
  salts?: number;
  /** 目前 HP:跨探索/戰鬥持續,回村整備才回滿——不會每場戰鬥重置 */
  hp: number;
  /** 途中取得的戰利品(戰鬥掉落/地圖拾獲),活著回村才入庫;死了跟著全丟 */
  loot?: Record<string, number>;
  /** 出發時的揹負空間上限(補給+戰利品共用;有背包升級較大) */
  packCap?: number;
}

import { WEAPONS, ARROWS_PER_SLOT, RATIONS_PER_SLOT, BULLETS_PER_SLOT, RAILS_PER_SLOT } from "./village/data";

/**
 * 揹負空間目前的占用量(統一容量):
 * - 武器:各自的 packSize × 把數
 * - 弓矢等彈藥:3 個併 1 格(隨身的與戰利品裡的合併計算)
 * - 其他補給與戰利品:1 個 1 格
 */
export function packUsed(carried: Carried): number {
  let used = 0;
  for (const [id, n] of Object.entries(carried.weapons)) {
    const def = WEAPONS.find((w) => w.id === id);
    used += (def?.packSize ?? 3) * n;
  }
  const arrowsTotal = carried.arrows + (carried.loot?.arrow ?? 0);
  used += Math.ceil(arrowsTotal / ARROWS_PER_SLOT);
  const bulletsTotal = (carried.bullets ?? 0) + (carried.loot?.bullet ?? 0);
  if (bulletsTotal > 0) used += Math.ceil(bulletsTotal / BULLETS_PER_SLOT);
  const railsTotal = (carried.rails ?? 0) + (carried.loot?.rail ?? 0);
  if (railsTotal > 0) used += Math.ceil(railsTotal / RAILS_PER_SLOT);
  // 乾糧輕便 2 份併 1 格;肉乾重,1 份 1 格
  const rationsTotal = carried.rations + (carried.loot?.ration ?? 0);
  used += Math.ceil(rationsTotal / RATIONS_PER_SLOT);
  used += (carried.jerky ?? 0) + carried.bandages + (carried.scrolls ?? 0) + (carried.oil ?? 0) + (carried.elixirs ?? 0) + (carried.salts ?? 0);
  for (const [id, n] of Object.entries(carried.loot ?? {})) {
    if (id === "arrow" || id === "ration" || id === "bullet" || id === "rail") continue; // 已併入各自的格
    used += n;
  }
  return used;
}

/** 撿到就能用:這些拾獲直接併入補給欄——壓在戰利品堆裡的東西路上動不了(繃帶不能包、弓矢不能射) */
const SUPPLY_FIELD = {
  bandage: "bandages",
  jerky: "jerky",
  elixir: "elixirs",
  salt: "salts",
  scroll: "scrolls",
  arrow: "arrows",
  bullet: "bullets",
  ration: "rations",
  oil: "oil",
  rail: "rails",
} as const;

/**
 * 拾獲戰利品(受揹負空間限制):一件一件裝,塞得下多少裝多少。
 * 可用補給(SUPPLY_FIELD)進補給欄,其餘素材進戰利品堆;空間占用同一把尺。
 * 空間不足時 overflow = true,讓 UI 能提示「背包塞不下了」。
 */
export function addLoot(carried: Carried, gains: Record<string, number>): { added: Record<string, number>; overflow: boolean } {
  carried.loot ??= {};
  const cap = carried.packCap ?? 20;
  const bag = carried as unknown as Record<string, number | undefined>;
  const added: Record<string, number> = {};
  let overflow = false;
  for (const [id, n] of Object.entries(gains)) {
    const field = SUPPLY_FIELD[id as keyof typeof SUPPLY_FIELD];
    for (let k = 0; k < n; k++) {
      if (field) {
        const cur = bag[field] ?? 0;
        bag[field] = cur + 1;
        if (packUsed(carried) > cap) {
          bag[field] = cur; // 塞不下,退回這一件
          overflow = true;
          break;
        }
      } else {
        carried.loot[id] = (carried.loot[id] ?? 0) + 1;
        if (packUsed(carried) > cap) {
          carried.loot[id]--; // 塞不下,退回這一件
          if (carried.loot[id] === 0) delete carried.loot[id];
          overflow = true;
          break;
        }
      }
      added[id] = (added[id] ?? 0) + 1;
    }
  }
  return { added, overflow };
}

/** 舊存檔遷移:過去撿到的可用補給被壓在戰利品堆裡(不能用)——搬回補給欄 */
function migrateLootSupplies(c: Carried) {
  if (!c.loot) return;
  const bag = c as unknown as Record<string, number | undefined>;
  let moved = false;
  for (const [id, field] of Object.entries(SUPPLY_FIELD)) {
    const n = c.loot[id] ?? 0;
    if (n > 0) {
      bag[field] = (bag[field] ?? 0) + n;
      delete c.loot[id];
      moved = true;
    }
  }
  if (moved) saveCarried(c);
}

const KEY = "carried";

export function loadCarried(): Carried | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Carried;
    migrateLootSupplies(c);
    return c;
  } catch {
    return null;
  }
}

export function saveCarried(carried: Carried) {
  localStorage.setItem(KEY, JSON.stringify(carried));
}

/** 死亡時呼叫:帶出門的東西全部消失(§3.9) */
export function clearCarried() {
  localStorage.removeItem(KEY);
}

/**
 * 活著回村:把行囊裡剩下的東西(武器/補給/戰利品/武器耐久)全部歸還進村莊庫存,並清空行囊。
 * 村莊頁與整備頁載入時都會呼叫,確保不管從哪條路回村,東西都正確入庫。
 */
export function returnCarriedToVillage() {
  const leftover = loadCarried();
  if (!leftover) return;
  let village: Record<string, any>;
  try {
    const raw = localStorage.getItem("village-state");
    if (!raw) return;
    village = JSON.parse(raw);
  } catch {
    return;
  }

  village.ownedWeapons ??= {};
  for (const [id, n] of Object.entries(leftover.weapons)) {
    village.ownedWeapons[id] = (village.ownedWeapons[id] ?? 0) + n;
  }
  village.resources ??= {};
  village.resources.ration = (village.resources.ration ?? 0) + leftover.rations;
  village.resources.jerky = (village.resources.jerky ?? 0) + (leftover.jerky ?? 0);
  village.resources.bandage = (village.resources.bandage ?? 0) + leftover.bandages;
  village.resources.arrow = (village.resources.arrow ?? 0) + leftover.arrows;
  village.resources.bullet = (village.resources.bullet ?? 0) + (leftover.bullets ?? 0);
  village.resources.rail = (village.resources.rail ?? 0) + (leftover.rails ?? 0);
  village.resources.scroll = (village.resources.scroll ?? 0) + (leftover.scrolls ?? 0);
  village.resources.oil = (village.resources.oil ?? 0) + (leftover.oil ?? 0);
  village.resources.elixir = (village.resources.elixir ?? 0) + (leftover.elixirs ?? 0);
  village.resources.salt = (village.resources.salt ?? 0) + (leftover.salts ?? 0);
  for (const [id, n] of Object.entries(leftover.loot ?? {})) {
    village.resources[id] = (village.resources[id] ?? 0) + n;
  }
  // 帶回武器的剩餘耐久跟著回村(不會免費回滿——要修得靠工匠鋪/鐵匠鋪)
  village.weaponDurability ??= {};
  for (const [id, n] of Object.entries(leftover.weapons)) {
    if (n > 0 && leftover.durability[id] !== undefined) {
      village.weaponDurability[id] = leftover.durability[id];
    }
  }

  localStorage.setItem("village-state", JSON.stringify(village));
  clearCarried();
}
