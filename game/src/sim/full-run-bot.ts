// 全流程模擬器(開發工具,不進遊戲頁面):
// 用真實引擎(VillageEngine / ExploreEngine / CombatEngine)加速跑一遍
// 「開局 → 打通全部探勘點(含 Lv5 教堂)→ 盡可能揭露全地圖」,
// 統計換算成玩家真實遊玩時間(村莊 tick=10s、探索每步 0.5s、戰鬥依引擎 dt 累計)。
// 瀏覽器 console 用法:const m = await import('/src/sim/full-run-bot.ts'); await m.runFullSim();

import { VillageEngine } from "../village/engine";
import { ExploreEngine } from "../explore/engine";
import { CombatEngine } from "../engine";
import { buildPlayerCategories } from "../demo-data";
import { WEAPONS, UPGRADES, TRADES, carryCapacity } from "../village/data";
import { BLOCKED } from "../explore/types";
import { MAP_WIDTH, MAP_HEIGHT, startPosition } from "../explore/map-gen";
import { specialSites, siteProgress, saveSiteProgress, churchKeySiteKey, hasChurchKey, grantChurchKey, type SpecialSite } from "../explore/sites";
import { pickRandomEnemy, pickMidEnemy, GUARDIANS, LANDMARK_REWARDS, LV3_BOSS, type EnemyDef } from "../enemies";
import { addLoot, saveCarried, clearCarried, loadCarried, returnCarriedToVillage, playerMaxHp, packUsed, type Carried } from "../carried";
import { markLandmarkCleared, currentMapId, markFreshExpedition } from "../explore/engine";

const VILLAGE_TICK_SEC = 10;
const STEP_SEC = 0.5; // 按方向鍵走一格的真實時間
const DECISION_SEC = 0.6; // 戰鬥每次暫停做決策的時間
const PREP_SEC = 45; // 回村整備+出發的雜項時間
const STAGE_TRANSITION_SEC = 6; // 地城層間的頁面切換

interface SimTime {
  village: number;
  explore: number;
  combat: number;
}

interface SimStats {
  time: SimTime;
  battles: number;
  deaths: number;
  expeditions: number;
  timeline: string[];
  causes: Record<string, number>;
}

const noopVillageCb = { onLog: () => {}, onTick: () => {} };

function fmt(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}小時${m}分` : `${m}分`;
}

function totalSec(t: SimTime): number {
  return t.village + t.explore + t.combat;
}

// ---- 戰鬥模擬(政策:優先最高傷害、低血吃補、危急撤退) ----

interface FightResult {
  outcome: "win" | "dead" | "retreat";
  seconds: number;
}

function canUseSim(carried: Carried, id: string): boolean {
  const weapon = WEAPONS.find((w) => w.id === id);
  if (weapon) {
    if ((carried.weapons[id] ?? 0) <= 0) return false;
    const per = weapon.ammoPerUse ?? 1;
    if (weapon.ammo === "arrow" && carried.arrows < per) return false;
    if (weapon.ammo === "bullet" && (carried.bullets ?? 0) < per) return false;
    return true;
  }
  if (id === "bandage") return carried.bandages > 0;
  if (id === "jerky") return (carried.jerky ?? 0) > 0;
  if (id === "fire-scroll") return (carried.scrolls ?? 0) > 0;
  if (id === "elixir") return (carried.elixirs ?? 0) > 0;
  if (id === "salt") return (carried.salts ?? 0) > 0;
  return true;
}

function afterUseSim(engine: CombatEngine, carried: Carried, id: string) {
  const weapon = WEAPONS.find((w) => w.id === id);
  if (weapon) {
    const per = weapon.ammoPerUse ?? 1;
    if (weapon.ammo === "arrow") carried.arrows = Math.max(0, carried.arrows - per);
    if (weapon.ammo === "bullet") carried.bullets = Math.max(0, (carried.bullets ?? 0) - per);
    carried.durability[id] = (carried.durability[id] ?? weapon.durability) - 1;
    if (carried.durability[id] <= 0) {
      carried.weapons[id] = Math.max(0, (carried.weapons[id] ?? 0) - 1);
      if (carried.weapons[id] > 0) carried.durability[id] = weapon.durability;
      else delete carried.durability[id];
    }
  } else if (id === "bandage") {
    carried.bandages = Math.max(0, carried.bandages - 1);
    engine.clearStatus("bleed");
  } else if (id === "jerky") {
    carried.jerky = Math.max(0, (carried.jerky ?? 0) - 1);
  } else if (id === "fire-scroll") {
    carried.scrolls = Math.max(0, (carried.scrolls ?? 0) - 1);
  } else if (id === "salt") {
    carried.salts = Math.max(0, (carried.salts ?? 0) - 1);
    engine.clearControl(6);
  } else if (id === "elixir") {
    carried.elixirs = Math.max(0, (carried.elixirs ?? 0) - 1);
    engine.clearStatus("poison");
    engine.clearStatus("bleed");
  }
  saveCarried(carried);
}

export function fight(enemyDef: EnemyDef, carried: Carried): FightResult {
  const cats = buildPlayerCategories(carried);
  const engine = new CombatEngine(cats, enemyDef.moves, { onLog: () => {}, onPauseChange: () => {}, onHpChange: () => {} }, {
    enemyHp: enemyDef.hp,
    enemyLabel: enemyDef.label,
  });
  engine.playerMaxHp = playerMaxHp();
  engine.playerHp = Math.min(engine.playerMaxHp, Math.max(1, carried.hp ?? engine.playerMaxHp));

  const useScroll = enemyDef.hp >= 26; // 卷軸只對硬仗用
  // 敵人最大單發傷害:決定「補血線」要抬多高——高爆發敵人必須主動維持血量,
  // 貪到 35% 才補會被「大招+暈眩」的組合帶走(這就是控制 Boss 教玩家的第一課)
  const maxHit = Math.max(...enemyDef.moves.map((m) => m.damage));
  let t = 0;
  const step = (engine as unknown as { step: (dt: number) => void }).step.bind(engine);

  while (engine.playerHp > 0 && engine.enemyHp > 0 && t < 900) {
    step(0.05);
    t += 0.05;
    if (!engine.paused) continue;
    t += DECISION_SEC;

    // 就緒清單(可用的)
    const ready: { catId: string; id: string; damage: number; heal: number }[] = [];
    for (const cat of engine.playerCategories) {
      for (const tr of cat.trackers) {
        if (tr.ready && canUseSim(carried, tr.subAction.id)) {
          ready.push({ catId: cat.def.id, id: tr.subAction.id, damage: tr.subAction.damage, heal: tr.subAction.heal ?? 0 });
        }
      }
    }

    // 危急且無補品 → 撤退(60% 被追擊)
    const hasHeal = carried.bandages > 0 || (carried.jerky ?? 0) > 0;
    if (engine.playerHp <= 10 && !hasHeal) {
      const pursued = Math.random() < 0.6;
      if (pursued) {
        const dmg = engine.enemy.currentMove.damage || 3;
        engine.playerHp = Math.max(0, engine.playerHp - dmg);
        if (engine.playerHp <= 0) return { outcome: "dead", seconds: t };
      }
      carried.hp = engine.playerHp;
      saveCarried(carried);
      return { outcome: "retreat", seconds: t };
    }

    // 真人技巧:敵人快死了、自己有缺口 → 先吃肉乾把狀態補回來再收尾(把雜魚戰當成移動中的休息站)
    const topUp = engine.enemyHp <= 4 && engine.playerHp <= engine.playerMaxHp - 6 && (carried.jerky ?? 0) > 2;
    // 補血優先:繃帶(重傷/流血)、肉乾(小補)
    const bleeding = engine.playerStatus.bleed.level > 0;
    const safeLine = Math.min(engine.playerMaxHp - 5, maxHit * 2 + 4);
    const lowHp = engine.playerHp <= Math.max(engine.playerMaxHp * 0.35, safeLine) || topUp;
    let used = false;
    // 醒神鹽:帶控制的大招條爬過一半就提前含上,用免疫窗口把暈眩/遲緩擋在門外
    if ((carried.salts ?? 0) > 0 && engine.controlImmuneLeft <= 0 && engine.enemy.currentMove.control && engine.enemy.progress >= 0.45) {
      const salt = ready.find((r) => r.id === "salt");
      if (salt) {
        if (engine.useSubAction(salt.catId as never, salt.id)) afterUseSim(engine, carried, salt.id);
        used = true;
      }
    }
    if (used) {
      /* 這一手用掉了,補血/攻擊留到下一次暫停 */
    } else
    if (lowHp || bleeding) {
      // 囤貨紀律:繃帶/藥劑是 Boss 戰資源——雜魚戰(hp<80)只用肉乾撐,流血例外(繃帶止血)
      const bossFight = enemyDef.hp >= 80;
      const elixir = bossFight ? ready.find((r) => r.id === "elixir") : undefined;
      const bandage = bossFight || bleeding ? ready.find((r) => r.id === "bandage") : undefined;
      const jerky = ready.find((r) => r.id === "jerky");
      const deficit = engine.playerMaxHp - engine.playerHp;
      const anyStatus = engine.playerStatus.bleed.level > 0 || engine.playerStatus.poison.level > 0;
      // 肉乾見底時解除囤貨紀律——垂死之際抱著繃帶不用才是真的浪費
      const jerkyOut = (carried.jerky ?? 0) <= 0;
      const bandageAny = jerkyOut ? ready.find((r) => r.id === "bandage") : bandage;
      const elixirAny = jerkyOut ? ready.find((r) => r.id === "elixir") : elixir;
      const pick =
        elixirAny && (deficit >= 15 || anyStatus) ? elixirAny : deficit >= 20 && bandageAny ? bandageAny : bleeding && bandageAny ? bandageAny : jerky ?? bandageAny ?? elixirAny;
      if (pick) {
        if (engine.useSubAction(pick.catId as never, pick.id)) afterUseSim(engine, carried, pick.id);
        used = true;
      }
    }
    if (!used) {
      // 攻擊:火焰卷軸(硬仗)> 最高傷害武器
      const attacks = ready.filter((r) => r.damage > 0 && (r.id !== "fire-scroll" || useScroll));
      attacks.sort((a, b) => b.damage - a.damage);
      const pick = attacks[0];
      if (pick) {
        if (engine.useSubAction(pick.catId as never, pick.id)) afterUseSim(engine, carried, pick.id);
        used = true;
      }
    }
    if (!used) engine.skip(); // 只剩不想用的(如不必要的補品)→ 暫不使用
  }

  if (engine.playerHp <= 0) return { outcome: "dead", seconds: t };
  carried.hp = engine.playerHp;
  saveCarried(carried);
  // 打了 15 分鐘還沒分出勝負(輸出太低,如徒手對 Boss)→ 視同撤退
  if (engine.enemyHp > 0) return { outcome: "retreat", seconds: t };
  return { outcome: "win", seconds: t };
}

/** 輕裝紀律(攻堅/農晶行程):大宗戰利品(木石皮肉)當場放棄,背包留給補品與異晶 */
let leanLoot = false;
const LEAN_DROP = ["wood", "stone", "hide", "meat", "grain", "arrow"];

/** 勝利後套用戰利品(含異晶機率),回傳掉落 */
function applyVictoryLoot(carried: Carried, enemyDef: EnemyDef, extra?: Record<string, number>) {
  const gains: Record<string, number> = { ...enemyDef.loot };
  if (leanLoot) for (const k of LEAN_DROP) delete gains[k];
  if (enemyDef.shardChance && Math.random() < enemyDef.shardChance) gains.shard = (gains.shard ?? 0) + 1;
  if (extra) for (const [id, n] of Object.entries(extra)) gains[id] = (gains[id] ?? 0) + n;
  addLoot(carried, gains);
  saveCarried(carried);
}

// ---- 地城(五級制)模擬:逐層打,含獎勵結算(複刻 main.ts 勝利分支) ----

function pickDungeonEnemy(level: number, stage: number, stages: number, landmarkId?: string): EnemyDef {
  const isFinal = stage >= stages;
  if (isFinal) {
    if (level >= 4 && landmarkId && GUARDIANS[landmarkId]) return GUARDIANS[landmarkId];
    if (level === 3) return LV3_BOSS;
    return pickRandomEnemy();
  }
  return level >= 3 ? pickMidEnemy() : pickRandomEnemy();
}

// ---- 尋路:已知地圖上的 BFS(玩家有完整地圖記憶後的合理規劃) ----

type Grid = { type: string }[][];

function bfsFrom(grid: Grid, sx: number, sy: number): Int32Array {
  const dist = new Int32Array(MAP_WIDTH * MAP_HEIGHT).fill(-1);
  const queue: number[] = [sy * MAP_WIDTH + sx];
  dist[sy * MAP_WIDTH + sx] = 0;
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const cx = cur % MAP_WIDTH;
    const cy = Math.floor(cur / MAP_WIDTH);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= MAP_WIDTH || ny >= MAP_HEIGHT) continue;
      const idx = ny * MAP_WIDTH + nx;
      if (dist[idx] !== -1) continue;
      if ((BLOCKED as readonly string[]).includes(grid[ny][nx].type)) continue;
      dist[idx] = dist[cur] + 1;
      queue.push(idx);
    }
  }
  return dist;
}

/**
 * 回溯出從 (sx,sy) 到 (tx,ty) 的逐步路徑。
 * 軌道加權(rail=1、非 rail=4):真人會沿著自己鋪的鐵軌走——軌上水 1/4、糧 1/8、不遇敵,
 * 稍微繞路也遠比荒地直線便宜;沒有軌的地圖等同一般 BFS。
 */
function pathTo(grid: Grid, sx: number, sy: number, tx: number, ty: number): [number, number][] | null {
  const N = MAP_WIDTH * MAP_HEIGHT;
  const dist = new Int32Array(N).fill(-1);
  const prev = new Int32Array(N).fill(-1);
  const startIdx = sy * MAP_WIDTH + sx;
  const targetIdx = ty * MAP_WIDTH + tx;
  // 小根堆(cost, idx)
  const heap: number[][] = [[0, startIdx]];
  dist[startIdx] = 0;
  const push = (item: number[]) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = (): number[] | undefined => {
    if (heap.length === 0) return undefined;
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length > 0) {
    const [cost, cur] = pop()!;
    if (cost > dist[cur]) continue;
    if (cur === targetIdx) break;
    const cx = cur % MAP_WIDTH;
    const cy = Math.floor(cur / MAP_WIDTH);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= MAP_WIDTH || ny >= MAP_HEIGHT) continue;
      const tile = grid[ny][nx] as { type: string; rail?: boolean };
      if ((BLOCKED as readonly string[]).includes(tile.type)) continue;
      const idx = ny * MAP_WIDTH + nx;
      const stepCost = tile.rail ? 1 : 4;
      if (dist[idx] !== -1 && dist[idx] <= cost + stepCost) continue;
      dist[idx] = cost + stepCost;
      prev[idx] = cur;
      push([dist[idx], idx]);
    }
  }
  if (dist[targetIdx] === -1) return null;
  // 從目標回溯到起點,再翻成前進方向序列
  const cells: number[] = [];
  for (let cur = targetIdx; cur !== startIdx; cur = prev[cur]) {
    cells.push(cur);
    if (prev[cur] === -1) return null;
  }
  cells.reverse();
  const path: [number, number][] = [];
  let px = sx;
  let py = sy;
  for (const cell of cells) {
    const nx = cell % MAP_WIDTH;
    const ny = Math.floor(cell / MAP_WIDTH);
    path.push([nx - px, ny - py]);
    px = nx;
    py = ny;
  }
  return path;
}

// ---- 主模擬 ----

export interface SimOptions {
  /** true = 認真玩(每個生產週期都打一次採集小遊戲);false = 純掛機(只掛職業產線) */
  active?: boolean;
}

export async function runFullSim(opts: SimOptions = {}): Promise<SimStats> {
  const ACTIVE = opts.active !== false;
  localStorage.clear();
  localStorage.setItem("hasExplored", "0"); // 稍後首次遠征設 1

  const stats: SimStats = { time: { village: 0, explore: 0, combat: 0 }, battles: 0, deaths: 0, expeditions: 0, timeline: [], causes: {} };
  const note = (c: string) => (stats.causes[c] = (stats.causes[c] ?? 0) + 1);
  const trace: string[] = [];
  (stats as unknown as { trace: string[] }).trace = trace;
  let tracing = false;
  // 診斷開關:northExpedition 進北嶺時開細節追蹤(console 先設 window.__traceNorth = true)
  const traceNorthWanted = typeof window !== "undefined" && (window as unknown as { __traceNorth?: boolean }).__traceNorth === true;
  const traceChurchWanted = typeof window !== "undefined" && (window as unknown as { __traceChurch?: boolean }).__traceChurch === true;
  const tr = (msg: string) => {
    if (tracing && trace.length < 400) {
      const c = loadCarried();
      trace.push(msg);
    }
  };
  const snap = (expl: ExploreEngine, tag: string) => {
    if (!tracing || trace.length >= 400) return;
    const c = expl.carried;
    trace.push(`${tag} @(${expl.playerX},${expl.playerY}) 水${expl.water} 糧${c?.rations ?? "-"} 肉${c?.jerky ?? "-"} 繃${c?.bandages ?? "-"} 鹽${c?.salts ?? "-"} 藥${c?.elixirs ?? "-"} 彈${c?.bullets ?? "-"} hp${c?.hp ?? "-"} 包${c ? packUsed(c) : "-"}/${c?.packCap ?? "-"}`);
  };
  const village = new VillageEngine(noopVillageCb);
  const mark = (label: string) => {
    const line = `[${fmt(totalSec(stats.time))}] ${label}`;
    stats.timeline.push(line);
    console.log("[SIM]", line);
  };

  // -- 村莊政策 --
  const gatherAccuracy = () => (Math.random() < 0.75 ? 0.92 : 0.7);

  function rebalanceJobs(goal: { leather?: boolean; jerky?: boolean; iron?: boolean; grain?: boolean; steel?: boolean }) {
    for (const key of Object.keys(village.assignments)) village.assignments[key] = 0;
    let free = village.population;
    const put = (job: string, n: number) => {
      const actual = Math.min(free, n);
      if (actual > 0 && village.isJobUnlocked(job)) {
        village.assignments[job] = actual;
        free -= actual;
      }
    };
    // 肉乾是礦工的口糧:戰備庫存 500 才收手;肉乾見底時礦工也要節流(不然整條產線鎖死)
    const smokerCap = (n: number) => ((village.resources.jerky ?? 0) >= 500 ? 0 : n);
    // 節奏化開採:肉乾囤到 60 才全員下坑,吃完就收隊回獵場——庫存振盪而不是貼著零死鎖
    const minerCap = (n: number) => ((village.resources.jerky ?? 0) >= 60 ? n : 0);
    if (goal.steel) {
      // 鋼產線:鐵礦→鐵→(+煤)→鋼,一條龍;肉乾是礦工的口糧,燻肉必須跟上
      put("miner", minerCap(4));
      put("smelter", 2);
      put("coalminer", minerCap(2));
      put("steelworker", 1);
      put("smoker", smokerCap(6));
      put("hunter", 10);
    } else if (goal.iron) {
      put("miner", minerCap(5));
      put("smelter", 3); // 冶金:鐵礦 → 鐵(鐵階武器的原料)
      put("smoker", smokerCap(3));
      put("hunter", 9);
    } else if (goal.jerky) {
      put("smoker", smokerCap(2));
      put("hunter", 6);
    }
    if (goal.leather) {
      put("tanner", 4);
      if ((village.assignments["hunter"] ?? 0) < 10) put("hunter", 10 - (village.assignments["hunter"] ?? 0));
    }
    if (goal.grain) put("farmer", 2);
    if (goal.iron || goal.steel) {
      // 集中戰略:產線被肉乾鏈限速時,剩餘人力全壓狩獵(木頭只留給燻肉棚的消耗)
      const extraHunter = Math.min(free, Math.ceil(free * 0.6));
      village.assignments["hunter"] = (village.assignments["hunter"] ?? 0) + extraHunter;
      free -= extraHunter;
      put("woodcutter", Math.ceil(free * 0.7));
      put("quarrier", free);
    } else {
      // 其餘人力砍柴/採石(木頭需求大約是石頭兩倍)
      const wood = Math.ceil(free * 0.65);
      put("woodcutter", wood);
      put("quarrier", free);
    }
  }

  function villageBuildPolicy(phase: { canTannery: boolean; canSmithy: boolean }) {
    // 小木屋:蓋到 10 間(成本級距後就把資源留給產線建築)
    while ((village.buildingCounts["hut"] ?? 0) < 10 && village.canBuild("hut")) village.build("hut");
    if (!village.hasBuilding("farm") && village.canBuild("farm")) village.build("farm");
    if (phase.canTannery && !village.hasBuilding("tannery") && village.canBuild("tannery")) village.build("tannery");
    if (!village.hasBuilding("smokehouse") && village.canBuild("smokehouse")) village.build("smokehouse");
    if (phase.canSmithy && !village.hasBuilding("smithy") && village.canBuild("smithy")) village.build("smithy");
    if (!village.hasBuilding("trading-post") && village.seenResources.has("shard") && localStorage.getItem("hasExplored") === "1" && village.canBuild("trading-post")) {
      village.build("trading-post");
    }
    // 一次性升級:水袋 → 背包 → 皮甲
    for (const up of UPGRADES) {
      if (!village.upgrades[up.id] && village.isUpgradeVisible(up.id) && village.canAfford(up.cost)) village.craftUpgrade(up.id);
    }
  }

  /** 讓村莊跑 n 個 tick(含手動採集與事件回應) */
  function runVillage(ticks: number, opts: { gather?: "wood" | "stone" | "auto"; jobs?: Parameters<typeof rebalanceJobs>[0]; canTannery?: boolean; canSmithy?: boolean } = {}) {
    const resolvePending = () => {
      // 選項 0 可能付不起(消耗型選項會被擋)——依序試到能選的為止
      for (let oi = 0; village.pendingEvent && oi < 4; oi++) village.resolveEvent(oi);
    };
    for (let i = 0; i < ticks; i++) {
      if (village.pendingEvent) resolvePending();
      rebalanceJobs(opts.jobs ?? {});
      (village as unknown as { tick: () => void }).tick();
      if (village.pendingEvent) resolvePending();
      // 手動採集(認真模式限定):優先餵當前瓶頸——皮革缺生皮就狩獵生皮、肉乾缺生肉就狩獵生肉,否則採木石
      if (ACTIVE) {
        village.gatherReadyAt = 0;
        const canHunt = village.availableGathers().includes("meat");
        let target: "wood" | "stone" | "meat" | "hide";
        if (opts.jobs?.leather && canHunt && village.resources.hide < 200) target = "hide";
        else if ((opts.jobs?.jerky || opts.jobs?.iron || opts.jobs?.steel) && canHunt && village.resources.meat < 600) target = "meat";
        else target = village.resources.wood <= village.resources.stone * 2 ? "wood" : "stone";
        village.gatherResult(target, gatherAccuracy());
      }
      villageBuildPolicy({ canTannery: opts.canTannery ?? false, canSmithy: opts.canSmithy ?? false });
      stats.time.village += VILLAGE_TICK_SEC;
    }
  }

  /** 村莊一直跑到條件成立(上限 maxTicks) */
  function villageUntil(cond: () => boolean, maxTicks: number, opts: Parameters<typeof runVillage>[1] = {}): boolean {
    for (let i = 0; i < maxTicks; i++) {
      if (cond()) return true;
      runVillage(1, opts);
    }
    return cond();
  }

  // -- 整備出發 --
  interface Loadout {
    weapons: Record<string, number>;
    rations: number;
    jerky: number;
    bandages: number;
    arrows: number;
    scrolls: number;
    elixirs?: number;
    salts?: number;
    bullets?: number;
    rails?: number;
    oil?: number;
  }

  function depart(loadout: Loadout): Carried {
    const packCap = carryCapacity(village.upgrades);
    const carried: Carried = {
      weapons: {},
      durability: {},
      rations: 0,
      maxRations: 0,
      jerky: 0,
      bandages: 0,
      arrows: 0,
      scrolls: 0,
      hp: playerMaxHp(),
      loot: {},
      packCap,
    };
    for (const [id, n] of Object.entries(loadout.weapons)) {
      const take = Math.min(n, village.ownedWeapons[id] ?? 0);
      if (take > 0) {
        carried.weapons[id] = take;
        village.ownedWeapons[id] = (village.ownedWeapons[id] ?? 0) - take;
        const def = WEAPONS.find((w) => w.id === id)!;
        carried.durability[id] = village.weaponDurability[id] ?? def.durability;
        delete village.weaponDurability[id];
      }
    }
    carried.rations = Math.min(loadout.rations, village.resources.ration);
    village.resources.ration -= carried.rations;
    carried.maxRations = carried.rations;
    carried.jerky = Math.min(loadout.jerky, village.resources.jerky);
    village.resources.jerky -= carried.jerky;
    carried.bandages = Math.min(loadout.bandages, village.resources.bandage);
    village.resources.bandage -= carried.bandages;
    carried.arrows = Math.min(loadout.arrows, village.resources.arrow);
    village.resources.arrow -= carried.arrows;
    carried.scrolls = Math.min(loadout.scrolls, village.resources.scroll);
    village.resources.scroll -= carried.scrolls;
    carried.salts = Math.min(loadout.salts ?? 0, village.resources.salt ?? 0);
    village.resources.salt = (village.resources.salt ?? 0) - carried.salts;
    carried.bullets = Math.min(loadout.bullets ?? 0, Math.floor(village.resources.bullet ?? 0));
    village.resources.bullet = (village.resources.bullet ?? 0) - carried.bullets;
    carried.rails = Math.min(loadout.rails ?? 0, Math.floor(village.resources.rail ?? 0));
    village.resources.rail = (village.resources.rail ?? 0) - carried.rails;
    carried.oil = Math.min(loadout.oil ?? 0, Math.floor(village.resources.oil ?? 0));
    village.resources.oil = (village.resources.oil ?? 0) - carried.oil;
    carried.elixirs = Math.min(loadout.elixirs ?? 0, village.resources.elixir);
    village.resources.elixir -= carried.elixirs;
    village.saveState();
    saveCarried(carried);
    localStorage.setItem("hasExplored", "1");
    markFreshExpedition(); // 設 fresh + 回中央地圖 + 遠征序號 +1(據點儲備重置)
    stats.time.village += PREP_SEC;
    stats.expeditions++;
    return carried;
  }

  // -- 遠征 --
  let encounterFlag = false;
  let deathFlag = false;
  const exploreCb = {
    onLog: () => {},
    onDeath: () => {
      deathFlag = true;
    },
    onEncounter: () => {
      encounterFlag = true;
    },
  };

  function newExplore(): ExploreEngine {
    encounterFlag = false;
    deathFlag = false;
    const expl = new ExploreEngine(exploreCb);
    // 效能:引擎每走一步都會把整張地圖序列化進 localStorage(單人遊玩無感,模擬器上萬步會拖垮);
    // 模擬期間改成手動存檔——只在遠征收尾時呼叫 realSave
    const realSave = expl.saveState.bind(expl);
    (expl as unknown as { saveState: () => void }).saveState = () => {};
    (expl as unknown as { realSave: () => void }).realSave = realSave;
    return expl;
  }

  function persistExplore(expl: ExploreEngine) {
    (expl as unknown as { realSave: () => void }).realSave();
  }

  /**
   * 沿路徑走;處理遭遇戰與力竭死亡。
   * 回傳 "arrived" | "dead"(戰死或力竭)| "aborted"(路不通)
   */
  function walkTo(expl: ExploreEngine, tx: number, ty: number, abortIf?: () => boolean, onStep?: () => void, stepAbortIf?: () => boolean): "arrived" | "dead" | "aborted" | "turnback" {
    for (let replan = 0; replan < 8; replan++) {
      if (expl.playerX === tx && expl.playerY === ty) return "arrived";
      const path = pathTo(expl.grid as unknown as Grid, expl.playerX, expl.playerY, tx, ty);
      if (!path || path.length === 0) return "aborted";
      for (const [dx, dy] of path) {
        expl.move(dx, dy);
        stats.time.explore += STEP_SEC;
        onStep?.();
        if (deathFlag) {
          stats.deaths++;
          note("力竭(水/糧)");
          snap(expl, "[力竭死亡]");
          clearCarried();
          persistExplore(expl);
          return "dead";
        }
        if (encounterFlag) {
          encounterFlag = false;
          const enemy = currentMapId() !== "A" && Math.random() < 0.5 ? pickMidEnemy() : pickRandomEnemy();
          const carried = expl.carried!;
          const result = fight(enemy, carried);
          stats.battles++;
          stats.time.combat += result.seconds + STAGE_TRANSITION_SEC;
          if (result.outcome === "dead") {
            stats.deaths++;
            note("路遇戰死:" + enemy.label);
            clearCarried();
            persistExplore(expl);
            return "dead";
          }
          if (result.outcome === "win") applyVictoryLoot(carried, enemy);
          if (result.outcome === "retreat") note("路遇撒退(hp" + (carried.hp ?? 0) + ")");
          snap(expl, `[戰] ${enemy.label} ${result.outcome}`);
          // 真人的紀律:一場戰鬥打完發現狀態不對,立刻折返,不硬走
          if (abortIf && abortIf()) return "turnback";
        }
        // 每步檢查(僅特殊任務用,如鋪軌的「軌用光了」)
        if (stepAbortIf && stepAbortIf()) return "turnback";
      }
      if (expl.playerX === tx && expl.playerY === ty) return "arrived";
    }
    return "aborted";
  }

  /** 目前地圖上所有補給據點(含村口與解放後的地標——地標解放後可補給) */
  function depots(expl: ExploreEngine): [number, number][] {
    const list: [number, number][] = [];
    if (expl.mapId === "A") {
      const s0 = startPosition();
      list.push([s0.x, s0.y]);
    }
    for (let y = 0; y < MAP_HEIGHT; y++)
      for (let x = 0; x < MAP_WIDTH; x++) if (expl.grid[y][x].type === "depot") list.push([x, y]);
    for (const s of specialSites()) {
      if ((s.mapId ?? "A") === expl.mapId && s.level >= 4 && siteProgress(s.key).cleared) list.push([s.x, s.y]);
    }
    return list;
  }

  /**
   * 有水量意識的長途移動:一段一段經補給點跳島。
   * 這是真人玩家的走法——水不夠就先繞去補給點,而不是硬走到渴死。
   */
  function travelTo(expl: ExploreEngine, tx: number, ty: number, abortIf?: () => boolean, onStep?: () => void): "arrived" | "dead" | "aborted" | "turnback" {
    const MARGIN = 4;
    let lastBestToTarget = Infinity; // 防鬼打牆:每一段中繼都必須讓「離目標的剩餘距離」變短
    for (let leg = 0; leg < 30; leg++) {
      if (expl.playerX === tx && expl.playerY === ty) return "arrived";
      const grid = expl.grid as unknown as Grid;
      const dHere = bfsFrom(grid, expl.playerX, expl.playerY);
      const direct = dHere[ty * MAP_WIDTH + tx];
      if (direct === -1) return "aborted";
      snap(expl, `[leg] 目標(${tx},${ty}) 直線${direct}`);
      if (expl.water >= direct + MARGIN) return walkTo(expl, tx, ty, abortIf, onStep);

      // 需要中繼:挑「目前水量走得到、且離目標最近」的補給點
      const dTarget = bfsFrom(grid, tx, ty);
      let best: [number, number] | null = null;
      let bestToTarget = Infinity;
      for (const [ax, ay] of depots(expl)) {
        const toDepot = dHere[ay * MAP_WIDTH + ax];
        const toTarget = dTarget[ay * MAP_WIDTH + ax];
        if (toDepot <= 0 || toTarget === -1) continue;
        if (toDepot > expl.water + 1) continue;
        if (toTarget < bestToTarget) {
          bestToTarget = toTarget;
          best = [ax, ay];
        }
      }
      if (!best || bestToTarget >= lastBestToTarget) {
        // 沒有中繼點,或中繼不再讓我們更接近目標(水量網路的盡頭)——
        // 水夠就賭一把直衝(可能是單程票),不夠就承認到不了
        if (expl.water + 2 >= direct) {
          snap(expl, `[dash] 網路盡頭直衝(${tx},${ty}) 距${direct}`);
          return walkTo(expl, tx, ty, abortIf, onStep);
        }
        note("水路不通");
        snap(expl, "[水路不通]");
        return "aborted";
      }
      lastBestToTarget = bestToTarget; // 沒有中繼點:目前的水量網路到不了這個目標
      if (bestToTarget >= direct && expl.water >= direct - 2) {
        snap(expl, `[dash] 直衝(${tx},${ty}) 距${direct}`);
        return walkTo(expl, tx, ty, abortIf, onStep);
      }
      snap(expl, `[hop] 經補給(${best[0]},${best[1]}) 再${bestToTarget}到目標`);
      const r = walkTo(expl, best[0], best[1], abortIf, onStep);
      if (r !== "arrived") return r;
    }
    return "aborted";
  }

  /** 狀態還撐得住繼續冒險嗎(真人會回村休整,而不是殘血硬闖) */
  function fitToFight(carried: Carried | null): boolean {
    if (!carried) return false;
    const hp = carried.hp ?? 0;
    return hp >= 15 || (hp >= 10 && ((carried.jerky ?? 0) >= 3 || carried.bandages >= 1));
  }

  /**
   * 該掉頭回家了嗎:血量低又沒補品、或背包塞滿(戰利品會把乾糧補給的位置吃掉,
   * 再走下去會在斷糧中力竭——這正是模擬統計裡最大宗的死因)
   */
  function shouldTurnBack(expl: ExploreEngine): boolean {
    const c = expl.carried;
    if (!c) return true;
    const hp = c.hp ?? 0;
    if (hp < 14 && (c.jerky ?? 0) < 2 && c.bandages < 1) return true;
    const cap = c.packCap ?? 20;
    if (packUsed(c) >= cap - 2) return true; // 背包滿了,補給點補不進乾糧
    if (c.rations <= 2 && (c.jerky ?? 0) <= 2) return true; // 糧見底
    return false;
  }

  /** 結束遠征:走回村口入庫。回不去就是回不去——硬走,走不到就死在路上(不作弊瞬移) */
  function goHome(expl: ExploreEngine): void {
    const s0 = startPosition();
    let r = travelTo(expl, s0.x, s0.y);
    if (r === "aborted") r = walkTo(expl, s0.x, s0.y); // 水量網路斷了也只能硬走,聽天由命
    persistExplore(expl);
    if (r === "arrived") {
      returnCarriedToVillage();
      (village as unknown as { loadState: () => void }).loadState();
    } else if (r === "aborted") {
      // 連路都沒有(理論上不會發生):視同折損
      stats.deaths++;
      clearCarried();
    }
  }

  /** 站在探勘點上,逐層打穿(或中途撤退) */
  function clearSite(expl: ExploreEngine, site: SpecialSite): "cleared" | "dead" | "aborted" {
    if (site.landmarkId === "church" && !hasChurchKey()) return "aborted"; // 門鎖著
    for (;;) {
      const progress = siteProgress(site.key);
      if (progress.cleared) return "cleared";
      const stage = progress.stage + 1;
      const enemy = pickDungeonEnemy(site.level, stage, site.stages, site.landmarkId);
      const carried = expl.carried!;
      // 攔截線放寬:守衛戰有肉乾/繃帶續戰力就打得動(蒙地卡羅顯示滿血勝率 100%,血量六成+補品也夠)
      const hp = carried.hp ?? 0;
      // 控制型 Boss(煤礦/教堂):八成血+補品儲備才開打——殘血進場的實測勝率是 7%,先休整;
      // 中央三地標守衛沒有控制技,維持原本的寬鬆門檻(滿血勝率 100%,六成血+補品也打得動)
      const strictBoss = site.landmarkId === "coalmine" || site.landmarkId === "church";
      const okToFight = strictBoss
        ? hp >= playerMaxHp() * 0.7 && ((carried.jerky ?? 0) >= 8 || carried.bandages >= 3)
        : site.level >= 4
          ? hp >= playerMaxHp() * 0.6 || (hp >= playerMaxHp() * 0.45 && (carried.jerky ?? 0) >= 5)
          : hp >= playerMaxHp() * 0.4 || (carried.jerky ?? 0) >= 3 || carried.bandages >= 1;
      if (!okToFight) {
        note("地城門檻不打(hp" + hp + ")");
        snap(expl, "[門檻不打]");
        return "aborted";
      }

      const result = fight(enemy, carried);
      stats.battles++;
      stats.time.combat += result.seconds + STAGE_TRANSITION_SEC;
      snap(expl, `[地城${site.level}-${stage}] ${enemy.label} ${result.outcome}`);
      if (result.outcome === "dead") {
        stats.deaths++;
        note("地城戰死:" + enemy.label);
        clearCarried();
        return "dead";
      }
      if (result.outcome === "retreat") {
        note("地城撒退:" + enemy.label);
        return "aborted";
      }

      const isFinal = stage >= site.stages;
      if (!isFinal) {
        saveSiteProgress(site.key, { stage, cleared: false });
        applyVictoryLoot(carried, enemy);
        continue;
      }
      saveSiteProgress(site.key, { stage, cleared: true });
      if (site.level === 3 && site.key === churchKeySiteKey()) grantChurchKey(); // 黑鐵鑰匙
      let extra: Record<string, number> | undefined;
      if (site.level >= 4 && site.landmarkId) {
        markLandmarkCleared(site.landmarkId);
        const reward = LANDMARK_REWARDS[site.landmarkId];
        if (reward) {
          extra = reward.loot;
          if (reward.weapon) {
            carried.weapons[reward.weapon] = (carried.weapons[reward.weapon] ?? 0) + 1;
            const def = WEAPONS.find((w) => w.id === reward.weapon);
            if (def && carried.durability[reward.weapon] === undefined) carried.durability[reward.weapon] = def.durability;
          }
        }
      }
      applyVictoryLoot(carried, enemy, extra);
      return "cleared";
    }
  }

  /**
   * 一趟遠征:依序嘗試打通目標清單;體力不支/水路不通就回村。
   */
  function expedition(targets: SpecialSite[], loadout: Loadout, lean = false): number {
    depart(loadout);
    leanLoot = lean;
    let expl = newExplore();
    let cleared = 0;
    for (const site of targets) {
      if (siteProgress(site.key).cleared) continue;
      if (!fitToFight(expl.carried)) break;
      const walk = travelTo(expl, site.x, site.y, () => shouldTurnBack(expl));
      if (walk === "dead") return cleared;
      if (walk === "turnback") break;
      if (walk === "aborted") continue;
      // 控制 Boss(教堂)開打前的休整紀律:先到鄰近據點補血吃肉乾再回來
      if ((site.landmarkId === "church" || site.landmarkId === "coalmine") && (expl.carried?.hp ?? 0) < playerMaxHp() * 0.85) {
        const near = depots(expl)
          .map(([ax, ay]) => ({ ax, ay, d: Math.abs(ax - expl.playerX) + Math.abs(ay - expl.playerY) }))
          .filter((c) => c.d > 0 && c.d <= 10)
          .sort((a, b) => a.d - b.d)[0];
        if (near) {
          if (walkTo(expl, near.ax, near.ay) === "dead") return cleared;
          while ((expl.carried?.hp ?? 0) < playerMaxHp() - 5 && (expl.carried?.jerky ?? 0) > 6 && expl.canEatJerky()) expl.eatJerky();
          if (walkTo(expl, site.x, site.y) === "dead") return cleared;
        }
      }
      const res = clearSite(expl, site);
      persistExplore(expl);
      if (res === "dead") return cleared;
      if (res === "cleared") {
        cleared++;
        expl = newExplore(); // 重建引擎讓 Lv1/Lv3 升格補給點
      } else break;
    }
    goHome(expl);
    return cleared;
  }

  /** 鋪軌遠征:沿村莊→目標的路徑鋪鐵軌(永久建設);回傳這趟鋪了幾根 */
  function railExpedition(target: [number, number], railsToCarry: number): number {
    depart({
      weapons: { "iron-knife": 1, "iron-sword": 1 },
      rations: 14,
      jerky: Math.min(8, village.resources.jerky),
      bandages: Math.min(2, village.resources.bandage),
      arrows: 0,
      scrolls: 0,
      rails: railsToCarry,
    });
    const expl = newExplore();
    const before = expl.carried?.rails ?? 0;
    const lay = () => {
      if (expl.canLayRail()) expl.layRail();
    };
    lay(); // 村口第一格
    const r = walkTo(expl, target[0], target[1], undefined, lay, () => (expl.carried?.rails ?? 0) <= 0);
    const laid = before - (expl.carried?.rails ?? 0);
    persistExplore(expl);
    if (r !== "dead") goHome(expl);
    return laid;
  }

  /** 農晶行程:鋼裝去北嶺獵場繞一圈——雜魚一擊必殺,異晶入袋(反制道具的財源) */
  function shardFarmTrip(): void {
    depart({
      weapons: { "steel-sword": 1, "steel-knife": 1 },
      rations: 20,
      jerky: Math.min(12, village.resources.jerky),
      bandages: 0,
      arrows: 0,
      scrolls: 0,
    });
    leanLoot = true;
    let expl = newExplore();
    const cx = Math.floor(MAP_WIDTH / 2);
    if (travelTo(expl, cx, 0) !== "arrived") {
      goHome(expl);
      return;
    }
    persistExplore(expl);
    expl.travelThroughExit();
    expl = newExplore();
    for (const [tx, ty] of [[52, 44], [43, 33], [52, 24]] as const) {
      if (travelTo(expl, tx, ty, () => shouldTurnBack(expl)) !== "arrived") break;
    }
    let back = travelTo(expl, cx, MAP_HEIGHT - 1);
    if (back === "aborted") back = walkTo(expl, cx, MAP_HEIGHT - 1);
    if (back !== "arrived") return;
    persistExplore(expl);
    expl.travelThroughExit();
    expl = newExplore();
    goHome(expl);
  }

  /**
   * 北嶺遠征:中央地圖北緣出口 → 北嶺哨站鏈(由南往北)→ 煤礦坑 → 原路折返。
   * 跨圖是單線深入:水量網路要靠沿路打通的哨站一段段修出去(哨站打通即升格補給點)。
   */
  function northExpedition(loadout: Loadout): void {
    if (traceNorthWanted) tracing = true;
    depart(loadout);
    leanLoot = true;
    let expl = newExplore(); // 中央地圖
    const cx = Math.floor(MAP_WIDTH / 2);
    let r = travelTo(expl, cx, 0, () => shouldTurnBack(expl));
    if (r === "dead") return;
    if (r !== "arrived") {
      goHome(expl);
      return;
    }
    persistExplore(expl);
    expl.travelThroughExit();
    expl = newExplore(); // 北嶺,落在南緣入口
    snap(expl, "[北嶺] 進入");

    // 燈火紀律:路過據點順手點燈(壓遭遇率 ×0.4)——北回廊的戰耗稅就靠這個降
    const lampStep = () => {
      if (expl.canLightLamp()) expl.lightLamp();
    };
    const nTargets = specialSites()
      .filter((st) => (st.mapId ?? "A") === "N" && !siteProgress(st.key).cleared)
      .sort((a, b) => b.y - a.y); // 由南往北推
    for (const site of nTargets) {
      if (!fitToFight(expl.carried)) break;
      const walk = travelTo(expl, site.x, site.y, () => shouldTurnBack(expl), lampStep);
      if (walk === "dead") return;
      if (walk !== "arrived") break;
      // 守衛戰的休整紀律:血沒養滿先到鄰近據點補給+吃肉乾再開打(殘血進場勝率 7%);
      // 層間被門檻擋下也一樣——去據點休整回來續打(層數進度有保存),不必整趟放棄
      const restNearby = (): "ok" | "dead" => {
        const near = depots(expl)
          .map(([ax, ay]) => ({ ax, ay, d: Math.abs(ax - expl.playerX) + Math.abs(ay - expl.playerY) }))
          .filter((c) => c.d > 0 && c.d <= 8)
          .sort((a, b) => a.d - b.d)[0];
        if (!near) return "ok";
        if (walkTo(expl, near.ax, near.ay, undefined, lampStep) === "dead") return "dead";
        while ((expl.carried?.hp ?? 0) < playerMaxHp() - 5 && (expl.carried?.jerky ?? 0) > 6 && expl.canEatJerky()) expl.eatJerky();
        if (walkTo(expl, site.x, site.y, undefined, lampStep) === "dead") return "dead";
        return "ok";
      };
      let res: "cleared" | "dead" | "aborted" = "aborted";
      for (let tryN = 0; tryN < 3; tryN++) {
        if (site.level >= 4 && (expl.carried?.hp ?? 0) < playerMaxHp() * 0.85) {
          if (restNearby() === "dead") return;
        }
        res = clearSite(expl, site);
        persistExplore(expl);
        if (res !== "aborted") break;
        // 門檻不打/地城撤退:休整能救的就救,救不了(肉乾也見底)就收隊
        if ((expl.carried?.jerky ?? 0) <= 6 && expl.carried!.bandages <= 0) break;
      }
      if (res === "dead") return;
      if (res !== "cleared") break;
      expl = newExplore(); // 哨站升格補給點
    }

    // 折返:北嶺南緣出口 → 中央地圖 → 村莊
    let back = travelTo(expl, cx, MAP_HEIGHT - 1);
    if (back === "aborted") back = walkTo(expl, cx, MAP_HEIGHT - 1); // 水路斷了也只能硬走
    if (back !== "arrived") return; // 倒在北嶺(walkTo 內已結算死亡)
    persistExplore(expl);
    expl.travelThroughExit();
    expl = newExplore(); // 中央地圖北緣內側
    goHome(expl);
    leanLoot = false;
  }

  // 安全打造:craftConsumable 在配方不可見時會靜默不動作,直接 while 會死迴圈——確認數量真的有增加才繼續
  const craftUpTo = (id: "ration" | "arrow" | "bullet" | "rail" | "oil", target: number) => {
    for (let i = 0; i < 200; i++) {
      if (village.resources[id] >= target) break;
      const before = village.resources[id];
      village.craftConsumable(id);
      if (village.resources[id] === before) break;
    }
  };

  const ensureCraft = () => {
    if ((village.ownedWeapons["stone-axe"] ?? 0) < 1) village.craftWeapon("stone-axe");
    if ((village.ownedWeapons["wood-spear"] ?? 0) < 1) village.craftWeapon("wood-spear");
    craftUpTo("ration", 12);
  };

  // ============ 劇本 ============

  mark("開局");
  const sites = specialSites().filter((st) => (st.mapId ?? "A") === "A"); // 中央戰役只看中央的點
  const start = startPosition();
  const near = (a: SpecialSite, b: SpecialSite) =>
    Math.hypot(a.x - start.x, a.y - start.y) - Math.hypot(b.x - start.x, b.y - start.y);
  const clearedCount = (lv: number) => sites.filter((s) => s.level === lv && siteProgress(s.key).cleared).length;

  // Phase 1:起步——邊採邊蓋,直到石斧+木槍+乾糧就緒
  villageUntil(
    () => {
      ensureCraft();
      return (village.ownedWeapons["stone-axe"] ?? 0) >= 1 && (village.ownedWeapons["wood-spear"] ?? 0) >= 1 && village.resources.ration >= 10;
    },
    900,
    { jobs: { grain: true } },
  );
  mark(`石斧+木槍+乾糧就緒(人口 ${village.population})`);

  // Phase 2:清 Lv1 / Lv2(近距;Lv1 打通變補給點,活動圈逐步外推)
  const earlyLoadout = (): Loadout => ({
    weapons: { "stone-axe": 1, "wood-spear": 1 },
    rations: 10,
    jerky: Math.min(4, village.resources.jerky),
    bandages: Math.min(2, village.resources.bandage),
    arrows: 0,
    scrolls: 0,
  });
  for (let round = 0; round < 30; round++) {
    const remaining = sites.filter((s) => (s.level === 1 || s.level === 2) && !siteProgress(s.key).cleared).sort(near);
    if (remaining.length === 0) break;
    villageUntil(
      () => {
        ensureCraft();
        return (village.ownedWeapons["stone-axe"] ?? 0) >= 1 && village.resources.ration >= 8;
      },
      400,
      { jobs: { grain: true } },
    );
    // 沒有肉乾的年代,一趟頂多打兩個點就回家養傷(硬撐是早期滅團的主因)
    expedition(remaining.slice(0, 2), earlyLoadout());
  }
  mark(`Lv1×${clearedCount(1)}/${sites.filter((x) => x.level === 1).length} Lv2×${clearedCount(2)}/4 打通(戰死累計 ${stats.deaths})`);

  // Phase 3:產線建設——製革場、燻製棚、獵弓;升級三件套
  villageUntil(
    () => {
      if ((village.ownedWeapons["hunting-bow"] ?? 0) < 1 && village.canAfford(WEAPONS.find((w) => w.id === "hunting-bow")!.cost)) village.craftWeapon("hunting-bow");
      craftUpTo("arrow", 15);
      ensureCraft();
      return village.hasBuilding("tannery") && village.hasBuilding("smokehouse") && (village.ownedWeapons["hunting-bow"] ?? 0) >= 1;
    },
    2400,
    { jobs: { leather: true, jerky: true, grain: true }, canTannery: true },
  );
  mark(`製革場+燻製棚+獵弓(人口 ${village.population})`);
  villageUntil(() => village.upgrades["waterskin"] && village.upgrades["backpack"] && village.upgrades["leather-armor"], 6000, {
    jobs: { leather: true, grain: true }, // 不派燻肉:這一段的木頭全數留給三件升級(smoker 每人吃木 30/tick)
    canTannery: true,
  });
  mark(`水袋+背包+皮甲齊備(人口 ${village.population};木${Math.floor(village.resources.wood)} 石${Math.floor(village.resources.stone)} 皮革${Math.floor(village.resources.leather)} 生皮${Math.floor(village.resources.hide)} 水袋=${village.upgrades.waterskin === true} 背包=${village.upgrades.backpack === true} 皮甲=${village.upgrades["leather-armor"] === true})`);

  // Phase 4:Lv3 遺跡(水 32+補給跳島;打通變前線基地)→ 工匠鋪
  const midLoadout = (): Loadout => ({
    weapons: { "stone-axe": 2, "wood-spear": 1, "hunting-bow": 1 },
    rations: 16,
    jerky: Math.min(8, village.resources.jerky),
    bandages: Math.min(3, village.resources.bandage),
    arrows: 15,
    scrolls: 0,
  });
  for (let round = 0; round < 12; round++) {
    const remaining = sites.filter((s) => s.level === 3 && !siteProgress(s.key).cleared).sort(near);
    if (remaining.length === 0) break;
    villageUntil(
      () => {
        ensureCraft();
        craftUpTo("arrow", 15);
        if ((village.ownedWeapons["stone-axe"] ?? 0) < 2) village.craftWeapon("stone-axe");
        craftUpTo("ration", 14);
        return village.resources.ration >= 12 && (village.resources.jerky ?? 0) >= 5;
      },
      800,
      { jobs: { leather: true, jerky: true, grain: true }, canTannery: true },
    );
    expedition(remaining.slice(0, 2), midLoadout());
  }
  villageUntil(() => village.hasBuilding("smithy"), 600, { jobs: { jerky: true, grain: true }, canTannery: true, canSmithy: true });
  mark(`Lv3×${clearedCount(3)}/4 打通,工匠鋪=${village.hasBuilding("smithy")}(戰死累計 ${stats.deaths})`);

  // Phase 5:具名地標——觀測台(刺刀)→ 祭壇(卷軸)→ 礦坑(鐵)
  function landmarkCampaign(lmId: string) {
    const site = sites.find((s) => s.landmarkId === lmId)!;
    for (let attempt = 0; attempt < 8 && !siteProgress(site.key).cleared; attempt++) {
      villageUntil(
        () => {
          ensureCraft();
          craftUpTo("arrow", 20);
          if ((village.ownedWeapons["stone-axe"] ?? 0) < 2) village.craftWeapon("stone-axe");
          if (village.canRepairWeapon("bayonet")) village.repairWeapon("bayonet");
          if (village.canRepairWeapon("stone-axe")) village.repairWeapon("stone-axe");
          craftUpTo("ration", 18);
          return village.resources.ration >= 16 && (village.resources.jerky ?? 0) >= 12;
        },
        1000,
        { jobs: { leather: true, jerky: true, grain: true }, canTannery: true, canSmithy: true },
      );
      const loadout: Loadout = {
        weapons: { bayonet: 1, "stone-axe": 2, "hunting-bow": 1 },
        rations: 16,
        jerky: Math.min(12, village.resources.jerky),
        bandages: Math.min(4, village.resources.bandage),
        arrows: 18,
        scrolls: lmId === "mine" ? Math.min(2, village.resources.scroll) : 0,
      };
      // 先修哨站鏈:沿線走廊上還沒打通的 Lv1~Lv3 據點排在地標前面,一路打過去
      const dd = (ax: number, ay: number, bx: number, by: number) => Math.abs(ax - bx) + Math.abs(ay - by);
      const corridor = sites
        .filter((x) => x.level <= 3 && !siteProgress(x.key).cleared)
        .filter((x) => dd(x.x, x.y, start.x, start.y) + dd(x.x, x.y, site.x, site.y) <= dd(start.x, start.y, site.x, site.y) + 16)
        .sort(near);
      expedition([...corridor, site], loadout);
    }
    mark(`${lmId}:${siteProgress(site.key).cleared ? "解放" : "×8 次嘗試失敗"}(戰死累計 ${stats.deaths})`);
  }
  for (const lmId of ["observatory", "shrine", "mine"]) landmarkCampaign(lmId);
  // 沒打下來的地標再各補一輪(真人不會只試一個下午就放棄)
  for (const lmId of ["observatory", "shrine", "mine"]) {
    const site = sites.find((s) => s.landmarkId === lmId)!;
    if (!siteProgress(site.key).cleared) landmarkCampaign(lmId);
  }

  // Phase 6:鐵產線 → 鐵刀/鐵劍/鐵槍三件(北嶺攻堅的門票)
  const mineCleared = siteProgress(sites.find((s) => s.landmarkId === "mine")!.key).cleared;
  const IRON_TRIO = ["iron-knife", "iron-sword", "iron-spear"] as const;
  if (mineCleared) villageUntil(
    () => {
      for (const id of IRON_TRIO) {
        if ((village.ownedWeapons[id] ?? 0) < 1 && village.canAfford(WEAPONS.find((w) => w.id === id)!.cost)) village.craftWeapon(id);
      }
      if (village.canRepairWeapon("bayonet")) village.repairWeapon("bayonet");
      return IRON_TRIO.every((id) => (village.ownedWeapons[id] ?? 0) >= 1);
    },
    4000,
    { jobs: { iron: true, leather: true, grain: true }, canTannery: true, canSmithy: true },
  );
  mark(`鐵三件=${IRON_TRIO.every((id) => (village.ownedWeapons[id] ?? 0) >= 1)},鐵儲備 ${Math.floor(village.resources.iron)},水壺=${village.upgrades["iron-flask"] === true} 鐵甲=${village.upgrades["iron-armor"] === true}`);

  // Phase 6.4:鋪軌北上——鐵軌從村莊一路鋪到北緣出口內側:
  // 軌上水 1/4、糧 1/8、完全不遇敵,北嶺長征的水量帳才算得平(這正是鐵軌系統的設計目的)
  if (mineCleared) {
    let totalLaid = 0;
    for (let trip = 0; trip < 4; trip++) {
      villageUntil(
        () => {
          craftUpTo("rail", 20);
          craftUpTo("ration", 14);
          return village.resources.rail >= 12 && village.resources.ration >= 12;
        },
        3000,
        { jobs: { iron: true, jerky: true, grain: true }, canTannery: true, canSmithy: true },
      );
      const laid = railExpedition([Math.floor(MAP_WIDTH / 2), 1], Math.min(20, Math.floor(village.resources.rail)));
      totalLaid += laid;
      if (laid === 0) break;
    }
    mark(`鐵軌鋪設 ${totalLaid} 根(村莊→北緣出口)`);
  }

  // Phase 6.5:北嶺攻堅——哨站鏈+煤礦坑(鋼時代的入場考;帶醒神鹽反制崩落暈眩)
  const coalSite = specialSites().find((st) => st.landmarkId === "coalmine")!;
  if (mineCleared) {
    for (let attempt = 0; attempt < 6 && !siteProgress(coalSite.key).cleared; attempt++) {
      villageUntil(
        () => {
          ensureCraft();
          for (const id of IRON_TRIO) {
            if (village.canRepairWeapon(id)) village.repairWeapon(id);
          }
          craftUpTo("ration", 24);
          craftUpTo("oil", 6);
          // 北嶺是中期梯隊的主場:鐵甲(50 血)+推車(70 格)+足量肉乾是門票,不是奢侈品
          return (
            village.upgrades["iron-flask"] === true &&
            village.upgrades["iron-armor"] === true &&
            village.upgrades["iron-cart"] === true &&
            village.resources.ration >= 20 &&
            (village.resources.jerky ?? 0) >= 20
          );
        },
        6000,
        { jobs: { iron: true, leather: true, jerky: true, grain: true }, canTannery: true, canSmithy: true },
      );
      if (village.hasBuilding("trading-post")) {
        while ((village.resources.salt ?? 0) < 3 && village.resources.shard >= 6) village.trade("trade-salt");
        while (village.resources.bandage < 4 && village.resources.shard >= 3) village.trade("trade-bandage");
        while (village.resources.elixir < 2 && village.resources.shard >= 10) village.trade("trade-elixir");
      }
      const saltsCarried = Math.min(3, Math.floor(village.resources.salt ?? 0));
      northExpedition({
        weapons: { "iron-knife": 1, "iron-sword": 1, "iron-spear": 1 },
        rations: 20,
        jerky: Math.min(20, village.resources.jerky),
        bandages: Math.min(6, village.resources.bandage),
        arrows: 0,
        scrolls: Math.min(2, village.resources.scroll),
        elixirs: Math.min(2, village.resources.elixir),
        salts: saltsCarried,
        oil: Math.min(6, Math.floor(village.resources.oil ?? 0)),
      });
      mark(
        `北嶺嘗試 #${attempt + 1}:煤礦${siteProgress(coalSite.key).cleared ? "解放!" : "未破"}(帶鹽 ${saltsCarried},戰死累計 ${stats.deaths};壺${village.upgrades["iron-flask"] === true} 甲${village.upgrades["iron-armor"] === true} 車${village.upgrades["iron-cart"] === true} 鐵${Math.floor(village.resources.iron)} 錠${Math.floor(village.resources.ingot ?? 0)} 皮${Math.floor(village.resources.leather)} 肉${Math.floor(village.resources.jerky)} 糧${Math.floor(village.resources.ration)})`,
      );
    }
  }
  const coalCleared = siteProgress(coalSite.key).cleared;

  // Phase 6.6:鋼鐵產線——採煤/煉鋼;鋼三件+散彈槍+子彈+鋼甲
  const STEEL_KIT = ["steel-knife", "steel-sword", "steel-spear", "shotgun"] as const;
  if (coalCleared) {
    villageUntil(
      () => {
        for (const id of STEEL_KIT) {
          if ((village.ownedWeapons[id] ?? 0) < 1 && village.canAfford(WEAPONS.find((w) => w.id === id)!.cost)) village.craftWeapon(id);
        }
        craftUpTo("bullet", 24);
        return (
          STEEL_KIT.every((id) => (village.ownedWeapons[id] ?? 0) >= 1) &&
          village.resources.bullet >= 24 &&
          village.upgrades["steel-armor"] === true
        );
      },
      9000,
      { jobs: { steel: true, leather: true, jerky: true, grain: true }, canTannery: true, canSmithy: true },
    );
    mark(
      `鋼裝=${STEEL_KIT.map((id) => ((village.ownedWeapons[id] ?? 0) >= 1 ? "O" : "X")).join("")} 子彈 ${Math.floor(village.resources.bullet)} 鋼甲=${village.upgrades["steel-armor"] === true} 鋼壺=${village.upgrades["steel-flask"] === true}`,
    );
  }

  const church = sites.find((s) => s.landmarkId === "church")!;
  // 先拿黑鐵鑰匙(離教堂最近的 Lv3 遺跡)
  const keySite = sites.find((s) => s.key === churchKeySiteKey());
  for (let attempt = 0; attempt < 5 && keySite && !hasChurchKey(); attempt++) {
    villageUntil(
      () => {
        ensureCraft();
        craftUpTo("ration", 16);
        return village.resources.ration >= 12 && (village.resources.jerky ?? 0) >= 6;
      },
      600,
      { jobs: { jerky: true, grain: true }, canTannery: true, canSmithy: true },
    );
    expedition([keySite], midLoadout());
  }
  mark(`黑鐵鑰匙=${hasChurchKey()}`);
  const steelReady = () => (village.ownedWeapons["steel-sword"] ?? 0) >= 1 || (village.ownedWeapons["steel-spear"] ?? 0) >= 1;
  for (let attempt = 0; attempt < 8 && coalCleared && !siteProgress(church.key).cleared; attempt++) {
    // 交易所兌換硬仗底牌:醒神鹽(反制鐘鳴/低語)最優先,再來藥劑、卷軸、繃帶
    if (village.hasBuilding("trading-post")) {
      while ((village.resources.salt ?? 0) < 5 && village.resources.shard >= 6) village.trade("trade-salt");
      while (village.resources.elixir < 3 && village.resources.shard >= 10) village.trade("trade-elixir");
      while (village.resources.bandage < 8 && village.resources.shard >= 3) village.trade("trade-bandage");
      while (village.resources.scroll < 2 && village.resources.shard >= 6) village.trade("trade-scroll");
    }
    villageUntil(
      () => {
        ensureCraft();
        // 戰死掉裝後的重整:鋼武器重新打造(鋼產線還在),修理堪用的
        for (const id of STEEL_KIT) {
          if ((village.ownedWeapons[id] ?? 0) < 1 && village.canAfford(WEAPONS.find((w) => w.id === id)!.cost)) village.craftWeapon(id);
          if (village.canRepairWeapon(id)) village.repairWeapon(id);
        }
        craftUpTo("bullet", 24);
        craftUpTo("ration", 20);
        return steelReady() && village.resources.ration >= 18 && (village.resources.jerky ?? 0) >= 16 && village.resources.bullet >= 12;
      },
      4000,
      { jobs: { steel: true, jerky: true, grain: true }, canTannery: true, canSmithy: true },
    );
    // 異晶攢不出反制套組(鹽5+藥3+繃8 ≈ 84 晶)→ 先去北嶺獵場農晶,攢夠再開打
    for (let farm = 0; farm < 5 && village.resources.shard < 75; farm++) {
      shardFarmTrip();
      villageUntil(() => { craftUpTo("ration", 20); return village.resources.ration >= 16; }, 400, { jobs: { steel: true, jerky: true, grain: true }, canTannery: true, canSmithy: true });
    }
    if (traceChurchWanted) tracing = true;
    tr(`[教堂備戰] 繃${village.resources.bandage} 鹽${Math.floor(village.resources.salt ?? 0)} 藥${village.resources.elixir} 晶${Math.floor(village.resources.shard)} 子彈${Math.floor(village.resources.bullet)} 肉${Math.floor(village.resources.jerky)}`);
    const loadout: Loadout = {
      weapons: { "steel-knife": 1, "steel-sword": 1, "steel-spear": 1, shotgun: 1 },
      rations: 18,
      jerky: Math.min(16, village.resources.jerky),
      bandages: Math.min(8, village.resources.bandage),
      arrows: 0,
      bullets: Math.min(24, Math.floor(village.resources.bullet)),
      scrolls: Math.min(2, village.resources.scroll),
      elixirs: Math.min(3, village.resources.elixir),
      salts: Math.min(5, village.resources.salt ?? 0),
    };
    expedition([church], loadout, true);
    leanLoot = false;
    mark(`教堂嘗試 #${attempt + 1}:${siteProgress(church.key).cleared ? "打通!" : "失敗"}(戰死累計 ${stats.deaths})`);
  }

  // Phase 7:全地圖掃圖(補給跳島;每趟從村口出發)
  const sweepLoadout = (): Loadout => ({
    weapons: { bayonet: village.ownedWeapons["bayonet"] ? 1 : 0, "iron-spear": village.ownedWeapons["iron-spear"] ? 1 : 0, "stone-axe": 1 },
    rations: 20,
    jerky: Math.min(8, village.resources.jerky),
    bandages: Math.min(3, village.resources.bandage),
    arrows: 0,
    scrolls: 0,
  });
  let noProgress = 0;
  let lastRevealed = -1;
  for (let trip = 0; trip < 60; trip++) {
    villageUntil(() => {
      craftUpTo("ration", 18);
      return village.resources.ration >= 16 && (village.resources.jerky ?? 0) >= 5;
    }, 600, {
      jobs: { jerky: true, grain: true },
      canTannery: true,
      canSmithy: true,
    });
    depart(sweepLoadout());
    const expl = newExplore();
    const grid = expl.grid as unknown as Grid;

    for (let hops = 0; hops < 60; hops++) {
      if (!fitToFight(expl.carried)) break;
      const dHere = bfsFrom(grid, expl.playerX, expl.playerY);
      let target: [number, number] | null = null;
      let bestD = Infinity;
      for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
          if (expl.grid[y][x].revealed) continue;
          let d = dHere[y * MAP_WIDTH + x];
          if (d === -1) {
            for (let dy = -3; dy <= 3; dy++) {
              for (let dx = -3 + Math.abs(dy); dx <= 3 - Math.abs(dy); dx++) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= MAP_WIDTH || ny >= MAP_HEIGHT) continue;
                const dd = dHere[ny * MAP_WIDTH + nx];
                if (dd !== -1 && (d === -1 || dd < d)) d = dd;
              }
            }
          }
          if (d !== -1 && d < bestD) {
            bestD = d;
            target = [x, y];
          }
        }
      }
      if (!target) break;
      let dest: [number, number] = target;
      if ((BLOCKED as readonly string[]).includes(grid[target[1]][target[0]].type) || dHere[target[1] * MAP_WIDTH + target[0]] === -1) {
        let bd = Infinity;
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3 + Math.abs(dy); dx <= 3 - Math.abs(dy); dx++) {
            const nx = target[0] + dx;
            const ny = target[1] + dy;
            if (nx < 0 || ny < 0 || nx >= MAP_WIDTH || ny >= MAP_HEIGHT) continue;
            const dd = dHere[ny * MAP_WIDTH + nx];
            if (dd !== -1 && dd < bd) {
              bd = dd;
              dest = [nx, ny];
            }
          }
        }
        if (bd === Infinity) break;
      }
      const r = travelTo(expl, dest[0], dest[1], () => shouldTurnBack(expl));
      if (r === "dead") break;
      if (r === "turnback") break;
      if (r === "aborted") break;
    }
    if (!deathFlag) goHome(expl);

    const check = newExplore();
    let revealedNow = 0;
    for (let y = 0; y < MAP_HEIGHT; y++) for (let x = 0; x < MAP_WIDTH; x++) if (check.grid[y][x].revealed) revealedNow++;
    if (revealedNow === lastRevealed) {
      noProgress++;
      if (noProgress >= 2) break;
    } else noProgress = 0;
    lastRevealed = revealedNow;
  }

  // 收尾統計
  const expl = newExplore();
  let revealed = 0;
  const total = MAP_WIDTH * MAP_HEIGHT;
  for (let y = 0; y < MAP_HEIGHT; y++) for (let x = 0; x < MAP_WIDTH; x++) if (expl.grid[y][x].revealed) revealed++;
  const clearedAll = sites.every((s) => siteProgress(s.key).cleared);
  mark(
    `結束:地圖揭露 ${revealed}/${total}(${Math.round((revealed / total) * 100)}%),探勘點全通=${clearedAll},戰鬥 ${stats.battles} 場,戰死 ${stats.deaths} 次,遠征 ${stats.expeditions} 趟`,
  );
  mark(`時間合計 ${fmt(totalSec(stats.time))}(村莊 ${fmt(stats.time.village)} / 趕路 ${fmt(stats.time.explore)} / 戰鬥 ${fmt(stats.time.combat)})`);
  return stats;
}
