import { BLOCKED, LANDMARKS, TILE_SYMBOL, type Checkpoint, type Tile, type TileType } from "./types";
import { generateMap, startPosition, exitLinkAt, borderDepotFor, MAP_DEFS, MAP_WIDTH, MAP_HEIGHT, MAZE, type MapId, type ExitLink } from "./map-gen";
import { loadCarried, saveCarried, clearCarried, addLoot, packUsed, playerMaxHp, type Carried } from "../carried";
import { RESOURCE_LABEL, type ResourceId } from "../village/types";
import { siteAt, siteProgress, specialSites, hasChurchKey, DUNGEON_KEY, SITE_ARRIVAL_TEXT, type DungeonRun } from "./sites";
import { RATIONS_PER_SLOT } from "../village/data";
import { CHOICE_EVENTS, type ChoiceEventDef } from "./choice-events";

const STATE_KEY = "explore-state-v10"; // v10:煤礦坑外推(要比鐵礦坑遠),舊存檔不相容

// ---- v9 → v10 一次性遷移(2026-09 煤礦坑外推)----
(function migrateMapV10() {
  if (localStorage.getItem("map-v10-migrated")) return;
  try {
    let rails = 0;
    let lamps = 0;
    for (const suffix of ["", ":N", ":E", ":S", ":W"]) {
      const raw = localStorage.getItem("explore-state-v9" + suffix);
      if (!raw) continue;
      const st = JSON.parse(raw);
      for (const row of (st.railRows ?? []) as string[]) rails += (row.match(/1/g) ?? []).length;
      for (const row of (st.litRows ?? []) as string[]) lamps += (row.match(/1/g) ?? []).length;
      localStorage.removeItem("explore-state-v9" + suffix);
    }
    if (rails > 0 || lamps > 0) {
      const v = JSON.parse(localStorage.getItem("village-state") ?? "{}");
      v.resources ??= {};
      v.resources.rail = (v.resources.rail ?? 0) + rails;
      v.resources.oil = (v.resources.oil ?? 0) + lamps;
      localStorage.setItem("village-state", JSON.stringify(v));
    }
    if (rails > 0) localStorage.removeItem("rail-to-mine");
    const progress = JSON.parse(localStorage.getItem("site-progress") ?? "{}");
    const fresh: Record<string, unknown> = {};
    for (const keep of ["7,5", "12,43", "77,46", "62,13", "73,47", "29,5"]) {
      if (progress[keep]) fresh[keep] = progress[keep];
    }
    if (progress["48,8"]) fresh["54,4"] = progress["48,8"]; // 煤礦坑外推
    localStorage.setItem("site-progress", JSON.stringify(fresh));
  } catch {
    /* 壞資料就放棄遷移,別擋開機 */
  }
  localStorage.setItem("map-v10-migrated", "1");
})();

// ---- v8 → v9 一次性遷移(2026-09 迷宮改建)----
(function migrateMapV9() {
  if (localStorage.getItem("map-v9-migrated")) return;
  try {
    let rails = 0;
    let lamps = 0;
    for (const suffix of ["", ":N", ":E", ":S", ":W"]) {
      const raw = localStorage.getItem("explore-state-v8" + suffix);
      if (!raw) continue;
      const st = JSON.parse(raw);
      for (const row of (st.railRows ?? []) as string[]) rails += (row.match(/1/g) ?? []).length;
      for (const row of (st.litRows ?? []) as string[]) lamps += (row.match(/1/g) ?? []).length;
      localStorage.removeItem("explore-state-v8" + suffix);
    }
    if (rails > 0 || lamps > 0) {
      const v = JSON.parse(localStorage.getItem("village-state") ?? "{}");
      v.resources ??= {};
      v.resources.rail = (v.resources.rail ?? 0) + rails;
      v.resources.oil = (v.resources.oil ?? 0) + lamps;
      localStorage.setItem("village-state", JSON.stringify(v));
    }
    if (rails > 0) localStorage.removeItem("rail-to-mine");
    const progress = JSON.parse(localStorage.getItem("site-progress") ?? "{}");
    const fresh: Record<string, unknown> = {};
    for (const keep of ["7,5", "12,43", "77,46", "62,13", "48,8"]) {
      if (progress[keep]) fresh[keep] = progress[keep]; // 地標座標未動,進度全留
    }
    localStorage.setItem("site-progress", JSON.stringify(fresh));
  } catch {
    /* 壞資料就放棄遷移,別擋開機 */
  }
  localStorage.setItem("map-v9-migrated", "1");
})();

/** 迷宮牆內(不含外圈牆):視野與偷竊規則的適用範圍 */
function isMazeInterior(x: number, y: number): boolean {
  return x > MAZE.x1 && x < MAZE.x2 && y > MAZE.y1 && y < MAZE.y2;
}

// ---- v7 → v8 一次性遷移(2026-09 兩礦拉近、祭壇環水、高牆圍場)----
// 舊圖作廢:鐵軌拆回材料、燃燈折回燈油退進村莊庫存;
// 地標地城進度照新座標搬家(打贏的不用重打);Lv1~3 與北嶺哨站隨新地圖重置
(function migrateMapV8() {
  if (localStorage.getItem("map-v8-migrated")) return;
  try {
    let rails = 0;
    let lamps = 0;
    for (const suffix of ["", ":N", ":E", ":S", ":W"]) {
      const raw = localStorage.getItem("explore-state-v7" + suffix);
      if (!raw) continue;
      const s = JSON.parse(raw);
      for (const row of (s.railRows ?? []) as string[]) rails += (row.match(/1/g) ?? []).length;
      for (const row of (s.litRows ?? []) as string[]) lamps += (row.match(/1/g) ?? []).length;
      localStorage.removeItem("explore-state-v7" + suffix);
    }
    if (rails > 0 || lamps > 0) {
      const v = JSON.parse(localStorage.getItem("village-state") ?? "{}");
      v.resources ??= {};
      v.resources.rail = (v.resources.rail ?? 0) + rails;
      v.resources.oil = (v.resources.oil ?? 0) + lamps;
      localStorage.setItem("village-state", JSON.stringify(v));
    }
    if (rails > 0) localStorage.removeItem("rail-to-mine");
    const progress = JSON.parse(localStorage.getItem("site-progress") ?? "{}");
    const fresh: Record<string, unknown> = {};
    for (const keep of ["7,5", "12,43", "77,46"]) {
      if (progress[keep]) fresh[keep] = progress[keep]; // 教堂/祭壇/觀測台座標不變
    }
    if (progress["72,8"]) fresh["62,13"] = progress["72,8"]; // 鐵礦坑拉近
    if (progress["N:44,7"]) fresh["48,8"] = progress["N:44,7"]; // 煤礦坑搬進中央地圖
    localStorage.setItem("site-progress", JSON.stringify(fresh));
  } catch {
    /* 壞資料就放棄遷移,別擋開機 */
  }
  localStorage.setItem("map-v8-migrated", "1");
})();

// ---- v6 → v7 一次性遷移(2026-09 地圖縮小 30%)----
// 舊圖作廢:鋪過的鐵軌拆回材料、燃著的燈柱折回燈油,全數退進村莊庫存;
// 地標的地城進度照 landmarkId 搬到新座標的 key(打贏的不用重打);Lv1~3 隨新地圖重置
(function migrateMapV7() {
  if (localStorage.getItem("map-v7-migrated")) return;
  try {
    let rails = 0;
    let lamps = 0;
    for (const suffix of ["", ":N", ":E", ":S", ":W"]) {
      const raw = localStorage.getItem("explore-state-v6" + suffix);
      if (!raw) continue;
      const s = JSON.parse(raw);
      for (const row of (s.railRows ?? []) as string[]) rails += (row.match(/1/g) ?? []).length;
      for (const row of (s.litRows ?? []) as string[]) lamps += (row.match(/1/g) ?? []).length;
      localStorage.removeItem("explore-state-v6" + suffix);
    }
    if (rails > 0 || lamps > 0) {
      const v = JSON.parse(localStorage.getItem("village-state") ?? "{}");
      v.resources ??= {};
      v.resources.rail = (v.resources.rail ?? 0) + rails;
      v.resources.oil = (v.resources.oil ?? 0) + lamps;
      localStorage.setItem("village-state", JSON.stringify(v));
    }
    // 鐵軌拆光了,礦車加成也得重新接
    if (rails > 0) localStorage.removeItem("rail-to-mine");
    // 地標地城進度搬家(座標制 key:舊 105x65 座標 → 新 88x54 座標)
    const moves: [string, string][] = [
      ["86,10", "72,8"], // 鐵礦坑
      ["92,55", "77,46"], // 觀測台
      ["14,52", "12,43"], // 祭壇
      ["N:52,8", "N:44,7"], // 煤礦坑
      ["N:52,44", "N:44,37"], // 北嶺哨站
      ["N:52,24", "N:44,20"],
    ];
    const progress = JSON.parse(localStorage.getItem("site-progress") ?? "{}");
    const fresh: Record<string, unknown> = {};
    if (progress["7,5"]) fresh["7,5"] = progress["7,5"]; // 教堂座標不變
    for (const [oldKey, newKey] of moves) {
      if (progress[oldKey]) fresh[newKey] = progress[oldKey];
    }
    localStorage.setItem("site-progress", JSON.stringify(fresh));
  } catch {
    /* 壞資料就放棄遷移,別擋開機 */
  }
  localStorage.setItem("map-v7-migrated", "1");
})();
const FRESH_KEY = "expedition-fresh";
const CURRENT_MAP_KEY = "current-map";
const MAP_ENTRY_KEY = "map-entry"; // 跨圖移動時的落點(一次性)
const EXPEDITION_SERIAL_KEY = "expedition-serial"; // 第幾趟遠征:各地圖用它判斷「新遠征了,據點儲備重置」
const VISITED_MAPS_KEY = "maps-visited"; // 到過的地圖(第一次踏入播抵達敘事)

/** 目前所在的地圖(遠征從村莊出發時重設回中央地圖 A) */
export function currentMapId(): MapId {
  const v = localStorage.getItem(CURRENT_MAP_KEY);
  return v === "N" || v === "E" || v === "S" || v === "W" ? v : "A";
}

function stateKeyFor(mapId: MapId): string {
  return mapId === "A" ? STATE_KEY : `${STATE_KEY}:${mapId}`;
}

function expeditionSerial(): number {
  return Number(localStorage.getItem(EXPEDITION_SERIAL_KEY) ?? "0");
}
const LANDMARKS_CLEARED_KEY = "landmarks-cleared";

export function clearedLandmarks(): string[] {
  try {
    return JSON.parse(localStorage.getItem(LANDMARKS_CLEARED_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

export function markLandmarkCleared(id: string) {
  const list = clearedLandmarks();
  if (!list.includes(id)) {
    list.push(id);
    localStorage.setItem(LANDMARKS_CLEARED_KEY, JSON.stringify(list));
  }
}

/** 觀測台解放後,再訪時輪播的觀測紀錄(認知揭露弧線第一~二階段之間:舊文明的存在+一絲異常,不說破) */
const OBSERVATORY_LORE: string[] = [
  "「第 12 夜。倍率還是不夠我看得清楚,得再換一組鏡片才行。它表面的紋路,和去年畫下來的不一樣了。」",
  "「第 31 夜。今晚很清楚。那東西肯定不是什麼隕石坑。隕石坑可不會動!」",
  "「第 47 夜。我把畫拿給鎮上的人看,他們笑我。但沒有關係,我知道的,祂一直在看著我,我是祂在這片土地上的代行者,哈哈哈...」",
  "紀錄到這裡就斷了。最後一頁只有一幅用力過猛的炭筆畫:一輪滿月,月面上纏繞著許多細長的、像根一樣的東西。",
];
const OBSERVATORY_LORE_KEY = "observatory-lore-index";

/**
 * 整備頁「出發」時呼叫:地圖是固定的,探索過的區域跨遠征保留,
 * 但新遠征要把玩家放回出發點、補滿水、重設檢查點。
 */
export function markFreshExpedition() {
  // 連續空手而歸的計數(引導事件的燃料):上一趟一無所獲 → +1,有收穫 → 歸零。
  // 「收穫」= 撿到任何東西,或打通任何探勘層(戰鬥頁也會蓋章)
  if (expeditionSerial() > 0) {
    const fruitless = localStorage.getItem("expedition-gained") !== "1";
    const n = Number(localStorage.getItem("fruitless-expeditions") ?? "0");
    localStorage.setItem("fruitless-expeditions", String(fruitless ? n + 1 : 0));
  }
  localStorage.removeItem("expedition-gained");
  // 迷宮五盜:偷竊紀錄與贓物跨遠征不保留——沒從 Boss 手上拿回來,就是沒了
  localStorage.removeItem("pending-group");
  localStorage.removeItem("maze-stolen");
  localStorage.removeItem("maze-stolen-kinds");
  localStorage.removeItem("maze-theft");
  localStorage.removeItem("maze-entered");
  localStorage.removeItem("maze-stash-seen");
  localStorage.setItem(FRESH_KEY, "1");
  // 每趟遠征都從村莊(中央地圖)出發;遠征序號 +1,各地圖據此重置據點儲備
  localStorage.setItem(CURRENT_MAP_KEY, "A");
  localStorage.setItem(EXPEDITION_SERIAL_KEY, String(expeditionSerial() + 1));
}

const SYMBOL_TO_TYPE: Record<string, TileType> = Object.fromEntries(
  Object.entries(TILE_SYMBOL).map(([type, symbol]) => [symbol, type as TileType]),
);

/**
 * 探索中撿到的敘事碎片(worldbuilding.md § 8.2 認知揭露弧線的第一階段線索)。
 * 核心寫作原則:只給線索,不說破——玩家此刻應該還以為這是個普通的中古世界,
 * 這些碎片是「曾有現代文明」的第一批暗示,說得越少越好。
 */
const NARRATIVE_FINDS: string[] = [
  "草叢裡有一小片又硬又輕的碎片,不是木頭也不是石頭。摸起來冰涼光滑,你說不出它是什麼。",
  "一截埋在土裡的細長金屬,筆直得不可思議——沒有任何鍛造的鎚痕。",
  "碎石堆下壓著一張脆化的紙片,上面印著整齊得詭異的小字。大部分已經模糊,只認得出一個詞:「……疏散……」",
  "半埋的木盒裡有一本泡爛的小冊子,字跡雋秀:「……他最近總是盯著院子裡那棵樹看,一句話也不說……」後面的頁面黏死了。",
  "一塊斷裂的平滑石板,表面刻著筆直的溝槽,溝槽裡殘留著暗色的、像是金屬的東西。",
  "你在樹幹上發現幾道抓痕。太高了——不管是什麼留下的,牠站起來比你高得多。",
  "風裡短暫飄來一段像是歌聲的聲音,又立刻消失了。方向不明。",
  "地上有一只小小的圓形玻璃片,磨得很精細,把景物放得很大。誰會做這種東西?又是為了看什麼?",
];

export interface CollectedItem {
  x: number;
  y: number;
  type: TileType;
}

/** 自動拾取開關(預設關:每次拾獲都由玩家抉擇;探索頁的按鈕切換) */
export function isAutoPickup(): boolean {
  return localStorage.getItem("auto-pickup") === "1";
}

export function setAutoPickup(on: boolean) {
  localStorage.setItem("auto-pickup", on ? "1" : "0");
}

/** 讀村莊「裝備中」的被動(擁有但沒裝上的不生效) */
function readPerk(id: string): boolean {
  try {
    const v = JSON.parse(localStorage.getItem("village-state") ?? "{}");
    if (Array.isArray(v.equippedPerks)) return v.equippedPerks.includes(id);
    return v.perks?.[id] === true; // 舊存檔還沒經過村莊頁遷移:退回全生效
  } catch {
    return false;
  }
}

/** 火車蓋好了嗎:通車後軌上移動不再消耗水糧(村莊建築,跨頁讀存檔) */
function hasTrainBuilt(): boolean {
  try {
    const v = JSON.parse(localStorage.getItem("village-state") ?? "{}");
    return ((v.buildingCounts ?? {})["train"] ?? 0) > 0;
  } catch {
    return false;
  }
}

/** 水量上限:村莊做出「大水袋」升級後放寬(village/data.ts WATERSKIN_CAPACITY) */
function readWaterCapacity(): number {
  try {
    const v = JSON.parse(localStorage.getItem("village-state") ?? "{}");
    const u = v.upgrades ?? {};
    if (u["steel-flask"]) return 50;
    if (u["iron-flask"]) return 40;
    if (u.waterskin) return 32;
    return 20;
  } catch {
    return 20;
  }
}

export interface ExploreCallbacks {
  onLog: (text: string) => void;
  onDeath: () => void;
  /** 隨機遭遇觸發時呼叫,由 UI 層決定要不要真的跳去戰鬥畫面(§3.7) */
  onEncounter: () => void;
}

const REVEAL_RADIUS = 3; // 上下左右各 3 格的菱形視野(曼哈頓距離)
const MOVE_WATER_COST = 1; // 每格 1 水(design-notes.md § 3.4)
const FOOD_EVERY_STEPS = 2; // 每走 2 格消耗 1 乾糧(仿 ADR)
// §3.7 隨機遭遇。2026-08 依用戶要求上調:未點燈的荒野 0.2(約每 5~6 步一戰,真正的險地),
// 點燈後 ×0.5 → 0.1,正好等於舊版的基礎值——燈火從「加分項」升格為「必修基建」:
// 想安全走廊就得鋪燈,鐵軌管水糧、燈火管遇敵的分工更鮮明
const ENCOUNTER_CHANCE = 0.2;
const LAMP_OIL_COST = 1; // 點亮一座據點燈柱要一罐燈油(一罐=舊制三份,占 3 格)
export const LAMP_RADIUS = 8; // 燈火壓遇敵的範圍(曼哈頓距離);UI 用它把光圈畫在地圖上
const LAMP_SUPPRESS = 0.5; // 照亮區內的遭遇率倍率(0.2 × 0.5 = 舊版基礎值 0.1)

export class ExploreEngine {
  /** 這個引擎實例所在的地圖 */
  readonly mapId: MapId;
  grid: Tile[][];
  playerX: number;
  playerY: number;
  water: number;
  /** 上限刻意壓低,前期活動範圍靠初始區域密集的補給點支撐;做出「大水袋」升級後放寬 */
  maxWater = readWaterCapacity();
  /** 隨身行囊(整備頁打包),null = 什麼都沒帶就出門了 */
  carried: Carried | null;
  checkpoint: Checkpoint;
  private stepCount = 0;
  /** 斷水後硬撐的步數(寬限 2 步,第 3 步倒下);補到水就歸零 */
  private thirstSteps = 0;
  /** 斷糧後硬撐的步數(規則同上) */
  private hungerSteps = 0;
  /** 戰後喘息:每場戰鬥結束後 3 步內不再觸發隨機遭遇,避免連環戰把節奏打爛 */
  private encounterGrace = 0;
  /** 開著的選擇式小劇情(事件框):有它在,移動整個停住等抉擇 */
  pendingChoiceEvent: ChoiceEventDef | null = null;
  /** 抉擇後的結果文本(第二幕):按「繼續」才收起 */
  pendingChoiceResult: string | null = null;
  /** 結果收起後要開打的事件小 Boss(如「唱歌的風」的哼歌者) */
  private pendingBossAfterResult = false;
  /** 這趟遠征已領過乾糧儲備的據點("x,y"):每個據點每趟只給一次,新遠征重置 */
  private depotGrantsUsed = new Set<string>();
  /** 這趟遠征已在哪些據點休整過(同上,防止進出刷血) */
  private depotHealUsed = new Set<string>();
  /** 腳邊還沒做決定的拾獲物(手動拾取模式):走開就留在身後 */
  pendingPickup: Record<string, number> | null = null;
  /** 這份地圖狀態屬於第幾趟遠征(據點儲備的重置依據) */
  private stateSerial = -1;
  /** 軌上連續行走的步數(水 1/4 步、糧 1/8 步的節流計數) */
  private railSteps = 0;
  /** 離開最後一個據點後,新揭露的格子座標,用來在死亡時把迷霧退回據點狀態(§3.9) */
  private revealedSinceCheckpoint = new Set<string>();
  /** 離開最後一個據點後拾獲、尚未帶回的東西,死亡時退回原位(§3.9) */
  private collectedSinceCheckpoint: CollectedItem[] = [];

  constructor(private readonly cb: ExploreCallbacks) {
    this.mapId = currentMapId();
    this.carried = loadCarried();

    // 地圖是固定的(種子生成);探索進度(迷霧/拾獲狀態)跨遠征保留
    const restored = this.restoreState();
    const start = startPosition();
    if (restored) {
      this.grid = restored.grid;
      this.playerX = restored.playerX;
      this.playerY = restored.playerY;
      this.water = restored.water;
      this.stepCount = restored.stepCount;
      this.thirstSteps = restored.thirstSteps ?? 0;
      this.hungerSteps = restored.hungerSteps ?? 0;
      this.encounterGrace = restored.encounterGrace ?? 0;
      this.checkpoint = restored.checkpoint;
      this.revealedSinceCheckpoint = restored.revealedSinceCheckpoint;
      this.collectedSinceCheckpoint = restored.collectedSinceCheckpoint;
      this.depotGrantsUsed = restored.depotGrantsUsed;
      this.depotHealUsed = restored.depotHealUsed;
      this.pendingPickup = restored.pendingPickup;
      this.stateSerial = restored.serial;
      this.railSteps = restored.railSteps;
    } else {
      this.grid = generateMap(this.mapId);
      this.playerX = start.x;
      this.playerY = start.y;
      this.water = this.maxWater;
      this.checkpoint = { x: start.x, y: start.y, water: this.maxWater };
      this.reveal(start.x, start.y);
    }

    // 跨圖落點(一次性):從出口走過來,落在這張地圖的入口
    try {
      const entryRaw = localStorage.getItem(MAP_ENTRY_KEY);
      if (entryRaw) {
        localStorage.removeItem(MAP_ENTRY_KEY);
        const entry = JSON.parse(entryRaw) as { x: number; y: number; water?: number };
        this.playerX = entry.x;
        this.playerY = entry.y;
        if (entry.water !== undefined) this.water = entry.water; // 水量跟著人走——跨圖不是免費補水
        this.checkpoint = { x: entry.x, y: entry.y, water: this.water };
        this.revealedSinceCheckpoint.clear();
        this.collectedSinceCheckpoint = [];
        this.reveal(entry.x, entry.y);
        // 第一次踏上這張地圖:播抵達敘事
        const visited = new Set<string>(JSON.parse(localStorage.getItem(VISITED_MAPS_KEY) ?? "[]") as string[]);
        if (!visited.has(this.mapId) && MAP_DEFS[this.mapId].arrivalText) {
          visited.add(this.mapId);
          localStorage.setItem(VISITED_MAPS_KEY, JSON.stringify([...visited]));
          this.cb.onLog(MAP_DEFS[this.mapId].arrivalText);
        }
      }
    } catch {
      /* 壞資料忽略 */
    }

    // 拾荒的長手已敗:迷宮視野永久全開(原野上也看得到內部)
    if (this.mapId === "A" && clearedLandmarks().includes("scavenger")) {
      for (let y = MAZE.y1; y <= MAZE.y2; y++) {
        for (let x = MAZE.x1; x <= MAZE.x2; x++) {
          const t = this.grid[y]?.[x];
          if (t) t.revealed = true;
        }
      }
    }

    // 新遠征序號:每張地圖第一次在這趟被載入時,重置據點儲備
    const serial = expeditionSerial();
    if (this.stateSerial !== serial) {
      this.stateSerial = serial;
      this.depotGrantsUsed.clear();
      this.depotHealUsed.clear();
    }

    // 新遠征(整備頁出發):人回到出發點、補滿水、重設檢查點,但保留已探索的迷霧
    if (this.mapId === "A" && localStorage.getItem(FRESH_KEY)) {
      localStorage.removeItem(FRESH_KEY);
      this.playerX = start.x;
      this.playerY = start.y;
      this.water = this.maxWater;
      this.stepCount = 0;
      this.thirstSteps = 0;
      this.hungerSteps = 0;
      this.checkpoint = { x: start.x, y: start.y, water: this.maxWater };
      this.revealedSinceCheckpoint.clear();
      this.collectedSinceCheckpoint = [];
      this.depotGrantsUsed.clear(); // 新遠征:各據點的乾糧儲備重新補上
      this.depotHealUsed.clear();
      this.reveal(start.x, start.y);

      // 戰死歸來後的第一次再出門(且已做出大水袋):她的道別多停了一會兒——一次性
      try {
        const v = JSON.parse(localStorage.getItem("village-state") ?? "{}");
        if (
          localStorage.getItem("died-once") === "1" &&
          (v.upgrades ?? {}).waterskin === true &&
          !localStorage.getItem("waterskin-farewell-shown")
        ) {
          localStorage.setItem("waterskin-farewell-shown", "1");
          this.cb.onLog("她幫你把新水袋的繩結繫緊並掛到了你的肩上,手卻停留在那繩結上遲遲不肯放開。");
          this.cb.onLog("『走遠一點也沒關係了。……但要記得回來。』");
        }
      } catch {
        /* 壞資料忽略 */
      }
    }

    // 邊境據點(入口內側):新加的固定補給點——舊的相鄰地圖存檔載入後補打(冪等)
    const border = borderDepotFor(this.mapId);
    if (border && this.grid[border.y]?.[border.x] && this.grid[border.y][border.x].type !== "depot") {
      this.grid[border.y][border.x] = { ...this.grid[border.y][border.x], type: "depot" };
    }

    // 打通的 Lv1/Lv3 探勘點升格為前線補給基地(各地圖處理自己的點)
    this.promoteClearedSitesToDepots();

    // 剛打贏地城回到地圖時,人就站在據點上(補給點或解放後的地標)——直接補給。
    // 沒有這一手,在礦坑/觀測台這種深處打完勝仗,會因為水袋見底而回不了家
    const standing = this.grid[this.playerY]?.[this.playerX];
    if (standing?.type === "depot") {
      this.refillHere();
    } else if (standing?.type === "landmark") {
      const site = siteAt(this.playerX, this.playerY, this.mapId);
      if (site && siteProgress(site.key).cleared) this.refillHere();
    }

    this.saveState();
  }

  /** Lv1/Lv3 打通後變成補給點(前線基地);只處理本地圖的點 */
  private promoteClearedSitesToDepots() {
    for (const s of specialSites()) {
      if ((s.mapId ?? "A") !== this.mapId) continue;
      if ((s.level === 1 || s.level === 3) && siteProgress(s.key).cleared) {
        const tile = this.grid[s.y]?.[s.x];
        if (tile && tile.type !== "depot") tile.type = "depot";
      }
    }
  }

  /** 這個據點這趟遠征是否已領過乾糧儲備(UI 用:拿空的補給點畫成小寫 s) */
  isDepotLooted(x: number, y: number): boolean {
    return this.depotGrantsUsed.has(this.key(x, y));
  }

  /** 站在出口上時,這個出口通往哪裡(給 UI 顯示「前進」按鈕) */
  exitLinkHere(): ExitLink | null {
    const tile = this.grid[this.playerY]?.[this.playerX];
    if (!tile || tile.type !== "exit") return null;
    return exitLinkAt(this.mapId, this.playerX, this.playerY);
  }

  /** 跨圖移動:保存這張地圖的進度,切換目前地圖並記下落點;由 UI 重新載入頁面完成切換 */
  travelThroughExit(): ExitLink | null {
    const link = this.exitLinkHere();
    if (!link) return null;
    this.saveState();
    localStorage.setItem(CURRENT_MAP_KEY, link.to);
    localStorage.setItem(MAP_ENTRY_KEY, JSON.stringify({ x: link.entryX, y: link.entryY, water: this.water }));
    return link;
  }

  /** 目前站著的未打通探勘點(給 UI 顯示「深入調查」按鈕用) */
  currentSite() {
    const site = siteAt(this.playerX, this.playerY, this.mapId);
    if (!site) return null;
    const progress = siteProgress(site.key);
    if (progress.cleared) return null;
    return { site, progress };
  }

  /** 玩家按下「深入調查」:寫入地城狀態,由 UI 觸發跳戰鬥頁 */
  startDungeon(): boolean {
    const current = this.currentSite();
    if (!current) return false;
    // 靜默教堂上了鎖:要先在某座遺跡深處找到黑鐵鑰匙(UI 端會顯示鎖的敘事)
    if (current.site.landmarkId === "church" && !hasChurchKey()) return false;
    const run: DungeonRun = {
      key: current.site.key,
      level: current.site.level,
      stage: current.progress.stage + 1,
      stages: current.site.stages,
      landmarkId: current.site.landmarkId,
    };
    localStorage.setItem(DUNGEON_KEY, JSON.stringify(run));
    this.encounterGrace = 3; // 地城戰打完出來也給喘息,不會一出門又被隨機遭遇堵上
    this.saveState();
    return true;
  }

  /** 跳去戰鬥頁前保存遠征進度,回來時 restoreState 接續 */
  saveState() {
    const typeRows: string[] = [];
    const revealRows: string[] = [];
    const litRows: string[] = [];
    const railRows: string[] = [];
    for (const row of this.grid) {
      typeRows.push(row.map((t) => TILE_SYMBOL[t.type]).join(""));
      revealRows.push(row.map((t) => (t.revealed ? "1" : "0")).join(""));
      litRows.push(row.map((t) => (t.lit ? "1" : "0")).join(""));
      railRows.push(row.map((t) => (t.rail ? "1" : "0")).join(""));
    }
    localStorage.setItem(
      stateKeyFor(this.mapId),
      JSON.stringify({
        serial: this.stateSerial,
        typeRows,
        revealRows,
        playerX: this.playerX,
        playerY: this.playerY,
        water: this.water,
        stepCount: this.stepCount,
        thirstSteps: this.thirstSteps,
        hungerSteps: this.hungerSteps,
        encounterGrace: this.encounterGrace,
        checkpoint: this.checkpoint,
        revealedSince: [...this.revealedSinceCheckpoint],
        collectedSince: this.collectedSinceCheckpoint,
        depotGrantsUsed: [...this.depotGrantsUsed],
        depotHealUsed: [...this.depotHealUsed],
        pendingPickup: this.pendingPickup,
        railSteps: this.railSteps,
        litRows,
        railRows,
      }),
    );
  }

  private restoreState() {
    try {
      const raw = localStorage.getItem(stateKeyFor(this.mapId));
      if (!raw) return null;
      const s = JSON.parse(raw);
      const grid: Tile[][] = (s.typeRows as string[]).map((rowStr: string, y: number) =>
        [...rowStr].map((symbol, x) => ({
          type: SYMBOL_TO_TYPE[symbol] ?? "plain",
          revealed: (s.revealRows as string[])[y][x] === "1",
          lit: (s.litRows as string[] | undefined)?.[y]?.[x] === "1",
          rail: (s.railRows as string[] | undefined)?.[y]?.[x] === "1",
        })),
      );
      return {
        grid,
        playerX: s.playerX as number,
        playerY: s.playerY as number,
        water: s.water as number,
        stepCount: s.stepCount as number,
        thirstSteps: (s.thirstSteps ?? 0) as number,
        hungerSteps: (s.hungerSteps ?? 0) as number,
        encounterGrace: (s.encounterGrace ?? 0) as number,
        checkpoint: s.checkpoint as Checkpoint,
        revealedSinceCheckpoint: new Set<string>(s.revealedSince ?? []),
        collectedSinceCheckpoint: (s.collectedSince ?? []) as CollectedItem[],
        depotGrantsUsed: new Set<string>(s.depotGrantsUsed ?? []),
        depotHealUsed: new Set<string>(s.depotHealUsed ?? []),
        pendingPickup: (s.pendingPickup ?? null) as Record<string, number> | null,
        serial: (s.serial ?? -1) as number,
        railSteps: (s.railSteps ?? 0) as number,
      };
    } catch {
      return null;
    }
  }

  get rations(): number {
    return this.carried?.rations ?? 0;
  }

  get hp(): number {
    return this.carried?.hp ?? playerMaxHp();
  }

  private key(x: number, y: number) {
    return `${x},${y}`;
  }

  private reveal(cx: number, cy: number) {
    // 迷宮視野(§2026-09 用戶定案):牆內只看得到貼身一圈(不透牆);
    // 打贏拾荒的長手之前,從外面完全看不進迷宮內部——勝利後全開(見建構子)
    const scavCleared = clearedLandmarks().includes("scavenger");
    const inMazeNow = this.mapId === "A" && !scavCleared && isMazeInterior(cx, cy);
    const radius = inMazeNow ? 1 : REVEAL_RADIUS;
    // 菱形視野:曼哈頓距離 |dx|+|dy| <= radius,而不是正方形範圍
    for (let dy = -radius; dy <= radius; dy++) {
      const remain = radius - Math.abs(dy);
      for (let dx = -remain; dx <= remain; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (this.mapId === "A" && !scavCleared && !inMazeNow && isMazeInterior(x, y)) continue; // 外面看不進迷宮
        const tile = this.grid[y]?.[x];
        if (tile && !tile.revealed) {
          tile.revealed = true;
          this.revealedSinceCheckpoint.add(this.key(x, y));
        }
      }
    }
  }

  // ---- 迷宮五盜(拾荒的長手,§2026-09)----

  private mazeDepthMap: Map<string, number> | null = null;

  /** 迷宮內各格離入口的步數(BFS;牆擋路)——深度帶的量尺 */
  private mazeDepths(): Map<string, number> {
    if (this.mazeDepthMap) return this.mazeDepthMap;
    const m = new Map<string, number>();
    const q: [number, number, number][] = [[MAZE.entrance.x, MAZE.entrance.y, 0]];
    m.set(`${MAZE.entrance.x},${MAZE.entrance.y}`, 0);
    while (q.length) {
      const [x, y, d] = q.shift()!;
      for (const [ddx, ddy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + ddx;
        const ny = y + ddy;
        if (nx < MAZE.x1 || nx > MAZE.x2 || ny < MAZE.y1 || ny > MAZE.y2) continue;
        const k = `${nx},${ny}`;
        if (m.has(k)) continue;
        const t = this.grid[ny]?.[nx];
        if (!t || BLOCKED.includes(t.type)) continue;
        m.set(k, d + 1);
        q.push([nx, ny, d + 1]);
      }
    }
    this.mazeDepthMap = m;
    return m;
  }

  /** 這一格落在第幾個深度帶(0~4;未達第一帶 = -1):以 Boss 深度均分五段 */
  private theftBandAt(x: number, y: number): number {
    const m = this.mazeDepths();
    const d = m.get(`${x},${y}`);
    if (d === undefined) return -1;
    const bossD = m.get(`${MAZE.boss.x},${MAZE.boss.y}`) ?? 30;
    const fr = [0.15, 0.35, 0.5, 0.7, 0.85];
    let band = -1;
    for (let i = 0; i < fr.length; i++) {
      if (d >= Math.round(bossD * fr[i])) band = i;
    }
    return band;
  }

  private theftBandsDone(): number[] {
    try {
      const o = JSON.parse(localStorage.getItem("maze-theft") ?? "null") as { serial: number; bands: number[] } | null;
      if (o && o.serial === expeditionSerial()) return o.bands;
    } catch {
      /* 壞資料重來 */
    }
    return [];
  }

  private markTheftBand(b: number) {
    const bands = this.theftBandsDone();
    bands.push(b);
    localStorage.setItem("maze-theft", JSON.stringify({ serial: expeditionSerial(), bands }));
  }

  /**
   * 滑鼠點擊用:不用點準相鄰格,點在玩家哪一側就往哪個方向走一步。
   * 例如點在 @ 右邊(不管遠近)就往右走一格,取水平/垂直落差較大的那一軸為移動方向。
   */
  moveTo(x: number, y: number) {
    const dx = x - this.playerX;
    const dy = y - this.playerY;
    if (dx === 0 && dy === 0) return;
    if (Math.abs(dx) > Math.abs(dy)) {
      this.move(Math.sign(dx), 0);
    } else {
      this.move(0, Math.sign(dy));
    }
  }

  /** dx/dy 為 -1/0/1,代表移動方向 */
  move(dx: number, dy: number) {
    if (this.pendingChoiceEvent || this.pendingChoiceResult) return; // 事件框開著:先做完抉擇
    const nx = this.playerX + dx;
    const ny = this.playerY + dy;
    const target = this.grid[ny]?.[nx];
    if (!target || BLOCKED.includes(target.type)) {
      this.cb.onLog("那個方向走不過去。");
      return;
    }

    // 山坡(2026-09 用戶定案):順著山勢才走得上去——/ 從左邊上、| 直上直下、\ 從右邊上
    if (
      (target.type === "slopeL" && !(dx === 1 && dy === 0)) ||
      (target.type === "slopeV" && dx !== 0) ||
      (target.type === "slopeR" && !(dx === -1 && dy === 0))
    ) {
      this.cb.onLog("山坡太陡,這一面爬不上去——得順著山勢繞。");
      return;
    }

    // 腳邊還有沒撿的東西:走開就等於放棄
    if (this.pendingPickup && Object.keys(this.pendingPickup).length > 0) {
      this.cb.onLog("你把剩下的東西留在了身後。");
    }
    this.pendingPickup = null;

    this.playerX = nx;
    this.playerY = ny;
    this.reveal(nx, ny);
    this.stepCount++;

    // ---- 東南迷宮:首入敘事、五盜伏擊、贓物架(勝利前限定)----
    if (this.mapId === "A" && !clearedLandmarks().includes("scavenger") && isMazeInterior(nx, ny)) {
      if (localStorage.getItem("maze-entered") !== String(expeditionSerial())) {
        localStorage.setItem("maze-entered", String(expeditionSerial()));
        this.cb.onLog("牆縫窄得只容一人側身。裡面的黑暗有一種被整理過的味道——每樣東西,都有它被擺放的位置。");
      }
      const bandMax = this.theftBandAt(nx, ny);
      if (bandMax >= 0) {
        const done = this.theftBandsDone();
        for (let b = 0; b <= bandMax; b++) {
          if (!done.includes(b)) {
            this.markTheftBand(b);
            localStorage.setItem("pending-event-boss", "tentacle");
            this.saveState();
            this.cb.onEncounter();
            return;
          }
        }
      }
      if (nx === MAZE.stash.x && ny === MAZE.stash.y && localStorage.getItem("maze-stash-seen") !== String(expeditionSerial())) {
        localStorage.setItem("maze-stash-seen", String(expeditionSerial()));
        const stolen = JSON.parse(localStorage.getItem("maze-stolen") ?? "[]") as unknown[];
        if (stolen.length > 0) this.cb.onLog("牆縫深處整整齊齊擺著你的東西——像展示,又像誘餌。");
      }
    }

    if (target.type === "chest") {
      // 迷宮寶箱(名刀鬼雪):打贏守著它的東西才開得了;一次性
      if (!clearedLandmarks().includes("scavenger")) {
        this.cb.onLog("上鎖的箱子——撬不開。守著它的東西還在。");
      } else if (localStorage.getItem("oniyuki-claimed")) {
        this.cb.onLog("箱子已經空了。");
      } else if (this.carried) {
        if (packUsed(this.carried) + 2 > (this.carried.packCap ?? 20)) {
          this.cb.onLog("背包塞不下這柄刀——騰出空間再來。");
        } else {
          localStorage.setItem("oniyuki-claimed", "1");
          this.carried.weapons["oniyuki"] = (this.carried.weapons["oniyuki"] ?? 0) + 1;
          this.carried.durability["oniyuki"] = this.carried.durability["oniyuki"] ?? 60; // 與 WEAPONS 定義同步
          saveCarried(this.carried);
          this.markGained({ oniyuki: 1 });
          this.cb.onLog("箱底躺著一柄刀。刀身白得像初雪,握柄纏著褪色的藍繩——碰到的瞬間,指尖凍得一麻。");
          this.cb.onLog("獲得了【名刀——鬼雪】。");
        }
      }
    } else if (target.type === "depot") {
      // 邊境據點:第一次踏上時的一段敘事(每張相鄰地圖一次)
      const border = borderDepotFor(this.mapId);
      if (border && border.x === nx && border.y === ny && !localStorage.getItem(`border-depot-seen:${this.mapId}`)) {
        localStorage.setItem(`border-depot-seen:${this.mapId}`, "1");
        this.cb.onLog("入口內側有一座半塌的補給棚,棚內是一些發舊的物資,還有稍微可用的工具,應該修補一下就可以使用。");
        this.cb.onLog("『接下來的旅途這裡會很適合當中繼點。』");
      }
      this.refillHere();
    } else if (target.type === "resource" || target.type === "event") {
      this.collectedSinceCheckpoint.push({ x: nx, y: ny, type: target.type });
      // 選擇式小劇情(2026-09 核可):事件點有機率開出「停下來抉擇」的一幕——
      // 每則一場遊戲只出現一次(觸發即記名),抽完後回到平常的碎片/補給
      if (target.type === "event" && this.maybeStartChoiceEvent()) {
        target.type = "plain";
        this.saveState();
        return;
      }
      const rolled =
        this.mapId === "A" && MAZE.rations.some((rt) => rt.x === nx && rt.y === ny)
          ? { ration: 2 }
          : this.rollPickupGains(target.type);
      target.type = "plain";
      if (typeof rolled === "string") {
        this.cb.onLog(rolled); // 敘事碎片,或沒背囊
      } else if (isAutoPickup()) {
        this.cb.onLog(this.applyPickup(rolled)); // 自動拾取:照舊全收(受揹負空間限制)
      } else {
        // 手動拾取:先擺在腳邊,列出來讓玩家決定撿什麼、丟什麼
        this.pendingPickup = rolled;
        const text = Object.entries(rolled)
          .map(([id, n]) => `${RESOURCE_LABEL[id as ResourceId]} ×${n}`)
          .join("、");
        this.cb.onLog(`你翻找出:${text}。`);
      }
    } else if (target.type === "site" || target.type === "landmark") {
      // 特殊探勘地點(五級制):踩上只給敘事與危險氛圍,由玩家主動選「深入調查」才開戰
      const site = siteAt(nx, ny, this.mapId);
      if (site) {
        const progress = siteProgress(site.key);
        const lm = LANDMARKS.find((l) => l.x === nx && l.y === ny);
        if (progress.cleared) {
          if (lm?.id === "observatory") {
            const idx = Number(localStorage.getItem(OBSERVATORY_LORE_KEY) ?? "0");
            this.cb.onLog(OBSERVATORY_LORE[Math.min(idx, OBSERVATORY_LORE.length - 1)]);
            if (idx < OBSERVATORY_LORE.length - 1) localStorage.setItem(OBSERVATORY_LORE_KEY, String(idx + 1));
          } else if (lm) {
            this.cb.onLog(lm.clearedText);
          } else {
            this.cb.onLog("這裡已經被你清理乾淨了。");
          }
          // 解放後的地標同時是前線據點:能補水補糧、記錄檢查點——
          // 沒有這一層,礦坑/觀測台這種離補給網 20+ 步的地方就是回不來的單程票。
          // 第一次進攻仍然是「不打贏就回不了家」的豪賭(Lv4 到場警語說的正是這件事)
          if (lm) this.refillHere();
        } else {
          if (lm) this.cb.onLog(`【${lm.label}】${lm.introText}`);
          this.cb.onLog(SITE_ARRIVAL_TEXT[site.level]);
          if (progress.stage > 0) this.cb.onLog("你認得自己上次留下的記號——可以從中斷的地方繼續深入。");
        }
      }
    } else if (target.type === "exit") {
      const link = this.exitLinkHere();
      if (link) {
        this.cb.onLog(link.to === "A" ? "路往回坡去——再走下去就回到中央地帶了。" : "路在腳下向遠方延伸,越過這道稜線,就是另一片土地了。");
      }
    }

    // 軌上移動(這一步的起點與終點都有軌):台車滑行——水 1/4 步、糧 1/8 步、不遇敵
    const fromTile = this.grid[this.playerY - dy]?.[this.playerX - dx];
    const onRail = !!(fromTile?.rail && target.rail);
    if (onRail) this.railSteps++;

    // 水:每步扣(軌上每 4 步扣 1);食物:每 2 步吃一餐(軌上每 8 步)——先吃輕便的乾糧(不回血),
    // 乾糧見底改咬肉乾(重但滋養,回血),兩者都空了才是真正的斷糧
    // 測試模式(工具列 DEV 鈕):水糧不耗、不遇敵——走遍地圖驗地形用;正式發布前移除
    const devMode = localStorage.getItem("explore-dev") === "1";
    const wasDry = this.water <= 0; // 這一步出發前就已經沒水了
    const trainRunning = onRail && hasTrainBuilt(); // 火車通車:車廂代步,軌上零消耗
    if (devMode) {
      // 測試模式不耗水
    } else if (onRail) {
      if (!trainRunning && this.railSteps % 4 === 0) this.water = Math.max(0, this.water - 1);
    } else {
      this.water = Math.max(0, this.water - MOVE_WATER_COST);
    }
    let ateThisStep = false;
    const foodDue = !devMode && (onRail ? !trainRunning && this.railSteps % 8 === 0 : this.stepCount % FOOD_EVERY_STEPS === 0);
    if (this.carried && foodDue) {
      if (this.carried.rations > 0) {
        this.carried.rations--;
        ateThisStep = true;
        if (this.carried.rations === 2) this.cb.onLog("背囊裡的乾糧所剩無幾了。");
        if (this.carried.rations === 0 && (this.carried.jerky ?? 0) > 0) this.cb.onLog("乾糧吃完了。接下來只能靠肉乾撐著。");
      } else if ((this.carried.jerky ?? 0) > 0) {
        this.carried.jerky = (this.carried.jerky ?? 0) - 1;
        ateThisStep = true;
        this.carried.hp = Math.min(playerMaxHp(), (this.carried.hp ?? playerMaxHp()) + 10);
        this.cb.onLog("你咬了口肉乾——鹹得發苦,但力氣實實在在地回來了。");
      }
      saveCarried(this.carried);
    }
    if (this.water === 4) this.cb.onLog("水袋輕得讓人不安。");
    if (this.water === 0 && !wasDry) this.cb.onLog("水完全喝光了。喉嚨像著了火——得馬上找到補給。");

    // 耗盡後的寬限:斷水/斷糧後都還能硬撐 2 步(找補給的最後機會),第 3 步倒下
    if (wasDry && this.water <= 0) {
      this.thirstSteps++;
      if (this.thirstSteps > 2) {
        this.die("你的腳步越來越沉,最後在乾渴中倒下……", "thirst");
        return;
      }
    } else if (this.water > 0) {
      this.thirstSteps = 0;
    }
    const noFood = !devMode && this.carried && this.carried.rations <= 0 && (this.carried.jerky ?? 0) <= 0;
    if (noFood && !ateThisStep) {
      this.hungerSteps++;
      if (this.hungerSteps === 1) this.cb.onLog("最後一點吃的也沒了。胃在絞痛——撐不了多久了。");
      if (this.hungerSteps > 2) {
        this.die("飢餓抽乾了你最後的力氣……", "hunger");
        return;
      }
    } else if (!noFood) {
      this.hungerSteps = 0;
    }

    // 村莊威壓圈:村子周邊有人活動、有火堆,野獸不在家門口晃(曼哈頓 6 格內遭遇率 ×0.3)——
    // 沒有這一圈,回程最後幾步被堵的機率高得離譜,「快到家了」變成最危險的時刻
    const start = startPosition();
    const nearHome = this.mapId === "A" && Math.abs(this.playerX - start.x) + Math.abs(this.playerY - start.y) <= 6;
    const homeMult = nearHome ? 0.3 : 1;
    // 燈火壓遇敵:照亮區(任一點燈據點的曼哈頓 8 格內)遭遇率打四折
    const lampMult = this.nearLitLamp() ? LAMP_SUPPRESS : 1;
    // 第一次走在光圈裡:用一句觀察描寫把「這裡安全得多」說給玩家體感(整輪遊戲只說一次)
    if (lampMult < 1 && !localStorage.getItem("lamp-glow-noticed")) {
      localStorage.setItem("lamp-glow-noticed", "1");
      this.cb.onLog("走在燈火裡,連夜風都柔和了些。窸窣與低嗥被擋在光的邊緣之外——這圈溫暖裡,肩膀可以稍微鬆下來。");
    }
    // 【潛行】(老者教的走法):遭遇率再 ×0.8
    const stealthMult = readPerk("stealth") ? 0.8 : 1;
    if (onRail) {
      // 軌道是人開出來的路:牠們不靠近鐵軌——完全不遇敵(滿狀態抵達 Boss 的戰略通道)
    } else if (this.encounterGrace > 0) {
      this.encounterGrace--; // 戰後喘息中,不觸發隨機遭遇
    } else if (!devMode && Math.random() < ENCOUNTER_CHANCE * lampMult * stealthMult * homeMult) {
      this.cb.onLog("⚠ 你感覺到附近有什麼東西的氣息……");
      // 外圍成群(2026-09 用戶定案「後期」):要離村夠遠(>32 格/相鄰圖),
      // 且至少解放過一座 Lv4 地標(進度門檻)——新手村圈永遠不會被三隻圍上
      {
        const gcx = Math.floor(MAP_WIDTH / 2);
        const gcy = Math.floor(MAP_HEIGHT / 2);
        const far = this.mapId !== "A" || Math.hypot(this.playerX - gcx, this.playerY - gcy) > 32;
        const lateGame = clearedLandmarks().length > 0;
        if (far && lateGame && Math.random() < 0.5) {
          localStorage.setItem("pending-group", "1");
          this.cb.onLog("……而且氣息不只一道。");
        }
      }
      this.encounterGrace = 3;
      this.saveState();
      this.cb.onEncounter();
      return;
    }

    // 每步存檔:地圖固定、進度持續保留,任何時候跳頁/重載都能接續
    this.saveState();
  }

  /** 目前位置是否在任一點燈據點的照亮範圍內 */
  private nearLitLamp(): boolean {
    for (let dy = -LAMP_RADIUS; dy <= LAMP_RADIUS; dy++) {
      const remain = LAMP_RADIUS - Math.abs(dy);
      for (let dx = -remain; dx <= remain; dx++) {
        if (this.grid[this.playerY + dy]?.[this.playerX + dx]?.lit) return true;
      }
    }
    return false;
  }

  /** 站著的這格能不能點燈:是據點(補給點/已解放地標)、還沒點過、身上燈油夠 */
  canLightLamp(): boolean {
    const tile = this.grid[this.playerY]?.[this.playerX];
    if (!tile || tile.lit) return false;
    const clearedLandmark =
      tile.type === "landmark" && !!siteAt(this.playerX, this.playerY, this.mapId) && siteProgress(siteAt(this.playerX, this.playerY, this.mapId)!.key).cleared;
    if (tile.type !== "depot" && !clearedLandmark) return false;
    return (this.carried?.oil ?? 0) >= LAMP_OIL_COST;
  }

  /** 這一格能不能鋪鐵軌:限中央地圖、身上有軌、格子可走且沒鋪過、與村莊或既有軌道相連 */
  canLayRail(): boolean {
    if (this.mapId !== "A" || !this.carried || (this.carried.rails ?? 0) <= 0) return false;
    const tile = this.grid[this.playerY]?.[this.playerX];
    if (!tile || tile.rail) return false;
    if (BLOCKED.includes(tile.type) || tile.type === "exit") return false;
    const start = startPosition();
    // 相連規則:貼著村莊,或四方向鄰接既有軌道
    if (Math.abs(this.playerX - start.x) + Math.abs(this.playerY - start.y) <= 1) return true;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      if (this.grid[this.playerY + dy]?.[this.playerX + dx]?.rail) return true;
    }
    return false;
  }

  /** 鋪一段鐵軌:永久建設(死亡不失去);鋪到礦坑旁,礦車開始自動運輸(村莊礦工產出×2) */
  layRail(): boolean {
    if (!this.canLayRail() || !this.carried) return false;
    const tile = this.grid[this.playerY][this.playerX];
    tile.rail = true;
    this.carried.rails = (this.carried.rails ?? 0) - 1;
    saveCarried(this.carried);
    // 鋪到礦坑旁:礦車自動運輸
    const mine = LANDMARKS.find((l) => l.id === "mine");
    if (mine && localStorage.getItem("rail-to-mine") !== "1") {
      const adj = Math.abs(this.playerX - mine.x) + Math.abs(this.playerY - mine.y) <= 1;
      if (adj) {
        localStorage.setItem("rail-to-mine", "1");
        this.cb.onLog("鐵軌接上了礦坑的舊軌道。第一台礦車被推上鐵軌時,整條路都在輕輕震——從今天起,礦石自己會回村了。(鐵礦工產出 ×2)");
      }
    }
    this.saveState();
    return true;
  }

  /** 站在據點上嗎(補給點或已解放地標)——休息類動作的前提 */
  private atRestPoint(): boolean {
    const tile = this.grid[this.playerY]?.[this.playerX];
    if (!tile) return false;
    if (tile.type === "depot") return true;
    if (tile.type === "landmark") {
      const site = siteAt(this.playerX, this.playerY, this.mapId);
      return !!site && siteProgress(site.key).cleared;
    }
    return false;
  }

  /** 據點上可以坐下來吃肉乾補血(玩家自己決定要不要花這口糧) */
  canEatJerky(): boolean {
    if (!this.atRestPoint() || !this.carried) return false;
    if (this.isAtHome()) return false; // 家門口不啃行軍糧——結束遠征回村休整就好
    return (this.carried.jerky ?? 0) > 0 && (this.carried.hp ?? playerMaxHp()) < playerMaxHp();
  }

  /** 站在村莊出發點上嗎(中央地圖限定)——家門口不是荒野據點,不套補給/休整那一套 */
  private isAtHome(): boolean {
    if (this.mapId !== "A") return false;
    const start = startPosition();
    return this.playerX === start.x && this.playerY === start.y;
  }

  /** 吃一份肉乾:+10 HP */
  eatJerky(): boolean {
    if (!this.canEatJerky() || !this.carried) return false;
    this.carried.jerky = (this.carried.jerky ?? 0) - 1;
    const before = this.carried.hp ?? playerMaxHp();
    this.carried.hp = Math.min(playerMaxHp(), before + 10);
    saveCarried(this.carried);
    this.saveState();
    this.cb.onLog(`你靠著據點坐下,慢慢嚼完一條肉乾。(HP +${this.carried.hp - before})`);
    return true;
  }

  /** 旅途中從背包使用恢復品(肉乾 +10/繃帶 +20/藥劑 +15)——不必等據點 */
  useHealingItem(kind: "jerky" | "bandage" | "elixir"): boolean {
    if (!this.carried) return false;
    const cap = playerMaxHp();
    const before = this.carried.hp ?? cap;
    if (before >= cap) return false;
    if (kind === "jerky") {
      if ((this.carried.jerky ?? 0) <= 0) return false;
      this.carried.jerky = (this.carried.jerky ?? 0) - 1;
      this.carried.hp = Math.min(cap, before + 10);
      this.cb.onLog(`你邊走邊嚼了一條肉乾。(HP +${this.carried.hp - before})`);
    } else if (kind === "bandage") {
      if (this.carried.bandages <= 0) return false;
      this.carried.bandages -= 1;
      this.carried.hp = Math.min(cap, before + 20);
      this.cb.onLog(`你停下腳步,把傷口重新包紮好。(HP +${this.carried.hp - before})`);
    } else {
      if ((this.carried.elixirs ?? 0) <= 0) return false;
      this.carried.elixirs = (this.carried.elixirs ?? 0) - 1;
      this.carried.hp = Math.min(cap, before + 15);
      this.cb.onLog(`你仰頭灌下一小口藥劑。(HP +${this.carried.hp - before})`);
    }
    saveCarried(this.carried);
    this.saveState();
    return true;
  }

  /** 點亮據點的燈柱:消耗燈油,永久壓低周圍的遭遇率 */
  lightLamp(): boolean {
    if (!this.canLightLamp() || !this.carried) return false;
    const tile = this.grid[this.playerY][this.playerX];
    tile.lit = true;
    this.carried.oil = (this.carried.oil ?? 0) - LAMP_OIL_COST;
    saveCarried(this.carried);
    this.saveState();
    this.cb.onLog("燈油淌進油槽,火苗竄上燈芯。溫暖的光漫開,把黑暗連同藏在其中的東西一併推遠。火光烘在臉上——這一小圈地方,重新屬於人了。");
    return true;
  }

  /**
   * 據點補給(補給點 $ 與解放後的地標共用):
   * - 水:據點有水源,無限補滿
   * - 乾糧:據點的「儲備」——每個據點每趟遠征只能拿一次,隨機 5~15 份(受揹負空間限制);
   *   拿過的據點這趟再回來只剩水,防止在據點旁反覆進出刷糧
   * - 記錄檢查點
   */
  private refillHere() {
    // 家門口什麼都不給(連水都不補):要補給就正式回村再整備出發——
    // 那一趟同時把行囊入庫、清出背包,才是完整的回村循環;站在村口的主角只有「返回村莊」
    if (this.isAtHome()) {
      this.setCheckpoint();
      return;
    }
    const waterGain = this.maxWater - this.water;
    this.water = this.maxWater;
    let rationGain = 0;
    const grantKey = this.key(this.playerX, this.playerY);
    const alreadyLooted = this.depotGrantsUsed.has(grantKey);
    let packWasFull = false;
    if (this.carried && !alreadyLooted) {
      const cap = this.carried.packCap ?? 20;
      const room = Math.max(0, cap - packUsed(this.carried));
      const stock = 5 + Math.floor(Math.random() * 11); // 5~15
      rationGain = Math.min(stock, room * RATIONS_PER_SLOT);
      if (rationGain > 0) {
        this.carried.rations += rationGain;
        this.depotGrantsUsed.add(grantKey);
        saveCarried(this.carried);
      } else {
        packWasFull = true; // 背包塞不下:儲備保留,不算拿過
      }
    }
    // 據點休整:安全的地方能好好包紮喘口氣——自動回復「缺損血量的一半」,
    // 每個據點每趟遠征一次(否則在據點旁進進出出就能免費磨到滿血);要更多就自己吃肉乾(UI 按鈕)
    let restHeal = 0;
    if (this.carried && !this.depotHealUsed.has(grantKey)) {
      const cap = playerMaxHp();
      const hp = this.carried.hp ?? cap;
      restHeal = Math.ceil((cap - hp) / 2);
      if (restHeal > 0) {
        this.carried.hp = hp + restHeal;
        this.depotHealUsed.add(grantKey);
        saveCarried(this.carried);
      }
    }

    this.setCheckpoint();
    // 具體回報補了什麼——玩家要能一眼看出據點的用處;沒補到東西也講清楚「真正的原因」
    const parts: string[] = [];
    if (waterGain > 0) parts.push(`水 +${waterGain}`);
    if (rationGain > 0) parts.push(`乾糧 +${rationGain}`);
    if (restHeal > 0) parts.push(`HP +${restHeal}(休整)`);
    let tail = "";
    if (packWasFull) tail = "儲藏格裡還有乾糧,但你的背包塞不下了——騰出空間再來拿。";
    else if (alreadyLooted && this.carried) tail = "儲備這趟已經拿過了,只剩水還能補給。";
    if (parts.length > 0) {
      this.cb.onLog(`補給:${parts.join("、")}。${tail}`);
    } else {
      this.cb.onLog(tail || "水是滿的,這裡暫時幫不上什麼忙。");
    }
  }

  /** 把一批拾獲物加進行囊(受揹負空間限制),回傳結算文字 */
  /** 事件點抽選擇式小劇情:抽中回 true(事件框由 UI 依 pendingChoiceEvent 呈現) */
  private maybeStartChoiceEvent(): boolean {
    if (!this.carried) return false;
    let seen: string[] = [];
    try {
      seen = JSON.parse(localStorage.getItem("choice-events-seen") ?? "[]") as string[];
    } catch {
      seen = [];
    }
    const pool = CHOICE_EVENTS.filter((e) => !seen.includes(e.id));
    if (pool.length === 0 || Math.random() >= 0.45) return false;
    const ev = pool[Math.floor(Math.random() * pool.length)];
    seen.push(ev.id);
    localStorage.setItem("choice-events-seen", JSON.stringify(seen)); // 觸發即記名:重整頁面也不會再開同一則
    this.pendingChoiceEvent = ev;
    return true;
  }

  /** 玩家做出抉擇:套效果、記結果文本(UI 顯示第二幕,按「繼續」收起) */
  resolveChoiceEvent(optionIndex: number) {
    const ev = this.pendingChoiceEvent;
    if (!ev) return;
    const opt = ev.options[optionIndex];
    if (!opt) return;
    this.pendingChoiceEvent = null;
    this.pendingChoiceResult = opt.result;
    this.cb.onLog(opt.result);
    const fx = opt.effect;
    if (fx && this.carried) {
      if (fx.kind === "gain") {
        const { added, overflow } = addLoot(this.carried, fx.gains);
        this.markGained(added);
        if (overflow) this.cb.onLog("(背包塞不下,一部分留在了原地)");
      } else if (fx.kind === "water") {
        this.water = Math.min(this.maxWater, this.water + fx.amount);
      } else if (fx.kind === "boss") {
        // 事件小 Boss:結果文本收起的那一刻開戰(戰鬥頁優先讀這把鑰匙)
        localStorage.setItem("pending-event-boss", fx.enemyId);
        this.pendingBossAfterResult = true;
      } else if (fx.kind === "trade") {
        const { added } = addLoot(this.carried, fx.gains);
        this.markGained(added);
        for (const [k, n] of Object.entries(fx.costs)) {
          // 目前只有乾糧一種代價;不足就不扣(留東西是心意,不是義務)
          if (k === "ration") this.carried.rations = Math.max(0, this.carried.rations - n);
        }
      }
      saveCarried(this.carried);
    }
    this.saveState();
  }

  /** 收起結果文本(第二幕結束,恢復行動;帶著 Boss 的事件在這一刻開戰) */
  dismissChoiceResult() {
    this.pendingChoiceResult = null;
    if (this.pendingBossAfterResult) {
      this.pendingBossAfterResult = false;
      this.saveState();
      this.cb.onEncounter();
    }
  }

  /** 蓋「這趟有收穫」章(引導事件據此歸零空手計數) */
  private markGained(added: Record<string, number>) {
    if (Object.keys(added).length > 0) localStorage.setItem("expedition-gained", "1");
  }

  private applyPickup(gains: Record<string, number>): string {
    if (!this.carried) return "拾獲了一些東西,但你沒有背囊可以裝。";
    const { added, overflow } = addLoot(this.carried, gains);
    this.markGained(added);
    saveCarried(this.carried);
    const entries = Object.entries(added);
    if (entries.length === 0) return "找到了一些東西,但背包已經塞不下了,只能忍痛留在原地。";
    const text = entries.map(([id, n]) => `${RESOURCE_LABEL[id as ResourceId]} +${n}`).join("、");
    return overflow ? `拾獲:${text}(背包塞不下,剩下的留在了原地)` : `拾獲:${text}`;
  }

  /** 從腳邊的拾獲物撿起指定數量(手動拾取模式) */
  pickupFromPending(id: string, count: number) {
    if (!this.pendingPickup || !this.carried) return;
    const avail = this.pendingPickup[id] ?? 0;
    const take = Math.min(avail, count);
    if (take <= 0) return;
    const { added } = addLoot(this.carried, { [id]: take });
    this.markGained(added);
    const got = added[id] ?? 0;
    saveCarried(this.carried);
    this.pendingPickup[id] = avail - got;
    if (this.pendingPickup[id] <= 0) delete this.pendingPickup[id];
    if (got < take) this.cb.onLog("背包塞不下更多了。");
    this.saveState();
  }

  /** 全部撿起(塞得下多少撿多少) */
  pickupAllPending() {
    if (!this.pendingPickup) return;
    for (const id of Object.keys({ ...this.pendingPickup })) {
      this.pickupFromPending(id, Number.MAX_SAFE_INTEGER);
    }
  }

  /** 全部放棄 */
  discardPending() {
    this.pendingPickup = null;
    this.saveState();
  }

  /** 地圖拾獲($ 資源點 / * 小事件):擲出這一格的內容(敘事碎片回傳文字,其餘回傳資源表) */
  private rollPickupGains(type: TileType): string | Record<string, number> {
    if (!this.carried) return "拾獲了一些東西,但你沒有背囊可以裝。";

    // 距離梯度:離村莊越遠,拾獲量越豐厚(走得深要值得)
    const cx = Math.floor(MAP_WIDTH / 2);
    const cy = Math.floor(MAP_HEIGHT / 2);
    const dist = Math.hypot(this.playerX - cx, this.playerY - cy);
    const depthBonus = 1 + dist / Math.hypot(cx, cy); // 1.0(村口)~ 2.0(地圖角落)

    const gains: Record<string, number> = {};
    if (type === "resource") {
      // 資源點:1~2 種基礎素材,偏向所在象限的特產(林地多木皮、廢墟多石材)
      const inForest = this.playerX < cx && this.playerY < cy;
      const inRuins = this.playerX >= cx && this.playerY < cy;
      const pool: [ResourceId, number][] = inForest
        ? [["wood", 4], ["wood", 5], ["hide", 2], ["meat", 2]]
        : inRuins
          ? [["stone", 3], ["stone", 4], ["wood", 3], ["arrow", 2]]
          : [["wood", 3], ["stone", 2], ["hide", 1], ["meat", 2]];
      const count = 1 + (Math.random() < 0.4 ? 1 : 0);
      for (let i = 0; i < count; i++) {
        const [id, n] = pool[Math.floor(Math.random() * pool.length)];
        gains[id] = (gains[id] ?? 0) + Math.round(n * depthBonus);
      }
    } else {
      // 小事件:三成是敘事碎片(認知揭露弧線的水滴,worldbuilding.md § 8.2),其餘是補給品
      if (Math.random() < 0.3) {
        return NARRATIVE_FINDS[Math.floor(Math.random() * NARRATIVE_FINDS.length)];
      }
      const roll = Math.random();
      if (roll < 0.4) gains.ration = Math.round(2 * depthBonus);
      else if (roll < 0.7) gains.bandage = 1;
      else if (roll < 0.9) gains.arrow = Math.round(3 * depthBonus);
      else gains.hide = Math.round(2 * depthBonus);
    }

    return gains;
  }

  private setCheckpoint() {
    this.checkpoint = { x: this.playerX, y: this.playerY, water: this.water };
    this.revealedSinceCheckpoint.clear();
    this.collectedSinceCheckpoint = [];
  }

  /**
   * 力竭死亡(§3.9):
   * - 帶出門的東西全部消失
   * - 最後一個檢查點之後揭露的迷霧退回、拾獲的東西回到原位(地圖是固定的,拾獲點會恢復)
   * - 由代行者救回村莊
   */
  private die(reason: string, cause: string) {
    this.cb.onLog(reason);
    this.cb.onLog("意識模糊之際,你聽見熟悉的聲音——她把你帶回了村莊。");
    localStorage.setItem("death-cause", cause); // 回村後代行者依死因給一句叮囑(village-main)
    this.thirstSteps = 0;
    this.hungerSteps = 0;

    for (const key of this.revealedSinceCheckpoint) {
      const [x, y] = key.split(",").map(Number);
      const tile = this.grid[y]?.[x];
      if (tile) tile.revealed = false;
    }
    for (const item of this.collectedSinceCheckpoint) {
      const tile = this.grid[item.y]?.[item.x];
      if (tile) tile.type = item.type;
    }
    this.revealedSinceCheckpoint.clear();
    this.collectedSinceCheckpoint = [];
    this.playerX = this.checkpoint.x;
    this.playerY = this.checkpoint.y;
    this.water = this.checkpoint.water;

    clearCarried();
    localStorage.removeItem("maze-stolen");
    localStorage.removeItem("maze-stolen-kinds");
    this.saveState();
    this.cb.onDeath();
  }
}

export { MAP_WIDTH, MAP_HEIGHT };
