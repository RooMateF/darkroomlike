import "./style.css";
import { ExploreEngine, MAP_WIDTH, MAP_HEIGHT, LAMP_RADIUS, isAutoPickup, setAutoPickup } from "./explore/engine";
import { MAP_DEFS } from "./explore/map-gen";
import { hasChurchKey } from "./explore/sites";
import { LANDMARKS, TILE_SYMBOL } from "./explore/types";
import { playerMaxHp, packUsed, saveCarried } from "./carried";
import { WEAPONS, ARROWS_PER_SLOT, RATIONS_PER_SLOT, BULLETS_PER_SLOT, RAILS_PER_SLOT } from "./village/data";
import { RESOURCE_LABEL, type ResourceId } from "./village/types";

const savedTheme = localStorage.getItem("theme") ?? "dark";
document.documentElement.dataset.theme = savedTheme;

// 記錄「玩家至少外出探索過一次」——村莊那邊的部分建築(如製革場)以此浮現
localStorage.setItem("hasExplored", "1");

const app = document.querySelector<HTMLDivElement>("#app")!;
app.style.maxWidth = "1040px"; // 整張地圖完整呈現需要比其他頁面寬的版面
app.innerHTML = `
  <div class="top-row">
    <h1>探索</h1>
    <span>
      <button id="auto-pickup-toggle"></button>
      <button id="pack-toggle">背包</button>
      <button id="view-toggle">全圖</button>
      <button id="theme-toggle">切換底色</button>
    </span>
  </div>
  <div class="section">
    <div class="hp-line">HP <b id="hp-text"></b>　　水 <b id="water-text"></b>　　乾糧 <b id="ration-text"></b>　　位置 <b id="pos-text"></b></div>
    <div class="hint-line">方向鍵 / WASD,或點擊 @ 的某一側往該方向走一步</div>
    <div class="status-line" id="status-line"></div>
    <div class="status-line" id="pickup-panel"></div>
    <div class="status-line" id="site-action"></div>
  </div>

  <div id="map" class="map-grid map-grid-full"></div>
  <div id="pack-panel" class="section" style="display:none"></div>
  <hr />
  <div class="log-panel scrollable" id="log"></div>
`;

const mapEl = document.querySelector<HTMLDivElement>("#map")!;
const hpText = document.querySelector<HTMLElement>("#hp-text")!;
const waterText = document.querySelector<HTMLElement>("#water-text")!;
const rationText = document.querySelector<HTMLElement>("#ration-text")!;
const posText = document.querySelector<HTMLElement>("#pos-text")!;
const statusEl = document.querySelector<HTMLElement>("#status-line")!;
const pickupPanelEl = document.querySelector<HTMLElement>("#pickup-panel")!;
const autoPickupToggle = document.querySelector<HTMLButtonElement>("#auto-pickup-toggle")!;
autoPickupToggle.addEventListener("click", () => {
  setAutoPickup(!isAutoPickup());
  render();
});
const siteActionEl = document.querySelector<HTMLElement>("#site-action")!;
const logEl = document.querySelector<HTMLDivElement>("#log")!;

document.querySelector<HTMLButtonElement>("#theme-toggle")!.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("theme", next);
});

function appendLog(text: string) {
  const line = document.createElement("div");
  line.className = "log-line";
  line.textContent = text;
  logEl.appendChild(line);
  // 保留最近 100 筆供捲動回顧(敘事碎片值得回頭看),新訊息自動捲到底
  while (logEl.childElementCount > 100) logEl.removeChild(logEl.firstChild!);
  logEl.scrollTop = logEl.scrollHeight;
}

const engine = new ExploreEngine({
  onLog: appendLog,
  onDeath: () => {
    // 死亡:帶出門的東西已消失(§3.9),自動送回村莊,不需要按鈕
    statusEl.textContent = "▍正在返回村莊……";
    window.setTimeout(() => {
      window.location.href = "village.html";
    }, 2200);
  },
  onEncounter: () => {
    // 保存遠征進度,戰鬥勝利回來時從原地接續
    engine.saveState();
    statusEl.textContent = "▍遭遇戰鬥!";
    window.setTimeout(() => {
      window.location.href = "index.html";
    }, 900);
  },
});

// ---- 地圖呈現:雙模式 ----
// 「視野」(預設):攝影機跟著 @ 走,固定 16px 清晰字級,只畫視窗塞得下的範圍——
//   之前把 105 格整張塞進小視窗,字縮到人眼看不清,完全本末倒置
// 「全圖」:一覽全貌(字級隨視窗縮小),規劃長途路線時切過來看
let viewMode: "camera" | "full" = (localStorage.getItem("explore-view") as "camera" | "full") ?? "camera";
let cells: HTMLSpanElement[][] = [];
let viewCols = MAP_WIDTH;
let viewRows = MAP_HEIGHT;

const viewToggle = document.querySelector<HTMLButtonElement>("#view-toggle")!;
viewToggle.addEventListener("click", () => {
  viewMode = viewMode === "camera" ? "full" : "camera";
  localStorage.setItem("explore-view", viewMode);
  buildGrid();
  render();
});

/** 量測目前字級下一個等寬字元的實際寬度(px) */
function measureCharWidth(): number {
  const probe = document.createElement("div");
  probe.className = "map-row";
  probe.textContent = "".padEnd(20, ".");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  mapEl.appendChild(probe);
  const w = probe.getBoundingClientRect().width / 20;
  probe.remove();
  return w || 9.6;
}

/** 依模式重建地圖 DOM(視野模式的格子數依視窗大小計算) */
function buildGrid() {
  mapEl.className = viewMode === "camera" ? "map-grid map-grid-cam" : "map-grid map-grid-full";
  mapEl.innerHTML = "";

  if (viewMode === "camera") {
    const charW = measureCharWidth();
    const budgetW = mapEl.clientWidth || app.clientWidth;
    // 高度預算:視窗高扣掉上方資訊區與下方日誌保留區(scaleY 0.6 壓縮後每列約 0.6 個字高)
    const budgetH = Math.max(200, window.innerHeight - mapEl.getBoundingClientRect().top - 170);
    const fontPx = 16;
    viewCols = Math.max(21, Math.min(MAP_WIDTH, Math.floor(budgetW / charW) - 2));
    viewRows = Math.max(13, Math.min(MAP_HEIGHT, Math.floor(budgetH / (fontPx * 0.6)) - 2));
  } else {
    viewCols = MAP_WIDTH;
    viewRows = MAP_HEIGHT;
  }

  const frameRow = (text: string) => {
    const row = document.createElement("div");
    row.className = "map-row";
    row.textContent = text;
    mapEl.appendChild(row);
  };

  frameRow(`+${"-".repeat(viewCols)}+`);
  cells = [];
  for (let y = 0; y < viewRows; y++) {
    const row = document.createElement("div");
    row.className = "map-row";
    row.appendChild(document.createTextNode("|"));
    const rowCells: HTMLSpanElement[] = [];
    for (let x = 0; x < viewCols; x++) {
      const cell = document.createElement("span");
      cell.className = "map-cell";
      row.appendChild(cell);
      rowCells.push(cell);
    }
    row.appendChild(document.createTextNode("|"));
    mapEl.appendChild(row);
    cells.push(rowCells);
  }
  frameRow(`+${"-".repeat(viewCols)}+`);
}

buildGrid();

// 視窗大小改變時重算視野尺寸
let resizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    buildGrid();
    render();
  }, 200);
});

// 事件委派:點在 @ 的哪一側就往那個方向走一步(格子上存的是世界座標)
mapEl.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (!target.dataset.x) return;
  engine.moveTo(Number(target.dataset.x), Number(target.dataset.y));
  render();
});

// 村莊出發點(地圖中央;只有中央地圖有村莊)
const homePos = { x: Math.floor(MAP_WIDTH / 2), y: Math.floor(MAP_HEIGHT / 2) };

// 標題帶上目前地圖的名字(中央地圖不加註)
{
  const mapLabel = MAP_DEFS[engine.mapId].label;
  document.querySelector("h1")!.textContent = mapLabel ? `探索——${mapLabel}` : "探索";
}

// ---- 背包管理面板:遠征中整理揹負空間(逐件/整疊丟棄) ----
// 戰利品與補給共用背包,撿滿了乾糧就補不進去——把「丟什麼、留什麼」的決定權交給玩家
const packPanel = document.querySelector<HTMLDivElement>("#pack-panel")!;
const packToggle = document.querySelector<HTMLButtonElement>("#pack-toggle")!;
let packOpen = false;
packToggle.addEventListener("click", () => {
  packOpen = !packOpen;
  packPanel.style.display = packOpen ? "" : "none";
  renderPack();
});

/** 面板的一列:名稱(占格資訊)+ 丟棄鈕 */
function packRow(label: string, info: string, onDropOne: () => void, onDropAll?: () => void) {
  const line = document.createElement("div");
  line.className = "row-grid";
  const name = document.createElement("span");
  name.className = "row-name";
  name.textContent = label;
  const mid = document.createElement("span");
  mid.className = "row-controls";
  mid.textContent = info;
  const btns = document.createElement("span");
  const drop1 = document.createElement("button");
  drop1.className = "btn";
  drop1.textContent = "丟1";
  drop1.addEventListener("click", () => {
    onDropOne();
    saveCarried(engine.carried!);
    renderPack();
    render();
  });
  btns.appendChild(drop1);
  if (onDropAll) {
    const dropAll = document.createElement("button");
    dropAll.className = "btn";
    dropAll.textContent = "全丟";
    dropAll.addEventListener("click", () => {
      onDropAll();
      saveCarried(engine.carried!);
      renderPack();
      render();
    });
    btns.appendChild(dropAll);
  }
  line.append(name, mid, btns);
  packPanel.appendChild(line);
}

function renderPackButton() {
  const c = engine.carried;
  packToggle.textContent = c ? `背包 ${packUsed(c)}/${c.packCap ?? 20}` : "背包";
  // 背包快滿時按鈕亮起提醒
  packToggle.classList.toggle("ready", !!c && packUsed(c) >= (c.packCap ?? 20) - 2);
  if (packOpen) renderPack();
}

function renderPack() {
  const c = engine.carried;
  if (!packOpen) return;
  packPanel.innerHTML = "";
  if (!c) {
    packPanel.textContent = "身上沒有行囊。";
    return;
  }

  const title = document.createElement("div");
  title.className = "section-title";
  title.textContent = `行囊整理(${packUsed(c)}/${c.packCap ?? 20} 格)——丟棄的東西會留在原地,拿不回來`;
  packPanel.appendChild(title);

  // 武器(各有占格;丟了就沒了)
  for (const w of WEAPONS) {
    const n = c.weapons[w.id] ?? 0;
    if (n <= 0) continue;
    packRow(`${w.label} ×${n}`, `占 ${w.packSize * n} 格`, () => {
      c.weapons[w.id] = n - 1;
      if (c.weapons[w.id] <= 0) {
        delete c.weapons[w.id];
        delete c.durability[w.id];
      }
    });
  }

  // 補給品(乾糧 2 併 1 格、弓矢 3 併 1 格,其餘 1 格 1 件)
  type SupplyKey = "rations" | "jerky" | "bandages" | "arrows" | "bullets" | "rails" | "scrolls" | "oil" | "elixirs";
  const supplies: { key: SupplyKey; id: ResourceId; perSlot: number }[] = [
    { key: "rations", id: "ration", perSlot: RATIONS_PER_SLOT },
    { key: "jerky", id: "jerky", perSlot: 1 },
    { key: "bandages", id: "bandage", perSlot: 1 },
    { key: "arrows", id: "arrow", perSlot: ARROWS_PER_SLOT },
    { key: "bullets", id: "bullet", perSlot: BULLETS_PER_SLOT },
    { key: "rails", id: "rail", perSlot: RAILS_PER_SLOT },
    { key: "scrolls", id: "scroll", perSlot: 1 },
    { key: "oil", id: "oil", perSlot: 1 },
    { key: "elixirs", id: "elixir", perSlot: 1 },
  ];
  for (const def of supplies) {
    const n = (c[def.key] as number | undefined) ?? 0;
    if (n <= 0) continue;
    const slots = Math.ceil(n / def.perSlot);
    packRow(
      `${RESOURCE_LABEL[def.id]} ×${n}`,
      `占 ${slots} 格`,
      () => ((c[def.key] as number) = Math.max(0, n - 1)),
      () => ((c[def.key] as number) = 0),
    );
  }

  // 戰利品(活著帶回村才入庫;弓矢/乾糧類與隨身的合併計格)
  for (const [id, n] of Object.entries(c.loot ?? {})) {
    if ((n ?? 0) <= 0) continue;
    const perSlot = id === "arrow" ? ARROWS_PER_SLOT : id === "ration" ? RATIONS_PER_SLOT : 1;
    const slots = Math.ceil((n ?? 0) / perSlot);
    packRow(
      `${RESOURCE_LABEL[id as ResourceId] ?? id} ×${n}(戰利品)`,
      `約占 ${slots} 格`,
      () => {
        c.loot![id] = (n ?? 0) - 1;
        if (c.loot![id] <= 0) delete c.loot![id];
      },
      () => {
        delete c.loot![id];
      },
    );
  }

  if (packPanel.childElementCount <= 1) {
    const empty = document.createElement("div");
    empty.className = "hint-line";
    empty.textContent = "背包是空的。";
    packPanel.appendChild(empty);
  }
}

function render() {
  viewToggle.textContent = viewMode === "camera" ? "全圖" : "視野";
  renderPackButton();
  // 攝影機原點:以 @ 為中心,夾在地圖邊界內
  const ox = viewMode === "camera" ? Math.max(0, Math.min(MAP_WIDTH - viewCols, engine.playerX - Math.floor(viewCols / 2))) : 0;
  const oy = viewMode === "camera" ? Math.max(0, Math.min(MAP_HEIGHT - viewRows, engine.playerY - Math.floor(viewRows / 2))) : 0;

  // 收集燃著的燈柱位置,把光圈(曼哈頓 LAMP_RADIUS 格)畫成提亮的區域
  const lamps: [number, number][] = [];
  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      if (engine.grid[y][x].lit) lamps.push([x, y]);
    }
  }
  const inGlow = (x: number, y: number) => lamps.some(([lx, ly]) => Math.abs(x - lx) + Math.abs(y - ly) <= LAMP_RADIUS);

  for (let vy = 0; vy < viewRows; vy++) {
    for (let vx = 0; vx < viewCols; vx++) {
      const x = ox + vx;
      const y = oy + vy;
      const cell = cells[vy][vx];
      cell.dataset.x = String(x);
      cell.dataset.y = String(y);
      const isPlayer = x === engine.playerX && y === engine.playerY;
      const tile = engine.grid[y][x];
      let symbol = tile.revealed ? TILE_SYMBOL[tile.type] : " ";
      // 鐵軌:一般地形上畫 =(據點/地標等重要符號優先)
      if (tile.revealed && tile.rail && (tile.type === "plain" || tile.type === "brush" || tile.type === "rubble")) {
        symbol = "=";
      }
      // 補給點三態:S 有儲備 / s 這趟已拿空 / %(點過燈,燈柱燃著)
      if (tile.revealed && tile.type === "depot") {
        symbol = tile.lit ? "%" : engine.isDepotLooted(x, y) ? "s" : "S";
      }
      // 出口依方位畫箭頭(北^ 南v 西< 東>),暗示「路通往地圖之外」
      if (tile.revealed && tile.type === "exit") {
        symbol = y === 0 ? "^" : y === MAP_HEIGHT - 1 ? "v" : x === 0 ? "<" : ">";
      }
      // 地標依定義畫各自的字母(M 礦坑 / O 觀測台 / A 祭壇 / K 煤礦坑)
      if (tile.revealed && tile.type === "landmark") {
        symbol = LANDMARKS.find((l) => l.x === x && l.y === y && (l.mapId ?? "A") === engine.mapId)?.symbol ?? "!";
      }
      // 村莊:整張地圖最特別的一格(家的符號),只在中央地圖
      if (engine.mapId === "A" && tile.revealed && x === homePos.x && y === homePos.y) symbol = "⌂";
      cell.textContent = isPlayer ? "@" : symbol;

      // 顏色層:拿空的補給點淡化;燈火光圈提亮;村莊與燃著的燈柱高亮加粗
      cell.className = "map-cell";
      if (!isPlayer && tile.revealed) {
        if (symbol === "⌂" || symbol === "%") cell.classList.add("beacon");
        else if (symbol === "s") cell.classList.add("dim");
        else if (lamps.length > 0 && inGlow(x, y)) cell.classList.add("glow");
      }
    }
  }
  hpText.textContent = `${engine.hp}/${playerMaxHp()}`;
  waterText.textContent = `${engine.water}/${engine.maxWater}`;
  rationText.textContent = String(engine.rations);
  posText.textContent = `${engine.playerX}, ${engine.playerY}`;

  autoPickupToggle.textContent = isAutoPickup() ? "自動拾取:開" : "自動拾取:關";

  // 腳邊的拾獲物(手動拾取模式):逐項決定,或一鍵全撿/全放棄;走開=放棄剩下
  pickupPanelEl.innerHTML = "";
  const pending = engine.pendingPickup;
  if (pending && Object.keys(pending).length > 0) {
    const label = document.createElement("span");
    label.textContent = "▍腳邊:";
    pickupPanelEl.appendChild(label);
    for (const [id, n] of Object.entries(pending)) {
      const btn = document.createElement("button");
      btn.className = "btn ready";
      btn.textContent = `撿 ${RESOURCE_LABEL[id as ResourceId] ?? id} ×${n}`;
      btn.addEventListener("click", () => {
        engine.pickupFromPending(id, n);
        render();
      });
      pickupPanelEl.appendChild(btn);
    }
    const allBtn = document.createElement("button");
    allBtn.className = "btn btn-primary";
    allBtn.textContent = "全部拾取";
    allBtn.addEventListener("click", () => {
      engine.pickupAllPending();
      render();
    });
    const dropBtn = document.createElement("button");
    dropBtn.className = "btn";
    dropBtn.textContent = "全部放棄";
    dropBtn.addEventListener("click", () => {
      engine.discardPending();
      render();
    });
    pickupPanelEl.append(allBtn, dropBtn);
  }

  siteActionEl.innerHTML = "";

  // 站在出口上 → 顯示「前進」:跨到相鄰地圖(水糧血照舊帶著走,沒有傳送)
  const exitLink = engine.exitLinkHere();
  if (exitLink) {
    const goBtn = document.createElement("button");
    goBtn.className = "btn btn-primary";
    goBtn.textContent = exitLink.label;
    goBtn.addEventListener("click", () => {
      if (engine.travelThroughExit()) {
        statusEl.textContent = "▍你越過了邊界……";
        window.setTimeout(() => location.reload(), 700);
      }
    });
    siteActionEl.appendChild(goBtn);
  }

  // 站在村莊出發點(中央地圖的中心)→ 可以結束遠征回村。回村沒有傳送——要自己走回來,水和糧的回程壓力才是真的
  if (engine.mapId === "A" && engine.playerX === homePos.x && engine.playerY === homePos.y) {
    const homeBtn = document.createElement("a");
    homeBtn.className = "btn btn-primary";
    homeBtn.textContent = "返回村莊(結束遠征)";
    homeBtn.href = "village.html";
    siteActionEl.appendChild(homeBtn);
  }

  // 站在可鋪軌的格子上 → 顯示「鋪設鐵軌」(從村莊連出去的永久工程)
  if (engine.canLayRail()) {
    const railBtn = document.createElement("button");
    railBtn.className = "btn";
    railBtn.textContent = `鋪設鐵軌(剩 ${engine.carried?.rails ?? 0})`;
    railBtn.addEventListener("click", () => {
      if (engine.layRail()) render();
    });
    siteActionEl.appendChild(railBtn);
  }

  // 站在據點上、身上有肉乾且沒滿血 → 顯示「吃肉乾」(要不要花這口糧,玩家自己決定)
  if (engine.canEatJerky()) {
    const eatBtn = document.createElement("button");
    eatBtn.className = "btn";
    eatBtn.textContent = `吃肉乾 +10(剩 ${engine.carried?.jerky ?? 0})`;
    eatBtn.addEventListener("click", () => {
      if (engine.eatJerky()) render();
    });
    siteActionEl.appendChild(eatBtn);
  }

  // 站在據點上且帶著燈油 → 顯示「點亮燈柱」(照亮區的遭遇率大幅下降)
  if (engine.canLightLamp()) {
    const lampBtn = document.createElement("button");
    lampBtn.className = "btn";
    lampBtn.textContent = "點亮燈柱(燈油×3)";
    lampBtn.addEventListener("click", () => {
      if (engine.lightLamp()) render();
    });
    siteActionEl.appendChild(lampBtn);
  }

  // 站在未打通的探勘點上 → 顯示「深入調查」;層數進度用刻痕感的文字呈現
  const current = engine.currentSite();
  if (current && current.site.landmarkId === "church" && !hasChurchKey()) {
    // 教堂上了鎖:鑰匙藏在某座遺跡深處(不寫提示,鎖孔的形狀就是線索)
    const locked = document.createElement("span");
    locked.textContent = "▍大門上懸著一把黑鐵巨鎖,鎖孔的形狀像一片葉子。推不開,也撬不動。";
    siteActionEl.appendChild(locked);
  } else if (current) {
    const btn = document.createElement("button");
    btn.className = "btn btn-primary";
    btn.textContent = current.progress.stage > 0 ? `繼續深入(${current.progress.stage}/${current.site.stages})` : "深入調查";
    btn.addEventListener("click", () => {
      if (engine.startDungeon()) {
        statusEl.textContent = "▍你撥開入口,走進黑暗……";
        window.setTimeout(() => {
          window.location.href = "index.html";
        }, 900);
      }
    });
    siteActionEl.appendChild(btn);
  }
}

window.addEventListener("keydown", (e) => {
  const map: Record<string, [number, number]> = {
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    w: [0, -1],
    s: [0, 1],
    a: [-1, 0],
    d: [1, 0],
  };
  const dir = map[e.key];
  if (!dir) return;
  e.preventDefault();
  engine.move(dir[0], dir[1]);
  render();
});

render();

(window as unknown as { __explore: typeof engine }).__explore = engine;
