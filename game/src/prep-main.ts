import "./style.css";
import { WEAPONS, carryCapacity, ARROWS_PER_SLOT, RATIONS_PER_SLOT } from "./village/data";
import { RESOURCE_LABEL } from "./village/types";
import { saveCarried, returnCarriedToVillage, playerMaxHp, type Carried } from "./carried";
import { markFreshExpedition } from "./explore/engine";

// 整備頁:出門前決定帶什麼——武器(占耐久)、乾糧、繃帶、弓矢。
// 直接操作 village-state 的庫存;出發時把選擇寫進 carried,探索/戰鬥都讀這一份。

const savedTheme = localStorage.getItem("theme") ?? "dark";
document.documentElement.dataset.theme = savedTheme;

// ---- 讀村莊庫存 ----
interface VillageState {
  resources: Record<string, number>;
  ownedWeapons: Record<string, number>;
  /** 受損武器的剩餘耐久(不修的話會一直帶著;鐵匠鋪可修理) */
  weaponDurability?: Record<string, number>;
  [key: string]: unknown;
}

function loadVillage(): VillageState | null {
  try {
    const raw = localStorage.getItem("village-state");
    return raw ? (JSON.parse(raw) as VillageState) : null;
  } catch {
    return null;
  }
}

function saveVillage(state: VillageState) {
  localStorage.setItem("village-state", JSON.stringify(state));
}

const village = loadVillage();
const app = document.querySelector<HTMLDivElement>("#app")!;

if (!village) {
  app.innerHTML = `<p class="narrative-text">這裡什麼都沒有。<a href="village.html" style="color:inherit">回村莊</a></p>`;
  throw new Error("no village state");
}

// 上一趟帶出門、還沒用完的東西先歸還進庫存(死亡時 carried 已被清空,不會走到這)
returnCarriedToVillage();
// 歸還後重新讀一次庫存
Object.assign(village, loadVillage() ?? {});

// ---- 選擇狀態 ----
const pick = {
  weapons: {} as Record<string, number>,
  rations: 0,
  jerky: 0,
  bandages: 0,
  arrows: 0,
  scrolls: 0,
  oil: 0,
  elixirs: 0,
};

app.innerHTML = `
  <div class="top-row">
    <h1>整備</h1>
    <button id="theme-toggle">切換底色</button>
  </div>
  <div class="nav-links">
    <a href="village.html">← 回村莊</a>
  </div>

  <div class="section">
    <div class="section-title">狀態</div>
    <div id="stats-list" class="resource-grid"></div>
  </div>

  <div class="section">
    <div class="section-title">武器</div>
    <div id="weapon-list"></div>
  </div>

  <div class="section">
    <div class="section-title">補給品</div>
    <div id="supply-list"></div>
  </div>

  <div class="section button-row">
    <button id="depart-btn" class="btn btn-primary">出發 →</button>
  </div>
`;

document.querySelector<HTMLButtonElement>("#theme-toggle")!.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("theme", next);
});

const weaponListEl = document.querySelector<HTMLDivElement>("#weapon-list")!;
const supplyListEl = document.querySelector<HTMLDivElement>("#supply-list")!;

// ---- 揹負空間(統一容量):武器(各有占格)、補給、途中拾獲的戰利品全部共用 ----
const upgrades = (village as { upgrades?: Record<string, boolean> }).upgrades ?? {};
const capacity = carryCapacity(upgrades.backpack === true);

/** 目前配置占用的格數:武器 packSize×把數 + 肉乾/繃帶/卷軸各 1 + 乾糧 2 併 1 格 + 弓矢 3 併 1 格 */
function packPicked(): number {
  let used = 0;
  for (const [id, n] of Object.entries(pick.weapons)) {
    const def = WEAPONS.find((w) => w.id === id);
    used += (def?.packSize ?? 3) * n;
  }
  used += pick.jerky + pick.bandages + pick.scrolls + pick.oil + pick.elixirs;
  used += Math.ceil(pick.rations / RATIONS_PER_SLOT);
  used += Math.ceil(pick.arrows / ARROWS_PER_SLOT);
  return used;
}

/** 模擬多帶一件某東西之後還塞不塞得下 */
function fitsAfterAdd(mutate: () => void, revert: () => void): boolean {
  mutate();
  const ok = packPicked() <= capacity;
  revert();
  return ok;
}

// ---- 狀態:出發時的自身數值(HP 滿血、水袋容量看有沒有做大水袋升級) ----
let capPackValue: HTMLElement;
{
  const statsEl = document.querySelector<HTMLDivElement>("#stats-list")!;
  const hasWaterskin = upgrades.waterskin === true;
  const waterCap = hasWaterskin ? 32 : 20;
  const stats: [string, string, string?][] = [
    ["HP", `${playerMaxHp()}/${playerMaxHp()}${upgrades["leather-armor"] ? "(皮甲)" : ""}`],
    ["水", `${waterCap}/${waterCap}${hasWaterskin ? "(大水袋)" : ""}`],
    ["揹負空間", `0/${capacity}`, "cap-pack"],
    ["每步消耗", "水 1"],
    ["每 2 步消耗", "乾糧 1(不回血;乾糧見底改咬肉乾,咬一口 +10 HP)"],
  ];
  for (const [label, value, id] of stats) {
    const item = document.createElement("div");
    item.className = "resource-item";
    const l = document.createElement("span");
    l.className = "label";
    l.textContent = label;
    const v = document.createElement("span");
    v.className = "value";
    v.textContent = value;
    if (id) v.id = id;
    item.append(l, v);
    statsEl.appendChild(item);
  }
  capPackValue = document.getElementById("cap-pack")!;
}

/** 一列「名稱 [-] n/總量 [+]」的通用挑選列;canAdd 是容量上限的守門 */
function makePickRow(
  label: string,
  extra: string,
  getStock: () => number,
  getPicked: () => number,
  setPicked: (n: number) => void,
  canAdd: () => boolean = () => true,
) {
  const line = document.createElement("div");
  line.className = "row-grid";

  const name = document.createElement("span");
  name.className = "row-name";
  name.textContent = label;

  const controls = document.createElement("span");
  controls.className = "row-controls";

  const minus = document.createElement("button");
  minus.className = "btn-tiny";
  minus.textContent = "−";
  minus.addEventListener("click", () => {
    setPicked(Math.max(0, getPicked() - 1));
    render();
  });

  const count = document.createElement("span");
  count.className = "row-count";
  count.style.minWidth = "3.5em";

  const plus = document.createElement("button");
  plus.className = "btn-tiny";
  plus.textContent = "+";
  plus.addEventListener("click", () => {
    if (!canAdd()) return;
    setPicked(Math.min(getStock(), getPicked() + 1));
    render();
  });

  controls.append(minus, count, plus);

  const info = document.createElement("span");
  info.className = "row-info";
  info.textContent = extra;

  line.append(name, controls, info);
  return { line, count, minus, plus, getStock, getPicked, canAdd };
}

type PickRow = ReturnType<typeof makePickRow>;
const rows: PickRow[] = [];

for (const w of WEAPONS) {
  const stock = () => village.ownedWeapons[w.id] ?? 0;
  if (stock() <= 0) continue;
  const remainingDur = village.weaponDurability?.[w.id] ?? w.durability;
  const row = makePickRow(
    w.label,
    `占 ${w.packSize} 格・耐久 ${remainingDur}/${w.durability}${w.usesArrow ? "・需要弓矢" : ""}`,
    stock,
    () => pick.weapons[w.id] ?? 0,
    (n) => (pick.weapons[w.id] = n),
    () =>
      fitsAfterAdd(
        () => (pick.weapons[w.id] = (pick.weapons[w.id] ?? 0) + 1),
        () => (pick.weapons[w.id] = (pick.weapons[w.id] ?? 1) - 1),
      ),
  );
  weaponListEl.appendChild(row.line);
  rows.push(row);
}
if (rows.length === 0) {
  weaponListEl.innerHTML = `<div class="hint-line">沒有可攜帶的武器。</div>`;
}

const supplyDefs = [
  { id: "ration", label: RESOURCE_LABEL.ration, extra: `${RATIONS_PER_SLOT} 份占 1 格・行路的口糧,不回血`, get: () => pick.rations, set: (n: number) => (pick.rations = n) },
  { id: "jerky", label: RESOURCE_LABEL.jerky, extra: "占 1 格・重但滋養,關鍵時刻能回血", get: () => pick.jerky, set: (n: number) => (pick.jerky = n) },
  { id: "bandage", label: RESOURCE_LABEL.bandage, extra: "占 1 格・稀有,大量回復並止血", get: () => pick.bandages, set: (n: number) => (pick.bandages = n) },
  { id: "arrow", label: RESOURCE_LABEL.arrow, extra: `${ARROWS_PER_SLOT} 支占 1 格・獵弓的彈藥`, get: () => pick.arrows, set: (n: number) => (pick.arrows = n) },
  { id: "scroll", label: RESOURCE_LABEL.scroll, extra: "占 1 格・一次性,威力驚人", get: () => pick.scrolls, set: (n: number) => (pick.scrolls = n) },
  { id: "oil", label: RESOURCE_LABEL.oil, extra: "占 1 格・點亮據點燈柱的燃料(每座 3 份)", get: () => pick.oil, set: (n: number) => (pick.oil = n) },
  { id: "elixir", label: RESOURCE_LABEL.elixir, extra: "占 1 格・戰鬥中飲用:大量回復並解除所有異常", get: () => pick.elixirs, set: (n: number) => (pick.elixirs = n) },
] as const;

for (const def of supplyDefs) {
  const stock = () => Math.floor(village.resources[def.id] ?? 0);
  if (stock() <= 0) continue;
  const row = makePickRow(def.label, def.extra, stock, def.get, def.set, () =>
    fitsAfterAdd(
      () => def.set(def.get() + 1),
      () => def.set(def.get() - 1),
    ),
  );
  supplyListEl.appendChild(row.line);
  rows.push(row);
}
if (supplyListEl.childElementCount === 0) {
  supplyListEl.innerHTML = `<div class="hint-line">沒有可攜帶的補給品。</div>`;
}

// 沿用上次配置:少掉每次出門重新點一輪的麻煩(超出庫存的部分自動壓到庫存量)
// 進整備頁自動帶入上次的配置(壓到庫存與揹負空間內),省掉每次重點一輪;要調整直接改就好
try {
  const last = JSON.parse(localStorage.getItem("last-loadout") ?? "null");
  if (last) {
    for (const [id, n] of Object.entries(last.weapons ?? {})) {
      pick.weapons[id] = Math.min(village.ownedWeapons[id] ?? 0, n as number);
    }
    pick.rations = Math.min(Math.floor(village.resources.ration ?? 0), last.rations ?? 0);
    pick.jerky = Math.min(Math.floor(village.resources.jerky ?? 0), last.jerky ?? 0);
    pick.bandages = Math.min(Math.floor(village.resources.bandage ?? 0), last.bandages ?? 0);
    pick.arrows = Math.min(Math.floor(village.resources.arrow ?? 0), last.arrows ?? 0);
    pick.scrolls = Math.min(Math.floor(village.resources.scroll ?? 0), last.scrolls ?? 0);
    pick.oil = Math.min(Math.floor(village.resources.oil ?? 0), last.oil ?? 0);
    pick.elixirs = Math.min(Math.floor(village.resources.elixir ?? 0), last.elixirs ?? 0);
    // 夾回揹負空間(可能上次是有背包時的配置):先減補給,再減武器
    const order: ("oil" | "elixirs" | "scrolls" | "arrows" | "bandages" | "jerky" | "rations")[] = ["oil", "elixirs", "scrolls", "arrows", "bandages", "jerky", "rations"];
    let oi = 0;
    while (packPicked() > capacity && oi < order.length) {
      if (pick[order[oi]] > 0) pick[order[oi]]--;
      else oi++;
    }
    while (packPicked() > capacity) {
      const id = Object.keys(pick.weapons).find((k) => pick.weapons[k] > 0);
      if (!id) break;
      pick.weapons[id]--;
    }
  }
} catch {
  /* 壞資料就從空配置開始 */
}

const departBtn = document.querySelector<HTMLButtonElement>("#depart-btn")!;
departBtn.addEventListener("click", () => {
  localStorage.setItem("last-loadout", JSON.stringify(pick));
  // 從村莊庫存扣掉帶走的份
  for (const [id, n] of Object.entries(pick.weapons)) {
    if (n > 0) village.ownedWeapons[id] = (village.ownedWeapons[id] ?? 0) - n;
  }
  village.resources.ration = (village.resources.ration ?? 0) - pick.rations;
  village.resources.jerky = (village.resources.jerky ?? 0) - pick.jerky;
  village.resources.bandage = (village.resources.bandage ?? 0) - pick.bandages;
  village.resources.arrow = (village.resources.arrow ?? 0) - pick.arrows;
  village.resources.scroll = (village.resources.scroll ?? 0) - pick.scrolls;
  village.resources.oil = (village.resources.oil ?? 0) - pick.oil;
  village.resources.elixir = (village.resources.elixir ?? 0) - pick.elixirs;
  saveVillage(village);

  const carried: Carried = {
    weapons: Object.fromEntries(Object.entries(pick.weapons).filter(([, n]) => n > 0)),
    durability: {},
    rations: pick.rations,
    maxRations: pick.rations,
    jerky: pick.jerky,
    bandages: pick.bandages,
    arrows: pick.arrows,
    scrolls: pick.scrolls,
    oil: pick.oil,
    elixirs: pick.elixirs,
    hp: playerMaxHp(), // 在村莊休整過,滿血出發(皮甲升級後上限 40)
    packCap: capacity, // 揹負空間上限:武器/補給/途中拾獲的戰利品全部共用
  };
  // 攜帶武器的耐久:受損的延續上次的剩餘值(沒修就是帶著傷上路),沒受損的為全滿
  for (const id of Object.keys(carried.weapons)) {
    const def = WEAPONS.find((w) => w.id === id)!;
    carried.durability[id] = village.weaponDurability?.[id] ?? def.durability;
  }
  saveCarried(carried);
  // 新遠征:地圖固定、迷霧保留,但人回到出發點、水補滿、檢查點重設
  markFreshExpedition();
  window.location.href = "explore.html";
});

function render() {
  for (const row of rows) {
    const picked = row.getPicked();
    const stock = row.getStock();
    const addable = picked < stock && row.canAdd();
    row.count.textContent = `${picked}/${stock}`;
    row.minus.disabled = picked <= 0;
    row.plus.disabled = !addable;
    row.minus.classList.toggle("ready", picked > 0);
    row.plus.classList.toggle("ready", addable);
  }
  capPackValue.textContent = `${packPicked()}/${capacity}`;
}

render();
