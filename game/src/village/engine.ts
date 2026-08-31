import { BUILDINGS, CONSUMABLES, HUT_CAP_BONUS, JOBS, TRADES, UPGRADES, WEAPONS, repairCost, isIronTierWeapon } from "./data";
import { EVENTS, FOLLOWUP_POOLS, type VillageEvent } from "./events-data";
import { clearedSiteCount } from "../explore/sites";
import { RESOURCE_LABEL, type ResourceId } from "./types";

export const TICK_MS = 10000; // 每個生產週期的真實時間長度
export const GATHER_COOLDOWN_MS = 10000; // 手動採集的冷卻時間,與生產週期一致
/** 每隔幾個生產週期補充一位村民(6 × 10 秒 = 60 秒)——
 * 20 秒/人時 15 分鐘就滿編、產能瞬間起飛,中期完全沒有「村子慢慢長大」的過程;
 * 60 秒/人讓人力本身成為前中期最重要的成長軸(2026-08 全流程模擬校準) */
const GROWTH_CHECK_EVERY = 6;
const EVENT_CHANCE_PER_TICK = 0.15;
/** 兩個事件之間至少隔幾個生產週期(12 × 10 秒 = 2 分鐘)——事件是節奏的標點,不是連環轟炸 */
const EVENT_COOLDOWN_TICKS = 12;
/** 手動採集可取得的資源種類(實際收穫量由採集小遊戲的準度決定,見 gatherResult) */
export const GATHERABLE: ResourceId[] = ["wood", "stone"];

export interface VillageCallbacks {
  onLog: (text: string) => void;
  onTick: () => void;
}

export class VillageEngine {
  resources: Record<ResourceId, number> = {
    wood: 0,
    stone: 0,
    hide: 0,
    leather: 0,
    meat: 0,
    grain: 0,
    water: 0,
    ration: 0,
    jerky: 0,
    bandage: 0,
    arrow: 0,
    iron: 0,
    scroll: 0,
    shard: 0,
    oil: 0,
    elixir: 0,
  };
  /** 每種建築已建成的數量(可重複建造的如小木屋會 >1) */
  buildingCounts: Record<string, number> = {};
  population = 2;
  /** 開局只有一堆火,沒有任何住所,所以上限剛好等於現有人數——要蓋出小木屋才有成長空間 */
  populationCap = 2;
  /** 每個工作目前指派的人數 */
  assignments: Record<string, number> = {};
  /** 目前等待玩家回應的選擇型事件,同時只會有一個,避免疊加太多決策 */
  pendingEvent: VillageEvent | null = null;
  /** 人口自然成長觸發過幾次,UI 用來判斷「第一次成長」的敘事時機(village/narrative.ts) */
  growthEventCount = 0;
  /** 曾經持有過的資源種類——武器配方要等玩家「見過」所有材料後才浮現(不寫解鎖提示,讓玩家自行摸索) */
  seenResources = new Set<ResourceId>();
  /** 已打造的武器數量(可重複打造,備用武器帶出門才有意義) */
  ownedWeapons: Record<string, number> = {};
  /** 一次性裝備升級(如大水袋) */
  upgrades: Record<string, boolean> = {};
  /** 稀有訪客交換來的永久被動(潛行/機巧/祝禱) */
  perks: Record<string, boolean> = {};
  /** 排程中的延遲後續事件(流浪者報恩/引來土匪) */
  scheduledFollowUps: { atTick: number; pool: string }[] = [];
  /** 上一個事件發生在第幾個週期(事件間隔冷卻用) */
  lastEventTick = 0;
  /** 受損武器的剩餘耐久(遠征帶回後持續保留;鐵匠鋪可修理回滿) */
  weaponDurability: Record<string, number> = {};
  private tickCount = 0;
  private timer = 0;

  constructor(private readonly cb: VillageCallbacks) {
    for (const job of JOBS) this.assignments[job.id] = 0;
    this.loadState();
  }

  /** 村莊狀態存進 localStorage,讓整備頁/跨頁重載都讀得到同一份庫存 */
  saveState() {
    localStorage.setItem(
      "village-state",
      JSON.stringify({
        resources: this.resources,
        buildingCounts: this.buildingCounts,
        population: this.population,
        populationCap: this.populationCap,
        assignments: this.assignments,
        growthEventCount: this.growthEventCount,
        seenResources: [...this.seenResources],
        ownedWeapons: this.ownedWeapons,
        upgrades: this.upgrades,
        perks: this.perks,
        scheduledFollowUps: this.scheduledFollowUps,
        lastEventTick: this.lastEventTick,
        weaponDurability: this.weaponDurability,
        tickCount: this.tickCount,
      }),
    );
  }

  private loadState() {
    try {
      const raw = localStorage.getItem("village-state");
      if (!raw) return;
      const s = JSON.parse(raw);
      Object.assign(this.resources, s.resources ?? {});
      this.buildingCounts = s.buildingCounts ?? {};
      this.population = s.population ?? this.population;
      this.populationCap = s.populationCap ?? this.populationCap;
      Object.assign(this.assignments, s.assignments ?? {});
      this.growthEventCount = s.growthEventCount ?? 0;
      for (const id of s.seenResources ?? []) this.seenResources.add(id as ResourceId);
      this.ownedWeapons = s.ownedWeapons ?? {};
      this.upgrades = s.upgrades ?? {};
      this.perks = s.perks ?? {};
      this.scheduledFollowUps = s.scheduledFollowUps ?? [];
      this.lastEventTick = s.lastEventTick ?? 0;
      this.weaponDurability = s.weaponDurability ?? {};
      this.tickCount = s.tickCount ?? 0;
    } catch {
      /* 壞資料直接忽略,當作全新開局 */
    }
  }

  get idlePopulation(): number {
    const assigned = Object.values(this.assignments).reduce((a, b) => a + b, 0);
    return this.population - assigned;
  }

  hasBuilding(buildingId: string): boolean {
    return (this.buildingCounts[buildingId] ?? 0) > 0;
  }

  /** 把目前持有量 > 0 的資源記進「見過」清單(武器配方浮現的依據) */
  private syncSeenResources() {
    for (const [id, amount] of Object.entries(this.resources)) {
      if (amount > 0) this.seenResources.add(id as ResourceId);
    }
  }

  weaponCount(weaponId: string): number {
    return this.ownedWeapons[weaponId] ?? 0;
  }

  /** 配方浮現條件:所有材料種類都「見過」(不必當下湊齊數量,湊數量是建造按鈕能不能按的事) */
  isWeaponVisible(weaponId: string): boolean {
    const weapon = WEAPONS.find((w) => w.id === weaponId);
    if (!weapon) return false;
    if (this.weaponCount(weaponId) > 0) return true;
    return Object.keys(weapon.cost).every((id) => this.seenResources.has(id as ResourceId));
  }

  /** 武器可重複打造,備用武器在耐久度機制下有實際意義 */
  craftWeapon(weaponId: string) {
    const weapon = WEAPONS.find((w) => w.id === weaponId);
    if (!weapon || weapon.lootOnly || !this.canAfford(weapon.cost)) return;

    for (const [id, amount] of Object.entries(weapon.cost)) {
      this.resources[id as ResourceId] -= amount ?? 0;
    }
    this.ownedWeapons[weaponId] = (this.ownedWeapons[weaponId] ?? 0) + 1;
    this.saveState();
    this.cb.onLog(`打造了「${weapon.label}」。`);
  }

  /** 消耗品打造(乾糧/繃帶/弓矢),成品直接進資源庫存 */
  isConsumableVisible(consumableId: string): boolean {
    const def = CONSUMABLES.find((c) => c.id === consumableId);
    if (!def) return false;
    if (def.requiresBuilding && !this.hasBuilding(def.requiresBuilding)) return false;
    if (def.requiresWeapon && this.weaponCount(def.requiresWeapon) <= 0) return false;
    return Object.keys(def.cost).every((id) => this.seenResources.has(id as ResourceId));
  }

  /** 這把武器是否受損(遠征帶回的剩餘耐久 < 全滿) */
  isWeaponDamaged(weaponId: string): boolean {
    const weapon = WEAPONS.find((w) => w.id === weaponId);
    if (!weapon) return false;
    const dur = this.weaponDurability[weaponId];
    return dur !== undefined && dur < weapon.durability;
  }

  /** 鐵礦坑解放後,工匠鋪升格為鐵匠鋪(才能處理鐵製以上的武器) */
  isSmithyIronCapable(): boolean {
    try {
      const cleared = JSON.parse(localStorage.getItem("landmarks-cleared") ?? "[]") as string[];
      return cleared.includes("mine");
    } catch {
      return false;
    }
  }

  /** 這把武器目前修得了嗎(工匠鋪修木石皮革類;鐵製以上要等升格為鐵匠鋪) */
  canRepairWeapon(weaponId: string): boolean {
    if (!this.hasBuilding("smithy") || !this.isWeaponDamaged(weaponId)) return false;
    if (isIronTierWeapon(weaponId) && !this.isSmithyIronCapable()) return false;
    return true;
  }

  /** 修理受損武器:成本為打造成本的一半,耐久回滿 */
  repairWeapon(weaponId: string) {
    if (!this.canRepairWeapon(weaponId)) return;
    const cost = repairCost(weaponId);
    if (!this.canAfford(cost)) return;

    for (const [id, amount] of Object.entries(cost)) {
      this.resources[id as ResourceId] -= amount ?? 0;
    }
    delete this.weaponDurability[weaponId];
    this.saveState();
    const weapon = WEAPONS.find((w) => w.id === weaponId);
    this.cb.onLog(`修理好了「${weapon?.label ?? weaponId}」。`);
  }

  isUpgradeVisible(upgradeId: string): boolean {
    const def = UPGRADES.find((u) => u.id === upgradeId);
    if (!def) return false;
    if (this.upgrades[upgradeId]) return true;
    if (def.requiresBuilding && !this.hasBuilding(def.requiresBuilding)) return false;
    return Object.keys(def.cost).every((id) => this.seenResources.has(id as ResourceId));
  }

  craftUpgrade(upgradeId: string) {
    const def = UPGRADES.find((u) => u.id === upgradeId);
    if (!def || this.upgrades[upgradeId] || !this.isUpgradeVisible(upgradeId) || !this.canAfford(def.cost)) return;

    for (const [id, amount] of Object.entries(def.cost)) {
      this.resources[id as ResourceId] -= amount ?? 0;
    }
    this.upgrades[upgradeId] = true;
    this.saveState();
    this.cb.onLog(`製作了「${def.label}」。`);
  }

  /** 交易所兌換:異晶 → 稀有物資 */
  trade(tradeId: string) {
    const def = TRADES.find((t) => t.id === tradeId);
    if (!def || !this.hasBuilding("trading-post") || this.resources.shard < def.shards) return;
    this.resources.shard -= def.shards;
    this.resources[def.get] += def.qty;
    this.syncSeenResources();
    this.saveState();
    this.cb.onLog(`用 ${def.shards} 顆異晶換得了「${RESOURCE_LABEL[def.get]}」。`);
  }

  craftConsumable(consumableId: string) {
    const def = CONSUMABLES.find((c) => c.id === consumableId);
    if (!def || !this.isConsumableVisible(consumableId) || !this.canAfford(def.cost)) return;

    for (const [id, amount] of Object.entries(def.cost)) {
      this.resources[id as ResourceId] -= amount ?? 0;
    }
    this.resources[def.id] += def.yield;
    this.syncSeenResources();
    this.saveState();
    this.cb.onLog(`製作了「${def.label}」x${def.yield}。`);
  }

  isJobUnlocked(jobId: string): boolean {
    const job = JOBS.find((j) => j.id === jobId)!;
    if (job.requiresBuilding && !this.hasBuilding(job.requiresBuilding)) return false;
    if (job.requiresLandmark) {
      try {
        const cleared = JSON.parse(localStorage.getItem("landmarks-cleared") ?? "[]") as string[];
        if (!cleared.includes(job.requiresLandmark)) return false;
      } catch {
        return false;
      }
    }
    return true;
  }

  /** 可重複建造的建築,成本隨已建數量遞增 */
  costOf(buildingId: string): Partial<Record<ResourceId, number>> {
    const building = BUILDINGS.find((b) => b.id === buildingId);
    if (!building) return {};
    const built = this.buildingCounts[buildingId] ?? 0;
    let multiplier = Math.pow(building.costGrowth ?? 1, built);
    // 級距跳升:每蓋滿 tierEvery 棟,成本額外再乘一次 tierGrowth
    if (building.tierEvery && building.tierGrowth) {
      multiplier *= Math.pow(building.tierGrowth, Math.floor(built / building.tierEvery));
    }
    const scaled: Partial<Record<ResourceId, number>> = {};
    for (const [id, amount] of Object.entries(building.cost)) {
      scaled[id as ResourceId] = Math.round((amount ?? 0) * multiplier);
    }
    return scaled;
  }

  canBuild(buildingId: string): boolean {
    const building = BUILDINGS.find((b) => b.id === buildingId);
    if (!building) return false;
    if (!building.repeatable && this.hasBuilding(buildingId)) return false;
    return this.canAfford(this.costOf(buildingId));
  }

  assign(jobId: string, delta: number) {
    const current = this.assignments[jobId] ?? 0;
    if (delta > 0 && this.idlePopulation <= 0) return;
    if (delta < 0 && current <= 0) return;
    this.assignments[jobId] = current + delta;
  }

  /** 採集冷卻結束的時間戳(0 = 可立即採集) */
  gatherReadyAt = 0;

  /** 連續「完美」採集的連擊數(手感獎勵:認真玩節奏條的人效率明顯高於隨手按) */
  gatherStreak = 0;

  /** 目前可手動採集的資源:木石隨時可採;打造出獵弓後開放狩獵(生肉/生皮) */
  availableGathers(): ResourceId[] {
    const list: ResourceId[] = ["wood", "stone"];
    if (this.weaponCount("hunting-bow") > 0) list.push("meat", "hide");
    return list;
  }

  get gatherCooldownLeft(): number {
    return Math.max(0, this.gatherReadyAt - Date.now());
  }

  get canGather(): boolean {
    return this.gatherCooldownLeft <= 0;
  }

  /**
   * 手動採集的結算:accuracy 是採集小遊戲的準度(0~1,1 = 正中甜蜜點)。
   * 不再是「按一下必得固定數量」,而是要玩一次節奏條決定收穫多寡。
   * - 收穫量隨小木屋數量放大(×(1+間數)):村子越大,跟著你出去搬的人手越多
   * - 連續「完美」疊連擊(每層 +15%,最高 5 層 ×1.75):認真玩節奏條的效率明顯高於隨手按,
   *   這是「手動遊玩效益」的主要放大器——掛機靠職業產線,盯著玩的人進度快得多
   * - 狩獵(生肉/生皮)基礎量較低:它直接餵肉乾/皮革這兩條中後期瓶頸產線,量要收著給
   */
  gatherResult(resourceId: ResourceId, accuracy: number): { amount: number; grade: string; streak: number } {
    if (!this.canGather) return { amount: 0, grade: "", streak: this.gatherStreak };

    const isHunt = resourceId === "meat" || resourceId === "hide";
    let base: number;
    let grade: string;
    if (accuracy >= 0.9) {
      base = isHunt ? 3 : 5;
      grade = "完美";
    } else if (accuracy >= 0.65) {
      base = isHunt ? 2 : 3;
      grade = "不錯";
    } else if (accuracy >= 0.35) {
      base = isHunt ? 1 : 2;
      grade = "普通";
    } else {
      base = 1;
      grade = "勉強";
    }
    const streakMult = 1 + 0.15 * this.gatherStreak;
    const perkMult = this.perks.machinist ? 1.25 : 1; // 【機巧】:鐵皮旅人改造過的工具
    const amount = Math.round(base * (1 + (this.buildingCounts["hut"] ?? 0)) * streakMult * perkMult);
    this.gatherStreak = accuracy >= 0.9 ? Math.min(5, this.gatherStreak + 1) : 0;

    this.resources[resourceId] += amount;
    this.syncSeenResources();
    this.saveState();
    this.gatherReadyAt = Date.now() + GATHER_COOLDOWN_MS / this.speedMult;
    return { amount, grade, streak: this.gatherStreak };
  }

  /**
   * 這個事件選項付不付得起:所有負值效果(要消耗的東西)都要有足額庫存。
   * 沒有繃帶就不能選「收治他(繃帶 -1)」——消耗型選項必須檢查持有量。
   */
  canAffordEventOption(option: { effect: Partial<Record<ResourceId, number>>; passiveLoss?: boolean }): boolean {
    if (option.passiveLoss) return true; // 承受損失型(如「隨牠們去」):不是付錢,是挨打——永遠可選,扣到歸零為止
    return Object.entries(option.effect).every(([id, amount]) => (amount ?? 0) >= 0 || this.resources[id as ResourceId] >= -(amount ?? 0));
  }

  /**
   * 套用事件效果並回傳「實際增減」的摘要文字(如「生肉 -4、人口 +1」)。
   * 以套用前後的差值計算——庫存不足被切到 0 時,顯示的就是真正損失的量,不是帳面數字
   */
  private applyEventEffect(
    effect: Partial<Record<ResourceId, number>>,
    populationDelta?: number,
    effectPct?: Partial<Record<ResourceId, number>>,
  ): string {
    const parts: string[] = [];
    for (const [id, amount] of Object.entries(effect)) {
      const before = this.resources[id as ResourceId];
      this.resources[id as ResourceId] = Math.max(0, before + (amount ?? 0));
      const actual = this.resources[id as ResourceId] - before;
      if (actual !== 0) parts.push(`${RESOURCE_LABEL[id as ResourceId]} ${actual > 0 ? "+" : ""}${actual}`);
    }
    // 比例扣除:嚴重事件按庫存百分比扣(顯示的是實際扣掉的量)
    for (const [id, pct] of Object.entries(effectPct ?? {})) {
      const before = this.resources[id as ResourceId];
      const loss = Math.floor(before * (pct ?? 0));
      if (loss > 0) {
        this.resources[id as ResourceId] = before - loss;
        parts.push(`${RESOURCE_LABEL[id as ResourceId]} -${loss}`);
      }
    }
    if (populationDelta) {
      const before = this.population;
      this.population = Math.max(0, Math.min(this.populationCap, this.population + populationDelta));
      const actual = this.population - before;
      if (actual !== 0) parts.push(`人口 ${actual > 0 ? "+" : ""}${actual}`);
    }
    return parts.join("、");
  }

  /** 到期的延遲後續事件:開獎(報恩/土匪/什麼也沒發生)。回傳是否真的開出了事件 */
  private fireDueFollowUp(): boolean {
    if (this.pendingEvent) return false;
    const idx = this.scheduledFollowUps.findIndex((f) => f.atTick <= this.tickCount);
    if (idx === -1) return false;
    const [due] = this.scheduledFollowUps.splice(idx, 1);
    const pool = FOLLOWUP_POOLS[due.pool] ?? [];
    const total = pool.reduce((sum, o) => sum + o.weight, 0);
    let roll = Math.random() * total;
    let outcomeId: string | null = null;
    for (const o of pool) {
      roll -= o.weight;
      if (roll <= 0) {
        outcomeId = o.id;
        break;
      }
    }
    if (!outcomeId) return false; // 什麼也沒發生——善意石沉大海

    const event = EVENTS.find((e) => e.id === outcomeId);
    if (!event) return false;
    this.lastEventTick = this.tickCount;
    if (event.kind === "passive") {
      const summary = this.applyEventEffect(event.effect, event.populationDelta, event.effectPct);
      this.cb.onLog(summary ? `${event.text}(${summary})` : event.text);
    } else {
      this.pendingEvent = event;
    }
    return true;
  }

  /** 玩家對選擇型事件做出回應 */
  resolveEvent(optionIndex: number) {
    if (!this.pendingEvent || this.pendingEvent.kind !== "choice") return;
    const option = this.pendingEvent.options[optionIndex];
    if (!option || !this.canAffordEventOption(option)) return;

    // 機率結局(如「拿起武器抵抗」的勝敗):加權開獎,套用抽中的那個結果
    let effect = option.effect;
    let effectPct = option.effectPct;
    let populationDelta = option.populationDelta;
    let resultText = option.resultText;
    if (option.outcomes && option.outcomes.length > 0) {
      const total = option.outcomes.reduce((sum, o) => sum + o.weight, 0);
      let roll = Math.random() * total;
      let picked = option.outcomes[option.outcomes.length - 1];
      for (const o of option.outcomes) {
        roll -= o.weight;
        if (roll <= 0) {
          picked = o;
          break;
        }
      }
      effect = picked.effect;
      effectPct = picked.effectPct;
      populationDelta = picked.populationDelta;
      resultText = picked.resultText;
    }

    const summary = this.applyEventEffect(effect, populationDelta, effectPct);
    if (option.grantPerk) this.perks[option.grantPerk] = true;
    if (option.followUp) {
      // 幾分鐘後開獎的賭注:排進延遲後續佇列
      const delay = option.followUp.delayMin + Math.floor(Math.random() * (option.followUp.delayMax - option.followUp.delayMin + 1));
      this.scheduledFollowUps.push({ atTick: this.tickCount + delay, pool: option.followUp.pool });
    }
    this.cb.onLog(summary ? `${resultText}(${summary})` : resultText);
    this.pendingEvent = null;
    this.syncSeenResources();
    this.saveState();
  }

  canAfford(cost: Partial<Record<ResourceId, number>>): boolean {
    return Object.entries(cost).every(([id, amount]) => this.resources[id as ResourceId] >= (amount ?? 0));
  }

  build(buildingId: string) {
    const building = BUILDINGS.find((b) => b.id === buildingId);
    if (!building || !this.canBuild(buildingId)) return;

    const cost = this.costOf(buildingId);
    for (const [id, amount] of Object.entries(cost)) {
      this.resources[id as ResourceId] -= amount ?? 0;
    }
    this.buildingCounts[buildingId] = (this.buildingCounts[buildingId] ?? 0) + 1;
    if (buildingId === "hut") this.populationCap += HUT_CAP_BONUS;
    this.saveState();
    this.cb.onLog(`建成了「${building.label}」。`);
  }

  /** 時間倍速(測試用,由 ?dev 的加速按鈕切換):生產週期與採集冷卻同步加速 */
  speedMult = 1;

  start() {
    this.timer = window.setInterval(() => this.tick(), TICK_MS / this.speedMult);
  }

  stop() {
    clearInterval(this.timer);
  }

  /** 切換時間倍速並重排計時器 */
  setSpeed(mult: number) {
    this.speedMult = mult;
    this.stop();
    this.start();
  }

  private tick() {
    // 有選擇型事件卡著時,整個生產迴圈暫停等玩家回應——
    // 不這樣做的話,事件會變成純裝飾,玩家可以放著不管照樣掛機生產(呼應 §2.6 戰鬥系統的 Wait 模式精神)
    if (this.pendingEvent) {
      this.cb.onTick();
      return;
    }

    this.tickCount++;

    for (const job of JOBS) {
      const workers = this.assignments[job.id] ?? 0;
      if (workers <= 0) continue;

      // 加工型工作(produces 有負值)逐位工人結算:原料不足的工人當輪不生產,不會把庫存扣成負的
      const consumes = Object.entries(job.produces).filter(([, n]) => (n ?? 0) < 0);
      // 鐵道通車後,台車把礦石直接運回村莊——鐵礦工的「產出」翻倍(消耗不變)
      const railwayBoost = job.id === "miner" && this.hasBuilding("railway") ? 2 : 1;
      for (let w = 0; w < workers; w++) {
        const canWork = consumes.every(([id, n]) => this.resources[id as ResourceId] >= -(n ?? 0));
        if (!canWork) break;
        for (const [id, amount] of Object.entries(job.produces)) {
          const n = amount ?? 0;
          this.resources[id as ResourceId] += n > 0 ? n * railwayBoost : n;
        }
      }
    }

    // Lv2 資源開放地點:每打通一處,村莊每週期多一份被動回收(design-notes.md § 3.10.1;之後鐵路開過去可再強化)
    const lv2 = clearedSiteCount(2);
    if (lv2 > 0) {
      this.resources.wood += 2 * lv2;
      this.resources.stone += 1 * lv2;
    }

    if (this.tickCount % GROWTH_CHECK_EVERY === 0) {
      this.checkPopulationGrowth();
    }

    if (!this.fireDueFollowUp()) this.rollRandomEvent();

    this.syncSeenResources();
    this.saveState();
    this.cb.onTick();
  }

  private rollRandomEvent() {
    if (this.pendingEvent) return; // 同時只處理一個事件,避免疊加太多決策
    if (this.tickCount - this.lastEventTick < EVENT_COOLDOWN_TICKS) return; // 事件間隔冷卻
    if (Math.random() >= EVENT_CHANCE_PER_TICK) return;

    // 只從「目前這個進度已經解鎖」且「情境上成立」的事件裡抽
    // (design-notes.md § 1.2 主線進度軟性偏移)——
    // 情境包含庫存/職業/建築:沒派獵人不會「狩獵滿載」,沒有田不會「穀物豐收」
    const ctx = {
      population: this.population,
      populationCap: this.populationCap,
      resources: this.resources,
      assignments: this.assignments,
      hasBuilding: (id: string) => this.hasBuilding(id),
      perks: this.perks,
    };
    const eligible = EVENTS.filter(
      (e) => !e.followUpOnly && (e.minTick ?? 0) <= this.tickCount && (!e.condition || e.condition(ctx)),
    );
    if (eligible.length === 0) return;

    // 加權抽選:稀有訪客(weight 0.06)要碰上很多次事件才會出現一次
    const totalWeight = eligible.reduce((sum, e) => sum + (e.weight ?? 1), 0);
    let roll = Math.random() * totalWeight;
    let event: VillageEvent = eligible[eligible.length - 1];
    for (const e of eligible) {
      roll -= e.weight ?? 1;
      if (roll <= 0) {
        event = e;
        break;
      }
    }
    this.lastEventTick = this.tickCount;
    if (event.kind === "passive") {
      const summary = this.applyEventEffect(event.effect, event.populationDelta, event.effectPct);
      this.cb.onLog(summary ? `${event.text}(${summary})` : event.text);
    } else {
      this.pendingEvent = event; // 選擇型事件:暫停在這裡等玩家回應,不自動套用效果
    }
  }

  private checkPopulationGrowth() {
    // 只要還有空房,每 20 秒就會有一位新居民抵達;住所蓋得越多,人口成長的空間就越大
    if (this.population >= this.populationCap) return;
    this.population++;
    this.growthEventCount++;
    this.cb.onLog("村莊多了一位新的居民。");
  }
}
