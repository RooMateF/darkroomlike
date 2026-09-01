// 特殊探勘地點五級制(design-notes.md § 3.10.1)
// 位置用獨立種子確定性生成:地圖固定,地點也固定;進度存 localStorage "site-progress"

import { LANDMARKS } from "./types";
import { MAP_WIDTH, MAP_HEIGHT } from "./map-gen";

export interface SpecialSite {
  key: string; // "map:x,y" 或 "x,y"(中央地圖沿用舊格式,存檔相容)
  x: number;
  y: number;
  /** 所在地圖(未填 = 中央地圖 A) */
  mapId?: string;
  level: 1 | 2 | 3 | 4 | 5;
  /** 小地城總層數(最後一層是 Boss) */
  stages: number;
  /** Lv4/5 是有名字的地方 */
  landmarkId?: string;
}

export interface SiteProgress {
  stage: number; // 已打通的層數
  cleared: boolean;
}

const SITE_SEED = 77130921;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let cache: SpecialSite[] | null = null;

/** 確定性生成全部特殊地點(Lv1~3 用種子撒點,Lv4/5 取自 LANDMARKS 的固定座標) */
export function specialSites(): SpecialSite[] {
  if (cache) return cache;
  const rng = mulberry32(SITE_SEED);
  const cx = Math.floor(MAP_WIDTH / 2);
  const cy = Math.floor(MAP_HEIGHT / 2);
  const sites: SpecialSite[] = [];
  const taken = new Set<string>();
  const landmarkKeys = new Set(LANDMARKS.map((l) => `${l.x},${l.y}`));

  function place(level: 1 | 2 | 3, count: number, minDist: number, maxDist: number, stages: number) {
    let placed = 0;
    for (let tries = 0; tries < 2000 && placed < count; tries++) {
      let x: number, y: number;
      if (level === 1) {
        // Lv1 用極座標撒點:半徑均勻取樣天然偏向內圈——前線基地要貼著村莊(ADR 式補給密度曲線)
        const r = minDist + rng() * (maxDist - minDist);
        const a = rng() * Math.PI * 2;
        x = Math.round(cx + Math.cos(a) * r);
        y = Math.round(cy + Math.sin(a) * r);
        if (x < 2 || x > MAP_WIDTH - 3 || y < 2 || y > MAP_HEIGHT - 3) continue;
      } else {
        x = 2 + Math.floor(rng() * (MAP_WIDTH - 4));
        y = 2 + Math.floor(rng() * (MAP_HEIGHT - 4));
      }
      const dist = Math.hypot(x - cx, y - cy);
      if (dist < minDist || dist > maxDist) continue;
      const key = `${x},${y}`;
      if (taken.has(key) || landmarkKeys.has(key)) continue;
      // 彼此間至少隔 4 格,避免擠成一團
      if (sites.some((s) => Math.hypot(s.x - x, s.y - y) < 4)) continue;
      taken.add(key);
      sites.push({ key, x, y, level, stages });
      placed++;
    }
  }

  place(1, 10, 4, 24, 1); // Lv1:最多,貼近村莊撒點(ADR 式前線基地——打通後升格補給點,先撐起近距活動圈)
  place(2, 4, 7, 22, 2); // Lv2:離基地不遠(之後鐵路要開得過去),兩層
  place(3, 4, 24, 44, 3); // Lv3:中距離,三層

  // 通往四大地標的舊哨站(Lv1,一層):沿路線固定兩座,打通後升格補給點——
  // 沒有這條哨站鏈,地標外圍會出現超過水袋上限的無補給區,地標物理性不可達。
  // 玩家要先打通哨站、把水量網路一段段修出去,才推得到地標(ADR 式的前哨推進)
  for (const lm of LANDMARKS.filter((l) => l.level >= 4 && (l.mapId ?? "A") === "A")) {
    for (const f of [0.42, 0.75]) {
      let x = Math.round(cx + (lm.x - cx) * f);
      let y = Math.round(cy + (lm.y - cy) * f);
      x = Math.max(2, Math.min(MAP_WIDTH - 3, x));
      y = Math.max(2, Math.min(MAP_HEIGHT - 3, y));
      while (taken.has(`${x},${y}`) || landmarkKeys.has(`${x},${y}`)) x++;
      const key = `${x},${y}`;
      taken.add(key);
      sites.push({ key, x, y, level: 1, stages: 1 });
    }
  }

  // Lv4:有名字的地方(鐵礦坑/觀測台/祭壇/煤礦坑),三層——非中央地圖的 key 帶地圖前綴
  for (const lm of LANDMARKS.filter((l) => l.level === 4)) {
    const key = lm.mapId && lm.mapId !== "A" ? `${lm.mapId}:${lm.x},${lm.y}` : `${lm.x},${lm.y}`;
    sites.push({ key, x: lm.x, y: lm.y, mapId: lm.mapId ?? "A", level: 4, stages: 3, landmarkId: lm.id });
  }
  // Lv5:幾乎無法戰勝的地方,四層
  for (const lm of LANDMARKS.filter((l) => l.level === 5)) {
    sites.push({ key: `${lm.x},${lm.y}`, x: lm.x, y: lm.y, mapId: lm.mapId ?? "A", level: 5, stages: 4, landmarkId: lm.id });
  }

  // 北嶺的哨站鏈(Lv1,一層):南緣入口通往煤礦坑的路上兩座——沒有它們,煤礦坑在水量網路外
  for (const [ox, oy] of [
    [44, 37],
    [44, 20],
  ] as const) {
    sites.push({ key: `N:${ox},${oy}`, x: ox, y: oy, mapId: "N", level: 1, stages: 1 });
  }

  cache = sites;
  return sites;
}

export function siteAt(x: number, y: number, mapId = "A"): SpecialSite | undefined {
  return specialSites().find((s) => s.x === x && s.y === y && (s.mapId ?? "A") === mapId);
}

// ---- 黑鐵鑰匙(教堂的前置):藏在離教堂最近的那座 Lv3 遺跡最深處 ----

const CHURCH_KEY_FLAG = "church-key";

/** 收著黑鐵鑰匙的 Lv3 遺跡(確定性:離教堂最近的那座) */
export function churchKeySiteKey(): string {
  const church = LANDMARKS.find((l) => l.id === "church")!;
  const lv3 = specialSites().filter((s) => s.level === 3 && (s.mapId ?? "A") === "A");
  lv3.sort((a, b) => Math.hypot(a.x - church.x, a.y - church.y) - Math.hypot(b.x - church.x, b.y - church.y));
  return lv3[0]?.key ?? "";
}

/** 鑰匙是「重要物品」:入手後永久持有,不占揹負空間、不會因死亡遺失(否則會永久卡關) */
export function hasChurchKey(): boolean {
  return localStorage.getItem(CHURCH_KEY_FLAG) === "1";
}

export function grantChurchKey() {
  localStorage.setItem(CHURCH_KEY_FLAG, "1");
}

// ---- 進度持久化 ----

const PROGRESS_KEY = "site-progress";

export function siteProgress(key: string): SiteProgress {
  try {
    const all = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? "{}");
    return all[key] ?? { stage: 0, cleared: false };
  } catch {
    return { stage: 0, cleared: false };
  }
}

export function saveSiteProgress(key: string, progress: SiteProgress) {
  let all: Record<string, SiteProgress> = {};
  try {
    all = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? "{}");
  } catch {
    /* 壞資料重來 */
  }
  all[key] = progress;
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
}

export function clearedSiteCount(level: number): number {
  try {
    const all = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? "{}") as Record<string, SiteProgress>;
    return specialSites().filter((s) => s.level === level && all[s.key]?.cleared).length;
  } catch {
    return 0;
  }
}

/** 進入地城時寫入,戰鬥頁據此選敵人與結算(取代舊的 pending-site / pending-landmark) */
export const DUNGEON_KEY = "dungeon";

export interface DungeonRun {
  key: string;
  level: number;
  /** 這一戰是第幾層(1-based) */
  stage: number;
  /** 總層數 */
  stages: number;
  landmarkId?: string;
}

/** 各等級踩上去時的氛圍敘事(Lv4/5 是明確的危險警示,worldbuilding 式的 show-don't-tell) */
export const SITE_ARRIVAL_TEXT: Record<number, string> = {
  1: "一處還算完整的屋棚,裡面似乎有動靜。看起來不算危險,但不深入不會知道。",
  2: "有人為整理過的痕跡——這裡的東西還沒被搬空,值得花點功夫。",
  3: "殘留的結構比外表看起來深得多。裡面不會是空的。",
  4: "這裡散發著危險的氣息……空氣裡有股壓迫感,沒有準備就進去的人,恐怕回不來。",
  5: "空氣沉得像水,連蟲鳴都消失了。身體裡每一個本能都在叫你轉身離開。",
};