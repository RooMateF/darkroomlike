import "./style.css";
import { VillageEngine, TICK_MS, GATHERABLE } from "./village/engine";
import { JOBS, BUILDINGS, WEAPONS, CONSUMABLES, UPGRADES, TRADES, repairCost, PERK_SLOTS, SMITHY_IRON_UPGRADE_COST } from "./village/data";
import { PERK_LABEL } from "./village/events-data";
import { clearedSiteCount, specialSites, siteProgress } from "./explore/sites";
import { generateMap } from "./explore/map-gen";
import { RESOURCE_LABEL, type ResourceId } from "./village/types";
import { INTRO_LINES, MILESTONES } from "./village/narrative";
import { returnCarriedToVillage, loadCarried } from "./carried";
import { mountPrep } from "./prep-main";
import { mountExplore } from "./explore-main";

// 行囊歸還:只有「真的回村」才結算——戰鬥打完跳回(?view=expedition)或
// 遠征進行中重新整理(village-tab 停在 expedition)時,行囊要留著接續遠征
const resumingExpedition =
  new URLSearchParams(location.search).get("view") === "expedition" ||
  localStorage.getItem("village-tab") === "expedition";
if (!resumingExpedition) returnCarriedToVillage();

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
  app.classList.remove("app-frame");
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
  app.classList.add("app-frame");
  app.innerHTML = `
    <div class="top-row">
      <h1>村莊</h1>
      <span id="village-tabs" class="tab-row"></span>
      <span>
        <button id="speed-btn" title="測試用:村莊時間十倍速" style="display:none">⏩×1</button>
        <button id="dev-btn" title="測試用:快速取得各種資源" style="display:none">DEV</button>
        <button id="theme-toggle">切換底色</button>
      </span>
    </div>

    <div class="hp-line" style="margin-bottom:10px;">人口 <b id="pop-text"></b>(閒置 <b id="idle-text"></b>)</div>

    <div class="page-content">
    <div class="main-split" id="main-split">
      <div class="col-fixed">
        <div class="section" id="affairs-resources">
          <div class="section-title">資源</div>
          <div id="resource-grid" class="resource-grid"></div>
          <div id="resource-empty" class="hint-line">火堆旁還沒有任何存料。</div>
          <div id="manual" class="button-row" style="margin-top:6px;"></div>
          <div id="gather-slot"></div>
        </div>
      </div>

      <div class="col-project">
        <div class="section" id="affairs-jobs" style="display:none;">
          <div class="section-title">工作</div>
          <div id="jobs"></div>
        </div>

        <div class="section" id="affairs-buildings" style="display:none;">
          <div class="section-title">建築</div>
          <div id="buildings" class="card-grid"></div>
        </div>

        <div class="section" id="armory-section" style="display:none;">
          <div class="section-title">裝備庫</div>
          <div id="armory" class="resource-grid"></div>
        </div>

        <div class="section" id="craft-section" style="display:none;">
          <div class="section-title">打造</div>
          <div id="craft-tabs" class="button-row" style="margin-bottom:6px;"></div>
          <div id="weapons"></div>
        </div>

        <div class="section" id="market-section" style="display:none;">
          <div class="section-title">交易所</div>
          <div class="hint-line" id="market-shards" style="margin-bottom:6px;"></div>
          <div id="trades" class="card-grid"></div>
        </div>

        <div class="section" id="prep-section" style="display:none;"></div>

        <div class="section" id="system-section" style="display:none;">
          <div class="section-title">系統</div>
          <div class="button-row">
            <button id="export-btn" class="btn ready">匯出存檔</button>
            <button id="import-btn" class="btn ready">匯入存檔</button>
            <button id="reset-btn" class="btn ready">重置遊戲</button>
            <input type="file" id="import-file" accept=".json" style="display:none;" />
          </div>
          <div class="hint-line" style="margin-top:6px;">進度會自動保存在這個瀏覽器裡;匯出可備份或搬到其他裝置。</div>
          <div class="section-title" style="margin-top:14px;">模擬戰(滿裝測試場)</div>
          <div class="hint-line">鋼階滿裝+危機意識,不影響存檔;打完自動重開,「撤退」=離開。</div>
          <div style="display:flex; flex-wrap:wrap; gap:6px;" id="sandbox-btns">
            <button class="btn" data-sandbox="church">教堂</button>
            <button class="btn" data-sandbox="coalmine">煤礦坑</button>
            <button class="btn" data-sandbox="mine">鐵礦坑</button>
            <button class="btn" data-sandbox="observatory">觀測台</button>
            <button class="btn" data-sandbox="shrine">祭壇</button>
            <button class="btn" data-sandbox="scavenger">拾荒的長手</button>
            <button class="btn" data-sandbox="counter">數數的東西</button>
            <button class="btn" data-sandbox="lv3">Lv3 看守</button>
            <button class="btn" data-sandbox="redmoon">紅月三連戰</button>
            <button class="btn" data-sandbox="siren">哼歌的東西</button>
            <button class="btn" data-sandbox="tentacle">收藏的觸手</button>
            <button class="btn" data-sandbox="group">外圍組隊</button>
            <button class="btn" data-sandbox="spawnpack">孳生體群</button>
            <button class="btn" data-sandbox="chain">遺跡連鎖戰</button>
          </div>
          <div class="section-title" style="margin-top:14px;">紅月試煉(真實存檔)</div>
          <div class="hint-line">用真實裝備體驗完整循環:按三次→出門看她的提醒與 ☾→打連鎖戰;放著不管按到第五次=災厄之夜。</div>
          <div style="display:flex; flex-wrap:wrap; gap:6px;">
            <button class="btn" id="redmoon-fire-btn">觸發一次紅月事件</button>
            <button class="btn" id="redmoon-status-btn">查看目前次數</button>
            <button class="btn" id="redmoon-reset-btn">循環歸零</button>
          </div>
        </div>
      </div>
    </div>

    <div id="expedition-section" style="display:none;"></div>
    </div>

    <div class="log-dock">
      <div class="section-title">紀錄</div>
      <div class="log-panel scrollable" id="log"></div>
    </div>
  `;

  // DEV/加速按鈕:開發期常駐(用戶要求);正式發布前改回「?dev 才出現」的門控
  {
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
  const logEl = document.querySelector<HTMLDivElement>("#log")!;

  document.querySelector<HTMLButtonElement>("#theme-toggle")!.addEventListener("click", toggleTheme);

  // 紀錄落地保存(2026-09 用戶定案):跳頁/重載不再洗掉,滾動保留最近 100 筆
  const VILLAGE_LOG_KEY = "village-log-v2"; // v2:存「畫面由上而下」順序;v1 是時間序,直接棄用
  // 2026-09 用戶定案:置頂實驗收掉,回到由上而下的時間順序(最新在底部,自動捲到底)
  function renderLogLine(text: string) {
    const line = document.createElement("div");
    line.className = "log-line";
    line.textContent = text;
    logEl.appendChild(line);
    // 保留最近 100 筆供捲動回顧
    while (logEl.childElementCount > 100) logEl.removeChild(logEl.firstChild!);
  }
  function appendLog(text: string) {
    renderLogLine(text);
    logEl.scrollTop = logEl.scrollHeight;
    try {
      // 直接保存畫面的由上而下順序,還原時照序重排
      localStorage.setItem(VILLAGE_LOG_KEY, JSON.stringify([...logEl.children].map((c) => c.textContent ?? "")));
    } catch {
      /* 壞資料不擋遊戲 */
    }
  }
  // 開頁還原歷史紀錄(存檔=畫面由上而下的順序,照序排回,捲到底部的最新處)
  try {
    for (const t of JSON.parse(localStorage.getItem(VILLAGE_LOG_KEY) ?? "[]") as string[]) renderLogLine(t);
    logEl.scrollTop = logEl.scrollHeight;
  } catch {
    /* 同上 */
  }

  // 燈油制度遷移(一次性):舊制 1 份 1 格、每座燈柱 3 份 → 新制 1 罐 3 格、每座 1 罐。
  // 庫存與行囊裡的舊份數折成罐(無條件進位,不讓玩家吃虧)
  if (!localStorage.getItem("oil-unit-v2")) {
    try {
      const v = JSON.parse(localStorage.getItem("village-state") ?? "{}");
      if ((v.resources?.oil ?? 0) > 0) {
        v.resources.oil = Math.ceil(v.resources.oil / 3);
        localStorage.setItem("village-state", JSON.stringify(v));
      }
      const c = JSON.parse(localStorage.getItem("carried") ?? "null");
      if (c && (c.oil ?? 0) > 0) {
        c.oil = Math.ceil(c.oil / 3);
        localStorage.setItem("carried", JSON.stringify(c));
      }
    } catch {
      /* 壞資料就跳過,別擋開機 */
    }
    localStorage.setItem("oil-unit-v2", "1");
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

  document.querySelector<HTMLButtonElement>("#redmoon-fire-btn")!.addEventListener("click", () => {
    engine.devFireEventById("red-moon");
  });
  document.querySelector<HTMLButtonElement>("#redmoon-status-btn")!.addEventListener("click", () => {
    const n = localStorage.getItem("redmoon-count") ?? "0";
    engine.devLog?.(`(紅月目前 ${n}/3;滿 3 出窪地,第 5 次災厄)`);
  });
  document.querySelector<HTMLButtonElement>("#redmoon-reset-btn")!.addEventListener("click", () => {
    localStorage.setItem("redmoon-count", "0");
    localStorage.removeItem("redmoon-reminded");
    engine.devLog?.("(紅月循環已歸零;窪地會在下次進入地圖時撤掉)");
  });
  document.querySelectorAll<HTMLButtonElement>("#sandbox-btns button").forEach((b) => {
    b.addEventListener("click", () => {
      window.location.href = `index.html?sandbox=${b.dataset.sandbox}`;
    });
  });
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

    // 命中回饋與引擎判定同一把尺:≤1 格=完美(整條閃光)、≤3=不錯、更遠=失手抖動
    gatherRow.className = distance <= 1 ? "gather-row hit-perfect" : distance <= 3 ? "gather-row hit-good" : "gather-row hit-miss";

    resultTimer = window.setTimeout(() => {
      gatherBarEl.style.visibility = "hidden";
    }, 1400);

    render();
  }

  function gradeKey(distance: number): string {
    // 與引擎的檔位一致:≤1 完美、≤3 不錯、≤6 普通
    if (distance <= 1) return "perfect";
    if (distance <= 3) return "good";
    if (distance <= 6) return "ok";
    return "poor";
  }

  // 節奏條繪製(採集與打造共用同一套視覺)
  function drawBar(cells: HTMLSpanElement[], pos: number) {
    for (let i = 0; i < BAR_LEN; i++) {
      const distance = Math.abs(i - SWEET_CENTER);
      const cell = cells[i];
      if (i === pos) {
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

  function drawGatherBar() {
    if (!gatherState) return;
    drawBar(gatherCells, gatherState.pos);
  }

  function drawStopped(cells: HTMLSpanElement[], stoppedAt: number, distance: number) {
    for (let i = 0; i < BAR_LEN; i++) {
      const d = Math.abs(i - SWEET_CENTER);
      const cell = cells[i];
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

  function drawStoppedBar(stoppedAt: number, distance: number) {
    drawStopped(gatherCells, stoppedAt, distance);
  }

  // 空白鍵也能停,不用一定要點按鈕(採集與打造的節奏條共用)
  window.addEventListener("keydown", (e) => {
    if (e.code !== "Space") return;
    if (gatherState) {
      e.preventDefault();
      stopGather();
    } else if (craftState) {
      e.preventDefault();
      stopCraftGame();
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
      // 工匠鋪的按鈕在「升格待付費」狀態下是升格鈕(2026-09 用戶定案)
      if (building.id === "smithy" && engine.canUpgradeSmithy()) engine.upgradeSmithy();
      else engine.build(building.id);
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

  // 頁面主分頁:村務(生產+建造)/工房(裝備庫+打造)/交易所——紀錄常駐上方(玩家反饋:紀錄太低看不到)
  // 投射式版面(玩家反饋):左欄資源常駐(所有功能都要對照它),右側面板由選單投射內容;
  // 整備/遠征併入本頁(不再是獨立網頁),遠征佔滿整個內容區
  type VillageTab = "jobs" | "build" | "workshop" | "market" | "prep" | "expedition" | "system";
  const VILLAGE_TABS: { id: VillageTab; label: string }[] = [
    { id: "jobs", label: "工作" },
    { id: "build", label: "建築" },
    { id: "workshop", label: "工房" },
    { id: "market", label: "交易所" },
    // prep 與 expedition 互斥顯示(村內=整備視圖/在外=地圖視圖),同標籤「遠征」讓它讀起來是同一個入口(2026-09 用戶要求)
    { id: "prep", label: "遠征" },
    { id: "expedition", label: "遠征" },
    { id: "system", label: "系統" },
  ];
  const storedTab = localStorage.getItem("village-tab");
  let villageTab = (VILLAGE_TABS.some((t) => t.id === storedTab) ? storedTab : "build") as VillageTab;
  const villageTabsEl = document.querySelector<HTMLSpanElement>("#village-tabs")!;
  const villageTabBtns = VILLAGE_TABS.map((t) => {
    const b = document.createElement("button");
    b.className = "btn";
    b.textContent = t.label;
    b.addEventListener("click", () => {
      villageTab = t.id;
      localStorage.setItem("village-tab", t.id);
      render();
    });
    villageTabsEl.appendChild(b);
    return { t, b };
  });
  const jobsSectionEl = document.querySelector<HTMLDivElement>("#affairs-jobs")!;
  const buildSectionEl = document.querySelector<HTMLDivElement>("#affairs-buildings")!;
  const systemSectionEl = document.querySelector<HTMLDivElement>("#system-section")!;
  const prepSectionEl = document.querySelector<HTMLDivElement>("#prep-section")!;
  const expeditionSectionEl = document.querySelector<HTMLDivElement>("#expedition-section")!;
  const mainSplitEl = document.querySelector<HTMLDivElement>("#main-split")!;
  const logDockEl = document.querySelector<HTMLDivElement>(".log-dock")!;

  function switchVillageTab(t: VillageTab) {
    villageTab = t;
    localStorage.setItem("village-tab", t);
    render();
  }

  // ---- 整備/遠征視圖的掛載管理:離開村莊視圖時暫停生產(遠征期間村莊凍結,維持原有平衡),
  // 回村後重讀存檔再恢復(整備扣裝/遠征歸還都直接動 localStorage) ----
  let mountedView: "" | "prep" | "expedition" = "";
  let exploreCleanup: (() => void) | null = null;

  function mountExpeditionView() {
    exploreCleanup = mountExplore(expeditionSectionEl, {
      onReturnVillage: () => {
        handleReturnHome();
        switchVillageTab("build");
      },
      onRemount: () => {
        // 跨圖:卸掉重掛(取代整頁 reload)
        exploreCleanup?.();
        expeditionSectionEl.innerHTML = "";
        mountExpeditionView();
      },
    });
  }

  function syncMountedView(target: VillageTab) {
    const want: "" | "prep" | "expedition" = target === "prep" ? "prep" : target === "expedition" ? "expedition" : "";
    if (want === mountedView) return;
    if (mountedView === "expedition") {
      exploreCleanup?.();
      exploreCleanup = null;
      expeditionSectionEl.innerHTML = "";
    }
    if (mountedView === "prep") prepSectionEl.innerHTML = "";
    const wasAway = mountedView !== "";
    mountedView = want;
    if (want && !wasAway) {
      engine.saveState();
      engine.stop();
    } else if (!want && wasAway) {
      engine.reloadState();
      // 行囊還在身上=人還在外面(例如遠征中切去看系統分頁):村莊維持凍結,不能邊探險邊生產
      if (loadCarried() === null) engine.start();
    }
    if (want === "prep") {
      mountPrep(prepSectionEl, {
        onDepart: () => switchVillageTab("expedition"),
        onBack: () => switchVillageTab("build"),
      });
    } else if (want === "expedition") {
      mountExpeditionView();
    }
  }
  const marketSectionEl = document.querySelector<HTMLDivElement>("#market-section")!;
  const marketShardsEl = document.querySelector<HTMLDivElement>("#market-shards")!;
  const tradesEl = document.querySelector<HTMLDivElement>("#trades")!;

  // 打造分頁:武器/物資/升級——配方多了以後一頁塞不下(玩家反饋),分頁各自乾淨;兌換移往交易所主分頁
  type CraftTab = "weapon" | "goods" | "upgrade";
  const CRAFT_TABS: { id: CraftTab; label: string }[] = [
    { id: "weapon", label: "武器" },
    { id: "goods", label: "物資" },
    { id: "upgrade", label: "升級" },
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
  // 武器列壓成單行(名稱|成本|修理/打造):12 把武器一頁放得下,不用捲(玩家反饋:畫面要乾淨)
  // ---- 打造小遊戲(武器限定):與採集同一套節奏條——完美=精工品,其餘準度退料 ----
  let craftState: { kind: "weapon" | "consumable"; id: string; pos: number; dir: number; timer: number } | null = null;
  let craftResultTimer = 0;
  const craftBarEl = document.createElement("div");
  craftBarEl.className = "gather-bar";
  const craftRow = document.createElement("div");
  craftRow.className = "gather-row";
  const craftCells: HTMLSpanElement[] = [];
  for (let i = 0; i < BAR_LEN; i++) {
    const cell = document.createElement("span");
    craftRow.appendChild(cell);
    craftCells.push(cell);
  }
  const craftStopBtn = document.createElement("button");
  craftStopBtn.className = "btn btn-primary";
  craftStopBtn.textContent = "停!";
  craftStopBtn.addEventListener("click", stopCraftGame);
  const craftResultEl = document.createElement("span");
  craftResultEl.className = "gather-result";
  craftBarEl.append(craftRow, craftStopBtn, craftResultEl);
  craftBarEl.style.visibility = "hidden";
  weaponsEl.parentElement!.insertBefore(craftBarEl, weaponsEl);

  function startCraftGame(kind: "weapon" | "consumable", id: string) {
    if (craftState) return;
    clearTimeout(craftResultTimer);
    craftResultEl.textContent = "";
    craftResultEl.className = "gather-result";
    craftRow.className = "gather-row";
    craftStopBtn.style.display = "";
    craftBarEl.style.visibility = "visible";
    craftState = { kind, id, pos: 0, dir: 1, timer: 0 };
    craftState.timer = window.setInterval(() => {
      const g = craftState!;
      g.pos += g.dir;
      if (g.pos >= BAR_LEN - 1 || g.pos <= 0) g.dir *= -1;
      drawBar(craftCells, g.pos);
    }, 45);
    drawBar(craftCells, craftState.pos);
  }

  function stopCraftGame() {
    if (!craftState) return;
    const { kind, id, pos } = craftState;
    clearInterval(craftState.timer);
    craftState = null;

    const distance = Math.abs(pos - SWEET_CENTER);
    const perfect = distance <= 1;
    // 武器完美=精工品(耐久上限+25%,不退料);其餘準度退料。消耗品完美仍退 20%
    const refundPct = perfect ? (kind === "weapon" ? 0 : 0.2) : distance <= 3 ? 0.1 : distance <= 6 ? 0.05 : 0;
    const ok = kind === "weapon" ? engine.craftWeapon(id, refundPct, perfect) : engine.craftConsumable(id, refundPct);

    drawStopped(craftCells, pos, distance);
    craftStopBtn.style.display = "none";
    const gradeText = perfect ? "完美" : distance <= 3 ? "不錯" : distance <= 6 ? "普通" : "勉強";
    craftResultEl.textContent = ok
      ? perfect && kind === "weapon"
        ? "完美　精工品完成(耐久上限 +25%)"
        : `${gradeText}　完工${refundPct > 0 ? `(省下約 ${Math.round(refundPct * 100)}% 材料)` : ""}`
      : "材料不夠了";
    craftResultEl.className = `gather-result grade-${gradeKey(distance)}`;
    craftRow.className = distance <= 1 ? "gather-row hit-perfect" : distance <= 3 ? "gather-row hit-good" : "gather-row hit-miss";

    craftResultTimer = window.setTimeout(() => {
      craftBarEl.style.visibility = "hidden";
    }, 1400);

    render();
  }

  const weaponRows = WEAPONS.map((weapon) => {
    const row = document.createElement("div");
    row.className = "craft-line";
    row.style.display = "none";

    const name = document.createElement("span");
    name.className = "building-name";
    name.textContent = weapon.label;
    const cost = document.createElement("span");
    cost.className = "building-cost";
    cost.textContent = Object.entries(weapon.cost)
      .map(([id, n]) => `${RESOURCE_LABEL[id as ResourceId]} ${n}`)
      .join("　");
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = "打造";
    btn.addEventListener("click", () => startCraftGame("weapon", weapon.id));
    // 修理鈕:鐵匠鋪蓋好且這把武器受損時才出現
    const repairBtn = document.createElement("button");
    repairBtn.className = "btn";
    repairBtn.style.display = "none";
    repairBtn.addEventListener("click", () => {
      if (repairBtn.dataset.brokenRepair) engine.repairBrokenWeapon(weapon.id);
      else engine.repairWeapon(weapon.id);
      render();
    });

    row.append(name, cost, repairBtn, btn);
    weaponsEl.appendChild(row);
    return { weapon, row, name, cost, btn, repairBtn };
  });

  // 消耗品打造(乾糧/繃帶/弓矢),同樣依「見過材料 + 前置建築/武器」浮現
  const consumableRows = CONSUMABLES.map((def) => {
    const row = document.createElement("div");
    row.className = "craft-line";
    row.style.display = "none";

    const name = document.createElement("span");
    name.className = "building-name";
    name.textContent = def.label;
    const cost = document.createElement("span");
    cost.className = "building-cost";
    cost.textContent =
      Object.entries(def.cost)
        .map(([id, n]) => `${RESOURCE_LABEL[id as ResourceId]} ${n}`)
        .join("　") + ` → x${def.yield}`;
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = "製作";
    // 消耗品直接製作(2026-09 用戶定案:小遊戲留給武器,量產物資不必每次按節奏條)
    btn.addEventListener("click", () => {
      engine.craftConsumable(def.id);
      render();
    });

    row.append(name, cost, btn);
    // 功能備註(2026-09 用戶要求):第二行冷冰冰講它拿來幹嘛
    if (def.note) {
      const note = document.createElement("span");
      note.className = "craft-note";
      note.textContent = `▍${def.note}`;
      row.appendChild(note);
    }
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
    name.textContent = def.label ?? ((def.qty ?? 1) > 1 ? `${RESOURCE_LABEL[def.get!]} ×${def.qty}` : RESOURCE_LABEL[def.get!]);
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
    // 主觀描述與系統效果分行(2026-09 用戶定案):flavor 講氣氛,這一行冷冰冰講數據
    if (def.effect) {
      const sysLine = document.createElement("div");
      sysLine.className = "trade-effect";
      sysLine.textContent = `▍${def.effect}`;
      row.appendChild(sysLine);
    }
    tradesEl.appendChild(row);
    return { def, row, btn };
  });

  // 條件解鎖的建築第一次浮現時,代行者用她的口吻點一句——不是系統教學框,是同伴的建議
  const ADVISOR_BUILDING_HINTS: Record<string, string> = {
    tannery: "她翻著你帶回來的生皮:「這些皮加工之後就能變成堅硬的皮革,做得出很多東西。搭個製革場吧,雖然味道不是很好聞就是了。」她調皮地笑著說道",
    smithy: "她看著你從遺跡帶回的工具,擦了擦上面的鏽:「這些都還能用。搭個工匠鋪,壞掉的東西我能把它修好。」",
    "trading-post": "她掂了掂那顆微溫的晶體:「這種東西……有人會收,而且有時候能交換到一些不可思議的東西。我們蓋個交易的地方讓外面的人可以來交換東西吧。」",
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
      ironFlaskDone: engine.upgrades["iron-flask"] === true,
      steelFlaskDone: engine.upgrades["steel-flask"] === true,
      ironArmorDone: engine.upgrades["iron-armor"] === true,
      steelArmorDone: engine.upgrades["steel-armor"] === true,
      ironCartDone: engine.upgrades["iron-cart"] === true,
      steelCartDone: engine.upgrades["steel-cart"] === true,
    };
    for (const m of MILESTONES) {
      if (!firedMilestones.has(m.id) && m.check(state)) {
        firedMilestones.add(m.id);
        localStorage.setItem("milestones-fired", JSON.stringify([...firedMilestones]));
        for (const line of Array.isArray(m.text) ? m.text : [m.text]) appendLog(line);
      }
    }
  }

  // ---- 她的指路(引導事件):連續 7 趟空手而歸後,回村由她點方向 ----
  // 第一次指最近的資源區塊,之後指最近的未打通探勘點;文本經用戶核可(2026-09)
  let guidanceText: string | null = null;
  let redmoonReminder: string | null = null;

  function dirName(dx: number, dy: number): string {
    // y 向下:東=0°、南=90°;八方位
    const names = ["東", "東南", "南", "西南", "西", "西北", "北", "東北"];
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    return names[Math.round(((ang + 360) % 360) / 45) % 8];
  }

  function nearestResourceDir(): string | null {
    let best: { x: number; y: number; d: number } | null = null;
    const consider = (x: number, y: number, isRes: boolean) => {
      if (!isRes) return;
      const d = Math.hypot(x - 44, y - 27);
      if (d >= 3 && (!best || d < best.d)) best = { x, y, d };
    };
    try {
      const raw = localStorage.getItem("explore-state-v10");
      if (raw) {
        // 已探索過:讀存檔格線($=還沒採走的資源)
        const rows = (JSON.parse(raw).typeRows ?? []) as string[];
        rows.forEach((row, y) => {
          for (let x = 0; x < row.length; x++) consider(x, y, row[x] === "$");
        });
      } else {
        // 一步都還沒踏出去:照固定種子重生成一張看
        generateMap("A").forEach((row, y) => row.forEach((t, x) => consider(x, y, t.type === "resource")));
      }
    } catch {
      return null;
    }
    return best ? dirName(best.x - 44, best.y - 27) : null;
  }

  function nearestSiteDir(): string | null {
    const open = specialSites().filter((st) => (st.mapId ?? "A") === "A" && !siteProgress(st.key).cleared);
    let best: { x: number; y: number; d: number } | null = null;
    for (const st of open) {
      const d = Math.hypot(st.x - 44, st.y - 27);
      if (!best || d < best.d) best = { x: st.x, y: st.y, d };
    }
    return best ? dirName(best.x - 44, best.y - 27) : null;
  }

  function maybeArmGuidance() {
    if (guidanceText || engine.pendingEvent) return;
    if (loadCarried() !== null) return; // 人還在外面:等回村再說
    if (Number(localStorage.getItem("fruitless-expeditions") ?? "0") < 7) return;
    const times = Number(localStorage.getItem("guidance-times") ?? "0");
    const dir = times === 0 ? nearestResourceDir() : (nearestSiteDir() ?? nearestResourceDir());
    if (!dir) return;
    // 單字方位在句子裡讀起來會禿(「北那頭」),補個「邊」;雙字方位(東北)不用
    const dirB = dir.length === 1 ? `${dir}邊` : dir;
    guidanceText =
      times === 0
        ? `她把一杯熱水塞進你手裡,在你對面坐下。「這幾趟……都空著手回來,對吧。」她沒有責備的意思,只是攤開你畫的地圖,手指往${dir}一點。「我記得${dir}邊的林子裡,總能撿到些能用的東西。往那邊走走看吧——注意自己的安全。」`
        : `「還是一無所獲的話……」她猶豫了一下,還是開了口。「獵人們提過,${dirB}那頭有處看起來不太尋常的地方。可能有危險,但……也可能有我們需要的東西。如果要去的話記得裝備要準備萬全。」`;
  }

  function maybeArmRedmoon() {
    // 紅月提醒(2026-09 核可):紅月事件滿三次,出門前她提醒一次
    if (redmoonReminder || guidanceText || engine.pendingEvent) return;
    if (loadCarried() !== null) return;
    if (Number(localStorage.getItem("redmoon-count") ?? "0") < 3) return;
    if (localStorage.getItem("redmoon-reminded")) return;
    redmoonReminder =
      "「連著幾個晚上……月亮的顏色都不對。」她望著天邊,眉頭皺得很深。「獵人說,村外有一塊窪地的草全倒向了中央——像有什麼東西在那裡聚集。如果你要去看的話,千萬要小心。而且我有不好的預感——那東西要是一直放著不管,總有一天會輪到村子。」";
  }

  function render() {
    // 事件用全螢幕遮罩呈現(時間本來就暫停了,讓玩家專心做決定)
    maybeArmGuidance();
    maybeArmRedmoon();
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
    } else if (redmoonReminder) {
      if (shownEventId !== "redmoon") {
        shownEventId = "redmoon";
        overlayTextEl.textContent = redmoonReminder;
        overlayOptionsEl.innerHTML = "";
        const btn = document.createElement("button");
        btn.className = "btn ready";
        btn.textContent = "知道了";
        btn.addEventListener("click", () => {
          localStorage.setItem("redmoon-reminded", "1");
          redmoonReminder = null;
          render();
        });
        overlayOptionsEl.appendChild(btn);
      }
      overlayEl.style.display = "flex";
    } else if (guidanceText) {
      if (shownEventId !== "guidance") {
        shownEventId = "guidance";
        overlayTextEl.textContent = guidanceText;
        overlayOptionsEl.innerHTML = "";
        const btn = document.createElement("button");
        btn.className = "btn ready";
        btn.textContent = "知道了";
        btn.addEventListener("click", () => {
          // 指過路就重新計數;下一輪(又空手 7 趟)改指特殊地點
          localStorage.setItem("fruitless-expeditions", "0");
          localStorage.setItem("guidance-times", String(Number(localStorage.getItem("guidance-times") ?? "0") + 1));
          guidanceText = null;
          render();
        });
        overlayOptionsEl.appendChild(btn);
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

      // 工匠鋪在鐵礦坑解放後可付費升格為鐵匠鋪(同一棟建築,名字與能力演化;2026-09 改為要花材料)
      let label = row.building.label;
      if (row.building.id === "smithy" && engine.isSmithyIronCapable()) label = "鐵匠鋪";
      row.name.textContent = count > 0 ? `${label} ×${count}` : label;
      if (row.building.id === "smithy" && engine.canUpgradeSmithy()) {
        row.cost.textContent = Object.entries(SMITHY_IRON_UPGRADE_COST)
          .map(([id, n]) => `${RESOURCE_LABEL[id as ResourceId]} ${n}`)
          .join("　");
        const affordable = engine.canAfford(SMITHY_IRON_UPGRADE_COST);
        row.btn.disabled = !affordable;
        row.btn.classList.toggle("ready", affordable);
        row.btn.textContent = "升格為鐵匠鋪";
        continue;
      }
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

    for (const [bid, bn] of Object.entries(engine.brokenWeapons)) {
      const bw = WEAPONS.find((w) => w.id === bid);
      if (bw && bn > 0) addArmoryLine(`${bw.label}(損毀)`, `×${bn}`);
    }
    for (const w of WEAPONS.filter((w) => engine.weaponCount(w.id) > 0)) {
      const fineN = engine.fineWeapons[w.id] ?? 0;
      const normalN = engine.weaponCount(w.id) - fineN;
      const dmg = engine.isWeaponDamaged(w.id) ? `(耐 ${engine.weaponDurability[w.id]}/${engine.currentMaxDurability(w.id)})` : "";
      // 精工另立一列;受損標記跟著「使用中那把」= 普通優先(2026-09 修訂)
      if (fineN > 0) addArmoryLine(`精工${w.label}${normalN > 0 ? "" : dmg}`, `×${fineN}`);
      if (normalN > 0) addArmoryLine(`${w.label}${dmg}`, `×${normalN}`);
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

    // 武器打造:見過所有材料的配方才浮現;可重複打造(備用武器在耐久度機制下有意義)
    const craftAvail: Record<CraftTab, boolean> = {
      weapon: weaponRows.some((r) => (r.weapon.lootOnly ? engine.weaponCount(r.weapon.id) > 0 : engine.isWeaponVisible(r.weapon.id))),
      goods: consumableRows.some((r) => engine.isConsumableVisible(r.def.id)),
      upgrade: upgradeRows.some((r) => engine.isUpgradeVisible(r.def.id)),
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
      const brokenN = engine.brokenWeapons[row.weapon.id] ?? 0;
      const visible = row.weapon.lootOnly ? engine.weaponCount(row.weapon.id) > 0 || brokenN > 0 : engine.isWeaponVisible(row.weapon.id);
      row.row.style.display = visible && tab === "weapon" ? "" : "none";
      if (!visible) continue;
      anyCraftVisible = true;

      const count = engine.weaponCount(row.weapon.id);
      const craftable = !row.weapon.lootOnly && engine.canAfford(row.weapon.cost);
      if (row.weapon.lootOnly) {
        row.btn.style.display = "none";
        row.cost.textContent = "";
      }
      // 打造列只標最大耐久(規格);殘耐久是「這一把」的狀態,看整備頁——受損時修理鈕就是訊號
      const fineOwned = engine.fineWeapons[row.weapon.id] ?? 0;
      row.name.textContent = `${count > 0 ? `${row.weapon.label} ×${count}` : row.weapon.label}${fineOwned > 0 ? `(精工 ×${fineOwned})` : ""}(耐久 ${row.weapon.durability})`;
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

      // 損毀的特殊武器:鐵匠鋪(鐵級)修復,費用=cost(鬼雪=異晶 30)
      if (brokenN > 0) {
        const rc = row.weapon.cost;
        const rcText = Object.entries(rc)
          .map(([id, n]) => `${RESOURCE_LABEL[id as ResourceId]}${n}`)
          .join(" ");
        const can = engine.canRepairBroken(row.weapon.id);
        const affordable = can && engine.canAfford(rc);
        row.repairBtn.style.display = "";
        row.repairBtn.textContent = can ? `修復損毀(${rcText})` : `修復損毀(需鐵匠鋪)`;
        row.repairBtn.disabled = !affordable;
        row.repairBtn.classList.toggle("ready", affordable);
        row.repairBtn.dataset.brokenRepair = "1";
      } else {
        delete row.repairBtn.dataset.brokenRepair;
      }

      // 丟棄改到整備頁的倉庫管理(2026-09 用戶反饋:打造列擠爆版面)
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
    // 交易所兌換(獨立主分頁):見過的才上架;獨賣品交易熟了才亮出來
    const tradeOpen = engine.hasBuilding("trading-post");
    for (const row of tradeRows) {
      const visible = tradeOpen && engine.isTradeVisible(row.def.id);
      row.row.style.display = visible ? "" : "none";
      if (!visible) continue;
      const affordable = engine.resources.shard >= row.def.shards;
      row.btn.disabled = !affordable;
      row.btn.classList.toggle("ready", affordable);
    }

    // 投射面板:分頁鈕常駐標題列;遠征佔滿內容區(左欄與投射面板整組隱藏)
    const onExpedition = loadCarried() !== null; // 遠征中=身上有行囊;回村結算後自然解除
    const readyToGo = engine.populationCap >= 20 && engine.hasBuilding("farm");
    const workshopHas = armoryEl.childElementCount > 0 || anyCraftVisible;
    const tabHas: Record<VillageTab, boolean> = {
      jobs: !onExpedition,
      build: !onExpedition,
      workshop: !onExpedition && workshopHas,
      market: !onExpedition && tradeOpen,
      prep: !onExpedition && readyToGo,
      expedition: onExpedition,
      system: true,
    };
    const activeVillageTab: VillageTab = tabHas[villageTab] ? villageTab : onExpedition ? "expedition" : "build";
    for (const { t, b } of villageTabBtns) {
      b.style.display = tabHas[t.id] ? "" : "none";
      b.classList.toggle("ready", t.id === activeVillageTab);
    }
    const isExp = activeVillageTab === "expedition";
    // 遠征中(人不在村裡):左欄資源僅供查看,手動採集收起——不能人在荒野還替村莊砍柴
    manualEl.style.display = onExpedition ? "none" : "";
    const gatherSlotHost = document.querySelector<HTMLDivElement>("#gather-slot");
    if (gatherSlotHost) gatherSlotHost.style.display = onExpedition ? "none" : "";
    mainSplitEl.style.display = isExp ? "none" : "";
    expeditionSectionEl.style.display = isExp ? "" : "none";
    logDockEl.style.display = isExp ? "none" : ""; // 遠征有自己的紀錄,村莊的先收起來
    app.style.maxWidth = isExp ? "1040px" : "";
    jobsSectionEl.style.display = activeVillageTab === "jobs" ? "" : "none";
    buildSectionEl.style.display = activeVillageTab === "build" ? "" : "none";
    armorySection.style.display = activeVillageTab === "workshop" && armoryEl.childElementCount > 0 ? "" : "none";
    craftSectionEl.style.display = activeVillageTab === "workshop" && anyCraftVisible ? "" : "none";
    marketSectionEl.style.display = activeVillageTab === "market" && tradeOpen ? "" : "none";
    prepSectionEl.style.display = activeVillageTab === "prep" ? "" : "none";
    systemSectionEl.style.display = activeVillageTab === "system" ? "" : "none";
    marketShardsEl.textContent = `異晶存量:${Math.floor(engine.resources.shard ?? 0)}`;
    // 掛載放在顯示之後:遠征視圖初始化要量測容器尺寸,容器必須已經可見
    syncMountedView(activeVillageTab);

    // 外出探索的入口只有選單列的「遠征」分頁(人口上限 20+田 解鎖時浮現)——
    // 左欄不再放重複的出門按鈕;條件不寫提示,讓玩家自行摸索
    checkMilestones();
  }

  // 死裡逃生回村:代行者依死因給一句叮囑(輪播,不重複唸同一句)
  const REVIVAL_TIPS: Record<string, string[]> = {
    thirst: [
      "她把裝滿的水囊放在你手邊:「記得要隨時注意自己的身體狀況補充水份喔。」",
      "「記住曾經去過的補給點。或許在回程的時候可以去那邊補給一些水和糧食。」她說完,替你掖了掖毯子。",
    ],
    hunger: [
      "她把一小塊肉乾塞進你手裡:「肚子餓了吧,沒有食物的話就不要再繼續勉強啦。」",
      "「別把肉乾當存糧吃光——在外面,那是你最後的生命線了。」她的聲音很輕,但能感受得出裡面暗藏的擔心。",
    ],
    combat: [
      "她替你把繃帶收緊:「撐不住的話就先暫時避開那些危險的地方。」",
      "「打不過的東西,就繞開牠。或許可以在其他地方找到能夠致勝的關鍵。」",
      "「多帶一把備用的武器。武器壞了的話就沒辦法作戰了。」",
    ],
  };
  function processDeathCause() {
    const deathCause = localStorage.getItem("death-cause");
    if (!deathCause) return;
    localStorage.removeItem("death-cause");
    localStorage.removeItem("explore-log-v2"); // 遠征以倒下告終(含戰鬥頁戰死):清掉這一趟的遠征紀錄
    localStorage.setItem("died-once", "1"); // 她看過你被抬回來的樣子——之後的道別會不一樣
    const tips = REVIVAL_TIPS[deathCause] ?? REVIVAL_TIPS.combat;
    const idxKey = `revival-tip-${deathCause}`;
    const idx = Number(localStorage.getItem(idxKey) ?? "0");
    appendLog("你在營地的火堆旁醒來。身上帶出去的東西,一樣也沒能回來。");
    appendLog(tips[idx % tips.length]);
    localStorage.setItem(idxKey, String((idx + 1) % tips.length));
  }
  processDeathCause();

  /** 遠征歸來(走回村口/倒下):行囊歸還入庫、活引擎重讀存檔、死因叮囑 */
  function handleReturnHome() {
    returnCarriedToVillage();
    engine.reloadState();
    localStorage.removeItem("explore-log-v2"); // 回村=這趟遠征結束,清掉當次遠征紀錄(村莊紀錄照舊保留)
    processDeathCause();
  }

  engine.start();
  // 戰鬥頁打完回來(?view=expedition),或遠征進行中重新整理:直接接回遠征視圖
  if (loadCarried() !== null && (new URLSearchParams(location.search).get("view") === "expedition" || localStorage.getItem("village-tab") === "expedition")) {
    villageTab = "expedition";
  }
  render();
  // 冷卻倒數需要每秒更新顯示,不能只靠 10 秒一次的生產週期
  setInterval(render, 500);

  // 防掛機(2026-09 用戶定案):閒置 10 分鐘強制觸發打盹事件——
  // 事件卡著=生產迴圈暫停,掛機放置不會白撿資源;任何點擊/按鍵/滾輪都算「有人在」
  const IDLE_LIMIT_MS = 10 * 60 * 1000;
  let lastActivity = performance.now();
  for (const evName of ["pointerdown", "keydown", "wheel"]) {
    window.addEventListener(evName, () => (lastActivity = performance.now()), { capture: true, passive: true });
  }
  setInterval(() => {
    if (performance.now() - lastActivity >= IDLE_LIMIT_MS) {
      engine.forceIdleEvent();
      lastActivity = performance.now(); // 觸發後重計:事件卡著期間本來就暫停,不必重複疊
    }
  }, 30_000);

  (window as unknown as { __village: typeof engine }).__village = engine;
}
