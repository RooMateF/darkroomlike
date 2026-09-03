import { BUILDINGS, CONSUMABLES, HUT_CAP_BONUS, JOBS, TRADES, UPGRADES, WEAPONS, repairCost, brokenRepairCost, isIronTierWeapon , PERK_SLOTS , fineMaxDurability, SMITHY_IRON_UPGRADE_COST, BARTER_RATE, BARTER_RAW, POP_CAP_BASE, POP_CAP_PER_MAP } from "./data";
import { EVENTS, FOLLOWUP_POOLS, type VillageEvent, type PassiveEvent } from "./events-data";
import { clearedSiteCount } from "../explore/sites";
import { RESOURCE_LABEL, type ResourceId } from "./types";

export const TICK_MS = 10000; // 每個生產週期的真實時間長度
export const GATHER_COOLDOWN_MS = 10000; // 手動採集的冷卻時間,與生產週期一致
/** 村民抵達的節奏:計量器每週期 +GROWTH_SPEED,滿 GROWTH_CHECK_EVERY 來一位。
 * 基準 60 秒/人(20 秒/人時 15 分鐘就滿編,沒有「村子慢慢長大」的過程);
 * 2026-08 依用戶要求加快 30%:1.3/tick → 約 46 秒/人 */
const GROWTH_CHECK_EVERY = 6;
const GROWTH_SPEED = 1.3;
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
    ingot: 0,
    coal: 0,
    steel: 0,
    bullet: 0,
    rail: 0,
    salt: 0,
    scroll: 0,
    shard: 0,
    oil: 0,
    bigshard: 0,
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
  /** 村民抵達計量器(每週期 +GROWTH_SPEED,滿 GROWTH_CHECK_EVERY 觸發) */
  private growthMeter = 0;
  /** 曾經持有過的資源種類——武器配方要等玩家「見過」所有材料後才浮現(不寫解鎖提示,讓玩家自行摸索) */
  seenResources = new Set<ResourceId>();
  /** 已打造的武器數量(可重複打造,備用武器帶出門才有意義) */
  ownedWeapons: Record<string, number> = {};
  /** 一次性裝備升級(如大水袋) */
  upgrades: Record<string, boolean> = {};
  /** 稀有訪客交換來的永久被動(潛行/機巧/祝禱)——「擁有」不等於「生效」 */
  perks: Record<string, boolean> = {};
  /** 目前裝備中的被動(上限 PERK_SLOTS 格):只有裝上的才生效,出門前要按 Boss 換裝 */
  equippedPerks: string[] = [];
  /** 排程中的延遲後續事件(流浪者報恩/引來土匪) */
  scheduledFollowUps: { atTick: number; pool: string }[] = [];
  /** 上一個事件發生在第幾個週期(事件間隔冷卻用) */
  lastEventTick = 0;
  /** 受損武器的剩餘耐久(遠征帶回後持續保留;鐵匠鋪可修理回滿) */
  weaponDurability: Record<string, number> = {};
  /** 精工品數量(是 ownedWeapons 的子集):打造完美的產物,耐久上限 +25%,永遠優先上手 */
  fineWeapons: Record<string, number> = {};
  /** 永久改造(改造藥劑,喝了就是永久;不占被動裝備欄):如 crisis-awareness 危機意識 */
  modifications: Record<string, boolean> = {};
  /** 損毀的特殊武器(鬼雪等):鐵匠鋪用異晶修復(cost 即修復費) */
  brokenWeapons: Record<string, number> = {};
  /** 累積交易次數(交易所獨賣品的熟客解鎖依據) */
  tradeCount = 0;
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
        growthMeter: this.growthMeter,
        seenResources: [...this.seenResources],
        ownedWeapons: this.ownedWeapons,
        fineWeapons: this.fineWeapons,
        brokenWeapons: this.brokenWeapons,
        modifications: this.modifications,
        upgrades: this.upgrades,
        perks: this.perks,
        equippedPerks: this.equippedPerks,
        scheduledFollowUps: this.scheduledFollowUps,
        lastEventTick: this.lastEventTick,
        weaponDurability: this.weaponDurability,
        tradeCount: this.tradeCount,
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
      this.growthMeter = s.growthMeter ?? 0;
      for (const id of s.seenResources ?? []) this.seenResources.add(id as ResourceId);
      this.ownedWeapons = s.ownedWeapons ?? {};
      this.fineWeapons = s.fineWeapons ?? {};
      this.brokenWeapons = s.brokenWeapons ?? {};
      this.modifications = s.modifications ?? {};
      this.upgrades = s.upgrades ?? {};
      this.perks = s.perks ?? {};
      // 舊存檔遷移:沒有裝備欄資料時,把已擁有的被動依序裝上(維持原「全部生效」的體感)
      this.equippedPerks = s.equippedPerks ?? Object.keys(this.perks).filter((k) => this.perks[k]).slice(0, PERK_SLOTS);
      this.scheduledFollowUps = s.scheduledFollowUps ?? [];
      this.lastEventTick = s.lastEventTick ?? 0;
      this.weaponDurability = s.weaponDurability ?? {};
      this.tradeCount = s.tradeCount ?? 0;
      this.tickCount = s.tickCount ?? 0;
    } catch {
      /* 壞資料直接忽略,當作全新開局 */
    }
  }

  /** 裝上/卸下被動:回傳是否成功(格子滿了裝不上) */
  togglePerk(id: string): boolean {
    const at = this.equippedPerks.indexOf(id);
    if (at >= 0) {
      this.equippedPerks.splice(at, 1);
      this.saveState();
      return true;
    }
    if (!this.perks[id]) return false;
    if (this.equippedPerks.length >= PERK_SLOTS) return false;
    this.equippedPerks.push(id);
    this.saveState();
    return true;
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
  /** 打造武器:refundPct 是準度退料;fine=true(完美)產出精工品(耐久上限 +25%) */
  craftWeapon(weaponId: string, refundPct = 0, fine = false): boolean {
    const weapon = WEAPONS.find((w) => w.id === weaponId);
    if (!weapon || weapon.lootOnly || !this.canAfford(weapon.cost)) return false;

    const saved: string[] = [];
    for (const [id, amount] of Object.entries(weapon.cost)) {
      const back = Math.round((amount ?? 0) * refundPct);
      this.resources[id as ResourceId] -= (amount ?? 0) - back;
      if (back > 0) saved.push(`${RESOURCE_LABEL[id as ResourceId]} ${back}`);
    }
    // 幽靈耐久防呆:這一型的舊武器已經全數失去(戰死帶走)時,殘耐久紀錄也該跟著消失——
    // 新打造的是全新的一把,不繼承亡者之傷
    if ((this.ownedWeapons[weaponId] ?? 0) <= 0) delete this.weaponDurability[weaponId];
    this.ownedWeapons[weaponId] = (this.ownedWeapons[weaponId] ?? 0) + 1;
    if (fine) this.fineWeapons[weaponId] = (this.fineWeapons[weaponId] ?? 0) + 1;
    this.saveState();
    this.cb.onLog(
      fine
        ? `打造了「${weapon.label}」——這一把是精工品,耐久上限 +25%。`
        : `打造了「${weapon.label}」。${saved.length > 0 ? `(手藝到位,省下 ${saved.join("、")})` : ""}`,
    );
    return true;
  }

  /** 這一型「使用中那把」的耐久上限(2026-09 修訂:普通優先上手,精工墊後) */
  currentMaxDurability(weaponId: string): number {
    const weapon = WEAPONS.find((w) => w.id === weaponId);
    if (!weapon) return 0;
    const fine = this.fineWeapons[weaponId] ?? 0;
    const normal = (this.ownedWeapons[weaponId] ?? 0) - fine;
    return normal <= 0 && fine > 0 ? fineMaxDurability(weaponId) : weapon.durability;
  }

  /** 消耗品打造(乾糧/繃帶/弓矢),成品直接進資源庫存 */
  isConsumableVisible(consumableId: string): boolean {
    const def = CONSUMABLES.find((c) => c.id === consumableId);
    if (!def) return false;
    if (def.requiresBuilding && !this.hasBuilding(def.requiresBuilding)) return false;
    if (def.requiresWeapon && this.weaponCount(def.requiresWeapon) <= 0) return false;
    if (def.requiresWeaponAny && !def.requiresWeaponAny.some((id) => this.weaponCount(id) > 0)) return false;
    if (def.requiresLandmark) {
      try {
        const cleared = JSON.parse(localStorage.getItem("landmarks-cleared") ?? "[]") as string[];
        if (!cleared.includes(def.requiresLandmark)) return false;
      } catch {
        return false;
      }
    }
    return Object.keys(def.cost).every((id) => this.seenResources.has(id as ResourceId));
  }

  /** 缺損耐久比例(0~1):修理費按這個比例計 */
  repairFraction(weaponId: string): number {
    const max = this.currentMaxDurability(weaponId);
    const dur = this.weaponDurability[weaponId];
    if (!max || dur === undefined) return 0;
    return Math.min(1, Math.max(0, (max - dur) / max));
  }

  /** 這把武器是否受損(遠征帶回的剩餘耐久 < 全滿) */
  isWeaponDamaged(weaponId: string): boolean {
    const weapon = WEAPONS.find((w) => w.id === weaponId);
    if (!weapon) return false;
    const dur = this.weaponDurability[weaponId];
    return dur !== undefined && dur < this.currentMaxDurability(weaponId);
  }

  /** 鐵礦坑是否已解放(升格鐵匠鋪的前置) */
  isMineCleared(): boolean {
    try {
      const cleared = JSON.parse(localStorage.getItem("landmarks-cleared") ?? "[]") as string[];
      return cleared.includes("mine");
    } catch {
      return false;
    }
  }

  /** 工匠鋪是否已升格為鐵匠鋪(2026-09 用戶定案:礦坑解放後要另花材料升格,不再免費自動) */
  isSmithyIronCapable(): boolean {
    return this.upgrades["smithy-iron"] === true;
  }

  canUpgradeSmithy(): boolean {
    return this.hasBuilding("smithy") && this.isMineCleared() && !this.isSmithyIronCapable();
  }

  /** 升格工匠鋪→鐵匠鋪:爐膛與砧換成吃得動鐵的規格 */
  upgradeSmithy() {
    if (!this.canUpgradeSmithy() || !this.canAfford(SMITHY_IRON_UPGRADE_COST)) return;
    for (const [id, amount] of Object.entries(SMITHY_IRON_UPGRADE_COST)) {
      this.resources[id as ResourceId] -= amount ?? 0;
    }
    this.upgrades["smithy-iron"] = true;
    this.saveState();
    this.cb.onLog("爐膛重新砌過,鐵砧換上了新的。工匠鋪升格為鐵匠鋪——鐵製的武器,現在修得動了。");
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
    const cost = repairCost(weaponId, this.repairFraction(weaponId));
    if (!this.canAfford(cost)) return;

    for (const [id, amount] of Object.entries(cost)) {
      this.resources[id as ResourceId] -= amount ?? 0;
    }
    delete this.weaponDurability[weaponId];
    this.saveState();
    const weapon = WEAPONS.find((w) => w.id === weaponId);
    this.cb.onLog(`修理好了「${weapon?.label ?? weaponId}」。`);
  }

  /** 修復損毀的特殊武器(鬼雪):鐵匠鋪(鐵級)限定,費用=cost(異晶) */
  canRepairBroken(weaponId: string): boolean {
    if ((this.brokenWeapons[weaponId] ?? 0) <= 0) return false;
    return this.hasBuilding("smithy") && this.isSmithyIronCapable();
  }

  repairBrokenWeapon(weaponId: string) {
    const weapon = WEAPONS.find((w) => w.id === weaponId);
    const cost = brokenRepairCost(weaponId);
    if (!weapon || !this.canRepairBroken(weaponId) || !this.canAfford(cost)) return;
    for (const [id, amount] of Object.entries(cost)) {
      this.resources[id as ResourceId] -= amount ?? 0;
    }
    this.brokenWeapons[weaponId]--;
    if (this.brokenWeapons[weaponId] <= 0) delete this.brokenWeapons[weaponId];
    this.ownedWeapons[weaponId] = (this.ownedWeapons[weaponId] ?? 0) + 1;
    delete this.weaponDurability[weaponId]; // 修復後全滿
    this.saveState();
    this.cb.onLog(`「${weapon.label}」修復好了——寒氣重新纏上了刀身。`);
  }

  /** 丟棄一把武器:有備用且使用中那把有耗損時,可挑丟哪一把(dropWorn=丟耗損的) */
  dropWeapon(weaponId: string, dropWorn: boolean) {
    const n = this.ownedWeapons[weaponId] ?? 0;
    if (n <= 0) return;
    const fine = this.fineWeapons[weaponId] ?? 0;
    const normal = n - fine;
    // 2026-09 修訂:普通優先——不論丟耗損的還是丟備用都先丟普通品,精工永遠留到最後
    if (normal <= 0 && fine > 0) this.fineWeapons[weaponId] = fine - 1;
    if ((this.fineWeapons[weaponId] ?? 0) <= 0) delete this.fineWeapons[weaponId];
    this.ownedWeapons[weaponId] = n - 1;
    if (this.ownedWeapons[weaponId] <= 0) {
      delete this.ownedWeapons[weaponId];
      delete this.weaponDurability[weaponId];
    } else if (dropWorn) {
      // 耗損的那把扔了,備用的頂上(全新,殘耐久紀錄跟著消失)
      delete this.weaponDurability[weaponId];
    }
    this.saveState();
    const weapon = WEAPONS.find((w) => w.id === weaponId);
    this.cb.onLog(`丟棄了一把「${weapon?.label ?? weaponId}」。`);
  }

  isUpgradeVisible(upgradeId: string): boolean {
    const def = UPGRADES.find((u) => u.id === upgradeId);
    if (!def) return false;
    if (this.upgrades[upgradeId]) return true;
    if (def.requiresBuilding && !this.hasBuilding(def.requiresBuilding)) return false;
    if (def.requiresUpgrade && !this.upgrades[def.requiresUpgrade]) return false; // 升級鏈逐級推進
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
  /** 這個兌換品現在上不上架:見過的東西才會擺出來;獨賣品要交易夠熟(minTrades)才亮出來 */
  isTradeVisible(tradeId: string): boolean {
    const def = TRADES.find((t) => t.id === tradeId);
    if (!def) return false;
    if (def.requiresResourceSeen && !this.seenResources.has(def.requiresResourceSeen)) return false;
    if (def.minTrades !== undefined && this.tradeCount < def.minTrades) return false;
    if (def.minExpeditions !== undefined) {
      // 出門超過 N 次才悄然上架(讀遠征序號;不提示,讓玩家某天自己在攤子上看到)
      const trips = Number(localStorage.getItem("expedition-serial") ?? "0");
      if (trips <= def.minExpeditions) return false;
    }
    if (def.grantModification && this.modifications[def.grantModification]) return false; // 只有一瓶,買過就下架
    return true;
  }

  trade(tradeId: string): boolean {
    const def = TRADES.find((t) => t.id === tradeId);
    if (!def || !this.hasBuilding("trading-post") || !this.isTradeVisible(tradeId) || this.resources.shard < def.shards) return false;
    this.resources.shard -= def.shards;
    this.tradeCount++;
    if (def.grantModification) {
      // 改造藥劑:兌換即飲下,永久生效(2026-09 用戶核可文本)
      this.modifications[def.grantModification] = true;
      this.saveState();
      this.cb.onLog("眼前的綠色藥劑擺在你的面前,你拿起瓶子露出猶豫的神情。");
      this.cb.onLog("『別擔心,雖然他不是我們能製作出來的東西,但是基本上他對人體無害』她說道『可以放心的喝下,說不定還會有一點小小的幫助呢!』");
      return true;
    }
    this.resources[def.get!] += (def.qty ?? 1) * 1;
    this.syncSeenResources();
    this.saveState();
    this.cb.onLog(`用 ${def.shards} 顆異晶換得了「${RESOURCE_LABEL[def.get!]}」${(def.qty ?? 1) > 1 ? ` ×${def.qty}` : ""}。`);
    return true;
  }

  /** 以物易物(2026-09 用戶定案):原物料之間 20 換 1;不計入交易次數(熟客門檻要花異晶才算) */
  canBarter(give: ResourceId, get: ResourceId, times = 1): boolean {
    if (!this.hasBuilding("trading-post") || give === get || times <= 0) return false;
    if (!BARTER_RAW.includes(give) || !BARTER_RAW.includes(get)) return false;
    if (!this.seenResources.has(give) || !this.seenResources.has(get)) return false;
    return (this.resources[give] ?? 0) >= BARTER_RATE * times;
  }

  barter(give: ResourceId, get: ResourceId, times = 1): boolean {
    if (!this.canBarter(give, get, times)) return false;
    this.resources[give] -= BARTER_RATE * times;
    this.resources[get] = (this.resources[get] ?? 0) + times;
    this.syncSeenResources();
    this.saveState();
    this.cb.onLog(`用 ${RESOURCE_LABEL[give]} ${BARTER_RATE * times} 換得了「${RESOURCE_LABEL[get]}」${times > 1 ? ` ×${times}` : ""}。`);
    return true;
  }

  /** 製作消耗品:refundPct 同打造——小遊戲停得準,退回一部分材料 */
  craftConsumable(consumableId: string, refundPct = 0): boolean {
    const def = CONSUMABLES.find((c) => c.id === consumableId);
    if (!def || !this.isConsumableVisible(consumableId) || !this.canAfford(def.cost)) return false;

    const saved: string[] = [];
    for (const [id, amount] of Object.entries(def.cost)) {
      const back = Math.round((amount ?? 0) * refundPct);
      this.resources[id as ResourceId] -= (amount ?? 0) - back;
      if (back > 0) saved.push(`${RESOURCE_LABEL[id as ResourceId]} ${back}`);
    }
    this.resources[def.id] += def.yield;
    this.syncSeenResources();
    this.saveState();
    this.cb.onLog(`製作了「${def.label}」x${def.yield}。${saved.length > 0 ? `(手藝到位,省下 ${saved.join("、")})` : ""}`);
    return true;
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

  /** 人口天花板(2026-09 用戶定案):中央地圖 100,每開啟一張相鄰地圖 +50 */
  populationCeiling(): number {
    const opened = ["N", "E", "S", "W"].filter((id) => localStorage.getItem(`map-opened:${id}`) === "1").length;
    return POP_CAP_BASE + POP_CAP_PER_MAP * opened;
  }

  canBuild(buildingId: string): boolean {
    const building = BUILDINGS.find((b) => b.id === buildingId);
    if (!building) return false;
    if (!building.repeatable && this.hasBuilding(buildingId)) return false;
    if (buildingId === "hut" && this.populationCap >= this.populationCeiling()) return false; // 這片土地住不下更多人
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
   * - 連續「完美」疊連擊(每層 +15%,最高 5 層 ×1.75,本次完美即時生效):
   *   認真玩節奏條的效率明顯高於隨手按——掛機靠職業產線,盯著玩的人進度快得多;
   *   「不錯」不中斷連擊(只是不成長),「普通/勉強」才歸零
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
    // 連擊:本次完美「先疊層、再算倍率」——畫面寫連擊×N,這一下就真的吃 ×(1+0.15N);
    // 「不錯」不中斷連擊(只是不成長),普通/勉強才歸零——手滑一格不至於前功盡棄
    if (accuracy >= 0.9) this.gatherStreak = Math.min(5, this.gatherStreak + 1);
    else if (accuracy < 0.65) this.gatherStreak = 0;
    const streakMult = 1 + 0.15 * this.gatherStreak;
    const perkMult = this.equippedPerks.includes("machinist") ? 1.25 : 1; // 【機巧】:鐵皮旅人改造過的工具
    const amount = Math.round(base * (1 + (this.buildingCounts["hut"] ?? 0)) * streakMult * perkMult);

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
    populationPct?: number,
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
      if (actual < 0) this.clampAssignments();
    }
    // 人口比例損失(如土匪敗北 -30%):至少折損 1 人(套用後同樣自動裁員)
    if (populationPct) {
      const loss = Math.max(1, Math.floor(this.population * populationPct));
      const before = this.population;
      this.population = Math.max(0, this.population - loss);
      if (this.population !== before) {
        parts.push(`人口 -${before - this.population}`);
        this.clampAssignments();
      }
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
    let populationPct: number | undefined;
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
      populationPct = picked.populationPct;
      resultText = picked.resultText;
    }

    const summary = this.applyEventEffect(effect, populationDelta, effectPct, populationPct);
    if (option.grantPerk) {
      this.perks[option.grantPerk] = true;
      // 有空格就直接裝上——玩家不用為第一個被動學一套 UI
      if (this.equippedPerks.length < PERK_SLOTS && !this.equippedPerks.includes(option.grantPerk)) {
        this.equippedPerks.push(option.grantPerk);
      }
    }
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

  /** 防掛機(2026-09 用戶定案):閒置太久由頁面層呼叫,強制觸發打盹事件——
   * 事件卡著的期間生產迴圈整個暫停,直到玩家回應才繼續 */
  forceIdleEvent() {
    if (this.pendingEvent) return; // 已有事件卡著=本來就暫停了,別疊
    const ev = EVENTS.find((e) => e.id === "idle-doze");
    if (!ev) return;
    this.pendingEvent = ev;
    this.lastEventTick = this.tickCount;
    this.cb.onTick();
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
    if (buildingId === "hut") this.populationCap = Math.min(this.populationCeiling(), this.populationCap + HUT_CAP_BONUS);
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

  /** 從 localStorage 重讀狀態:整備扣裝/遠征歸還直接改了存檔,活引擎要跟上 */
  reloadState() {
    this.loadState();
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
      // 鐵軌鋪到礦坑旁(rail-to-mine 旗標)後,礦車自動運輸——鐵礦工的「產出」翻倍(消耗不變);
      // 火車通車後,車廂運量再翻倍(×4)
      const railToMine = localStorage.getItem("rail-to-mine") === "1";
      const railwayBoost = job.id === "miner" && railToMine ? 4 : 1; // 2026-09 用戶定案:鐵軌連通礦坑即直接 ×4(火車建築移除)
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

    this.growthMeter += GROWTH_SPEED;
    if (this.growthMeter >= GROWTH_CHECK_EVERY) {
      this.growthMeter -= GROWTH_CHECK_EVERY;
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
      this.firePassiveEvent(event);
    } else {
      this.pendingEvent = event; // 選擇型事件:暫停在這裡等玩家回應,不自動套用效果
    }
  }

  /** 套用一則被動事件(隨機池與 DEV 指定觸發共用):含紅月計數與災厄 */
  private firePassiveEvent(event: PassiveEvent) {
    const summary = this.applyEventEffect(event.effect, event.populationDelta, event.effectPct);
    this.cb.onLog(summary ? `${event.text}(${summary})` : event.text);
    // 紅月計數(2026-09 核可):滿三次,下一次遠征近村刷出紅月窪地(☾);
    // 窪地放著不管、又過兩次紅月(第 5 次)=災厄之夜——人口最多折損上限的一半
    if (event.id === "red-moon") {
      const n = Number(localStorage.getItem("redmoon-count") ?? "0") + 1;
      localStorage.setItem("redmoon-count", String(n));
      if (n >= 5) {
        const loss = Math.max(1, Math.floor(this.populationCap * (0.3 + Math.random() * 0.2)));
        const before = this.population;
        this.population = Math.max(0, this.population - loss);
        this.clampAssignments();
        const lossSummary = this.applyEventEffect({}, undefined, { grain: 0.25, ration: 0.25, meat: 0.25 });
        localStorage.setItem("redmoon-count", "0"); // 災厄過後循環重來(窪地由探索頁撤掉)
        this.cb.onLog(
          `入夜後,窪地的方向傳來低沉的、像大地翻身一樣的聲音。那東西進村了。棚屋像紙一樣被撕開,哭喊聲持續了整夜——天亮清點,村子失去了 ${before - this.population} 個人。` +
            (lossSummary ? `(${lossSummary})` : ""),
        );
        this.saveState();
      }
    }
  }

  /** DEV 測試:往村莊紀錄寫一行(系統分頁的測試按鈕用) */
  devLog(text: string) {
    this.cb.onLog(text);
  }

  /** DEV 測試:指定觸發一則被動事件(照正常路徑走,紅月計數/災厄照算) */
  devFireEventById(id: string): boolean {
    const event = EVENTS.find((e) => e.id === id);
    if (!event || event.kind !== "passive") return false;
    this.firePassiveEvent(event);
    return true;
  }

  /** 人口減少後的自動裁員:超編的部分依工作清單由上到下扣(先伐木、再採石、依序往下) */
  private clampAssignments() {
    let assigned = Object.values(this.assignments).reduce((a, b) => a + b, 0);
    if (assigned <= this.population) return;
    for (const job of JOBS) {
      if (assigned <= this.population) break;
      const cut = Math.min(this.assignments[job.id] ?? 0, assigned - this.population);
      if (cut > 0) {
        this.assignments[job.id] -= cut;
        assigned -= cut;
      }
    }
  }

  private checkPopulationGrowth() {
    // 只要還有空房,每 20 秒就會有一位新居民抵達;住所蓋得越多,人口成長的空間就越大
    if (this.population >= this.populationCap) return;
    this.population++;
    this.growthEventCount++;
    // 新居民自動先去砍柴(2026-08 用戶指定):不用每次來人都手動指派;想調整隨時在工作分頁改
    this.assignments["woodcutter"] = (this.assignments["woodcutter"] ?? 0) + 1;
    this.cb.onLog("村莊多了一位新的居民。");
  }
}
