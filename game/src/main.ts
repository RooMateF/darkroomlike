import "./style.css";
import { CombatEngine, type LogEntry } from "./engine";
import { buildPlayerCategories } from "./demo-data";
import { WEAPONS, fineMaxDurability, WEAPON_CARRY_LIMITS } from "./village/data";
import { RESOURCE_LABEL, type ResourceId } from "./village/types";
import { loadCarried, saveCarried, clearCarried, addLoot, playerMaxHp, carriedMaxDurability, packUsed } from "./carried";
import { pickRandomEnemy, pickMidEnemy, pickEnemyGroup, GUARDIANS, LANDMARK_REWARDS, LV3_BOSS, EVENT_BOSSES, TENTACLE_GUARD, SPAWN_UNIT, MOON_MUTANT, REDMOON_BOSS, CHURCH_PHASE2_MOVES, CHURCH_PHASE2_PATTERN, WILD_SPAWN, type EnemyDef } from "./enemies";
import { markLandmarkCleared, currentMapId, isAutoPickup } from "./explore/engine";

// 蓋「這趟有收穫」章(空手計數的歸零依據;引導事件用)
function markExpeditionGained(added: Record<string, number>) {
  if (Object.keys(added).length > 0) localStorage.setItem("expedition-gained", "1");
}
import { DUNGEON_KEY, siteProgress, saveSiteProgress as saveSiteProgressRaw, churchKeySiteKey, hasChurchKey, grantChurchKey, type DungeonRun } from "./explore/sites";

// 打通任何一層也算「有收穫」:包一層蓋章
const saveSiteProgress: typeof saveSiteProgressRaw = (key, progress) => {
  localStorage.setItem("expedition-gained", "1");
  saveSiteProgressRaw(key, progress);
};
import type { CategoryId } from "./types";

// 模擬戰(?sandbox=<bossId>,2026-09 用戶要求):滿裝測試場——不讀不寫存檔,勝敗自動重開,撤退=離開
const SANDBOX = new URLSearchParams(window.location.search).get("sandbox");
if (SANDBOX) (globalThis as unknown as { __sandboxNoSave?: boolean }).__sandboxNoSave = true;

// 預設配置遵守攜帶上限(近戰3/槍械2/盾1):大劍+鬼雪+匕首、左輪+自動步槍、鋼盾
const SANDBOX_DEFAULT_WEAPONS: Record<string, number> = { "steel-greatsword": 1, oniyuki: 1, dagger: 1, "steel-shield": 1, revolver: 1, "auto-rifle": 1 };

/** 模擬戰武器配置(裝備調整面板改這份;sandbox 專用鍵,不是遊戲存檔) */
function sandboxLoadout(): Record<string, number> {
  try {
    const raw = localStorage.getItem("sandbox-loadout");
    if (raw) return JSON.parse(raw) as Record<string, number>;
  } catch {
    /* 壞資料用預設 */
  }
  return { ...SANDBOX_DEFAULT_WEAPONS };
}

function sandboxCarried() {
  const picked = sandboxLoadout();
  const weapons: Record<string, number> = {};
  const durability: Record<string, number> = {};
  for (const w of WEAPONS) {
    if ((picked[w.id] ?? 0) > 0) {
      weapons[w.id] = picked[w.id];
      durability[w.id] = w.durability;
    }
  }
  return {
    weapons,
    fineWeapons: {},
    durability,
    bullets: 150,
    bandages: 8,
    elixirs: 3,
    salts: 5,
    jerky: 4,
    scrolls: 2,
    rations: 4,
    hp: 90,
    loot: {},
  } as unknown as NonNullable<ReturnType<typeof loadCarried>>;
}

// 玩家的行動類別由隨身行囊決定(整備頁打包的 carried);敵人隨機抽自前期名冊
const carried = SANDBOX ? sandboxCarried() : loadCarried();
const PLAYER_CATEGORIES = buildPlayerCategories(carried);

// 地城戰(五級制探勘地點)優先於隨機遭遇;敵人依等級與層數選擇,最深層是 Boss
let dungeon: DungeonRun | null = null;
try {
  const raw = localStorage.getItem(DUNGEON_KEY);
  if (raw) dungeon = JSON.parse(raw) as DungeonRun;
} catch {
  dungeon = null;
}
if (SANDBOX && ["church", "coalmine", "mine", "observatory", "shrine", "scavenger", "counter", "lv3"].includes(SANDBOX)) {
  // 守衛型模擬戰:直接打最深層 Boss
  dungeon = {
    key: "sandbox",
    level: SANDBOX === "lv3" ? 3 : 5,
    stage: 1,
    stages: 1,
    landmarkId: SANDBOX === "lv3" ? undefined : SANDBOX,
    x: 0,
    y: 0,
  } as unknown as DungeonRun;
} else if (SANDBOX === "chain") {
  // 遺跡連鎖戰模擬:層間戰場景(下面會強制排入兩波)
  dungeon = { key: "sandbox", level: 4, stage: 1, stages: 3, landmarkId: "coalmine", x: 0, y: 0 } as unknown as DungeonRun;
}

function pickDungeonEnemy(run: DungeonRun): EnemyDef {
  const isFinal = run.stage >= run.stages;
  if (isFinal) {
    if (run.level >= 4 && run.landmarkId && GUARDIANS[run.landmarkId]) return GUARDIANS[run.landmarkId];
    if (run.level === 3) return LV3_BOSS;
    return pickRandomEnemy(); // Lv1/2 沒有獨立 Boss,最後一層也是雜兵強度
  }
  // 層間敵人:低等級用前期雜兵,高等級用中期梯隊
  return run.level >= 3 ? pickMidEnemy() : pickRandomEnemy();
}

// 入口防呆:戰鬥頁只該由探索頁在遭遇時跳進來——沒有行囊也沒有地城狀態(例如直接開網站根目錄)就導回村莊
if (!carried && !dungeon) {
  window.location.replace("village.html");
}

// 事件小 Boss(選擇式小劇情觸發,如「唱歌的風」):優先於地城與隨機遭遇
const eventBossId = SANDBOX === "siren" || SANDBOX === "tentacle" ? SANDBOX : localStorage.getItem("pending-event-boss");
if (!SANDBOX && eventBossId) localStorage.removeItem("pending-event-boss");

// 外圍組隊(探索頁標記):2~3 隻車輪戰;地城/事件 Boss 不組隊
const isGroupFight = SANDBOX === "group" || (!eventBossId && !dungeon && localStorage.getItem("pending-group") === "1");
if (localStorage.getItem("pending-group")) localStorage.removeItem("pending-group");
const groupQueue: EnemyDef[] = isGroupFight ? pickEnemyGroup() : [];

// 紅月窪地(2026-09 核可):踩上 ☾ 觸發——固定三場連鎖(畸體×2 → 畸體×1~2 → 變異野獸)
const isRedmoonFight = SANDBOX === "redmoon" || (!eventBossId && !dungeon && localStorage.getItem("pending-redmoon") === "1");
if (!SANDBOX && localStorage.getItem("pending-redmoon")) localStorage.removeItem("pending-redmoon");

// 相鄰地圖(中央地圖以外)的野外更兇:一半機率抽中期梯隊
const pickedDef = eventBossId
  ? (EVENT_BOSSES[eventBossId] ?? pickRandomEnemy())
  : dungeon
    ? pickDungeonEnemy(dungeon)
    : isGroupFight
      ? groupQueue.shift()!
      : currentMapId() !== "A" && Math.random() < 0.5
        ? pickMidEnemy()
        : pickRandomEnemy();

/** 成群的孳生體:資料上一筆,戰場上展開成 3 隻實體(2026-09 多目標系統) */
function expandPack(defs: EnemyDef[]): EnemyDef[] {
  const out: EnemyDef[] = [];
  for (const d of defs) {
    if (d.id === "spawn-pack") out.push(SPAWN_UNIT, SPAWN_UNIT, SPAWN_UNIT);
    else out.push(d);
  }
  return out;
}

// 這一波的實際陣容(展開後);後面的波次見 chainWaves
const initialWave = expandPack([pickedDef, ...groupQueue]);
groupQueue.length = 0;
if (isRedmoonFight) {
  initialWave.length = 0;
  initialWave.push(MOON_MUTANT, MOON_MUTANT);
}
if (SANDBOX === "spawnpack") {
  initialWave.length = 0;
  initialWave.push(SPAWN_UNIT, SPAWN_UNIT, SPAWN_UNIT);
}
const enemyDef = initialWave[0];

// 高階遺跡連鎖戰(2026-09 用戶定案):Lv3+ 層間戰有一半機率連 2~3 場——
// 波與波之間沒有補給、沒有拾取,結算(戰利品/掉落面板)全放最後
const chainWaves: EnemyDef[][] = [];
if (dungeon && dungeon.level >= 3 && dungeon.stage < dungeon.stages && Math.random() < 0.5) {
  const extra = 1 + (Math.random() < 0.4 ? 1 : 0);
  for (let i = 0; i < extra; i++) chainWaves.push(expandPack([pickMidEnemy()]));
}
if (isRedmoonFight) {
  chainWaves.push(Math.random() < 0.5 ? [MOON_MUTANT] : [MOON_MUTANT, MOON_MUTANT]);
  chainWaves.push([REDMOON_BOSS]);
}
if (SANDBOX === "chain") {
  chainWaves.length = 0;
  chainWaves.push(expandPack([pickMidEnemy()]), expandPack([pickMidEnemy()]));
}
/** 這一戰的完整陣容(含連鎖各波;勝利時戰利品合計、異晶逐隻擲骰) */
const unitDefs: EnemyDef[] = [...initialWave];

// 拾荒的長手 Boss 戰:贓物快照與歸還記帳(護贓觸手倒下即歸還那件)
const sandboxStealStore = { kinds: [] as string[], stolen: [] as { kind: string; id?: string; durability?: number; fine?: boolean; count?: number }[] };
let stolenSnapshot: { kind: string; id?: string; durability?: number; fine?: boolean }[] = [];
const returnedIdx = new Set<number>();
if (dungeon?.landmarkId === "scavenger") {
  if (SANDBOX) {
    // 模擬戰:偽造一整排贓物,展示「打倒護贓觸手取回裝備」的完整機制
    stolenSnapshot = [
      { kind: "weapon", id: "steel-knife", durability: 60, fine: false },
      { kind: "salt" },
      { kind: "elixir" },
      { kind: "jerky" },
      { kind: "bandage" },
    ];
  } else {
    try {
      stolenSnapshot = JSON.parse(localStorage.getItem("maze-stolen") ?? "[]");
    } catch {
      stolenSnapshot = [];
    }
  }
}
let lowHpWarned = false;

const BAR_WIDTH = 16;

// 記住上次選擇的底色(黑底/白底),預設黑底
const savedTheme = localStorage.getItem("theme") ?? "dark";
document.documentElement.dataset.theme = savedTheme;

const app = document.querySelector<HTMLDivElement>("#app")!;
// 版型比照村莊/遠征:左=行動區,右=整欄戰鬥紀錄——整頁塞進視窗,紀錄永遠看得到
app.classList.add("app-frame");
app.style.maxWidth = "920px";
app.innerHTML = `
  <div class="top-row">
    <h1>戰鬥</h1>
    <button id="theme-toggle">切換底色</button>
  </div>
  <div class="combat-split">
    <div class="combat-main" id="combat-main">
      <div class="section">
        <div class="section-title">你</div>
        <div class="row-grid" id="player-hp-row" style="position:relative;">
          <span class="row-name">HP <b id="player-hp-text"></b><span id="status-effects"></span></span>
          <span class="row-controls"><span class="bar hp-bar"><span class="filled" id="player-hp-filled"></span><span id="player-hp-empty"></span></span></span>
          <span class="row-info"></span>
        </div>
      </div>

      <!-- 控制列固定在行動區頂端(2026-09 用戶要求):不隨武器變多往下漂,位置顯眼 -->
      <div class="combat-controls"><span id="status-text"></span><span class="combat-controls-spacer"></span><button class="btn" id="skip-btn" disabled>暫不使用</button> <button class="btn" id="retreat-btn" disabled>撤退</button></div>
      <div class="section" id="categories"></div>

      <div class="section" style="margin-top:8px;">
        <div class="section-title">你的異常狀態</div>
        <div id="status-panel"></div>
      </div>
    </div>
    <div class="combat-side">
      <div class="section" style="margin-bottom:8px;" id="enemies"></div>
      <div class="section-title">戰鬥紀錄</div>
      <div class="log-panel scrollable combat-log" id="log"></div>
    </div>
  </div>
`;

const categoriesEl = document.querySelector<HTMLDivElement>("#categories")!;
const logEl = document.querySelector<HTMLDivElement>("#log")!;
const statusEl = document.querySelector<HTMLElement>("#status-text")!;
const skipBtn = document.querySelector<HTMLButtonElement>("#skip-btn")!;
skipBtn.addEventListener("click", () => engine.skip());
const retreatBtn = document.querySelector<HTMLButtonElement>("#retreat-btn")!;

// 撤退(design-notes.md § 2.10):隨時可退,但有風險——六成機率被追擊一次
retreatBtn.addEventListener("click", () => {
  if (SANDBOX) {
    window.location.href = "village.html";
    return;
  }
  if (retreatBtn.disabled) return;
  localStorage.removeItem(DUNGEON_KEY); // 地城進度已在每層勝利時保存,中途撤退不影響

  const pursued = Math.random() < 0.6;
  if (pursued) {
    const dmg = engine.enemy.currentMove.damage || 3;
    engine.playerHp = Math.max(0, engine.playerHp - dmg);
    appendSystemLog(`你轉身撤退,背後重重挨了一下(-${dmg})。`);
    if (engine.playerHp <= 0) {
      clearCarried();
      if (!SANDBOX) localStorage.setItem("death-cause", "combat");
      endCombat("你在逃跑途中倒下……一股溫暖的微光在你的意識消散前包裹著你。", "village.html", 2200);
      return;
    }
  } else {
    appendSystemLog("你抓準空隙脫離了戰鬥。");
  }
  if (carried) {
    carried.hp = engine.playerHp;
    saveCarried(carried);
  }
  endCombat("你退出了戰鬥。", "village.html?view=expedition", 1200);
});

document.querySelector<HTMLButtonElement>("#theme-toggle")!.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("theme", next);
});
const playerHpText = document.querySelector<HTMLElement>("#player-hp-text")!;
const playerHpFilled = document.querySelector<HTMLElement>("#player-hp-filled")!;
const playerHpEmpty = document.querySelector<HTMLElement>("#player-hp-empty")!;
const statusEffectsEl = document.querySelector<HTMLElement>("#status-effects")!;
const statusPanelEl = document.querySelector<HTMLElement>("#status-panel")!;

// ---- 敵欄(多目標):每隻一塊——標題(▶=目前目標)、HP 條、動作條、凍結條;點塊選目標,Tab 輪切 ----
interface UnitEls {
  root: HTMLDivElement;
  title: HTMLDivElement;
  hpText: HTMLElement;
  hpF: HTMLElement;
  hpE: HTMLElement;
  actF: HTMLElement;
  actE: HTMLElement;
  frRow: HTMLElement;
  frF: HTMLElement;
  frE: HTMLElement;
  frPct: HTMLElement;
}
let unitEls: UnitEls[] = [];

/** 傷害跳字(2026-09 用戶要求):在被打的那一塊上冒出 -N,飄起淡出;槍械逐彈跳 */
function spawnDamagePop(host: HTMLElement, text: string, topPx?: number) {
  const el = document.createElement("span");
  el.className = "dmg-pop";
  el.textContent = text;
  el.style.left = `${45 + Math.random() * 35}%`;
  if (topPx !== undefined) el.style.top = `${topPx}px`;
  host.appendChild(el);
  window.setTimeout(() => el.remove(), 900);
}

// 敵方跳字覆蓋層:掛在敵欄外,擊殺重建敵欄也不會把跳到一半的字洗掉
const enemiesHostEl = document.querySelector<HTMLDivElement>("#enemies")!;
enemiesHostEl.style.position = "relative";
const dmgPopLayer = document.createElement("div");
dmgPopLayer.id = "dmg-pop-layer";
enemiesHostEl.parentElement!.style.position = "relative";
enemiesHostEl.parentElement!.appendChild(dmgPopLayer);

function buildEnemyPanel() {
  const host = document.querySelector<HTMLDivElement>("#enemies")!;
  host.innerHTML = "";
  unitEls = engine.units.map((u, i) => {
    const root = document.createElement("div");
    root.className = "enemy-block";
    root.style.cursor = "pointer";
    root.addEventListener("click", () => engine.setTarget(i));
    // 目標欄(2026-09 用戶要求):敵塊左側一條可點的選擇欄,◉=目前目標、○=可選
    const gutter = document.createElement("div");
    gutter.className = "enemy-target-gutter";
    gutter.title = "設為攻擊目標(也可點整塊或按 Tab 輪切)";
    const body = document.createElement("div");
    body.className = "enemy-block-body";
    const title = document.createElement("div");
    title.className = "section-title";
    const mkRow = (label: string, info: string) => {
      const row = document.createElement("div");
      row.className = "row-grid";
      const name = document.createElement("span");
      name.className = "row-name";
      name.textContent = label;
      const controls = document.createElement("span");
      controls.className = "row-controls";
      const bar = document.createElement("span");
      bar.className = "bar";
      const f = document.createElement("span");
      f.className = "filled";
      const e2 = document.createElement("span");
      bar.append(f, e2);
      controls.appendChild(bar);
      const infoEl = document.createElement("span");
      infoEl.className = "row-info";
      infoEl.textContent = info;
      row.append(name, controls, infoEl);
      return { row, name, f, e: e2, infoEl };
    };
    const hp = mkRow("HP", "");
    const act = mkRow("動作", "敵方動作");
    const fr = mkRow("凍結", "");
    fr.row.style.display = "none";
    const st = mkRow("踉蹌", "");
    st.row.style.display = "none";
    body.append(title, hp.row, act.row, fr.row, st.row);
    root.append(gutter, body);
    host.appendChild(root);
    void u;
    return { root, gutter, title, hpText: hp.name, hpF: hp.f, hpE: hp.e, actF: act.f, actE: act.e, frRow: fr.row, frF: fr.f, frE: fr.e, frPct: fr.infoEl, stRow: st.row, stF: st.f, stE: st.e, stPct: st.infoEl };
  });
}

interface SubActionRow {
  categoryId: CategoryId;
  subActionId: string;
  name: HTMLSpanElement;
  bar: HTMLSpanElement;
  barFilled: HTMLSpanElement;
  barEmpty: HTMLSpanElement;
  pct: HTMLSpanElement;
  useLink: HTMLButtonElement;
}
const rows: SubActionRow[] = [];

// ---- 隨身資源的消耗規則(耐久度/弓矢/消耗品) ----

/** 這個子行動現在還能不能用(弓沒箭、消耗品用完、武器全壞 → 不能) */
function canUse(subActionId: string): boolean {
  if (!carried) return subActionId === "fists";
  const weapon = WEAPONS.find((w) => w.id === subActionId);
  if (weapon) {
    if ((carried.weapons[subActionId] ?? 0) <= 0) return false;
    const per = weapon.ammoPerUse ?? 1;
    if (weapon.ammo === "arrow" && carried.arrows < per) return false;
    if (weapon.ammo === "bullet" && (carried.bullets ?? 0) < per) return false;
    return true;
  }
  if (subActionId === "bandage") return carried.bandages > 0;
  if (subActionId === "jerky") return (carried.jerky ?? 0) > 0;
  if (subActionId === "fire-scroll") return (carried.scrolls ?? 0) > 0;
  if (subActionId === "elixir") return (carried.elixirs ?? 0) > 0;
  if (subActionId === "salt") return (carried.salts ?? 0) > 0;
  return true; // 徒手等不消耗任何東西的行動
}

/** 使用後結算:武器扣耐久(壞了換備用)、弓扣箭、消耗品扣數量 */
function afterUse(subActionId: string) {
  if (!carried) return;
  if (engine.justReloaded) return; // 換彈不是射擊:不耗彈藥也不耗任何東西
  const weapon = WEAPONS.find((w) => w.id === subActionId);
  if (weapon) {
    const per = weapon.ammoPerUse ?? 1;
    if (weapon.ammo === "arrow") carried.arrows = Math.max(0, carried.arrows - per);
    if (weapon.ammo === "bullet") carried.bullets = Math.max(0, (carried.bullets ?? 0) - per);
    if (weapon.noWear) {
      // 槍械不耗耐久(2026-09 用戶定案):只吃彈藥;死亡照樣全失
      saveCarried(carried);
      return;
    }
    carried.durability[subActionId] = (carried.durability[subActionId] ?? carriedMaxDurability(carried, subActionId)) - 1;
    if (carried.durability[subActionId] <= 0 && weapon.unbreakable) {
      // 特殊武器(鬼雪):不會消失——變成(損毀)留在背包,鐵匠鋪用異晶修復
      carried.weapons[subActionId] = Math.max(0, (carried.weapons[subActionId] ?? 0) - 1);
      if (carried.weapons[subActionId] <= 0) {
        delete carried.weapons[subActionId];
        delete carried.durability[subActionId];
      }
      carried.broken = carried.broken ?? {};
      carried.broken[subActionId] = (carried.broken[subActionId] ?? 0) + 1;
      appendSystemLog(`${weapon.label}的刀刃崩出裂紋,寒氣散了。(損毀——鐵匠鋪可用異晶修復)`);
    } else if (carried.durability[subActionId] <= 0) {
      // 壞的是「使用中那把」:普通優先上手(2026-09 修訂)——有普通存量時壞的是普通,精工墊後
      const fineNow = carried.fineWeapons?.[subActionId] ?? 0;
      const normalNow = (carried.weapons[subActionId] ?? 0) - fineNow;
      if (normalNow <= 0 && fineNow > 0) {
        carried.fineWeapons![subActionId]--;
        if (carried.fineWeapons![subActionId] <= 0) delete carried.fineWeapons![subActionId];
      }
      carried.weapons[subActionId] = Math.max(0, (carried.weapons[subActionId] ?? 0) - 1);
      if (carried.weapons[subActionId] > 0) {
        // 換上備用的那把(普通先頂,普通耗盡才輪到精工)
        carried.durability[subActionId] = carriedMaxDurability(carried, subActionId);
        appendSystemLog(`${weapon.label}壞了——你換上了備用的一把。`);
      } else {
        delete carried.durability[subActionId];
        appendSystemLog(`${weapon.label}徹底壞了。`);
      }
    }
  } else if (subActionId === "bandage") {
    carried.bandages = Math.max(0, carried.bandages - 1);
    engine.clearStatus("bleed"); // 繃帶止血:解除流血異常
  } else if (subActionId === "jerky") {
    carried.jerky = Math.max(0, (carried.jerky ?? 0) - 1);
  } else if (subActionId === "fire-scroll") {
    carried.scrolls = Math.max(0, (carried.scrolls ?? 0) - 1);
  } else if (subActionId === "elixir") {
    carried.elixirs = Math.max(0, (carried.elixirs ?? 0) - 1);
    engine.clearStatus("poison"); // 藥劑:解除所有異常
    engine.clearStatus("bleed");
  } else if (subActionId === "salt") {
    carried.salts = Math.max(0, (carried.salts ?? 0) - 1);
    engine.clearControl(6); // 醒神鹽:解控 + 6 秒免疫
  }
  saveCarried(carried);
}

/** 顯示用:名稱後面帶剩餘量(耐久/數量/箭數) */
function subActionLabel(subActionId: string, baseLabel: string): string {
  if (!carried) return baseLabel;
  const weapon = WEAPONS.find((w) => w.id === subActionId);
  if (weapon) {
    const count = carried.weapons[subActionId] ?? 0;
    if (count <= 0) return `${baseLabel}(損壞)`;
    const dur = carried.durability[subActionId] ?? weapon.durability;
    const spare = count > 1 ? ` ×${count}` : "";
    const ammoRaw = weapon.ammo === "arrow" ? `弓矢 ${carried.arrows}` : weapon.ammo === "bullet" ? `子彈 ${carried.bullets ?? 0}` : "";
    const parts = [weapon.noWear ? "" : `耐久 ${dur}`, ammoRaw].filter(Boolean).join("・");
    return `${baseLabel}${spare}${parts ? `(${parts})` : ""}`;
  }
  if (subActionId === "bandage") return `${baseLabel} ×${carried.bandages}`;
  if (subActionId === "jerky") return `${baseLabel} ×${carried.jerky ?? 0}`;
  if (subActionId === "fire-scroll") return `${baseLabel} ×${carried.scrolls ?? 0}`;
  if (subActionId === "elixir") return `${baseLabel} ×${carried.elixirs ?? 0}`;
  if (subActionId === "salt") return `${baseLabel} ×${carried.salts ?? 0}`;
  return baseLabel;
}

for (const cat of PLAYER_CATEGORIES) {
  const label = document.createElement("div");
  label.className = "section-title";
  label.textContent = cat.label;
  categoriesEl.appendChild(label);

  for (const sa of cat.subActions) {
    const line = document.createElement("div");
    line.className = "row-grid";

    const name = document.createElement("span");
    name.className = "row-name";
    // 行首標快捷鍵數字([1]~[9]):戰鬥每一兩秒就要出手一次,全用滑鼠點會累死
    const hotkey = rows.length + 1;
    name.textContent = hotkey <= 9 ? `${hotkey}. ${sa.label}` : sa.label;

    const barWrap = document.createElement("span");
    barWrap.className = "row-controls";
    const bar = document.createElement("span");
    bar.className = "bar";
    const barFilled = document.createElement("span");
    barFilled.className = "filled";
    const barEmpty = document.createElement("span");
    bar.append(barFilled, barEmpty);
    const pct = document.createElement("span");
    pct.className = "row-count";
    barWrap.append(bar, pct);

    const useLink = document.createElement("button");
    useLink.className = "use-link";
    useLink.textContent = "使用";
    useLink.disabled = true;
    useLink.addEventListener("click", () => {
      if (bossDialogActive || !canUse(sa.id)) return;
      if (engine.useSubAction(cat.id, sa.id)) afterUse(sa.id);
    });

    line.append(name, barWrap, useLink);
    categoriesEl.appendChild(line);
    rows.push({ categoryId: cat.id, subActionId: sa.id, name, bar, barFilled, barEmpty, pct, useLink });
  }
}

// ---- 格擋(盾牌):獨立於類別列的即時動作——0 鍵或按鈕,窗口/冷卻畫在同一條 bar ----
// 帶多面盾時用最好的那面(WEAPONS 順序即位階);半格擋耗 1 耐久,壞了自動換下一面
function bestShieldId(): string | null {
  if (!carried) return null;
  for (let i = WEAPONS.length - 1; i >= 0; i--) {
    const w = WEAPONS[i];
    if (w.category === "shield" && (carried.weapons[w.id] ?? 0) > 0) return w.id;
  }
  return null;
}

let shieldId = bestShieldId();
const blockRowEls = (() => {
  const line = document.createElement("div");
  line.className = "row-grid";
  line.style.display = "none";
  const name = document.createElement("span");
  name.className = "row-name";
  const barWrap = document.createElement("span");
  barWrap.className = "row-controls";
  const bar = document.createElement("span");
  bar.className = "bar";
  const barFilled = document.createElement("span");
  barFilled.className = "filled";
  const barEmpty = document.createElement("span");
  bar.append(barFilled, barEmpty);
  const pct = document.createElement("span");
  pct.className = "row-count";
  barWrap.append(bar, pct);
  const useLink = document.createElement("button");
  useLink.className = "use-link";
  useLink.textContent = "格擋";
  useLink.addEventListener("click", () => { if (!bossDialogActive) engine.useBlock(); });
  line.append(name, barWrap, useLink);
  categoriesEl.appendChild(line);
  return { line, name, bar, barFilled, barEmpty, pct, useLink };
})();

function syncShieldToEngine() {
  const def = shieldId ? WEAPONS.find((w) => w.id === shieldId) : null;
  engine.shield = def?.block ? { label: def.label, reduce: def.block.reduce, cd: def.block.cd } : null;
  blockRowEls.line.style.display = engine.shield ? "" : "none";
}

/** 半格擋耗盾耐久;壞了換下一面(完全格擋免費——手上功夫不磨盾) */
function onShieldBlocked(perfect: boolean) {
  if (perfect || !carried || !shieldId) return;
  const def = WEAPONS.find((w) => w.id === shieldId)!;
  carried.durability[shieldId] = (carried.durability[shieldId] ?? carriedMaxDurability(carried, shieldId)) - 1;
  if (carried.durability[shieldId] <= 0) {
    const fineNow = carried.fineWeapons?.[shieldId] ?? 0;
    const normalNow = (carried.weapons[shieldId] ?? 0) - fineNow;
    if (normalNow <= 0 && fineNow > 0) {
      carried.fineWeapons![shieldId]--;
      if (carried.fineWeapons![shieldId] <= 0) delete carried.fineWeapons[shieldId];
    }
    carried.weapons[shieldId] = Math.max(0, (carried.weapons[shieldId] ?? 0) - 1);
    if (carried.weapons[shieldId] > 0) {
      carried.durability[shieldId] = carriedMaxDurability(carried, shieldId);
      appendSystemLog(`${def.label}被打得裂開——你換上了備用的一面。`);
    } else {
      delete carried.durability[shieldId];
      appendSystemLog(`${def.label}徹底碎了。`);
      shieldId = bestShieldId();
      syncShieldToEngine();
    }
  }
  saveCarried(carried);
}

function appendLog(entry: LogEntry) {
  const line = document.createElement("div");
  line.className = "log-line";

  const actor = document.createElement("span");
  actor.textContent = entry.actor;

  const symbol = document.createElement("span");
  symbol.className = "log-symbol";
  symbol.textContent = ` ${entry.symbol} `;

  const target = document.createElement("span");
  target.className = "log-target hit";
  target.textContent =
    (entry.heal ?? 0) > 0 ? `${entry.target} (+${entry.heal})` : entry.damage > 0 ? `${entry.target} (-${entry.damage})` : entry.target;
  if (entry.blocked) target.textContent += "(盾架住了大半)";

  line.append(actor, symbol, target);
  logEl.appendChild(line);
  trimBattleLog();
}

/** 系統訊息(武器損壞等),沒有攻擊符號動畫 */
function appendSystemLog(text: string) {
  const line = document.createElement("div");
  line.className = "log-line";
  line.textContent = text;
  logEl.appendChild(line);
  trimBattleLog();
}

// 單場戰鬥的完整紀錄保留可捲動回看;每場戰鬥都是新頁面,結束離開時自然清空
function trimBattleLog() {
  while (logEl.childElementCount > 300) logEl.removeChild(logEl.firstChild!);
  logEl.scrollTop = logEl.scrollHeight;
}

// 【祝禱】(教徒的禱詞):敵方攻擊附帶的中毒/流血累積減半
function applyBlessing(moves: EnemyMove[]): EnemyMove[] {
  try {
    const v = JSON.parse(localStorage.getItem("village-state") ?? "{}");
    const blessingOn = Array.isArray(v.equippedPerks) ? v.equippedPerks.includes("blessing") : v.perks?.blessing === true;
    if (blessingOn) {
      return moves.map((m) => (m.status ? { ...m, status: { ...m.status, amount: Math.ceil(m.status.amount / 2) } } : m));
    }
  } catch {
    /* 沒有存檔就照原樣 */
  }
  return moves;
}
const combatMoves = applyBlessing(enemyDef.moves);

// ---- Boss 儀式對話框(2026-09 用戶要求):Boss 專屬敘述/對話全螢幕呈現,期間時間停住 ----
let bossDialogActive = false;
const bossOverlayEl = document.createElement("div");
bossOverlayEl.className = "event-overlay";
bossOverlayEl.style.display = "none";
bossOverlayEl.innerHTML = `
  <div class="event-box">
    <div class="event-title" id="boss-dialog-title"></div>
    <div class="event-text" id="boss-dialog-text"></div>
    <div class="event-options"><button class="btn ready" id="boss-dialog-next">繼續</button></div>
  </div>
`;
document.body.appendChild(bossOverlayEl);
const bossDialogTitle = bossOverlayEl.querySelector<HTMLDivElement>("#boss-dialog-title")!;
const bossDialogText = bossOverlayEl.querySelector<HTMLDivElement>("#boss-dialog-text")!;
const bossDialogNext = bossOverlayEl.querySelector<HTMLButtonElement>("#boss-dialog-next")!;
let bossDialogLines: string[] = [];
let bossDialogIdx = 0;
let bossDialogDone: (() => void) | null = null;

function showBossDialog(lines: string[], title: string, onDone?: () => void) {
  engine.stop(); // 儀式進行中,時間停住(開場時鐘還沒開也無害)
  bossDialogActive = true;
  bossDialogLines = lines;
  bossDialogIdx = 0;
  bossDialogDone = onDone ?? null;
  bossDialogTitle.textContent = title;
  bossDialogText.textContent = lines[0] ?? "";
  bossOverlayEl.style.display = "flex";
}

bossDialogNext.addEventListener("click", () => {
  bossDialogIdx++;
  if (bossDialogIdx < bossDialogLines.length) {
    bossDialogText.textContent = bossDialogLines[bossDialogIdx];
    return;
  }
  bossOverlayEl.style.display = "none";
  bossDialogActive = false;
  const done = bossDialogDone;
  bossDialogDone = null;
  engine.start(); // 戰鬥已結束時 step 會自己早退,重開時鐘無害
  done?.();
});

// 鍵盤快捷鍵(戰鬥的出手頻率高,全滑鼠會累死):數字 1~9 = 使用對應列;空白鍵 = 暫不使用;R = 撤退
window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (bossDialogActive) return; // 儀式對話框開著:先讀完
  if (lootPanelActive) return; // 掉落面板開著:按鍵交給面板
  if (e.key === " ") {
    e.preventDefault();
    if (!skipBtn.disabled) engine.skip();
    return;
  }
  if (e.key === "r" || e.key === "R") {
    if (!retreatBtn.disabled) retreatBtn.click();
    return;
  }
  if (e.key === "0") {
    engine.useBlock();
    return;
  }
  if (e.key === "Tab") {
    e.preventDefault();
    const living = engine.units.map((u, i) => ({ u, i })).filter((x) => x.u.hp > 0);
    if (living.length > 1) {
      const cur = engine.units.findIndex((u) => u === engine.targetUnit);
      const next = living.find((x) => x.i > cur) ?? living[0];
      engine.setTarget(next.i);
    }
    return;
  }
  const idx = Number(e.key);
  if (idx >= 1 && idx <= rows.length) {
    const row = rows[idx - 1];
    if (!row.useLink.disabled) row.useLink.click();
  }
});

const engine = new CombatEngine(PLAYER_CATEGORIES, combatMoves, {
  onLog: appendLog,
  onTell: appendSystemLog,
  onBlocked: (perfect) => onShieldBlocked(perfect),
  onSteal: () => performSteal(),
  onUnitsChanged: () => buildEnemyPanel(),
  onUnitHit: (unit, dmg) => {
    const i = engine.units.indexOf(unit);
    const el = unitEls[i];
    if (el) spawnDamagePop(dmgPopLayer, `-${dmg}`, enemiesHostEl.offsetTop + el.root.offsetTop + 6);
  },
  onPlayerHit: (dmg) => {
    const host = document.querySelector<HTMLElement>("#player-hp-row");
    if (host) spawnDamagePop(host, `-${dmg}`);
  },
  onEnemyAct: (unit, move) => {
    // 教堂半血(2026-09 用戶定案):第五招「孕育」必定釋放——零傷害的空窗,結算時鑽出兩隻
    if (move.id !== "priest-spawn" || unit.hp <= 0) return;
    appendSystemLog("孳生失敗體從不再祈禱的神父的身體裡鑽出");
    for (let k = 0; k < 2; k++) {
      engine.addEnemy(applyBlessing(WILD_SPAWN.moves), { hp: WILD_SPAWN.hp, label: WILD_SPAWN.label });
      unitDefs.push(WILD_SPAWN);
    }
  },
  onEnemyDown: (unit) => {
    // 護贓的觸手倒下:牠纏著的那件贓物直接回到你手上(2026-09 用戶定案)
    if (unit.tag?.startsWith("stolen:")) {
      returnStolenAt(Number(unit.tag.slice(7)));
      return;
    }
    // 收贓者本體先倒:剩餘護贓觸手潰散,纏著的東西全數落下
    if (dungeon?.landmarkId === "scavenger" && unit === engine.units[0]) {
      for (const g of engine.units) {
        if (g.hp > 0 && g.tag?.startsWith("stolen:")) {
          g.hp = 0;
          returnStolenAt(Number(g.tag.slice(7)));
        }
      }
    }
  },
  // 混亂發作:隨機執行一個「就緒且可用」的行動(行動條沒滿就等滿的那一刻,引擎每幀重試)
  onConfusedAct: () => {
    const candidates: { cat: CategoryId; id: string }[] = [];
    for (const c of engine.playerCategories) {
      for (const t of c.trackers) {
        if (t.ready && canUse(t.subAction.id)) candidates.push({ cat: c.def.id, id: t.subAction.id });
      }
    }
    if (candidates.length === 0) return false;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    appendSystemLog("你的身體完全不受控制，自己做出了行動");
    if (engine.useSubAction(pick.cat, pick.id)) {
      afterUse(pick.id);
      return true;
    }
    return false;
  },
  onPauseChange: (paused) => {
    if (lootPanelActive) return; // 勝利訊息別被收尾的 resume 洗掉
    statusEl.textContent = paused ? "▍等待你的指示…" : "";
    skipBtn.disabled = !paused;
    skipBtn.classList.toggle("ready", paused);
    retreatBtn.disabled = !paused;
    retreatBtn.classList.toggle("ready", paused);
  },
  onHpChange: () => {
    scavengerCheck();
    churchCheck();
    // 瀕死警告:低於三成血時給一次感官描寫(不重複刷)
    if (engine.playerHp > 0 && engine.playerHp <= engine.playerMaxHp * 0.3 && !lowHpWarned) {
      lowHpWarned = true;
      appendSystemLog("視線的邊緣開始發黑,耳朵裡有一層薄薄的嗡鳴。你知道自己快撐不住了。");
    }
    if (engine.playerHp <= 0) {
      // 死亡:帶出門的東西全部消失(§3.9),自動送回村莊(已探索的地圖知識與地城層數進度保留)
      clearCarried();
      if (!SANDBOX) {
        localStorage.removeItem(DUNGEON_KEY);
        localStorage.setItem("death-cause", "combat"); // 回村後代行者依死因給一句叮囑
      }
      endCombat("你倒下了……但是一股溫暖的微光包裹著你。", "village.html", 2200);
    } else if (engine.enemyHp <= 0) {
      // 連鎖戰:這一波清了,下一波直接壓上——沒有補給、沒有拾取,結算全放最後
      if (chainWaves.length > 0) {
        const wave = chainWaves.shift()!;
        appendSystemLog("喘息未定,通道深處又傳來動靜——下一波壓了上來。");
        engine.replaceEnemies(applyBlessing(wave[0].moves), {
          hp: wave[0].hp,
          label: wave[0].label,
          freezeResist: wave[0].freezeResist,
          pattern: wave[0].pattern,
          human: wave[0].human,
        });
        for (const d of wave.slice(1)) {
          engine.addEnemy(applyBlessing(d.moves), { hp: d.hp, label: d.label, freezeResist: d.freezeResist, pattern: d.pattern, human: d.human });
        }
        unitDefs.push(...wave);
        appendSystemLog(wave[0].intro);
        if (wave[0].boss) showBossDialog([wave[0].intro], wave[0].label);
        return;
      }

      // 教堂死亡語:儀式歸儀式,不跟地城結算綁在一起(模擬戰也演)
      if (dungeon?.landmarkId === "church" && dungeon.stage >= dungeon.stages) {
        const deathLine = "『原來.....這數百年的時光為的就是這一刻嗎，主啊，謝謝您......』";
        appendSystemLog(deathLine);
        showBossDialog([deathLine], "不再祈禱的神父");
      }

      if (isRedmoonFight) {
        // 紅月循環收束:計數歸零(窪地由探索頁撤掉);之後再滿三次會再來
        if (!SANDBOX) localStorage.setItem("redmoon-count", "0");
        appendSystemLog("那東西倒下時,窪地裡的紫紅色像退潮一樣散了。今晚的月亮,應該會是正常的顏色。");
      }

      // 勝利(多目標:全滅):戰利品全隊合計;剩餘 HP 記回行囊——活著帶回村才真的入庫
      const gains: Record<string, number> = {};
      for (const d of unitDefs) {
        for (const [id, n] of Object.entries(d.loot)) gains[id] = (gains[id] ?? 0) + n;
        // 汙染沾身的生物有機率額外掉「異晶」(逐隻擲骰)
        if (d.shardChance && Math.random() < d.shardChance) gains.shard = (gains.shard ?? 0) + 1;
      }
      let message = `擊倒了${enemyDef.label}${unitDefs.length > 1 ? `等 ${unitDefs.length} 隻` : ""}`;
      let delay = 1800;

      // 地城戰結算:推進層數;打通最深層 → 依等級發放報酬(design-notes.md § 3.10.1)
      if (dungeon && !SANDBOX) {
        localStorage.removeItem(DUNGEON_KEY);
        const progress = siteProgress(dungeon.key);
        const isFinal = dungeon.stage >= dungeon.stages;
        if (!isFinal) {
          saveSiteProgress(dungeon.key, { stage: dungeon.stage, cleared: false });
          message = `擊倒了${enemyDef.label}${unitDefs.length > 1 ? `等 ${unitDefs.length} 隻` : ""}——通道還在往深處延伸(${dungeon.stage}/${dungeon.stages})`;
        } else {
          saveSiteProgress(dungeon.key, { stage: dungeon.stage, cleared: true });
          delay = 3000;
          if (dungeon.level === 1) {
            gains.ration = (gains.ration ?? 0) + 2;
            message = "這裡清理乾淨了。屋棚還算牢固,適合當作外出時的落腳點";
          } else if (dungeon.level === 2) {
            gains.wood = (gains.wood ?? 0) + 6;
            gains.stone = (gains.stone ?? 0) + 6;
            message = "最裡面是還能用的採集場——村裡的人手之後可以定期來這裡回收物資";
          } else if (dungeon.level === 3) {
            const treasure = { leather: 4, hide: 6, arrow: 6, bandage: 3, ration: 4 };
            for (const [id, n] of Object.entries(treasure)) gains[id] = (gains[id] ?? 0) + n;
            message = "遺跡最深處堆著先人囤下的物資,量多得驚人。這裡也夠安全,可以作為前線的落腳點";
            // 黑鐵鑰匙:只藏在離教堂最近的那座 Lv3 遺跡(重要物品:永久持有,不占空間、不因死亡遺失)
            if (dungeon.key === churchKeySiteKey() && !hasChurchKey()) {
              grantChurchKey();
              message += "。碎石堆下壓著一把黑鐵鑰匙——冰得不像金屬,齒形像一片葉子";
              delay = 3600;
            }
          } else if (dungeon.landmarkId) {
            markLandmarkCleared(dungeon.landmarkId);
            // 數數的東西:配方是重要物品(永久持有,不占空間、不因死亡遺失)——
            // 醫院(第二章:教團人員事件)解鎖後才能製作
            if (dungeon.landmarkId === "counter") localStorage.setItem("recipe-counting-strike", "1");
            const reward = LANDMARK_REWARDS[dungeon.landmarkId];
            if (reward) {
              message = reward.message;
              if (reward.loot) for (const [id, n] of Object.entries(reward.loot)) gains[id] = (gains[id] ?? 0) + n;
              if (reward.weapon && carried) {
                carried.weapons[reward.weapon] = (carried.weapons[reward.weapon] ?? 0) + 1;
                const def = WEAPONS.find((w) => w.id === reward.weapon);
                if (def && carried.durability[reward.weapon] === undefined) carried.durability[reward.weapon] = def.durability;
              }
              delay = 3400;
            }
          }
        }
      }

      if (carried) {
        carried.hp = engine.playerHp;
        saveCarried(carried);
      }
      if (!carried || Object.keys(gains).length === 0) {
        endCombat(`${message}。`, "village.html?view=expedition", delay);
      } else if (isAutoPickup()) {
        // 自動拾取開啟:照舊直接入包(與探索頁的開關一致)
        const { added, overflow } = addLoot(carried, gains);
        markExpeditionGained(added);
        saveCarried(carried);
        let lootText = Object.entries(added)
          .map(([id, n]) => `${RESOURCE_LABEL[id as ResourceId]} +${n}`)
          .join("、");
        if (overflow) lootText += "(背包塞不下,部分只能放棄)";
        endCombat(lootText ? `${message} 拾獲:${lootText}` : `${message}。`, "village.html?view=expedition", delay);
      } else {
        // 手動拾取(預設):敵人的掉落一件件由玩家決定撿不撿——和探索拾獲同一套規則
        showLootPanel(message, gains, "village.html?view=expedition");
      }
    }
  },
}, { enemyHp: enemyDef.hp, enemyLabel: enemyDef.label, freezeResist: enemyDef.freezeResist, pattern: enemyDef.pattern, human: enemyDef.human });

// HP 跨戰鬥持續:從行囊接續上一場打完的血量(回村整備才會回滿);上限含皮甲加成
engine.playerMaxHp = playerMaxHp();
if (carried) {
  engine.playerHp = Math.min(engine.playerMaxHp, Math.max(1, carried.hp ?? engine.playerMaxHp));
} else {
  engine.playerHp = engine.playerMaxHp;
}
if (SANDBOX) {
  engine.playerMaxHp = 90; // 模擬戰:鋼甲滿裝
  engine.playerHp = 90;
  engine.firstStrikeBoost = true; // 危機意識也算滿配
  appendSystemLog("〔模擬戰〕滿裝測試場:勝敗不影響存檔,打完自動重開;「撤退」=離開回村。");
  // 模擬戰選單(2026-09 用戶要求):對手清單與裝備調整收進左側欄,不擠行動區
  const split = document.querySelector<HTMLDivElement>(".combat-split")!;
  const menu = document.createElement("div");
  menu.className = "sandbox-menu";
  const addTitle = (text: string) => {
    const t = document.createElement("div");
    t.className = "section-title";
    t.textContent = text;
    menu.appendChild(t);
  };
  const addBtn = (label: string, on: (() => void), ready = false) => {
    const b = document.createElement("button");
    b.className = "btn-tiny sandbox-menu-btn" + (ready ? " ready" : "");
    b.textContent = label;
    b.addEventListener("click", on);
    menu.appendChild(b);
    return b;
  };
  addTitle("模擬戰・對手");
  const fights: [string, string][] = [
    ["church", "教堂"], ["coalmine", "煤礦坑"], ["mine", "鐵礦坑"], ["observatory", "觀測台"],
    ["shrine", "祭壇"], ["scavenger", "拾荒的長手"], ["counter", "數數的東西"], ["lv3", "Lv3看守"],
    ["redmoon", "紅月三連戰"], ["siren", "哼歌的東西"], ["tentacle", "收藏的觸手"],
    ["group", "外圍組隊"], ["spawnpack", "孳生體群"], ["chain", "遺跡連鎖戰"],
  ];
  for (const [id, label] of fights) {
    addBtn(label, () => {
      window.location.href = `index.html?sandbox=${id}`;
    }, id === SANDBOX);
  }
  addTitle("裝備調整");
  const gearHint = document.createElement("div");
  gearHint.className = "hint-line";
  gearHint.textContent = "加/卸重開生效;修復立即";
  menu.appendChild(gearHint);
  const loadout = sandboxLoadout();
  const saveLoadout = () => localStorage.setItem("sandbox-loadout", JSON.stringify(loadout));
  const gearBtns: [string, HTMLButtonElement][] = [];
  const refreshGearBtns = () => {
    for (const [id, gb] of gearBtns) {
      const on = (loadout[id] ?? 0) > 0;
      gb.classList.toggle("ready", on);
      const def = WEAPONS.find((w) => w.id === id)!;
      gb.textContent = `${on ? "✓ " : "　"}${def.label}`;
    }
  };
  for (const w of WEAPONS) {
    const gb = addBtn(w.label, () => {
      if ((loadout[w.id] ?? 0) > 0) {
        loadout[w.id] = 0;
      } else {
        // 攜帶上限(2026-09):近戰3/槍械2/盾1——滿了要先卸一把
        const inCat = WEAPONS.filter((x) => x.category === w.category).reduce((n, x) => n + (loadout[x.id] ?? 0), 0);
        if (inCat >= WEAPON_CARRY_LIMITS[w.category]) return;
        loadout[w.id] = 1;
      }
      saveLoadout();
      refreshGearBtns();
    });
    gearBtns.push([w.id, gb]);
  }
  addTitle("操作");
  addBtn("全部加入", () => {
    for (const w of WEAPONS) loadout[w.id] = 1;
    saveLoadout();
    refreshGearBtns();
  });
  addBtn("全部移除", () => {
    for (const w of WEAPONS) loadout[w.id] = 0;
    saveLoadout();
    refreshGearBtns();
  });
  addBtn("修復所有武器", () => {
    if (!carried) return;
    for (const id of Object.keys(carried.weapons)) {
      carried.durability[id] = carriedMaxDurability(carried, id);
    }
    carried.broken = {};
    appendSystemLog("〔模擬戰〕所有武器修復完畢——耐久回滿。");
  });
  addBtn("套用並重開這場", () => window.location.reload());
  addBtn("離開模擬戰", () => {
    window.location.href = "village.html";
  });
  refreshGearBtns();
  split.prepend(menu);
}
// 這一波其餘敵人同時上場(組隊/孳生窩展開)
for (const d of initialWave.slice(1)) {
  engine.addEnemy(applyBlessing(d.moves), { hp: d.hp, label: d.label, freezeResist: d.freezeResist, pattern: d.pattern, human: d.human });
}
// 拾荒的長手:每件贓物由一條護贓觸手纏著上場——打倒觸手直接取回
if (dungeon?.landmarkId === "scavenger") {
  stolenSnapshot.slice(0, 5).forEach((_, i) => {
    engine.addEnemy(TENTACLE_GUARD.moves, { hp: TENTACLE_GUARD.hp, label: TENTACLE_GUARD.label, tag: `stolen:${i}` });
    unitDefs.push(TENTACLE_GUARD);
  });
}
buildEnemyPanel();

syncShieldToEngine();
// 招架輔助(匕首):帶在身上就把完美格擋窗延長(取攜帶武器裡最大的 parry 值)
engine.perfectWindowBonus = WEAPONS.reduce((m, w) => ((carried?.weapons[w.id] ?? 0) > 0 ? Math.max(m, w.parry ?? 0) : m), 0);
// 危機意識(改造藥劑):開戰首擊前全體充能 ×2
try {
  const v = JSON.parse(localStorage.getItem("village-state") ?? "{}");
  if (v.modifications?.["crisis-awareness"]) engine.firstStrikeBoost = true;
} catch {
  /* 沒存檔就算了 */
}
appendSystemLog(enemyDef.intro);
if (enemyDef.intro2) appendSystemLog(enemyDef.intro2);
if (enemyDef.boss) {
  showBossDialog(enemyDef.intro2 ? [enemyDef.intro, enemyDef.intro2] : [enemyDef.intro], enemyDef.label);
}
if (dungeon?.landmarkId === "scavenger" && stolenSnapshot.length > 0) {
  appendSystemLog("幾條蒼白的觸手從牆縫裡垂下,各自纏著你被搶走的東西。");
} else if (unitDefs.length > 1) {
  appendSystemLog(`影子不只一道——一共 ${unitDefs.length} 隻。(Tab 或點敵欄切換目標)`);
}
if (engine.enemy.currentMove.tell) appendSystemLog(engine.enemy.currentMove.tell);

// ?dev:測試鉤子——console 可直接驅動戰鬥時鐘(嵌入式瀏覽器 rAF 不穩時,自動化測試用)
if (new URLSearchParams(window.location.search).has("dev")) {
  (window as unknown as { __combat?: unknown }).__combat = {
    engine,
    step: (dt: number) => (engine as unknown as { step: (dt: number) => void }).step(dt),
    chainWaves, // 連鎖戰測試用:可窺可塞
  };
}

// ---- 迷宮五盜與拾荒的長手(§2026-09 用戶定案)----

/** 這一場已經偷過(觸手每場只偷一件) */
let stoleThisFight = false;

/** 觸手偷竊:優先序 武器→鹽→藥劑→肉乾→繃帶;同種東西一次遠征只偷一次;連耐久/精工一起記走 */
function performSteal() {
  if (stoleThisFight || !carried) return;
  let kinds: string[] = [];
  let stolen: { kind: string; id?: string; durability?: number; fine?: boolean; count?: number }[] = [];
  if (SANDBOX) {
    kinds = sandboxStealStore.kinds;
    stolen = sandboxStealStore.stolen;
  } else {
    try {
      kinds = JSON.parse(localStorage.getItem("maze-stolen-kinds") ?? "[]") as string[];
    } catch {
      kinds = [];
    }
    try {
      stolen = JSON.parse(localStorage.getItem("maze-stolen") ?? "[]");
    } catch {
      stolen = [];
    }
  }

  let record: { kind: string; id?: string; durability?: number; fine?: boolean } | null = null;
  if (!kinds.includes("weapon")) {
    // 偷「使用中」的最好武器(WEAPONS 排序位階;盾也算裝備):連當前耐久與精工身分一起搬走
    for (let i = WEAPONS.length - 1; i >= 0; i--) {
      const w = WEAPONS[i];
      if ((carried.weapons[w.id] ?? 0) <= 0) continue;
      const fineN = carried.fineWeapons?.[w.id] ?? 0;
      const normalN = (carried.weapons[w.id] ?? 0) - fineN;
      // 收藏家的品味:同型裡偷亮的那把(精工優先);耐久照那一把的實況記
      const stealFine = fineN > 0;
      const dur = stealFine
        ? (normalN <= 0 ? (carried.durability[w.id] ?? fineMaxDurability(w.id)) : fineMaxDurability(w.id))
        : (carried.durability[w.id] ?? w.durability);
      record = { kind: "weapon", id: w.id, durability: dur, fine: stealFine };
      carried.weapons[w.id] = (carried.weapons[w.id] ?? 0) - 1;
      if (stealFine) {
        carried.fineWeapons![w.id]--;
        if (carried.fineWeapons![w.id] <= 0) delete carried.fineWeapons![w.id];
      }
      if (carried.weapons[w.id] <= 0) {
        delete carried.weapons[w.id];
        delete carried.durability[w.id];
      } else if (!stealFine || normalN <= 0) {
        delete carried.durability[w.id]; // 使用中那把被偷走:備用頂上(全新)
      }
      appendSystemLog(`一條過長的手臂從黑暗裡閃出——等你回過神,${w.label}已經不在手上了！`);
      break;
    }
  }
  if (!record) {
    const bag = carried as unknown as Record<string, number | undefined>;
    const supplyOrder: { kind: string; key: string; label: string }[] = [
      { kind: "salt", key: "salts", label: "醒神鹽" },
      { kind: "elixir", key: "elixirs", label: "舊時代藥劑" },
      { kind: "jerky", key: "jerky", label: "肉乾" },
      { kind: "bandage", key: "bandages", label: "繃帶" },
    ];
    for (const so of supplyOrder) {
      if (kinds.includes(so.kind)) continue;
      if ((bag[so.key] ?? 0) <= 0) continue;
      bag[so.key] = (bag[so.key] ?? 0) - 1;
      record = { kind: so.kind };
      appendSystemLog(`一條過長的手臂從黑暗裡閃出——等你回過神,腰間的${so.label}已經不見了！`);
      break;
    }
  }
  if (!record) return; // 沒東西可偷:純粹的抽打

  stoleThisFight = true;
  kinds.push(record.kind);
  stolen.push(record);
  if (SANDBOX) {
    sandboxStealStore.kinds = kinds;
    sandboxStealStore.stolen = stolen;
  } else {
    localStorage.setItem("maze-stolen-kinds", JSON.stringify(kinds));
    localStorage.setItem("maze-stolen", JSON.stringify(stolen));
  }
  saveCarried(carried);
}

/** 護贓觸手倒下 → 歸還牠纏著的那一件(拾荒的長手改版:打觸手取回,不再看 Boss 血量門檻) */
let scavengerEnraged = false;

function returnStolenAt(idx: number): boolean {
  if (!carried || returnedIdx.has(idx)) return false;
  const item = stolenSnapshot[idx];
  if (!item) return false;
  returnedIdx.add(idx);
  if (!SANDBOX) localStorage.setItem("maze-stolen", JSON.stringify(stolenSnapshot.filter((_, i) => !returnedIdx.has(i))));
  if (item.kind === "weapon" && item.id) {
    carried.weapons[item.id] = (carried.weapons[item.id] ?? 0) + 1;
    if (item.fine) {
      carried.fineWeapons ??= {};
      carried.fineWeapons[item.id] = (carried.fineWeapons[item.id] ?? 0) + 1;
    }
    if (carried.durability[item.id] === undefined && item.durability !== undefined) {
      carried.durability[item.id] = item.durability; // 耐久不重置:被偷時是多少,回來就是多少
    }
    const def = WEAPONS.find((w) => w.id === item.id);
    appendSystemLog(`一樣東西從牠的收藏裡震落——${def?.label ?? item.id}回到了你手上。`);
  } else {
    const bag = carried as unknown as Record<string, number | undefined>;
    const keyMap: Record<string, [string, string]> = {
      salt: ["salts", "醒神鹽"],
      elixir: ["elixirs", "舊時代藥劑"],
      jerky: ["jerky", "肉乾"],
      bandage: ["bandages", "繃帶"],
    };
    const [key, label] = keyMap[item.kind] ?? ["bandages", item.kind];
    bag[key] = (bag[key] ?? 0) + 1;
    appendSystemLog(`一樣東西從牠的收藏裡震落——${label}回到了你手上。`);
  }
  saveCarried(carried);
  return true;
}

/** 拾荒的長手:半血狂暴(CD ×0.75)——贓物歸還改由護贓觸手負責 */
function scavengerCheck() {
  if (dungeon?.landmarkId !== "scavenger" || scavengerEnraged) return;
  const boss = engine.units[0];
  if (!boss || boss.hp <= 0) return;
  if (boss.hp / boss.maxHp <= 0.5) {
    scavengerEnraged = true;
    boss.hasteMult = 1 / 0.75;
    const enrageText = "失去收藏的長手抽搐著暴起,他的真身顯露出來，頭顱連著脖子接在牆壁上，無數隻手從牆壁縫裡伸出。他的眼睛發紅，或許在眼前與迷宮融為一體的怪物曾經是個人類......";
    appendSystemLog(enrageText);
    showBossDialog([enrageText], "拾荒的長手");
  }
}

// 不再祈禱的東西・半血蛻變(2026-09 核可 A+B+C):
// A 換招式表+CD×0.85;B 每第三招百手壓下(穿盾,鬼雪凍滿可打斷一次);C 血雨(每2秒-2)+道具轉盤拖慢到1.5s
let churchTransformed = false;
function churchCheck() {
  if (churchTransformed || !dungeon || dungeon.landmarkId !== "church") return;
  const u = engine.units[0];
  if (!u || u.hp <= 0 || u.hp > u.maxHp / 2) return;
  churchTransformed = true;
  const line1 = "他腫脹的後背被撐開來，血肉與鮮血化作暴雨灑滿了教堂，從後背伸出來的，是數不清可能有數十隻如同蜈蚣般的手。";
  const line2 = "『啊......我們的主在數百年前早就拋棄了我們，任由這顆星球被外來的力量不斷侵蝕。整個這片大陸早已被深淵的力量佔據，事到如今你們又能做到些什麼！』";
  appendSystemLog(line1);
  appendSystemLog(line2);
  // 儀式對話框讀完才蛻變開打(2026-09 用戶要求的儀式感)
  showBossDialog([line1, line2], "不再祈禱的神父", () => {
    engine.transformUnit(u, CHURCH_PHASE2_MOVES, { hasteMult: 1 / 0.85, pattern: CHURCH_PHASE2_PATTERN });
    u.freezeInterruptArmed = true;
    engine.stormBleed = 1; // 2026-09 用戶下修:血雨每 2 秒 −1
    engine.setItemField(1.5);
    appendSystemLog("血雨沒有停下。濃稠的血液落在皮膚上竟然燙的發痛,皮膚表面被這滾燙的血液燙出了新的傷口。(持續流血;道具使用變慢)");
  });
}

/** 掉落面板開著:主戰鬥快捷鍵(1~9/空白/R/0)全部讓路給面板自己的按鍵 */
let lootPanelActive = false;

/** 勝利掉落的手動拾取面板:數字鍵逐件撿、A 全拾、E 離開、B 整理背包(就地丟東西騰空間) */
function showLootPanel(message: string, gains: Record<string, number>, href: string) {
  engine.stop();
  lootPanelActive = true;
  statusEl.textContent = message;
  skipBtn.style.display = "none";
  retreatBtn.style.display = "none";

  const panel = document.createElement("div");
  panel.className = "loot-panel";
  const title = document.createElement("div");
  title.className = "hint-line";
  title.textContent = "牠身上留下了一些東西:";
  panel.appendChild(title);

  // 背包占用即時反映:撿與丟都會更新——整理背包不用離開這個畫面
  const packLine = document.createElement("div");
  packLine.className = "hint-line";
  panel.appendChild(packLine);
  const updatePackLine = () => {
    if (carried) packLine.textContent = `背包 ${packUsed(carried)}/${carried.packCap ?? 20}・HP ${carried.hp}/${engine.playerMaxHp}`;
  };
  updatePackLine();

  const leave = () => {
    lootPanelActive = false;
    window.removeEventListener("keydown", onLootKey);
    if (carried) saveCarried(carried);
    window.location.href = href;
  };

  const itemRows: { id: string; n: number; line: HTMLDivElement; pick: () => void }[] = [];
  const leaveIfEmpty = () => {
    if (itemRows.every((r) => r.line.style.display === "none")) window.setTimeout(leave, 500);
  };

  Object.entries(gains).forEach(([id, n], idx) => {
    const line = document.createElement("div");
    line.className = "row-grid";
    const name = document.createElement("span");
    name.className = "row-name";
    name.textContent = `${idx + 1}. ${RESOURCE_LABEL[id as ResourceId] ?? id} ×${n}`;
    const controls = document.createElement("span");
    controls.className = "row-controls";
    const btn = document.createElement("button");
    btn.className = "use-link ready";
    btn.textContent = "[撿]";
    const pick = () => {
      if (!carried || line.style.display === "none") return;
      const { added, overflow } = addLoot(carried, { [id]: n });
      markExpeditionGained(added);
      saveCarried(carried);
      const got = Object.values(added)[0] ?? 0;
      if (got <= 0) {
        appendSystemLog("背包塞不下了。");
        return;
      }
      appendSystemLog(`拾獲:${RESOURCE_LABEL[id as ResourceId] ?? id} +${got}${overflow ? "(塞不下的只能放棄)" : ""}`);
      line.style.display = "none";
      updatePackLine();
      leaveIfEmpty();
    };
    btn.addEventListener("click", pick);
    controls.appendChild(btn);
    line.append(name, controls);
    panel.appendChild(line);
    itemRows.push({ id, n, line, pick });
  });

  const actions = document.createElement("div");
  actions.className = "button-row";
  const allBtn = document.createElement("button");
  allBtn.className = "use-link ready";
  allBtn.textContent = "[A. 全部拾取]";
  allBtn.addEventListener("click", () => {
    if (!carried) return leave();
    let anyOverflow = false;
    const gotAll: string[] = [];
    for (const r of itemRows) {
      if (r.line.style.display === "none") continue;
      const { added, overflow } = addLoot(carried, { [r.id]: r.n });
      markExpeditionGained(added);
      if (overflow) anyOverflow = true;
      const got = Object.values(added)[0] ?? 0;
      if (got > 0) gotAll.push(`${RESOURCE_LABEL[r.id as ResourceId] ?? r.id} +${got}`);
    }
    saveCarried(carried);
    if (gotAll.length > 0) appendSystemLog(`拾獲:${gotAll.join("、")}`);
    if (anyOverflow) appendSystemLog("背包塞不下,剩下的只能放棄。");
    leave();
  });
  const leaveBtn = document.createElement("button");
  leaveBtn.className = "use-link ready";
  leaveBtn.textContent = "[E. 放棄並離開]";
  leaveBtn.addEventListener("click", leave);
  const packToggle = document.createElement("button");
  packToggle.className = "use-link";
  packToggle.textContent = "[B. 整理背包]";
  actions.append(allBtn, leaveBtn, packToggle);
  panel.appendChild(actions);

  // 整理背包:就地丟補給/戰利品騰空間(丟掉的留在原地,拿不回來)
  const packBox = document.createElement("div");
  packBox.style.display = "none";
  panel.appendChild(packBox);
  let packOpen = false;
  // 高亮選擇(↑↓ 移動、U 使用、D 丟):讓整理背包全程不用碰滑鼠
  let packSel = 0;
  let packEntries: { label: string; drop: () => void; use?: () => void }[] = [];
  const renderPackBox = () => {
    if (!carried) return;
    packBox.innerHTML = "";
    const bag = carried as unknown as Record<string, number | undefined>;
    // 吃/用得掉的補給:肉乾 +10、繃帶 +20、藥劑 +15(與路上使用同一套數值)
    const useHeal = (key: string, heal: number, text: string) => () => {
      if (!carried) return;
      if ((bag[key] ?? 0) <= 0) return;
      if (carried.hp >= engine.playerMaxHp) {
        appendSystemLog("HP 已滿,先留著吧。");
        return;
      }
      bag[key] = (bag[key] ?? 0) - 1;
      const before = carried.hp;
      carried.hp = Math.min(engine.playerMaxHp, carried.hp + heal);
      engine.playerHp = carried.hp; // 左欄血條同步
      saveCarried(carried);
      appendSystemLog(`${text}(HP +${carried.hp - before})`);
      updatePackLine();
      renderPackBox();
    };
    const entries: { label: string; drop: () => void; use?: () => void }[] = [];
    const sup: [string, string][] = [
      ["rations", "ration"],
      ["jerky", "jerky"],
      ["bandages", "bandage"],
      ["arrows", "arrow"],
      ["bullets", "bullet"],
      ["rails", "rail"],
      ["scrolls", "scroll"],
      ["oil", "oil"],
      ["elixirs", "elixir"],
      ["salts", "salt"],
    ];
    const usable: Record<string, { heal: number; text: string }> = {
      jerky: { heal: 10, text: "你嚼了一條肉乾。" },
      bandages: { heal: 20, text: "你停下來,把傷口重新包紮好。" },
      elixirs: { heal: 15, text: "你仰頭灌下一小口藥劑。" },
    };
    for (const [key, rid] of sup) {
      const n = bag[key] ?? 0;
      if (n > 0)
        entries.push({
          label: `${RESOURCE_LABEL[rid as ResourceId]} ×${n}`,
          drop: () => (bag[key] = n - 1),
          use: usable[key] ? useHeal(key, usable[key].heal, usable[key].text) : undefined,
        });
    }
    for (const [id, n] of Object.entries(carried.loot ?? {})) {
      if ((n ?? 0) <= 0) continue;
      entries.push({
        label: `${RESOURCE_LABEL[id as ResourceId] ?? id} ×${n}(戰利品)`,
        drop: () => {
          carried!.loot![id] = (n ?? 0) - 1;
          if (carried!.loot![id] <= 0) delete carried!.loot![id];
        },
      });
    }
    packEntries = entries;
    if (packSel >= entries.length) packSel = Math.max(0, entries.length - 1);
    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "hint-line";
      empty.textContent = "背包裡沒有可丟的補給。";
      packBox.appendChild(empty);
      return;
    }
    const hint = document.createElement("div");
    hint.className = "hint-line";
    hint.textContent = "↑↓ 選擇・U 使用・D 丟棄";
    packBox.appendChild(hint);
    entries.forEach((en, i) => {
      const line = document.createElement("div");
      line.className = "row-grid" + (i === packSel ? " loot-sel" : "");
      line.addEventListener("click", () => {
        packSel = i;
        renderPackBox();
      });
      const name = document.createElement("span");
      name.className = "row-name";
      name.textContent = `${i === packSel ? "▶ " : "　"}${en.label}`;
      const controls = document.createElement("span");
      controls.className = "row-controls";
      if (en.use) {
        const useBtn = document.createElement("button");
        useBtn.className = "use-link ready";
        useBtn.textContent = "[使用]";
        useBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          en.use!();
        });
        controls.appendChild(useBtn);
      }
      const dropBtn = document.createElement("button");
      dropBtn.className = "use-link";
      dropBtn.textContent = "[丟1]";
      dropBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        en.drop();
        if (carried) saveCarried(carried);
        updatePackLine();
        renderPackBox();
      });
      controls.appendChild(dropBtn);
      line.append(name, controls);
      packBox.appendChild(line);
    });
  };
  packToggle.addEventListener("click", () => {
    packOpen = !packOpen;
    packBox.style.display = packOpen ? "" : "none";
    if (packOpen) renderPackBox();
  });

  // 面板快捷鍵:數字=逐件撿、A=全拾、E=離開、B=整理背包;背包開著時 ↑↓ 選擇、U 使用、D 丟
  const onLootKey = (e: KeyboardEvent) => {
    if (bossDialogActive) return;
    if (e.repeat) return;
    if (packOpen) {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const len = packEntries.length;
        if (len > 0) packSel = (packSel + (e.key === "ArrowDown" ? 1 : len - 1)) % len;
        renderPackBox();
        return;
      }
      if (e.key === "u" || e.key === "U") {
        packEntries[packSel]?.use?.();
        return;
      }
      if (e.key === "d" || e.key === "D") {
        const en = packEntries[packSel];
        if (en) {
          en.drop();
          if (carried) saveCarried(carried);
          updatePackLine();
          renderPackBox();
        }
        return;
      }
    }
    const idx = Number(e.key);
    if (idx >= 1 && idx <= itemRows.length) {
      itemRows[idx - 1].pick();
      return;
    }
    if (e.key === "a" || e.key === "A") allBtn.click();
    else if (e.key === "e" || e.key === "E") leave();
    else if (e.key === "b" || e.key === "B") packToggle.click();
  };
  window.addEventListener("keydown", onLootKey);

  document.querySelector<HTMLDivElement>("#combat-main")?.appendChild(panel);
}

/** 戰鬥結束:停下引擎,短暫停留後自動離開,不需要按鈕 */
function endCombat(message: string, href: string, delayMs: number) {
  engine.stop();
  statusEl.textContent = SANDBOX ? `〔模擬戰〕${message}(即將重開)` : message;
  skipBtn.style.display = "none";
  retreatBtn.style.display = "none";
  window.setTimeout(() => {
    if (SANDBOX) {
      window.location.reload(); // 模擬戰:原地重開下一場
      return;
    }
    window.location.href = href;
  }, delayMs);
}

function render() {
  if (engine.reloadLock > 0) {
    statusEl.textContent = `▍換彈中……(${engine.reloadLock.toFixed(1)}s)`;
  } else if (statusEl.textContent.startsWith("▍換彈中")) {
    statusEl.textContent = "";
  }
  playerHpText.textContent = `${engine.playerHp}/${engine.playerMaxHp}`;
  // 血量條(2026-09 用戶要求:數字之外的視覺表示)——沿用 █░ 條語言;敵方各自的條在敵欄逐塊畫
  const pFill = Math.round((engine.playerHp / engine.playerMaxHp) * BAR_WIDTH);
  playerHpFilled.textContent = "█".repeat(pFill);
  playerHpEmpty.textContent = "░".repeat(BAR_WIDTH - pFill);

  // 異常狀態欄(2026-08 用戶要求:計量值明示)——中毒/流血含累積值,控制含剩餘秒數
  const effects: string[] = [];
  if (engine.playerStatus.poison.level > 0) effects.push(`中毒Lv${engine.playerStatus.poison.level}`);
  if (engine.playerStatus.bleed.level > 0) effects.push(`流血Lv${engine.playerStatus.bleed.level}`);
  statusEffectsEl.textContent = effects.length ? `(${effects.join(" ")})` : "";
  {
    // 圖形化(用戶提案):累積條會漲、倒數條會消——沿用戰鬥的 █░ 條語言
    const SBAR = 12;
    const sbar = (frac: number) => {
      const f = Math.max(0, Math.min(SBAR, Math.round(frac * SBAR)));
      return `${"█".repeat(f)}${"░".repeat(SBAR - f)}`;
    };
    const rows: string[] = [];
    const spRow = (label: string, frac: number, val: string) =>
      rows.push(`<div class="sp-row"><span class="sp-label">${label}</span><span class="sp-bar">${sbar(frac)}</span><span class="sp-val">${val}</span></div>`);
    const po = engine.playerStatus.poison;
    const bl = engine.playerStatus.bleed;
    const gaugeRow = (label: string, x: { level: number; gauge: number }) => {
      if (x.level >= 3) spRow(`${label} Lv3`, 1, "滿級");
      else spRow(x.level > 0 ? `${label} Lv${x.level}` : label, x.gauge / 100, `${Math.round(x.gauge)}/100`);
    };
    if (po.level > 0 || po.gauge > 0) gaugeRow("中毒", po);
    if (bl.level > 0 || bl.gauge > 0) gaugeRow("流血", bl);
    const dot = po.level + bl.level;
    if (dot > 0) rows.push(`<div class="status-line">持續傷害 每 2 秒 -${dot}</div>`);
    if (engine.firstStrikeBoost) spRow("危機意識", 1, "首擊 ×2");
    if (engine.playerEmpowerNext) spRow("凍結反擊", 1, "下一擊 ×1.5");
    if (engine.confusionPending) spRow("混亂(發作)", 1, "!!");
    else if (engine.confusionGauge > 0) spRow("混亂", engine.confusionGauge / 100, `${Math.round(engine.confusionGauge)}/100`);
    if (engine.stunLeft > 0) spRow("暈眩", engine.stunTotal > 0 ? engine.stunLeft / engine.stunTotal : 1, `${engine.stunLeft.toFixed(1)}s`);
    if (engine.slowLeft > 0) spRow("遲緩", engine.slowTotal > 0 ? engine.slowLeft / engine.slowTotal : 1, `${engine.slowLeft.toFixed(1)}s`);
    if (engine.controlImmuneLeft > 0) spRow("免疫(鹽)", engine.controlImmuneTotal > 0 ? engine.controlImmuneLeft / engine.controlImmuneTotal : 1, `${engine.controlImmuneLeft.toFixed(1)}s`);
    statusPanelEl.innerHTML = rows.length ? rows.join("") : `<div class="hint-line">你目前沒有異常。</div>`;
  }

  // 格擋列:窗口中=滿條亮起;冷卻中=回充進度;就緒=可按
  if (engine.shield && carried && shieldId) {
    const sdef = WEAPONS.find((w) => w.id === shieldId)!;
    const sdur = carried.durability[shieldId] ?? carriedMaxDurability(carried, shieldId);
    blockRowEls.name.textContent = `0. 格擋(${sdef.label}・耐久 ${sdur})`;
    let frac: number;
    let tag: string;
    if (engine.blockWindowLeft > 0) {
      frac = 1;
      tag = "格擋中!";
    } else if (engine.blockCooldownLeft > 0) {
      frac = 1 - engine.blockCooldownLeft / engine.shield.cd;
      tag = `${Math.round(frac * 100)}%`;
    } else {
      frac = 1;
      tag = "就緒";
    }
    const sFilled = Math.round(frac * BAR_WIDTH);
    blockRowEls.barFilled.textContent = "█".repeat(sFilled);
    blockRowEls.barEmpty.textContent = "░".repeat(BAR_WIDTH - sFilled);
    blockRowEls.pct.textContent = tag;
    const blockReady = engine.blockCooldownLeft <= 0 && engine.blockWindowLeft <= 0 && engine.stunLeft <= 0;
    blockRowEls.bar.classList.toggle("ready", engine.blockWindowLeft > 0 || blockReady);
    blockRowEls.useLink.disabled = !blockReady;
    blockRowEls.useLink.classList.toggle("ready", blockReady);
  }

  // 敵欄(多目標):每隻各自的 HP/動作/凍結;▶=目前目標,倒下的變暗
  engine.units.forEach((u, i) => {
    const el = unitEls[i];
    if (!el) return;
    // 倒下處理(2026-09 用戶定案):非人類直接消失;人類型態留屍(灰塊,未來復活機制的掛點)
    if (u.hp <= 0 && !u.human) {
      el.root.style.display = "none";
      return;
    }
    el.root.style.display = "";
    const isTarget = engine.targetUnit === u;
    el.gutter.textContent = u.hp <= 0 ? "×" : isTarget ? "◉" : "○";
    el.gutter.classList.toggle("ready", isTarget && u.hp > 0);
    el.title.textContent = `${u.label}${u.hp <= 0 ? "(倒下)" : ""}`;
    el.root.style.opacity = u.hp <= 0 ? "0.35" : "1";
    el.hpText.textContent = `HP ${u.hp}/${u.maxHp}`;
    const hFill = u.maxHp > 0 ? Math.round((u.hp / u.maxHp) * BAR_WIDTH) : 0;
    el.hpF.textContent = "█".repeat(hFill);
    el.hpE.textContent = "░".repeat(BAR_WIDTH - hFill);
    const aPct = u.hp > 0 ? u.tracker.progress : 0;
    const aFill = Math.round(aPct * BAR_WIDTH);
    el.actF.textContent = "█".repeat(aFill);
    el.actE.textContent = "░".repeat(BAR_WIDTH - aFill);
    if (u.hp > 0 && (u.freeze > 0 || u.chilled)) {
      el.frRow.style.display = "";
      const fFill = u.chilled ? BAR_WIDTH : Math.round((u.freeze / 100) * BAR_WIDTH);
      el.frF.textContent = "█".repeat(fFill);
      el.frE.textContent = "░".repeat(BAR_WIDTH - fFill);
      el.frPct.textContent = u.chilled ? "寒滯!" : `${Math.round(u.freeze)}/100`;
    } else {
      el.frRow.style.display = "none";
    }
    if (u.hp > 0 && (u.staggerGauge > 0 || u.staggerLeft > 0)) {
      el.stRow.style.display = "";
      const sFill = u.staggerLeft > 0 ? BAR_WIDTH : Math.round((u.staggerGauge / 100) * BAR_WIDTH);
      el.stF.textContent = "█".repeat(sFill);
      el.stE.textContent = "░".repeat(BAR_WIDTH - sFill);
      el.stPct.textContent = u.staggerLeft > 0 ? "踉蹌!" : `${Math.round(u.staggerGauge)}/100`;
    } else {
      el.stRow.style.display = "none";
    }
  });

  for (const cat of engine.playerCategories) {
    for (const t of cat.trackers) {
      const row = rows.find((r) => r.categoryId === cat.def.id && r.subActionId === t.subAction.id)!;
      const pct = Math.round(t.progress * 100);
      const filledCount = Math.round((pct / 100) * BAR_WIDTH);
      row.barFilled.textContent = "█".repeat(filledCount);
      row.barEmpty.textContent = "░".repeat(BAR_WIDTH - filledCount);
      row.pct.textContent = `${pct}%`;
      const hotkeyIdx = rows.indexOf(row) + 1;
      const hotkeyPrefix = hotkeyIdx <= 9 ? `${hotkeyIdx}. ` : "";
      if (t.subAction.magazine && t.needsReload) {
        row.name.textContent = `${hotkeyPrefix}${t.subAction.label}——換彈!`;
      } else if (t.subAction.magazine) {
        row.name.textContent = `${hotkeyPrefix}${subActionLabel(t.subAction.id, t.subAction.label)}・膛 ${t.subAction.magazine - t.magazineUsed}/${t.subAction.magazine}`;
      } else {
        row.name.textContent = hotkeyPrefix + subActionLabel(t.subAction.id, t.subAction.label);
      }
      const usable = t.ready && canUse(t.subAction.id);
      row.bar.classList.toggle("ready", usable);
      row.useLink.disabled = !usable;
      row.useLink.classList.toggle("ready", usable);
    }
  }

  requestAnimationFrame(render);
}

if (!bossDialogActive) engine.start(); // 開場儀式對話框開著:收掉才開鐘
render();

// 除錯用:因為瀏覽器分頁在背景時 rAF 會被節流甚至暫停,方便手動在 console 推進時間驗證邏輯
(window as unknown as { __engine: typeof engine }).__engine = engine;
