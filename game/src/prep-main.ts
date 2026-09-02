import "./style.css";
import { WEAPONS, carryCapacity, ARROWS_PER_SLOT, RATIONS_PER_SLOT, BULLETS_PER_SLOT, RAILS_PER_SLOT, OIL_SLOTS, fineMaxDurability } from "./village/data";
import { RESOURCE_LABEL } from "./village/types";
import { saveCarried, returnCarriedToVillage, playerMaxHp, type Carried } from "./carried";
import { markFreshExpedition } from "./explore/engine";

// 整備視圖:出門前決定帶什麼——武器(占耐久)、乾糧、繃帶、弓矢。
// 直接操作 village-state 的庫存;出發時把選擇寫進 carried,探索/戰鬥都讀這一份。
// 2026-08 併入村莊單頁:改為可掛載的視圖(mountPrep),殼層負責分頁與引擎暫停/重讀

// ---- 讀村莊庫存 ----
interface VillageState {
  resources: Record<string, number>;
  ownedWeapons: Record<string, number>;
  /** 精工品數量(ownedWeapons 的子集):耐久上限 +25%,帶出門時優先 */
  fineWeapons?: Record<string, number>;
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

export interface PrepMountOpts {
  /** 按下「出發」之後(carried 已寫入、fresh 旗標已立):殼層切到遠征視圖 */
  onDepart: () => void;
  /** 保留給殼層的返回掛勾(頁籤本身可切換,目前整備頁不再放回村鈕) */
  onBack?: () => void;
}

/** 把整備視圖掛進容器(每次進入分頁重新掛載,讀當下庫存) */
export function mountPrep(container: HTMLDivElement, opts: PrepMountOpts): void {
const village = loadVillage();
const app = container;

if (!village) {
  app.innerHTML = `<p class="narrative-text">這裡什麼都沒有。</p>`;
  return;
}

// 上一趟帶出門、還沒用完的東西先歸還進庫存(死亡時 carried 已被清空,不會走到這)
returnCarriedToVillage();
// 歸還後重新讀一次庫存
Object.assign(village, loadVillage() ?? {});

// ---- 選擇狀態 ----
const pick = {
  weapons: {} as Record<string, number>,
  fineW: {} as Record<string, number>,
  rations: 0,
  jerky: 0,
  bandages: 0,
  arrows: 0,
  bullets: 0,
  rails: 0,
  salts: 0,
  scrolls: 0,
  oil: 0,
  elixirs: 0,
};

app.innerHTML = `
  <div class="section-title">遠征</div>

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


const weaponListEl = app.querySelector<HTMLDivElement>("#weapon-list")!;
const supplyListEl = app.querySelector<HTMLDivElement>("#supply-list")!;

// ---- 揹負空間(統一容量):武器(各有占格)、補給、途中拾獲的戰利品全部共用 ----
const upgrades = (village as { upgrades?: Record<string, boolean> }).upgrades ?? {};
const capacity = carryCapacity(upgrades);

/** 目前配置占用的格數:武器 packSize×把數 + 肉乾/繃帶/卷軸各 1 + 乾糧 2 併 1 格 + 弓矢 3 併 1 格 */
function packPicked(): number {
  let used = 0;
  for (const [id, n] of Object.entries(pick.weapons)) {
    const def = WEAPONS.find((w) => w.id === id);
    used += (def?.packSize ?? 3) * n;
  }
  for (const [id, n] of Object.entries(pick.fineW)) {
    const def = WEAPONS.find((w) => w.id === id);
    used += (def?.packSize ?? 3) * n;
  }
  used += pick.jerky + pick.bandages + pick.scrolls + pick.elixirs + pick.salts;
  used += pick.oil * OIL_SLOTS;
  used += Math.ceil(pick.rations / RATIONS_PER_SLOT);
  used += Math.ceil(pick.arrows / ARROWS_PER_SLOT);
  used += Math.ceil(pick.bullets / BULLETS_PER_SLOT);
  used += Math.ceil(pick.rails / RAILS_PER_SLOT);
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
  const statsEl = app.querySelector<HTMLDivElement>("#stats-list")!;
  const waterCap = upgrades["steel-flask"] ? 50 : upgrades["iron-flask"] ? 40 : upgrades.waterskin ? 32 : 20;
  const flaskTag = upgrades["steel-flask"] ? "(鋼水壺)" : upgrades["iron-flask"] ? "(鐵水壺)" : upgrades.waterskin ? "(大水袋)" : "";
  const stats: [string, string, string?][] = [
    ["HP", `${playerMaxHp()}/${playerMaxHp()}${upgrades["steel-armor"] ? "(鋼甲)" : upgrades["iron-armor"] ? "(鐵甲)" : upgrades["leather-armor"] ? "(皮甲)" : ""}`],
    ["水", `${waterCap}/${waterCap}${flaskTag}`],
    ["揹負空間", `0/${capacity}`, "cap-pack"],
    ["每步消耗", "水 1"],
    ["每 2 步消耗", "乾糧 1"],
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
  capPackValue = app.querySelector<HTMLElement>("#cap-pack")!;
}

/** 一列「名稱 [-] n/總量 [+] [丟]」的通用挑選列;canAdd 是容量守門,onDrop 丟村莊庫存 */
function makePickRow(
  label: string,
  extra: string,
  getStock: () => number,
  getPicked: () => number,
  setPicked: (n: number) => void,
  canAdd: () => boolean = () => true,
  onDrop?: () => void,
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
  if (onDrop) {
    // 丟棄村莊庫存(2026-09:倉庫管理統一收進整備頁)——丟掉的拿不回來
    const dropBtn = document.createElement("button");
    dropBtn.className = "btn-tiny";
    dropBtn.textContent = "丟";
    dropBtn.title = "丟棄一件(從村莊倉庫;拿不回來)";
    dropBtn.addEventListener("click", () => {
      if (getStock() <= 0) return;
      onDrop();
      saveVillage(village);
      setPicked(Math.min(getPicked(), getStock()));
      render();
    });
    controls.append(dropBtn);
  }

  const info = document.createElement("span");
  info.className = "row-info";
  info.textContent = extra;

  line.append(name, controls, info);
  return { line, count, minus, plus, getStock, getPicked, canAdd };
}

type PickRow = ReturnType<typeof makePickRow>;
const rows: PickRow[] = [];

for (const w of WEAPONS) {
  const total = village.ownedWeapons[w.id] ?? 0;
  if (total <= 0) continue;
  const fineTotal = village.fineWeapons?.[w.id] ?? 0;
  const normalTotal = total - fineTotal;
  const ammoText = w.ammo === "arrow" ? "・需要弓矢" : w.ammo === "bullet" ? `・需要子彈(每擊 ${w.ammoPerUse ?? 1} 發)` : "";
  // 普通與精工分列各自挑(2026-09 用戶要求);戰鬥中普通優先消耗、精工墊後
  // 丟棄用可變庫存(丟一把 → 兩列的分母即時變)
  let normalStock = normalTotal;
  let fineStock = fineTotal;
  if (normalTotal > 0) {
    const remainingDur = village.weaponDurability?.[w.id] ?? w.durability;
    const row = makePickRow(
      w.label,
      w.noWear ? `占 ${w.packSize} 格・不耗損${ammoText}` : `占 ${w.packSize} 格・耐久 ${remainingDur}/${w.durability}${ammoText}`,
      () => normalStock,
      () => pick.weapons[w.id] ?? 0,
      (n) => (pick.weapons[w.id] = n),
      () =>
        fitsAfterAdd(
          () => (pick.weapons[w.id] = (pick.weapons[w.id] ?? 0) + 1),
          () => (pick.weapons[w.id] = (pick.weapons[w.id] ?? 1) - 1),
        ),
      () => {
        // 丟普通品:視為丟「耗損的那把」——殘耐久紀錄跟著消失
        normalStock -= 1;
        village.ownedWeapons[w.id] = (village.ownedWeapons[w.id] ?? 0) - 1;
        if (village.ownedWeapons[w.id] <= 0) delete village.ownedWeapons[w.id];
        if (village.weaponDurability) delete village.weaponDurability[w.id];
      },
    );
    weaponListEl.appendChild(row.line);
    rows.push(row);
  }
  if (fineTotal > 0) {
    const fineMax = fineMaxDurability(w.id);
    const fineDur = normalTotal <= 0 ? (village.weaponDurability?.[w.id] ?? fineMax) : fineMax;
    const row = makePickRow(
      `精工${w.label}`,
      w.noWear ? `占 ${w.packSize} 格・不耗損(精工)${ammoText}` : `占 ${w.packSize} 格・耐久 ${fineDur}/${fineMax}(精工:上限 +25%)${ammoText}`,
      () => fineStock,
      () => pick.fineW[w.id] ?? 0,
      (n) => (pick.fineW[w.id] = n),
      () =>
        fitsAfterAdd(
          () => (pick.fineW[w.id] = (pick.fineW[w.id] ?? 0) + 1),
          () => (pick.fineW[w.id] = (pick.fineW[w.id] ?? 1) - 1),
        ),
      () => {
        fineStock -= 1;
        village.fineWeapons ??= {};
        village.fineWeapons[w.id] = (village.fineWeapons[w.id] ?? 0) - 1;
        if (village.fineWeapons[w.id] <= 0) delete village.fineWeapons[w.id];
        village.ownedWeapons[w.id] = (village.ownedWeapons[w.id] ?? 0) - 1;
        if (village.ownedWeapons[w.id] <= 0) delete village.ownedWeapons[w.id];
      },
    );
    weaponListEl.appendChild(row.line);
    rows.push(row);
  }
}
if (rows.length === 0) {
  weaponListEl.innerHTML = `<div class="hint-line">沒有可攜帶的武器。</div>`;
}

const supplyDefs = [
  { id: "ration", label: RESOURCE_LABEL.ration, extra: `${RATIONS_PER_SLOT} 份占 1 格・行路口糧,每 2 步吃 1 份(不回血)`, get: () => pick.rations, set: (n: number) => (pick.rations = n) },
  { id: "jerky", label: RESOURCE_LABEL.jerky, extra: "占 1 格・咬一口 +10 HP;乾糧見底時拿來充飢", get: () => pick.jerky, set: (n: number) => (pick.jerky = n) },
  { id: "bandage", label: RESOURCE_LABEL.bandage, extra: "占 1 格・稀有,大量回復並止血", get: () => pick.bandages, set: (n: number) => (pick.bandages = n) },
  { id: "arrow", label: RESOURCE_LABEL.arrow, extra: `${ARROWS_PER_SLOT} 支占 1 格・獵弓的彈藥`, get: () => pick.arrows, set: (n: number) => (pick.arrows = n) },
  { id: "bullet", label: RESOURCE_LABEL.bullet, extra: `${BULLETS_PER_SLOT} 發占 1 格・左輪/散彈通用`, get: () => pick.bullets, set: (n: number) => (pick.bullets = n) },
  { id: "rail", label: RESOURCE_LABEL.rail, extra: `${RAILS_PER_SLOT} 根占 1 格・鋪在地圖上的永久建設`, get: () => pick.rails, set: (n: number) => (pick.rails = n) },
  { id: "scroll", label: RESOURCE_LABEL.scroll, extra: "占 1 格・一次性,威力驚人", get: () => pick.scrolls, set: (n: number) => (pick.scrolls = n) },
  { id: "oil", label: RESOURCE_LABEL.oil, extra: "占 3 格・一罐點亮一座據點燈柱", get: () => pick.oil, set: (n: number) => (pick.oil = n) },
  { id: "elixir", label: RESOURCE_LABEL.elixir, extra: "占 1 格・戰鬥中飲用:大量回復並解除所有異常", get: () => pick.elixirs, set: (n: number) => (pick.elixirs = n) },
  { id: "salt", label: RESOURCE_LABEL.salt, extra: "占 1 格・解除暈眩/遲緩並免疫 6 秒", get: () => pick.salts, set: (n: number) => (pick.salts = n) },
] as const;

for (const def of supplyDefs) {
  const stock = () => Math.floor(village.resources[def.id] ?? 0);
  if (stock() <= 0) continue;
  const row = makePickRow(
    def.label,
    def.extra,
    stock,
    def.get,
    def.set,
    () =>
      fitsAfterAdd(
        () => def.set(def.get() + 1),
        () => def.set(def.get() - 1),
      ),
    () => {
      village.resources[def.id] = Math.max(0, (village.resources[def.id] ?? 0) - 1);
    },
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
      const fineStock = village.fineWeapons?.[id] ?? 0;
      pick.weapons[id] = Math.min((village.ownedWeapons[id] ?? 0) - fineStock, n as number);
    }
    for (const [id, n] of Object.entries((last.fineW ?? {}) as Record<string, number>)) {
      pick.fineW[id] = Math.min(village.fineWeapons?.[id] ?? 0, n);
    }
    pick.rations = Math.min(Math.floor(village.resources.ration ?? 0), last.rations ?? 0);
    pick.jerky = Math.min(Math.floor(village.resources.jerky ?? 0), last.jerky ?? 0);
    pick.bandages = Math.min(Math.floor(village.resources.bandage ?? 0), last.bandages ?? 0);
    pick.arrows = Math.min(Math.floor(village.resources.arrow ?? 0), last.arrows ?? 0);
    pick.bullets = Math.min(Math.floor(village.resources.bullet ?? 0), last.bullets ?? 0);
    pick.rails = Math.min(Math.floor(village.resources.rail ?? 0), last.rails ?? 0);
    pick.salts = Math.min(Math.floor(village.resources.salt ?? 0), last.salts ?? 0);
    pick.scrolls = Math.min(Math.floor(village.resources.scroll ?? 0), last.scrolls ?? 0);
    pick.oil = Math.min(Math.floor(village.resources.oil ?? 0), last.oil ?? 0);
    pick.elixirs = Math.min(Math.floor(village.resources.elixir ?? 0), last.elixirs ?? 0);
    // 夾回揹負空間(可能上次是有背包時的配置):先減補給,再減武器
    const order: ("rails" | "salts" | "oil" | "elixirs" | "scrolls" | "bullets" | "arrows" | "bandages" | "jerky" | "rations")[] = ["rails", "salts", "oil", "elixirs", "scrolls", "bullets", "arrows", "bandages", "jerky", "rations"];
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

const departBtn = app.querySelector<HTMLButtonElement>("#depart-btn")!;
departBtn.addEventListener("click", () => {
  localStorage.setItem("last-loadout", JSON.stringify(pick));
  // 從村莊庫存扣掉帶走的份:普通與精工各自照玩家挑的數量扣(2026-09 用戶要求)
  const fineTaken: Record<string, number> = {};
  for (const [id, n] of Object.entries(pick.fineW)) {
    if (n > 0) {
      fineTaken[id] = n;
      village.fineWeapons ??= {};
      village.fineWeapons[id] = (village.fineWeapons[id] ?? 0) - n;
      if (village.fineWeapons[id] <= 0) delete village.fineWeapons[id];
      village.ownedWeapons[id] = (village.ownedWeapons[id] ?? 0) - n;
    }
  }
  for (const [id, n] of Object.entries(pick.weapons)) {
    if (n > 0) village.ownedWeapons[id] = (village.ownedWeapons[id] ?? 0) - n;
  }
  village.resources.ration = (village.resources.ration ?? 0) - pick.rations;
  village.resources.jerky = (village.resources.jerky ?? 0) - pick.jerky;
  village.resources.bandage = (village.resources.bandage ?? 0) - pick.bandages;
  village.resources.arrow = (village.resources.arrow ?? 0) - pick.arrows;
  village.resources.bullet = (village.resources.bullet ?? 0) - pick.bullets;
  village.resources.rail = (village.resources.rail ?? 0) - pick.rails;
  village.resources.salt = (village.resources.salt ?? 0) - pick.salts;
  village.resources.scroll = (village.resources.scroll ?? 0) - pick.scrolls;
  village.resources.oil = (village.resources.oil ?? 0) - pick.oil;
  village.resources.elixir = (village.resources.elixir ?? 0) - pick.elixirs;
  saveVillage(village);

  const totalWeapons: Record<string, number> = {};
  for (const [id, n] of Object.entries(pick.weapons)) if (n > 0) totalWeapons[id] = (totalWeapons[id] ?? 0) + n;
  for (const [id, n] of Object.entries(pick.fineW)) if (n > 0) totalWeapons[id] = (totalWeapons[id] ?? 0) + n;
  const carried: Carried = {
    weapons: totalWeapons,
    fineWeapons: fineTaken,
    durability: {},
    rations: pick.rations,
    maxRations: pick.rations,
    jerky: pick.jerky,
    bandages: pick.bandages,
    arrows: pick.arrows,
    bullets: pick.bullets,
    rails: pick.rails,
    salts: pick.salts,
    scrolls: pick.scrolls,
    oil: pick.oil,
    elixirs: pick.elixirs,
    hp: playerMaxHp(), // 在村莊休整過,滿血出發(皮甲升級後上限 40)
    packCap: capacity, // 揹負空間上限:武器/補給/途中拾獲的戰利品全部共用
  };
  // 攜帶武器的耐久:受損的延續上次的剩餘值(沒修就是帶著傷上路),沒受損的為全滿
  for (const id of Object.keys(carried.weapons)) {
    const def = WEAPONS.find((w) => w.id === id)!;
    const normalTaken = pick.weapons[id] ?? 0;
    // 使用中那把 = 普通優先(2026-09 修訂);殘耐久紀錄只在帶了普通品時延續
    // (只帶精工=全新精工滿耐久;例外:庫存本來就只剩精工,紀錄屬於精工)
    const fineStockOnly = ((village.ownedWeapons[id] ?? 0) + normalTaken + (fineTaken[id] ?? 0)) - ((village.fineWeapons?.[id] ?? 0) + (fineTaken[id] ?? 0)) <= 0;
    if (normalTaken > 0) {
      carried.durability[id] = village.weaponDurability?.[id] ?? def.durability;
    } else if (fineStockOnly) {
      carried.durability[id] = village.weaponDurability?.[id] ?? fineMaxDurability(id);
    } else {
      carried.durability[id] = fineMaxDurability(id);
    }
  }
  saveCarried(carried);
  // 新遠征:地圖固定、迷霧保留,但人回到出發點、水補滿、檢查點重設
  markFreshExpedition();
  opts.onDepart();
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
    // 丟到一件不剩的列直接消失,不占版面(2026-09 用戶要求)
    row.line.style.display = stock <= 0 && picked <= 0 ? "none" : "";
  }
  capPackValue.textContent = `${packPicked()}/${capacity}`;
}

render();
}
