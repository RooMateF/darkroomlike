import "./style.css";
import { CombatEngine, type LogEntry } from "./engine";
import { buildPlayerCategories } from "./demo-data";
import { WEAPONS } from "./village/data";
import { RESOURCE_LABEL, type ResourceId } from "./village/types";
import { loadCarried, saveCarried, clearCarried, addLoot, playerMaxHp } from "./carried";
import { pickRandomEnemy, pickMidEnemy, GUARDIANS, LANDMARK_REWARDS, LV3_BOSS, type EnemyDef } from "./enemies";
import { markLandmarkCleared, currentMapId, isAutoPickup } from "./explore/engine";
import { DUNGEON_KEY, siteProgress, saveSiteProgress, churchKeySiteKey, hasChurchKey, grantChurchKey, type DungeonRun } from "./explore/sites";
import type { CategoryId } from "./types";

// 玩家的行動類別由隨身行囊決定(整備頁打包的 carried);敵人隨機抽自前期名冊
const carried = loadCarried();
const PLAYER_CATEGORIES = buildPlayerCategories(carried);

// 地城戰(五級制探勘地點)優先於隨機遭遇;敵人依等級與層數選擇,最深層是 Boss
let dungeon: DungeonRun | null = null;
try {
  const raw = localStorage.getItem(DUNGEON_KEY);
  if (raw) dungeon = JSON.parse(raw) as DungeonRun;
} catch {
  dungeon = null;
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

// 相鄰地圖(中央地圖以外)的野外更兇:一半機率抽中期梯隊
const enemyDef = dungeon
  ? pickDungeonEnemy(dungeon)
  : currentMapId() !== "A" && Math.random() < 0.5
    ? pickMidEnemy()
    : pickRandomEnemy();
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
  <div class="hp-line" style="margin-bottom:8px;">你 <b id="player-hp-text"></b><span id="status-effects"></span>　　<span id="enemy-label"></span> <b id="enemy-hp-text"></b></div>
  <div class="combat-split">
    <div class="combat-main" id="combat-main">
      <div class="section">
        <div class="row-grid">
          <span class="row-name" id="enemy-bar-label"></span>
          <span class="row-controls"><span class="bar" id="enemy-bar"><span class="filled" id="enemy-bar-filled"></span><span id="enemy-bar-empty"></span></span></span>
          <span class="row-info">敵方動作</span>
        </div>
        <div class="status-line"><span id="status-text"></span> <button class="use-link" id="skip-btn" disabled>暫不使用</button> <button class="use-link" id="retreat-btn" disabled>撤退</button></div>
      </div>

      <div class="section" id="categories"></div>
    </div>
    <div class="combat-side">
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
  if (retreatBtn.disabled) return;
  localStorage.removeItem(DUNGEON_KEY); // 地城進度已在每層勝利時保存,中途撤退不影響

  const pursued = Math.random() < 0.6;
  if (pursued) {
    const dmg = engine.enemy.currentMove.damage || 3;
    engine.playerHp = Math.max(0, engine.playerHp - dmg);
    appendSystemLog(`你轉身撤退,背後重重挨了一下(-${dmg})。`);
    if (engine.playerHp <= 0) {
      clearCarried();
      localStorage.setItem("death-cause", "combat");
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
const enemyHpText = document.querySelector<HTMLElement>("#enemy-hp-text")!;
const enemyLabelEl = document.querySelector<HTMLElement>("#enemy-label")!;
const enemyBarLabelEl = document.querySelector<HTMLElement>("#enemy-bar-label")!;
const enemyBarFilled = document.querySelector<HTMLElement>("#enemy-bar-filled")!;
const enemyBarEmpty = document.querySelector<HTMLElement>("#enemy-bar-empty")!;
const statusEffectsEl = document.querySelector<HTMLElement>("#status-effects")!;
enemyLabelEl.textContent = enemyDef.label;
enemyBarLabelEl.textContent = enemyDef.label;

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
  const weapon = WEAPONS.find((w) => w.id === subActionId);
  if (weapon) {
    const per = weapon.ammoPerUse ?? 1;
    if (weapon.ammo === "arrow") carried.arrows = Math.max(0, carried.arrows - per);
    if (weapon.ammo === "bullet") carried.bullets = Math.max(0, (carried.bullets ?? 0) - per);
    carried.durability[subActionId] = (carried.durability[subActionId] ?? weapon.durability) - 1;
    if (carried.durability[subActionId] <= 0) {
      carried.weapons[subActionId] = Math.max(0, (carried.weapons[subActionId] ?? 0) - 1);
      if (carried.weapons[subActionId] > 0) {
        carried.durability[subActionId] = weapon.durability; // 換上備用的那把
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
    const ammoText = weapon.ammo === "arrow" ? `・弓矢 ${carried.arrows}` : weapon.ammo === "bullet" ? `・子彈 ${carried.bullets ?? 0}` : "";
    return `${baseLabel}${spare}(耐久 ${dur}${ammoText})`;
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
      if (!canUse(sa.id)) return;
      if (engine.useSubAction(cat.id, sa.id)) afterUse(sa.id);
    });

    line.append(name, barWrap, useLink);
    categoriesEl.appendChild(line);
    rows.push({ categoryId: cat.id, subActionId: sa.id, name, bar, barFilled, barEmpty, pct, useLink });
  }
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
let combatMoves = enemyDef.moves;
try {
  const v = JSON.parse(localStorage.getItem("village-state") ?? "{}");
  const blessingOn = Array.isArray(v.equippedPerks) ? v.equippedPerks.includes("blessing") : v.perks?.blessing === true;
  if (blessingOn) {
    combatMoves = enemyDef.moves.map((m) => (m.status ? { ...m, status: { ...m.status, amount: Math.ceil(m.status.amount / 2) } } : m));
  }
} catch {
  /* 沒有存檔就照原樣 */
}

// 鍵盤快捷鍵(戰鬥的出手頻率高,全滑鼠會累死):數字 1~9 = 使用對應列;空白鍵 = 暫不使用;R = 撤退
window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (e.key === " ") {
    e.preventDefault();
    if (!skipBtn.disabled) engine.skip();
    return;
  }
  if (e.key === "r" || e.key === "R") {
    if (!retreatBtn.disabled) retreatBtn.click();
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
  onPauseChange: (paused) => {
    statusEl.textContent = paused ? "▍等待你的指示…" : "";
    skipBtn.disabled = !paused;
    skipBtn.classList.toggle("ready", paused);
    retreatBtn.disabled = !paused;
    retreatBtn.classList.toggle("ready", paused);
  },
  onHpChange: () => {
    // 瀕死警告:低於三成血時給一次感官描寫(不重複刷)
    if (engine.playerHp > 0 && engine.playerHp <= engine.playerMaxHp * 0.3 && !lowHpWarned) {
      lowHpWarned = true;
      appendSystemLog("你的視線開始發黑,耳邊嗡嗡作響——再這樣下去會死。");
    }
    if (engine.playerHp <= 0) {
      // 死亡:帶出門的東西全部消失(§3.9),自動送回村莊(已探索的地圖知識與地城層數進度保留)
      clearCarried();
      localStorage.removeItem(DUNGEON_KEY);
      localStorage.setItem("death-cause", "combat"); // 回村後代行者依死因給一句叮囑
      endCombat("你倒下了……但是一股溫暖的微光包裹著你。", "village.html", 2200);
    } else if (engine.enemyHp <= 0) {
      // 勝利:剩餘 HP 記回行囊、收下戰利品——活著帶回村才真的入庫
      const gains: Record<string, number> = { ...enemyDef.loot };
      let message = `擊倒了${enemyDef.label}`;
      let delay = 1800;

      // 汙染沾身的生物有機率額外掉「異晶」(人類敵人不會掉)——之後交易所開張,這是兌換稀有品的硬通貨
      if (enemyDef.shardChance && Math.random() < enemyDef.shardChance) {
        gains.shard = (gains.shard ?? 0) + 1;
      }

      // 地城戰結算:推進層數;打通最深層 → 依等級發放報酬(design-notes.md § 3.10.1)
      if (dungeon) {
        localStorage.removeItem(DUNGEON_KEY);
        const progress = siteProgress(dungeon.key);
        const isFinal = dungeon.stage >= dungeon.stages;
        if (!isFinal) {
          saveSiteProgress(dungeon.key, { stage: dungeon.stage, cleared: false });
          message = `擊倒了${enemyDef.label}——通道還在往深處延伸(${dungeon.stage}/${dungeon.stages})`;
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
}, { enemyHp: enemyDef.hp, enemyLabel: enemyDef.label });

// HP 跨戰鬥持續:從行囊接續上一場打完的血量(回村整備才會回滿);上限含皮甲加成
engine.playerMaxHp = playerMaxHp();
if (carried) {
  engine.playerHp = Math.min(engine.playerMaxHp, Math.max(1, carried.hp ?? engine.playerMaxHp));
} else {
  engine.playerHp = engine.playerMaxHp;
}
appendSystemLog(enemyDef.intro);
if (engine.enemy.currentMove.tell) appendSystemLog(engine.enemy.currentMove.tell);

// ?dev:測試鉤子——console 可直接驅動戰鬥時鐘(嵌入式瀏覽器 rAF 不穩時,自動化測試用)
if (new URLSearchParams(window.location.search).has("dev")) {
  (window as unknown as { __combat?: unknown }).__combat = {
    engine,
    step: (dt: number) => (engine as unknown as { step: (dt: number) => void }).step(dt),
  };
}

/** 勝利掉落的手動拾取面板:一件件決定撿不撿;背包空間把關與探索頁一致 */
function showLootPanel(message: string, gains: Record<string, number>, href: string) {
  engine.stop();
  statusEl.textContent = message;
  skipBtn.style.display = "none";
  retreatBtn.style.display = "none";

  const panel = document.createElement("div");
  panel.className = "loot-panel";
  const title = document.createElement("div");
  title.className = "hint-line";
  title.textContent = "牠身上留下了一些東西:";
  panel.appendChild(title);

  const leave = () => {
    if (carried) saveCarried(carried);
    window.location.href = href;
  };

  const itemRows: { id: string; n: number; line: HTMLDivElement }[] = [];
  const leaveIfEmpty = () => {
    if (itemRows.every((r) => r.line.style.display === "none")) window.setTimeout(leave, 500);
  };

  for (const [id, n] of Object.entries(gains)) {
    const line = document.createElement("div");
    line.className = "row-grid";
    const name = document.createElement("span");
    name.className = "row-name";
    name.textContent = `${RESOURCE_LABEL[id as ResourceId] ?? id} ×${n}`;
    const controls = document.createElement("span");
    controls.className = "row-controls";
    const btn = document.createElement("button");
    btn.className = "use-link ready";
    btn.textContent = "[撿]";
    btn.addEventListener("click", () => {
      if (!carried) return;
      const { added, overflow } = addLoot(carried, { [id]: n });
      saveCarried(carried);
      const got = Object.values(added)[0] ?? 0;
      if (got <= 0) {
        appendSystemLog("背包塞不下了。");
        return;
      }
      appendSystemLog(`拾獲:${RESOURCE_LABEL[id as ResourceId] ?? id} +${got}${overflow ? "(塞不下的只能放棄)" : ""}`);
      line.style.display = "none";
      leaveIfEmpty();
    });
    controls.appendChild(btn);
    line.append(name, controls);
    panel.appendChild(line);
    itemRows.push({ id, n, line });
  }

  const actions = document.createElement("div");
  actions.className = "button-row";
  const allBtn = document.createElement("button");
  allBtn.className = "use-link ready";
  allBtn.textContent = "[全部拾取]";
  allBtn.addEventListener("click", () => {
    if (!carried) return leave();
    let anyOverflow = false;
    const gotAll: string[] = [];
    for (const r of itemRows) {
      if (r.line.style.display === "none") continue;
      const { added, overflow } = addLoot(carried, { [r.id]: r.n });
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
  leaveBtn.textContent = "[放棄並離開]";
  leaveBtn.addEventListener("click", leave);
  actions.append(allBtn, leaveBtn);
  panel.appendChild(actions);

  document.querySelector<HTMLDivElement>("#combat-main")?.appendChild(panel);
}

/** 戰鬥結束:停下引擎,短暫停留後自動離開,不需要按鈕 */
function endCombat(message: string, href: string, delayMs: number) {
  engine.stop();
  statusEl.textContent = message;
  skipBtn.style.display = "none";
  retreatBtn.style.display = "none";
  window.setTimeout(() => {
    window.location.href = href;
  }, delayMs);
}

function render() {
  playerHpText.textContent = `${engine.playerHp}/${engine.playerMaxHp}`;
  enemyHpText.textContent = `${engine.enemyHp}/${engine.enemyMaxHp}`;

  // 異常狀態顯示(§2.11.2):只顯示已成立的等級,計量值不顯示(玩家從挨打頻率自行感受)
  const effects: string[] = [];
  if (engine.playerStatus.poison.level > 0) effects.push(`中毒Lv${engine.playerStatus.poison.level}`);
  if (engine.playerStatus.bleed.level > 0) effects.push(`流血Lv${engine.playerStatus.bleed.level}`);
  statusEffectsEl.textContent = effects.length ? `(${effects.join(" ")})` : "";
    if (engine.stunLeft > 0) statusEffectsEl.textContent += `【暈眩 ${engine.stunLeft.toFixed(1)}s】`;
    else if (engine.slowLeft > 0) statusEffectsEl.textContent += `【遲緩 ${engine.slowLeft.toFixed(1)}s】`;

  // 敵方跑條(§2.9):速度本身就是威脅預告——招式越重跑條越慢,玩家看節奏自行判讀
  const ePct = Math.round(engine.enemy.progress * 100);
  const eFilled = Math.round((ePct / 100) * BAR_WIDTH);
  enemyBarFilled.textContent = "█".repeat(eFilled);
  enemyBarEmpty.textContent = "░".repeat(BAR_WIDTH - eFilled);

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
      row.name.textContent = hotkeyPrefix + subActionLabel(t.subAction.id, t.subAction.label);
      const usable = t.ready && canUse(t.subAction.id);
      row.bar.classList.toggle("ready", usable);
      row.useLink.disabled = !usable;
      row.useLink.classList.toggle("ready", usable);
    }
  }

  requestAnimationFrame(render);
}

engine.start();
render();

// 除錯用:因為瀏覽器分頁在背景時 rAF 會被節流甚至暫停,方便手動在 console 推進時間驗證邏輯
(window as unknown as { __engine: typeof engine }).__engine = engine;
