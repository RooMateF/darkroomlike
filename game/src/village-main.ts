import "./style.css";
import { VillageEngine, TICK_MS, GATHERABLE } from "./village/engine";
import { JOBS, BUILDINGS, WEAPONS, CONSUMABLES, UPGRADES, TRADES, repairCost, PERK_SLOTS } from "./village/data";
import { PERK_LABEL } from "./village/events-data";
import { clearedSiteCount } from "./explore/sites";
import { RESOURCE_LABEL, type ResourceId } from "./village/types";
import { INTRO_LINES, MILESTONES } from "./village/narrative";
import { returnCarriedToVillage } from "./carried";

// 從探索走回村莊時,行囊裡的東西自動歸還入庫(不管從哪條路回村都正確結算)
returnCarriedToVillage();

const TICK_SECONDS = TICK_MS / 1000;

const savedTheme = localStorage.getItem("theme") ?? "dark";
document.documentElement.dataset.theme = savedTheme;

const app = document.querySelector<HTMLDivElement>("#app")!;

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("theme", next);
}

// ---- 開場敘事(worldbuilding.md § 8:視角要「貼地」,一次一句,點繼續往下推進) ----
// 已有村莊進度(從探索/整備頁回來)就不重播開場
if (localStorage.getItem("village-state")) {
  startVillage();
} else {
  showIntro(0);
}

function showIntro(index: number) {
  if (index >= INTRO_LINES.length) {
    startVillage();
    return;
  }
  app.innerHTML = `
    <div class="top-row">
      <h1>村莊 — 開場</h1>
      <button id="theme-toggle">切換底色</button>
    </div>
    <p class="narrative-text">${INTRO_LINES[index]}</p>
    <button id="next-line" class="use-link ready">[繼續]</button>
  `;
  document.querySelector<HTMLButtonElement>("#theme-toggle")!.addEventListener("click", toggleTheme);
  document.querySelector<HTMLButtonElement>("#next-line")!.addEventListener("click", () => showIntro(index + 1));
}

// ---- 正式進入村莊畫面 ----
function startVillage() {
  app.innerHTML = `
    <div class="top-row">
      <h1>村莊</h1>
      <span>
        <button id="speed-btn" title="測試用:村莊時間十倍速" style="display:none">⏩×1</button>
        <button id="dev-btn" title="測試用:快速取得各種資源" style="display:none">DEV</button>
        <button id="theme-toggle">切換底色</button>
      </span>
    </div>

    <div class="dashboard">
      <div class="section full-width">
        <div class="hp-line">人口 <b id="pop-text"></b>(閒置 <b id="idle-text"></b>)</div>
      </div>

      <div class="section">
        <div class="section-title">資源</div>
        <div id="resource-grid" class="resource-grid"></div>
        <div id="resource-empty" class="hint-line">火堆旁還沒有任何存料。</div>
        <div id="manual" class="button-row" style="margin-top:8px;"></div>
        <div id="gather-slot"></div>
      </div>

      <div class="section">
        <div class="section-title">工作</div>
        <div id="jobs"></div>
      </div>

      <div class="section">
        <div class="section-title">建築</div>
        <div id="buildings"></div>
        <div id="depart" class="status-line" style="margin-top:8px;"></div>
      </div>

      <div class="section" id="armory-section" style="display:none;">
        <div class="section-title">裝備庫</div>
        <div id="armory"></div>
      </div>

      <div class="section" id="craft-section" style="display:none;">
        <div class="section-title">打造</div>
        <div id="craft-tabs" class="button-row" style="margin-bottom:8px;"></div>
        <div id="weapons"></div>
      </div>

      <div class="section full-width">
        <div class="section-title">紀錄</div>
        <div class="log-panel scrollable" id="log"></div>
      </div>

      <div class="section full-width">
        <div class="section-title">系統</div>
        <div class="button-row">
          <button id="export-btn" class="btn ready">匯出存檔</button>
          <button id="import-btn" class="btn ready">匯入存檔</button>
          <button id="reset-btn" class="btn ready">重置遊戲</button>
          <input type="file" id="import-file" accept=".json" style="display:none;" />
        </div>
        <div class="hint-line" style="margin-top:6px;">進度會自動保存在這個瀏覽器裡;匯出可備份或搬到其他裝置。</div>
      </div>
    </div>
  `;

  // DEV/加速按鈕只在網址帶 ?dev 時出現(正式遊玩不暴露測試工具)
  if (new URLSearchParams(location.search).has("dev")) {
    document.querySelector<HTMLButtonElement>("#dev-btn")!.style.display = "";
    document.querySelector<HTMLButtonElement>("#speed-btn")!.style.display = "";
  }
  const popText = document.querySelector<HTMLElement>("#pop-text")!;
  const idleText = document.querySelector<HTMLElement>("#idle-text")!;
  const resourceGridEl = document.querySelector<HTMLDivElement>("#resource-grid")!;
  const manualEl = document.querySelector<HTMLDivElement>("#manual")!;
  // 事件遮罩掛在 body 上,才能覆蓋整個畫面
  const overlayEl = document.createElement("div");
  overlayEl.className = "event-overlay";
  overlayEl.style.display = "none";
  overlayEl.innerHTML = `
    <div class="event-box">
      <div class="event-title">事件</div>
      <div class="event-text" id="overlay-text"></div>
      <div class="event-options" id="overlay-options"></div>
    </div>
  `;
  document.body.appendChild(overlayEl);
  const overlayTextEl = overlayEl.querySelector<HTMLDivElement>("#overlay-text")!;
  const overlayOptionsEl = overlayEl.querySelector<HTMLDivElement>("#overlay-options")!;
  let shownEventId: string | null = null;
  const jobsEl = document.querySelector<HTMLDivElement>("#jobs")!;
  const buildingsEl = document.querySelector<HTMLDivElement>("#buildings")!;
  const departEl = document.querySelector<HTMLDivElement>("#depart")!;
  const logEl = document.querySelector<HTMLDivElement>("#log")!;

  document.querySelector<HTMLButtonElement>("#theme-toggle")!.addEventListener("click", toggleTheme);

  function appendLog(text: string) {
    const line = document.createElement("div");
    line.className = "log-line";
    line.textContent = text;
    logEl.appendChild(line);
    // 保留最近 100 筆供捲動回顧,新訊息自動捲到底
    while (logEl.childElementCount > 100) logEl.removeChild(logEl.firstChild!);
    logEl.scrollTop = logEl.scrollHeight;
  }

  const engine = new VillageEngine({ onLog: appendLog, onTick: render });

  // 測試用十倍速:生產週期 10 秒 → 1 秒,採集冷卻同步縮短(只影響本次開頁,不寫進存檔)
  const speedBtn = document.querySelector<HTMLButtonElement>("#speed-btn")!;
  speedBtn.addEventListener("click", () => {
    const next = engine.speedMult === 1 ? 10 : 1;
    engine.setSpeed(next);
    speedBtn.textContent = `⏩×${next}`;
    speedBtn.classList.toggle("ready", next > 1);
    appendLog(next > 1 ? "(測試)時間十倍速開啟。" : "(測試)時間恢復正常速度。");
  });

  // ---- 系統:存檔匯出/匯入/重置(theme 底色偏好不算遊戲進度,保留) ----
  function gameSaveData(): Record<string, string> {
    const data: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      if (key === "theme") continue;
      data[key] = localStorage.getItem(key)!;
    }
    return data;
  }

  document.querySelector<HTMLButtonElement>("#export-btn")!.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(gameSaveData(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `darkroomlike-save-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    appendLog("存檔已匯出。");
  });

  const importFileEl = document.querySelector<HTMLInputElement>("#import-file")!;
  document.querySelector<HTMLButtonElement>("#import-btn")!.addEventListener("click", () => importFileEl.click());
  importFileEl.addEventListener("change", async () => {
    const file = importFileEl.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text()) as Record<string, string>;
      if (!data["village-state"]) throw new Error("不是有效的存檔");
      // 先清掉現有進度(保留底色偏好),再寫入匯入的內容
      const theme = localStorage.getItem("theme");
      localStorage.clear();
      if (theme) localStorage.setItem("theme", theme);
      for (const [key, value] of Object.entries(data)) localStorage.setItem(key, value);
      location.reload();
    } catch {
      appendLog("匯入失敗:檔案不是有效的存檔。");
      importFileEl.value = "";
    }
  });

  document.querySelector<HTMLButtonElement>("#reset-btn")!.addEventListener("click", () => {
    if (!window.confirm("確定要重置遊戲嗎?所有進度將會消失,無法復原。")) return;
    const theme = localStorage.getItem("theme");
    localStorage.clear();
    if (theme) localStorage.setItem("theme", theme);
    location.reload();
  });

  // 測試用:一鍵灌滿各種資源,省去慢慢生產的等待
  document.querySelector<HTMLButtonElement>("#dev-btn")!.addEventListener("click", () => {
    for (const id of Object.keys(RESOURCE_LABEL) as ResourceId[]) {
      engine.resources[id] += 50;
    }
    engine["syncSeenResources"]();
    engine.saveState();
    appendLog("(測試)所有資源 +50。");
    render();
  });

  // 資源網格
  const resourceRows = (Object.keys(RESOURCE_LABEL) as ResourceId[]).map((id) => {
    const item = document.createElement("div");
    item.className = "resource-item";
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = RESOURCE_LABEL[id];
    const value = document.createElement("span");
    value.className = "value";
    item.append(label, value);
    resourceGridEl.appendChild(item);
    return { id, item, value };
  });

  // ---- 手動採集小遊戲:節奏條,游標來回跑,按下停止,越接近中心甜蜜點收穫越多 ----
  const BAR_LEN = 21;
  const SWEET_CENTER = Math.floor(BAR_LEN / 2);
  let gatherState: { resourceId: ResourceId; pos: number; dir: number; timer: number } | null = null;
  let resultTimer = 0;

  const gatherBarEl = document.querySelector<HTMLDivElement>("#gather-slot")!;
  gatherBarEl.className = "gather-bar";

  // DOM 只建一次:如果每幀用 innerHTML 重建,按鈕會在 mousedown/mouseup 之間被換掉,click 事件永遠不會觸發
  const gatherRow = document.createElement("div");
  gatherRow.className = "gather-row";
  const gatherCells: HTMLSpanElement[] = [];
  for (let i = 0; i < BAR_LEN; i++) {
    const cell = document.createElement("span");
    gatherRow.appendChild(cell);
    gatherCells.push(cell);
  }
  const stopBtn = document.createElement("button");
  stopBtn.className = "btn btn-primary";
  stopBtn.textContent = "停!";
  stopBtn.addEventListener("click", stopGather);
  const resultEl = document.createElement("span");
  resultEl.className = "gather-result";
  gatherBarEl.append(gatherRow, stopBtn, resultEl);
  gatherBarEl.style.visibility = "hidden";

  // 木/石隨時可採;獵弓入手後開放狩獵(生肉/生皮)——按鈕在 render 時依 availableGathers 顯示
  const ALL_GATHERS: ResourceId[] = [...GATHERABLE, "meat", "hide"];
  const gatherButtons = ALL_GATHERS.map((id) => {
    const btn = document.createElement("button");
    btn.className = "btn ready";
    btn.textContent = id === "meat" || id === "hide" ? `狩獵${RESOURCE_LABEL[id]}` : `採集${RESOURCE_LABEL[id]}`;
    btn.style.display = "none";
    btn.addEventListener("click", () => startGather(id));
    manualEl.appendChild(btn);
    return { id, btn };
  });

  function startGather(resourceId: ResourceId) {
    if (gatherState || !engine.canGather) return;
    clearTimeout(resultTimer);
    resultEl.textContent = "";
    resultEl.className = "gather-result";
    gatherRow.className = "gather-row";
    stopBtn.style.display = "";
    gatherBarEl.style.visibility = "visible";

    gatherState = { resourceId, pos: 0, dir: 1, timer: 0 };
    gatherState.timer = window.setInterval(() => {
      const g = gatherState!;
      g.pos += g.dir;
      if (g.pos >= BAR_LEN - 1 || g.pos <= 0) g.dir *= -1;
      drawGatherBar();
    }, 45);
    drawGatherBar();
  }

  function stopGather() {
    if (!gatherState) return;
    const { resourceId, pos } = gatherState;
    clearInterval(gatherState.timer);
    const stoppedAt = pos;
    gatherState = null;

    // 距離中心越近,accuracy 越高
    const distance = Math.abs(stoppedAt - SWEET_CENTER);
    const accuracy = Math.max(0, 1 - distance / SWEET_CENTER);
    const { amount, grade, streak } = engine.gatherResult(resourceId, accuracy);

    // 停在哪裡就把游標留在哪裡,不要瞬間消失——先給回饋,再收起來
    drawStoppedBar(stoppedAt, distance);
    stopBtn.style.display = "none";
    resultEl.textContent = `${grade}　${RESOURCE_LABEL[resourceId]} +${amount}${streak >= 2 ? `　連擊×${streak}` : ""}`;
    resultEl.className = `gather-result grade-${gradeKey(distance)}`;

    // 命中中心會整條閃一下,失手則是輕微抖動,兩種手感明顯不同
    gatherRow.className = distance === 0 ? "gather-row hit-perfect" : distance <= 2 ? "gather-row hit-good" : "gather-row hit-miss";

    resultTimer = window.setTimeout(() => {
      gatherBarEl.style.visibility = "hidden";
    }, 1400);

    render();
  }

  function gradeKey(distance: number): string {
    if (distance === 0) return "perfect";
    if (distance <= 2) return "good";
    if (distance <= 5) return "ok";
    return "poor";
  }

  function drawGatherBar() {
    if (!gatherState) return;
    for (let i = 0; i < BAR_LEN; i++) {
      const distance = Math.abs(i - SWEET_CENTER);
      const cell = gatherCells[i];
      if (i === gatherState.pos) {
        cell.textContent = "█";
        cell.className = "gather-cursor";
      } else if (distance === 0) {
        cell.textContent = "◆";
        cell.className = "gather-sweet";
      } else if (distance <= 2) {
        cell.textContent = "▒";
        cell.className = "gather-good";
      } else {
        cell.textContent = "░";
        cell.className = "gather-track";
      }
    }
  }

  function drawStoppedBar(stoppedAt: number, distance: number) {
    for (let i = 0; i < BAR_LEN; i++) {
      const d = Math.abs(i - SWEET_CENTER);
      const cell = gatherCells[i];
      if (i === stoppedAt) {
        cell.textContent = distance === 0 ? "★" : "█";
        cell.className = `gather-cursor stopped-${gradeKey(distance)}`;
      } else if (d === 0) {
        cell.textContent = "◆";
        cell.className = "gather-sweet";
      } else if (d <= 2) {
        cell.textContent = "▒";
        cell.className = "gather-good";
      } else {
        cell.textContent = "░";
        cell.className = "gather-track";
      }
    }
  }

  // 空白鍵也能停,不用一定要點按鈕
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && gatherState) {
      e.preventDefault();
      stopGather();
    }
  });

  // 工作列表:每個工作一行,用 grid 對齊(名稱 / +- 控制 / 產出說明)
  const jobRows = JOBS.map((job) => {
    const line = document.createElement("div");
    line.className = "row-grid";

    const name = document.createElement("span");
    name.className = "row-name";
    name.textContent = job.label;

    const controls = document.createElement("span");
    controls.className = "row-controls";

    // 後期人口 40+,一次 ±1 要點到手痠——加 ±5;引擎的 assign 會自己夾住上下限
    const minus5 = document.createElement("button");
    minus5.className = "btn-tiny ready";
    minus5.textContent = "−5";
    minus5.addEventListener("click", () => {
      for (let i = 0; i < 5; i++) engine.assign(job.id, -1);
      render();
    });

    const minus = document.createElement("button");
    minus.className = "btn-tiny ready";
    minus.textContent = "−";
    minus.addEventListener("click", () => {
      engine.assign(job.id, -1);
      render();
    });

    const count = document.createElement("span");
    count.className = "row-count";

    const plus = document.createElement("button");
    plus.className = "btn-tiny ready";
    plus.textContent = "+";
    plus.addEventListener("click", () => {
      engine.assign(job.id, 1);
      render();
    });

    const plus5 = document.createElement("button");
    plus5.className = "btn-tiny ready";
    plus5.textContent = "+5";
    plus5.addEventListener("click", () => {
      for (let i = 0; i < 5; i++) engine.assign(job.id, 1);
      render();
    });

    controls.append(minus5, minus, count, plus, plus5);

    const info = document.createElement("span");
    info.className = "row-info";

    line.append(name, controls, info);
    jobsEl.appendChild(line);
    return { job, line, count, minus, plus, info };
  });

  // 建築列表:名稱+成本一行,效果+按鈕一行
  const buildingRows = BUILDINGS.map((building) => {
    const row = document.createElement("div");
    row.className = "building-row";

    const head = document.createElement("div");
    head.className = "building-head";
    const name = document.createElement("span");
    name.className = "building-name";
    name.textContent = building.label;
    const cost = document.createElement("span");
    cost.className = "building-cost";
    head.append(name, cost);

    const foot = document.createElement("div");
    foot.className = "building-foot";
    const effect = document.createElement("span");
    effect.className = "building-effect";
    effect.textContent = building.effect;
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = "建造";
    btn.addEventListener("click", () => {
      engine.build(building.id);
      render();
    });
    foot.append(effect, btn);

    row.append(head, foot);
    buildingsEl.appendChild(row);
    return { building, rowEl: row, name, cost, btn };
  });

  // 武器打造列表(resources.md § 3.0):配方要等「見過所有材料」才浮現,已打造的顯示為持有
  const craftSectionEl = document.querySelector<HTMLDivElement>("#craft-section")!;
  const weaponsEl = document.querySelector<HTMLDivElement>("#weapons")!;

  // 打造分頁:武器/物資/升級/兌換——配方多了以後一頁塞不下(玩家反饋),分頁各自乾淨
  type CraftTab = "weapon" | "goods" | "upgrade" | "trade";
  const CRAFT_TABS: { id: CraftTab; label: string }[] = [
    { id: "weapon", label: "武器" },
    { id: "goods", label: "物資" },
    { id: "upgrade", label: "升級" },
    { id: "trade", label: "兌換" },
  ];
  let craftTab = (localStorage.getItem("craft-tab") as CraftTab) ?? "weapon";
  const craftTabsEl = document.querySelector<HTMLDivElement>("#craft-tabs")!;
  const craftTabBtns = CRAFT_TABS.map((t) => {
    const b = document.createElement("button");
    b.className = "btn";
    b.textContent = t.label;
    b.addEventListener("click", () => {
      craftTab = t.id;
      localStorage.setItem("craft-tab", t.id);
      render();
    });
    craftTabsEl.appendChild(b);
    return { t, b };
  });
  const weaponRows = WEAPONS.map((weapon) => {
    const row = document.createElement("div");
    row.className = "building-row";
    row.style.display = "none";

    const head = document.createElement("div");
    head.className = "building-head";
    const name = document.createElement("span");
    name.className = "building-name";
    name.textContent = weapon.label;
    const cost = document.createElement("span");
    cost.className = "building-cost";
    cost.textContent = Object.entries(weapon.cost)
      .map(([id, n]) => `${RESOURCE_LABEL[id as ResourceId]} ${n}`)
      .join("　");
    head.append(name, cost);

    const foot = document.createElement("div");
    foot.className = "building-foot";
    const effect = document.createElement("span");
    effect.className = "building-effect";
    effect.textContent = weapon.category === "melee" ? "近戰武器" : "遠程武器";
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = "打造";
    btn.addEventListener("click", () => {
      engine.craftWeapon(weapon.id);
      render();
    });
    // 修理鈕:鐵匠鋪蓋好且這把武器受損時才出現
    const repairBtn = document.createElement("button");
    repairBtn.className = "btn";
    repairBtn.style.display = "none";
    repairBtn.addEventListener("click", () => {
      engine.repairWeapon(weapon.id);
      render();
    });
    foot.append(effect, repairBtn, btn);

    row.append(head, foot);
    weaponsEl.appendChild(row);
    return { weapon, row, name, cost, btn, repairBtn };
  });

  // 消耗品打造(乾糧/繃帶/弓矢),同樣依「見過材料 + 前置建築/武器」浮現
  const consumableRows = CONSUMABLES.map((def) => {
    const row = document.createElement("div");
    row.className = "building-row";
    row.style.display = "none";

    const head = document.createElement("div");
    head.className = "building-head";
    const name = document.createElement("span");
    name.className = "building-name";
    name.textContent = def.label;
    const cost = document.createElement("span");
    cost.className = "building-cost";
    cost.textContent =
      Object.entries(def.cost)
        .map(([id, n]) => `${RESOURCE_LABEL[id as ResourceId]} ${n}`)
        .join("　") + ` → x${def.yield}`;
    head.append(name, cost);

    const foot = document.createElement("div");
    foot.className = "building-foot";
    const effect = document.createElement("span");
    effect.className = "building-effect";
    effect.textContent = "消耗品";
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = "製作";
    btn.addEventListener("click", () => {
      engine.craftConsumable(def.id);
      render();
    });
    foot.append(effect, btn);

    row.append(head, foot);
    weaponsEl.appendChild(row);
    return { def, row, btn };
  });

  // 一次性升級(大水袋等),外觀沿用消耗品列
  const upgradeRows = UPGRADES.map((def) => {
    const row = document.createElement("div");
    row.className = "building-row";
    row.style.display = "none";

    const head = document.createElement("div");
    head.className = "building-head";
    const name = document.createElement("span");
    name.className = "building-name";
    name.textContent = def.label;
    const cost = document.createElement("span");
    cost.className = "building-cost";
    cost.textContent = Object.entries(def.cost)
      .map(([id, n]) => `${RESOURCE_LABEL[id as ResourceId]} ${n}`)
      .join("　");
    head.append(name, cost);

    const foot = document.createElement("div");
    foot.className = "building-foot";
    const effect = document.createElement("span");
    effect.className = "building-effect";
    effect.textContent = def.effect;
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = "製作";
    btn.addEventListener("click", () => {
      engine.craftUpgrade(def.id);
      render();
    });
    foot.append(effect, btn);

    row.append(head, foot);
    weaponsEl.appendChild(row);
    return { def, row, cost, btn };
  });

  // 交易所兌換列:交易所蓋好後浮現,異晶換稀有物資
  const tradeRows = TRADES.map((def) => {
    const row = document.createElement("div");
    row.className = "building-row";
    row.style.display = "none";

    const head = document.createElement("div");
    head.className = "building-head";
    const name = document.createElement("span");
    name.className = "building-name";
    name.textContent = RESOURCE_LABEL[def.get];
    const cost = document.createElement("span");
    cost.className = "building-cost";
    cost.textContent = `異晶 ${def.shards}`;
    head.append(name, cost);

    const foot = document.createElement("div");
    foot.className = "building-foot";
    const effect = document.createElement("span");
    effect.className = "building-effect";
    effect.textContent = def.flavor;
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = "兌換";
    btn.addEventListener("click", () => {
      engine.trade(def.id);
      render();
    });
    foot.append(effect, btn);

    row.append(head, foot);
    weaponsEl.appendChild(row);
    return { def, row, btn };
  });

  // 條件解鎖的建築第一次浮現時,代行者用她的口吻點一句——不是系統教學框,是同伴的建議
  const ADVISOR_BUILDING_HINTS: Record<string, string> = {
    tannery: "她翻著你帶回來的生皮:「這些皮加工之後就能變成堅硬的皮革,做得出很多東西。搭個製革場吧,雖然味道不是很好聞就是了。」她調皮地笑著說道",
    smithy: "她看著你從遺跡帶回的工具,擦了擦上面的鏽:「還能用。搭個工匠鋪,壞掉的傢伙就不用扔了。」",
    "trading-post": "她掂了掂那顆微溫的晶體:「這種東西……有人會收,而且出手很闊綽。我們蓋個交易的地方,或許也可以用這些晶體換到一些不好獲得的物資。」",
    railway: "她望著礦坑的方向:「靠人一趟一趟把礦扛回來,實在太慢也太辛苦了。我們鋪一條鐵道,讓火車來負責輸送吧。」",
  };
  const announcedBuildings = new Set<string>(JSON.parse(localStorage.getItem("building-hints-shown") ?? "[]") as string[]);
  function announceBuildingUnlock(buildingId: string) {
    const hint = ADVISOR_BUILDING_HINTS[buildingId];
    if (!hint || announcedBuildings.has(buildingId)) return;
    announcedBuildings.add(buildingId);
    localStorage.setItem("building-hints-shown", JSON.stringify([...announcedBuildings]));
    appendLog(hint);
  }

  // 里程碑敘事:符合條件時只觸發一次,且跨重載不重播(存 localStorage)
  const firedMilestones = new Set<string>(JSON.parse(localStorage.getItem("milestones-fired") ?? "[]") as string[]);
  function checkMilestones() {
    const state = {
      hutBuilt: engine.hasBuilding("hut"),
      firstGrowth: engine.growthEventCount >= 1,
      population: engine.population,
      populationCap: engine.populationCap,
      farmBuilt: engine.hasBuilding("farm"),
      backpackDone: engine.upgrades["backpack"] === true,
      armorDone: engine.upgrades["leather-armor"] === true,
      tanneryBuilt: engine.hasBuilding("tannery"),
      smithyBuilt: engine.hasBuilding("smithy"),
      mineCleared: engine.isSmithyIronCapable(),
      anyWeapon: Object.values(engine.ownedWeapons).some((n) => n > 0),
      waterskinDone: engine.upgrades["waterskin"] === true,
    };
    for (const m of MILESTONES) {
      if (!firedMilestones.has(m.id) && m.check(state)) {
        firedMilestones.add(m.id);
        localStorage.setItem("milestones-fired", JSON.stringify([...firedMilestones]));
        for (const line of Array.isArray(m.text) ? m.text : [m.text]) appendLog(line);
      }
    }
  }

  function render() {
    // 事件用全螢幕遮罩呈現(時間本來就暫停了,讓玩家專心做決定)
    const ev = engine.pendingEvent;
    if (ev && ev.kind === "choice") {
      // 只在事件換人時重建選項,避免每次 render 都重繪按鈕導致點擊失效
      if (shownEventId !== ev.id) {
        shownEventId = ev.id;
        overlayTextEl.textContent = ev.text;
        overlayOptionsEl.innerHTML = "";
        ev.options.forEach((opt, i) => {
          const btn = document.createElement("button");
          // 消耗型選項:庫存不足就不能選(繃帶都沒有,拿什麼收治人)
          const affordable = engine.canAffordEventOption(opt);
          btn.className = affordable ? "btn ready" : "btn";
          btn.disabled = !affordable;
          btn.textContent = affordable ? opt.label : `${opt.label}(不足)`;
          btn.addEventListener("click", () => {
            engine.resolveEvent(i);
            render();
          });
          overlayOptionsEl.appendChild(btn);
        });
      }
      overlayEl.style.display = "flex";
    } else {
      overlayEl.style.display = "none";
      shownEventId = null;
    }

    popText.textContent = `${engine.population}/${engine.populationCap}`;
    idleText.textContent = `${engine.idlePopulation}`;

    // 採集按鈕:冷卻中顯示剩餘秒數;狩獵鈕(生肉/生皮)要有獵弓才浮現
    const cdLeft = engine.gatherCooldownLeft;
    const gatherable = engine.availableGathers();
    for (const g of gatherButtons) {
      g.btn.style.display = gatherable.includes(g.id) ? "" : "none";
      const usable = engine.canGather && !gatherState;
      g.btn.disabled = !usable;
      g.btn.classList.toggle("ready", usable);
      const verb = g.id === "meat" || g.id === "hide" ? "狩獵" : "採集";
      g.btn.textContent = cdLeft > 0
        ? `${RESOURCE_LABEL[g.id]} ${Math.ceil(cdLeft / 1000)}s`
        : `${verb}${RESOURCE_LABEL[g.id]}`;
    }

    let anyResourceSeen = false;
    for (const row of resourceRows) {
      // 沒見過的資源不顯示(如皮革要等製革工實際產出後才浮現),保持「自行摸索」的原則
      const seen = engine.seenResources.has(row.id);
      row.item.style.display = seen ? "" : "none";
      if (seen) {
        anyResourceSeen = true;
        row.value.textContent = String(Math.floor(engine.resources[row.id]));
      }
    }
    // 開局資源區不留空白標題,給一句有敘事感的占位
    document.querySelector<HTMLElement>("#resource-empty")!.style.display = anyResourceSeen ? "none" : "";

    for (const row of jobRows) {
      // 尚未解鎖的工作直接不顯示,讓玩家自己摸索,不寫「需先蓋 XX」的提示
      const unlocked = engine.isJobUnlocked(row.job.id);
      row.line.style.display = unlocked ? "" : "none";
      if (!unlocked) continue;

      row.count.textContent = String(engine.assignments[row.job.id] ?? 0);
      const canRemove = (engine.assignments[row.job.id] ?? 0) > 0;
      const canAdd = engine.idlePopulation > 0;
      row.minus.disabled = !canRemove;
      row.plus.disabled = !canAdd;
      row.minus.classList.toggle("ready", canRemove);
      row.plus.classList.toggle("ready", canAdd);
      // 顯示「目前人數下的實際總產出」,而不是每人基礎值——0 人時顯示 +0,一眼看出這行現在沒在動
      const workers = engine.assignments[row.job.id] ?? 0;
      row.info.textContent =
        Object.entries(row.job.produces)
          .map(([id, n]) => {
            const total = (n ?? 0) * workers;
            return `${RESOURCE_LABEL[id as ResourceId]}${total >= 0 ? "+" : ""}${total}`;
          })
          .join(" ") + ` /${TICK_SECONDS}秒`;
    }

    const hasExplored = localStorage.getItem("hasExplored") === "1";
    for (const row of buildingRows) {
      // 條件解鎖的建築第一次浮現時,由代行者用她的口吻點一句(只說一次,存 localStorage)
      // 需要探索過/打通特定等級探勘點才浮現的建築,條件未達前完全隱藏
      let visible = !row.building.requiresExplore || hasExplored;
      if (visible && row.building.requiresSiteLevel) {
        visible = clearedSiteCount(row.building.requiresSiteLevel) > 0;
      }
      if (visible && row.building.requiresLandmark) {
        try {
          visible = (JSON.parse(localStorage.getItem("landmarks-cleared") ?? "[]") as string[]).includes(row.building.requiresLandmark);
        } catch {
          visible = false;
        }
      }
      if (visible && row.building.requiresResourceSeen) {
        visible = engine.seenResources.has(row.building.requiresResourceSeen);
      }
      if (visible) announceBuildingUnlock(row.building.id);
      row.rowEl.style.display = visible ? "" : "none";
      if (!visible) continue;

      const count = engine.buildingCounts[row.building.id] ?? 0;
      const cost = engine.costOf(row.building.id);
      const buildable = engine.canBuild(row.building.id);
      const maxedOut = !row.building.repeatable && count > 0;

      // 工匠鋪在鐵礦坑解放後升格為鐵匠鋪(同一棟建築,名字與能力演化)
      let label = row.building.label;
      if (row.building.id === "smithy" && engine.isSmithyIronCapable()) label = "鐵匠鋪";
      row.name.textContent = count > 0 ? `${label} ×${count}` : label;
      row.cost.textContent = maxedOut
        ? ""
        : Object.entries(cost)
            .map(([id, n]) => `${RESOURCE_LABEL[id as ResourceId]} ${n}`)
            .join("　");
      row.btn.disabled = !buildable;
      row.btn.classList.toggle("ready", buildable);
      row.btn.textContent = maxedOut ? "已建成" : "建造";
    }

    // 鐵軌配方浮現(鐵匠鋪+礦坑解放)時,代行者提一句鋪軌的構想——
    // 原「鐵道」建築的提示重新掛載於此;她說的火車,在鋼的時代會真的開起來
    if (engine.isConsumableVisible("rail")) announceBuildingUnlock("railway");

    // 裝備庫:一眼看清武器數量/狀態(受損顯示剩餘耐久)與出門用的消耗品存量
    const armorySection = document.querySelector<HTMLDivElement>("#armory-section")!;
    const armoryEl = document.querySelector<HTMLDivElement>("#armory")!;
    armoryEl.innerHTML = "";

    const addArmoryLine = (labelText: string, valueText: string) => {
      const line = document.createElement("div");
      line.className = "resource-item";
      const label = document.createElement("span");
      label.className = "label";
      label.textContent = labelText;
      const value = document.createElement("span");
      value.className = "value";
      value.textContent = valueText;
      line.append(label, value);
      armoryEl.appendChild(line);
    };

    for (const w of WEAPONS.filter((w) => engine.weaponCount(w.id) > 0)) {
      const dmg = engine.isWeaponDamaged(w.id) ? `(耐 ${engine.weaponDurability[w.id]}/${w.durability})` : "";
      addArmoryLine(`${w.label}${dmg}`, `×${engine.weaponCount(w.id)}`);
    }
    // 出門用的消耗品(弓矢/乾糧/肉乾/繃帶/卷軸/燈油/藥劑)也一併列出
    for (const id of ["arrow", "ration", "jerky", "bandage", "scroll", "oil", "elixir", "salt", "rail"] as ResourceId[]) {
      const n = Math.floor(engine.resources[id] ?? 0);
      if (n > 0) addArmoryLine(RESOURCE_LABEL[id], `×${n}`);
    }
    // 稀有訪客交換來的被動:裝備欄制——裝上的才生效,對著遠征目標換裝
    const ownedPerks = Object.entries(engine.perks).filter(([id, owned]) => owned && PERK_LABEL[id]);
    if (ownedPerks.length > 0) {
      addArmoryLine(`被動(生效 ${engine.equippedPerks.length}/${PERK_SLOTS})`, "");
      for (const [perkId] of ownedPerks) {
        const line = document.createElement("div");
        line.className = "resource-item";
        const label = document.createElement("span");
        label.className = "label";
        const equipped = engine.equippedPerks.includes(perkId);
        label.textContent = `　【${PERK_LABEL[perkId]}】${equipped ? "" : "(未裝備)"}`;
        const btn = document.createElement("button");
        btn.textContent = equipped ? "卸下" : "裝備";
        btn.disabled = !equipped && engine.equippedPerks.length >= PERK_SLOTS;
        btn.addEventListener("click", () => {
          engine.togglePerk(perkId);
          render();
        });
        line.append(label, btn);
        armoryEl.appendChild(line);
      }
    }
    armorySection.style.display = armoryEl.childElementCount > 0 ? "" : "none";

    // 武器打造:見過所有材料的配方才浮現;可重複打造(備用武器在耐久度機制下有意義)
    const craftAvail: Record<CraftTab, boolean> = {
      weapon: weaponRows.some((r) => (r.weapon.lootOnly ? engine.weaponCount(r.weapon.id) > 0 : engine.isWeaponVisible(r.weapon.id))),
      goods: consumableRows.some((r) => engine.isConsumableVisible(r.def.id)),
      upgrade: upgradeRows.some((r) => engine.isUpgradeVisible(r.def.id)),
      trade: engine.hasBuilding("trading-post"),
    };
    // 目前分頁沒東西(如升級還沒解鎖)就退到第一個有內容的分頁
    const tab: CraftTab = craftAvail[craftTab] ? craftTab : (CRAFT_TABS.find((t) => craftAvail[t.id])?.id ?? "weapon");
    for (const { t, b } of craftTabBtns) {
      b.style.display = craftAvail[t.id] ? "" : "none";
      b.classList.toggle("ready", t.id === tab);
    }
    let anyCraftVisible = false;
    for (const row of weaponRows) {
      // lootOnly(如異質短刃):不開放打造——沒入手前整列隱藏,入手後只顯示持有/修理
      const visible = row.weapon.lootOnly ? engine.weaponCount(row.weapon.id) > 0 : engine.isWeaponVisible(row.weapon.id);
      row.row.style.display = visible && tab === "weapon" ? "" : "none";
      if (!visible) continue;
      anyCraftVisible = true;

      const count = engine.weaponCount(row.weapon.id);
      const craftable = !row.weapon.lootOnly && engine.canAfford(row.weapon.cost);
      if (row.weapon.lootOnly) {
        row.btn.style.display = "none";
        row.cost.textContent = "";
      }
      const damaged = engine.isWeaponDamaged(row.weapon.id);
      const durText = damaged ? `(耐 ${engine.weaponDurability[row.weapon.id]}/${row.weapon.durability})` : "";
      row.name.textContent = (count > 0 ? `${row.weapon.label} ×${count}` : row.weapon.label) + durText;
      row.btn.disabled = !craftable;
      row.btn.classList.toggle("ready", craftable);

      // 修理鈕:工匠鋪/鐵匠鋪 + 受損 + 位階修得動才出現,顯示修理成本
      const canRepairHere = engine.canRepairWeapon(row.weapon.id) && count > 0;
      row.repairBtn.style.display = canRepairHere ? "" : "none";
      if (canRepairHere) {
        const rc = repairCost(row.weapon.id);
        const rcText = Object.entries(rc)
          .map(([id, n]) => `${RESOURCE_LABEL[id as ResourceId]}${n}`)
          .join(" ");
        const affordable = engine.canAfford(rc);
        row.repairBtn.textContent = `修理(${rcText})`;
        row.repairBtn.disabled = !affordable;
        row.repairBtn.classList.toggle("ready", affordable);
      }
    }

    // 消耗品:乾糧/繃帶/弓矢
    for (const row of consumableRows) {
      const visible = engine.isConsumableVisible(row.def.id);
      row.row.style.display = visible && tab === "goods" ? "" : "none";
      if (!visible) continue;
      anyCraftVisible = true;

      const craftable = engine.canAfford(row.def.cost);
      row.btn.disabled = !craftable;
      row.btn.classList.toggle("ready", craftable);
    }
    // 一次性升級
    for (const row of upgradeRows) {
      const visible = engine.isUpgradeVisible(row.def.id);
      row.row.style.display = visible && tab === "upgrade" ? "" : "none";
      if (!visible) continue;
      anyCraftVisible = true;

      const done = engine.upgrades[row.def.id] === true;
      const craftable = !done && engine.canAfford(row.def.cost);
      row.cost.style.display = done ? "none" : "";
      row.btn.disabled = !craftable;
      row.btn.classList.toggle("ready", craftable);
      row.btn.textContent = done ? "已完成" : "製作";
    }
    // 交易所兌換
    const tradeOpen = engine.hasBuilding("trading-post");
    for (const row of tradeRows) {
      row.row.style.display = tradeOpen && tab === "trade" ? "" : "none";
      if (!tradeOpen) continue;
      anyCraftVisible = true;
      const affordable = engine.resources.shard >= row.def.shards;
      row.btn.disabled = !affordable;
      row.btn.classList.toggle("ready", affordable);
    }
    craftSectionEl.style.display = anyCraftVisible ? "" : "none";

    // 外出探索:人口上限達 20(靠不斷擴建小木屋)且蓋出田才開放——
    // 沒有田就沒有穀物、沒有乾糧,空著肚子出門是送死;條件不寫提示,讓玩家自行摸索
    const readyToExplore = engine.populationCap >= 20 && engine.hasBuilding("farm");
    departEl.innerHTML = readyToExplore
      ? `<a href="prep.html" class="btn btn-primary">整備出門 →</a>`
      : "";

    checkMilestones();
  }

  // 死裡逃生回村:代行者依死因給一句叮囑(輪播,不重複唸同一句)
  const REVIVAL_TIPS: Record<string, string[]> = {
    thirst: [
      "她把裝滿的水囊放在你手邊:「口渴了嗎?記得要隨時注意自己的身體狀況補充水份。」",
      "「記住你曾經去過的補給點。或許在回程的時候可以去那邊補給一些水和糧食。」她說完,替你掖了掖毯子。",
    ],
    hunger: [
      "她把一小塊肉乾塞進你手裡:「肚子餓了吧,沒有食物的話就不要再繼續勉強啦。」",
      "「別把肉乾當存糧吃光——在外面,那是你最後的生命線了。」她的聲音很輕,但沒有商量的餘地。",
    ],
    combat: [
      "她替你把繃帶收緊:「撐不住的話就先暫時避開那些危險的地方。」",
      "「打不過的東西,就繞開牠。或許可以在其他地方找到能夠致勝的關鍵。」",
      "「多帶一把備用的武器。武器壞了的話就沒辦法作戰了。」",
    ],
  };
  const deathCause = localStorage.getItem("death-cause");
  if (deathCause) {
    localStorage.removeItem("death-cause");
    const tips = REVIVAL_TIPS[deathCause] ?? REVIVAL_TIPS.combat;
    const idxKey = `revival-tip-${deathCause}`;
    const idx = Number(localStorage.getItem(idxKey) ?? "0");
    appendLog("你在營地的火堆旁醒來。身上帶出去的東西,一樣也沒能回來。");
    appendLog(tips[idx % tips.length]);
    localStorage.setItem(idxKey, String((idx + 1) % tips.length));
  }

  engine.start();
  render();
  // 冷卻倒數需要每秒更新顯示,不能只靠 10 秒一次的生產週期
  setInterval(render, 500);

  (window as unknown as { __village: typeof engine }).__village = engine;
}
