import type { Tile, TileType } from "./types";
import { specialSites } from "./sites";

// 25 倍面積(21x13 → 105x65),整張地圖一次完整呈現(小字體)
export const MAP_WIDTH = 105;
export const MAP_HEIGHT = 65;

// 固定種子:每張地圖都是固定的,不會每次遠征重新生成
const MAP_SEED = 20260821;

// ---- 多地圖節點(design-notes.md § 3.8):中央地圖 A + 四張相鄰地圖 ----
// 相鄰地圖目前是「骨架版」:地形個性+稀疏補給+回程出口;地標/教派主題待定案
export type MapId = "A" | "N" | "E" | "S" | "W";

export interface MapDef {
  id: MapId;
  /** 顯示名(相鄰地圖的正式主題之後定案,先用地貌命名) */
  label: string;
  seed: number;
  /** 第一次踏入時的抵達敘事 */
  arrivalText: string;
  /** 補給點數量(相鄰地圖沒有村莊撐腰,補給稀疏得多) */
  depotCount: number;
}

export const MAP_DEFS: Record<MapId, MapDef> = {
  A: { id: "A", label: "", seed: MAP_SEED, arrivalText: "", depotCount: 16 },
  N: {
    id: "N",
    label: "北嶺",
    seed: MAP_SEED + 101,
    arrivalText: "地勢一路抬升,風變得又乾又冷。碎石坡上零星立著早已熄滅的窯口。",
    depotCount: 9,
  },
  E: {
    id: "E",
    label: "東郊廢墟",
    seed: MAP_SEED + 202,
    arrivalText: "斷牆越來越密,街道的輪廓從荒草底下浮出來——這裡曾經是一座城的邊緣。",
    depotCount: 9,
  },
  S: {
    id: "S",
    label: "南原",
    seed: MAP_SEED + 303,
    arrivalText: "視野忽然開闊。齊腰的荒草一路鋪到天邊,風吹過來的時候像浪。",
    depotCount: 8,
  },
  W: {
    id: "W",
    label: "西澤",
    seed: MAP_SEED + 404,
    arrivalText: "地面越走越軟,黑水在草根之間發亮。空氣裡有一股腐爛的甜味。",
    depotCount: 8,
  },
};

/** 出口連結:站在某張地圖的某個邊緣出口,通往哪張地圖、落在哪個入口 */
export interface ExitLink {
  to: MapId;
  entryX: number;
  entryY: number;
  /** 行進方向的顯示(往北前進/返回中央地帶) */
  label: string;
}

export function exitLinkAt(mapId: MapId, x: number, y: number): ExitLink | null {
  const cx = Math.floor(MAP_WIDTH / 2);
  const cy = Math.floor(MAP_HEIGHT / 2);
  if (mapId === "A") {
    if (y === 0 && x === cx) return { to: "N", entryX: cx, entryY: MAP_HEIGHT - 2, label: "往北方前進" };
    if (y === MAP_HEIGHT - 1 && x === cx) return { to: "S", entryX: cx, entryY: 1, label: "往南方前進" };
    if (x === 0 && y === cy) return { to: "W", entryX: MAP_WIDTH - 2, entryY: cy, label: "往西方前進" };
    if (x === MAP_WIDTH - 1 && y === cy) return { to: "E", entryX: 1, entryY: cy, label: "往東方前進" };
    return null;
  }
  // 相鄰地圖:唯一的出口通回中央地圖(落在對應邊緣出口的內側一格)
  if (mapId === "N" && y === MAP_HEIGHT - 1 && x === cx) return { to: "A", entryX: cx, entryY: 1, label: "返回中央地帶" };
  if (mapId === "S" && y === 0 && x === cx) return { to: "A", entryX: cx, entryY: MAP_HEIGHT - 2, label: "返回中央地帶" };
  if (mapId === "W" && x === MAP_WIDTH - 1 && y === cy) return { to: "A", entryX: 1, entryY: cy, label: "返回中央地帶" };
  if (mapId === "E" && x === 0 && y === cy) return { to: "A", entryX: MAP_WIDTH - 2, entryY: cy, label: "返回中央地帶" };
  return null;
}

/** mulberry32:輕量可種子化的 PRNG,同一個種子永遠生成同一張地圖 */
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

let rng = mulberry32(MAP_SEED);

/**
 * 相鄰地圖的地形個性(骨架版):整張圖單一風格,不再切象限——
 * 每張圖是一個「生態」,和中央地圖的四象限拼盤做出區隔
 */
function pickNeighborTerrain(mapId: MapId): TileType {
  const r = rng();
  switch (mapId) {
    case "N": // 北嶺:碎石與裸岩,難走,石多
      if (r < 0.42) return "plain";
      if (r < 0.52) return "brush";
      if (r < 0.83) return "rubble";
      if (r < 0.9) return "wall";
      if (r < 0.965) return "resource";
      return "event";
    case "E": // 東郊廢墟:斷牆密,事件與拾荒點最多
      if (r < 0.42) return "plain";
      if (r < 0.5) return "brush";
      if (r < 0.76) return "rubble";
      if (r < 0.87) return "wall";
      if (r < 0.94) return "resource";
      return "event";
    case "S": // 南原:開闊好走,但也貧瘠——用腳程換安全
      if (r < 0.8) return "plain";
      if (r < 0.9) return "brush";
      if (r < 0.94) return "rubble";
      if (r < 0.95) return "wall";
      if (r < 0.985) return "resource";
      return "event";
    case "W": // 西澤:灌木與軟地,擋路的黑水潭多
    default:
      if (r < 0.38) return "plain";
      if (r < 0.76) return "brush";
      if (r < 0.8) return "rubble";
      if (r < 0.9) return "wall";
      if (r < 0.965) return "resource";
      return "event";
  }
}

/**
 * 依象限給地形個性(骨架層的手工調味):
 * - 西北:林地——灌木密,木材/獸皮的主產區
 * - 東北:廢墟——碎石與斷牆,事件與拾荒點多
 * - 西南:濕地——水域交錯,通行要繞路
 * - 東南:平原——開闊好走,但也相對貧瘠
 */
function pickTerrain(dx: number, dy: number, _dist: number, _maxDist: number): TileType {
  // 特殊探勘地點(五級制)改由 sites.ts 確定性放置,不再隨機散佈
  // 地形符號極簡化:可走的地面以 . 為主,;/: 只是各象限的視覺調味;
  // 隨機的 ~(水域)整個移除——沒有玩法意義的符號不該出現,之後若做「河流」再以結構性方式回歸
  const zone = dx < 0 ? (dy < 0 ? "forest" : "marsh") : dy < 0 ? "ruins" : "plains";
  const r2 = rng();
  switch (zone) {
    case "forest":
      if (r2 < 0.51) return "plain";
      if (r2 < 0.81) return "brush";
      if (r2 < 0.87) return "rubble";
      if (r2 < 0.89) return "wall";
      if (r2 < 0.965) return "resource";
      return "event";
    case "ruins":
      if (r2 < 0.53) return "plain";
      if (r2 < 0.61) return "brush";
      if (r2 < 0.85) return "rubble";
      if (r2 < 0.9) return "wall";
      if (r2 < 0.95) return "resource";
      return "event";
    case "marsh":
      if (r2 < 0.52) return "plain";
      if (r2 < 0.82) return "brush";
      if (r2 < 0.87) return "rubble";
      if (r2 < 0.88) return "wall";
      if (r2 < 0.97) return "resource";
      return "event";
    case "plains":
    default:
      if (r2 < 0.75) return "plain";
      if (r2 < 0.85) return "brush";
      if (r2 < 0.92) return "rubble";
      if (r2 < 0.93) return "wall";
      if (r2 < 0.98) return "resource";
      return "event";
  }
}

export function generateMap(mapId: MapId = "A"): Tile[][] {
  const def = MAP_DEFS[mapId];
  rng = mulberry32(def.seed); // 每次呼叫都重設種子,保證生成同一張地圖
  const cx = Math.floor(MAP_WIDTH / 2);
  const cy = Math.floor(MAP_HEIGHT / 2);
  const maxDist = Math.hypot(cx, cy);

  const grid: Tile[][] = [];
  for (let y = 0; y < MAP_HEIGHT; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < MAP_WIDTH; x++) {
      const dist = Math.hypot(x - cx, y - cy);
      row.push({
        type: mapId === "A" ? pickTerrain(x - cx, y - cy, dist, maxDist) : pickNeighborTerrain(mapId),
        revealed: false,
      });
    }
    grid.push(row);
  }

  if (mapId !== "A") {
    return finishNeighborMap(grid, mapId);
  }

  // 出生點:村莊入口(補給點),周圍清出平地
  grid[cy][cx] = { type: "depot", revealed: false };
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const t = grid[cy + dy]?.[cx + dx];
      if (t && t.type !== "depot") grid[cy + dy][cx + dx] = { type: "plain", revealed: false };
    }
  }

  // 四邊中央的出口:通往相鄰地圖
  // 出口前清出一條短通道,確保不會被牆封死
  const exits: [number, number, number, number][] = [
    [cx, 0, 0, 1], // 北,通道往南清
    [cx, MAP_HEIGHT - 1, 0, -1], // 南
    [0, cy, 1, 0], // 西
    [MAP_WIDTH - 1, cy, -1, 0], // 東
  ];
  for (const [ex, ey, ddx, ddy] of exits) {
    grid[ey][ex] = { type: "exit", revealed: false };
    for (let i = 1; i <= 3; i++) {
      const t = grid[ey + ddy * i]?.[ex + ddx * i];
      if (t && (t.type === "wall" || t.type === "water")) grid[ey + ddy * i][ex + ddx * i] = { type: "plain", revealed: false };
    }
  }

  // 特殊探勘地點(五級制,design-notes.md § 3.10.1):Lv1~3 為 site,Lv4/5 為具名地標
  for (const s of specialSites().filter((s2) => (s2.mapId ?? "A") === "A")) {
    grid[s.y][s.x] = { type: s.level >= 4 ? "landmark" : "site", revealed: false };
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const t = grid[s.y + dy]?.[s.x + dx];
        if (t && (t.type === "wall" || t.type === "water")) grid[s.y + dy][s.x + dx] = { type: "plain", revealed: false };
      }
    }
  }

  // 補給點:初始區域密集,外圍稀疏(design-notes.md § 3.10 補給點密度曲線)
  let placed = 0;
  for (let tries = 0; tries < 1200 && placed < 16; tries++) {
    const x = Math.floor(rng() * MAP_WIDTH);
    const y = Math.floor(rng() * MAP_HEIGHT);
    const dist = Math.hypot(x - cx, y - cy);
    if (dist < 5) continue;
    const acceptChance = dist < 18 ? 0.9 : Math.max(0.05, 0.6 - (dist / maxDist) * 0.6);
    if (rng() > acceptChance) continue;
    const tile = grid[y][x];
    if (tile.type !== "plain" && tile.type !== "brush" && tile.type !== "rubble") continue;
    grid[y][x] = { type: "depot", revealed: false };
    placed++;
  }

  // Lv5 靜默教堂(7,5):用高牆把西北角圍成封閉區,只留北面一條窄道——
  // 牆的結構性用法:抵達本身就是一段「沿著牆找入口」的體驗
  {
    const x1 = 1, y1 = 2, x2 = 14, y2 = 11;
    const gapX = 7; // 北面唯一的開口
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        const isPerimeter = x === x1 || x === x2 || y === y1 || y === y2;
        if (isPerimeter) {
          grid[y][x] = { type: x === gapX && y === y1 ? "plain" : "wall", revealed: false };
        } else {
          grid[y][x] = { type: "plain", revealed: false };
        }
      }
    }
    // 教堂本體重新蓋回圍牆內
    grid[5][7] = { type: "landmark", revealed: false };
    // 開口上方的通道保持可走(通往地圖頂端)
    for (let y = 0; y < y1; y++) {
      const t = grid[y][gapX];
      if (t.type === "wall" || t.type === "water") grid[y][gapX] = { type: "plain", revealed: false };
    }
  }

  return grid;
}

/** 相鄰地圖收尾:回程出口+稀疏補給點(沒有村莊、沒有探勘點——內容之後與主題一起設計) */
function finishNeighborMap(grid: Tile[][], mapId: MapId): Tile[][] {
  const cx = Math.floor(MAP_WIDTH / 2);
  const cy = Math.floor(MAP_HEIGHT / 2);
  const def = MAP_DEFS[mapId];

  // 回程出口(通回中央地圖)+ 通道清障
  const backExit: Record<string, [number, number, number, number]> = {
    N: [cx, MAP_HEIGHT - 1, 0, -1], // 北嶺的南緣回中央
    S: [cx, 0, 0, 1],
    W: [MAP_WIDTH - 1, cy, -1, 0],
    E: [0, cy, 1, 0],
  };
  const [ex, ey, ddx, ddy] = backExit[mapId];
  grid[ey][ex] = { type: "exit", revealed: false };
  for (let i = 1; i <= 4; i++) {
    const t = grid[ey + ddy * i]?.[ex + ddx * i];
    if (t && (t.type === "wall" || t.type === "water")) grid[ey + ddy * i][ex + ddx * i] = { type: "plain", revealed: false };
  }

  // 這張地圖自己的探勘點/地標(如北嶺的哨站與煤礦坑)
  for (const s of specialSites().filter((s2) => s2.mapId === mapId)) {
    grid[s.y][s.x] = { type: s.level >= 4 ? "landmark" : "site", revealed: false };
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const t = grid[s.y + dy]?.[s.x + dx];
        if (t && (t.type === "wall" || t.type === "water")) grid[s.y + dy][s.x + dx] = { type: "plain", revealed: false };
      }
    }
  }

  // 稀疏補給點:相鄰地圖沒有村莊撐腰,全圖均勻撒但數量少——水網比中央地圖緊得多
  let placed = 0;
  for (let tries = 0; tries < 2000 && placed < def.depotCount; tries++) {
    const x = 3 + Math.floor(rng() * (MAP_WIDTH - 6));
    const y = 2 + Math.floor(rng() * (MAP_HEIGHT - 4));
    const tile = grid[y][x];
    if (tile.type !== "plain" && tile.type !== "brush" && tile.type !== "rubble") continue;
    grid[y][x] = { type: "depot", revealed: false };
    placed++;
  }

  return grid;
}

export function startPosition(): { x: number; y: number } {
  return { x: Math.floor(MAP_WIDTH / 2), y: Math.floor(MAP_HEIGHT / 2) };
}
