import { BASE_INTERVAL, type CategoryDef, type CategoryId, type EnemyMove, type StatusKind, type SubAction } from "./types";

export interface LogEntry {
  id: number;
  actor: string;
  target: string;
  symbol: string;
  damage: number;
  /** 回復量(道具使用時 damage 為 0、heal 為正) */
  heal?: number;
  crit?: boolean;
  blocked?: boolean;
  /** 這一擊壓制了對方(劍類:把牠的動作條往回推了) */
  suppressed?: boolean;
  /** 這一擊抓中了招架窗(特殊武器:對方那一擊會被架開) */
  riposted?: boolean;
}

/** 類別內每個子行動各自累積進度,但共用同一次歸零(見 design-notes.md § 2.3.2) */
class SubActionTracker {
  elapsed = 0;
  /** 彈匣已射發數(槍械):打滿 magazine → 該行動變「換彈」 */
  magazineUsed = 0;
  /** 彈匣已空:下一次點選這個行動=換彈(所有行動清空+凍結 reloadCost 秒) */
  needsReload = false;
  /** 一次性回轉倍率(道具轉盤:強力道具用完後下一輪 ×1.2),跑滿一輪自動歸 1 */
  costMult = 1;

  constructor(
    public readonly subAction: SubAction,
    private readonly speedMultiplier: () => number,
  ) {}

  get actualCost(): number {
    return (this.subAction.baseCost * this.costMult * BASE_INTERVAL) / this.speedMultiplier();
  }

  get progress(): number {
    return Math.min(1, this.elapsed / this.actualCost);
  }

  get ready(): boolean {
    return this.progress >= 1;
  }

  tick(dt: number) {
    if (this.elapsed < this.actualCost) {
      this.elapsed = Math.max(0, Math.min(this.actualCost, this.elapsed + dt));
      // 拖長的那一輪跑滿了:倍率只吃一輪,之後(含被跨類別歸零重跑)回到正常速度
      if (this.costMult !== 1 && this.elapsed >= this.actualCost) {
        this.costMult = 1;
        this.elapsed = this.actualCost; // 換回正常刻度仍保持滿格
      }
    }
  }
}

class CategoryTracker {
  trackers: SubActionTracker[];

  constructor(
    public readonly def: CategoryDef,
    speedMultiplier: () => number,
  ) {
    this.trackers = def.subActions.map((sa) => new SubActionTracker(sa, speedMultiplier));
  }

  tick(dt: number) {
    for (const t of this.trackers) t.tick(dt);
  }

  get hasReady(): boolean {
    return this.trackers.some((t) => t.ready);
  }

  /** 使用其中一個子行動時,整個類別的計時器一起歸零(§ 2.3.2) */
  resetAll() {
    for (const t of this.trackers) {
      t.elapsed = 0;
      // 被別的類別打斷重跑=全新的一輪:道具的「拖長下一輪」懲罰不跨越重置
      // (2026-09 用戶確認:攻擊重置道具盤後,適用的是 1s 而不是殘留的 1.2s)
      t.costMult = 1;
    }
  }
}

class EnemyTracker {
  elapsed = 0;
  currentMove: EnemyMove;
  /** 連招腳本(數數的東西):依序循環出招,取代隨機抽 */
  private patternIdx = 0;

  constructor(
    private readonly moves: EnemyMove[],
    private readonly speedMultiplier: () => number,
    private readonly pattern?: string[],
  ) {
    this.currentMove = this.pattern?.length ? (moves.find((m) => m.id === this.pattern![0]) ?? pickRandom(moves)) : pickRandom(moves);
  }

  get actualCost(): number {
    return (this.currentMove.baseCost * BASE_INTERVAL) / this.speedMultiplier();
  }

  get progress(): number {
    return Math.min(1, this.elapsed / this.actualCost);
  }

  tick(dt: number) {
    this.elapsed += dt;
  }

  /** 出招完畢後重新選招並歸零,見 § 2.9:跑條速度依當前準備中的招式而變動 */
  rollNextMove() {
    this.elapsed = 0;
    if (this.pattern?.length) {
      this.patternIdx = (this.patternIdx + 1) % this.pattern.length;
      this.currentMove = this.moves.find((m) => m.id === this.pattern![this.patternIdx]) ?? pickRandom(this.moves);
    } else {
      this.currentMove = pickRandom(this.moves);
    }
  }
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export interface EnemyUnitOpts {
  hp: number;
  label: string;
  freezeResist?: boolean;
  pattern?: string[];
  /** 自訂識別(拾荒的長手的護贓觸手掛 stolen:N,倒下即歸還那件贓物) */
  tag?: string;
  /** 人類型態:倒下留屍(未來復活機制);非人類倒下即從敵欄消失 */
  human?: boolean;
}

/** 戰場上的一隻敵人(2026-09 多目標改版):各自的血量/行動條/凍結/狂暴 */
export class EnemyUnit {
  tracker: EnemyTracker;
  hp: number;
  maxHp: number;
  label: string;
  tag?: string;
  /** 敵方凍結值(名刀鬼雪):滿 100 → 這隻的下一招 CD ×2 + 我方下一擊 ×1.5 */
  freeze = 0;
  /** 寒滯中:這隻當前準備的招充能減半,出招後解除 */
  chilled = false;
  /** 狂暴倍率(拾荒的長手 50% 後 CD ×0.75 → 充能 ×1.333) */
  hasteMult = 1;
  /** 鬼雪打斷(教堂蛻變 B):下一次凍結值疊滿時,這隻當前蓄力直接歸零(一場一次) */
  freezeInterruptArmed = false;
  /** 踉蹌值(重武器疊加,滿 100 觸發;巨體與凍結抗性同款減半) */
  staggerGauge = 0;
  /** 踉蹌中剩餘秒數:行動條凍住+受創 ×1.25——重武器砸出來的輸出窗 */
  staggerLeft = 0;
  readonly freezeResist: boolean;
  readonly human: boolean;
  /** 招架待命秒數(特殊武器抓中窗口):這段時間內牠落地的那一擊視為被完美格擋 */
  riposteLeft = 0;

  constructor(
    public moves: EnemyMove[],
    opts: EnemyUnitOpts,
  ) {
    this.hp = opts.hp;
    this.maxHp = opts.hp;
    this.label = opts.label;
    this.tag = opts.tag;
    this.freezeResist = opts.freezeResist ?? false;
    this.human = opts.human ?? false;
    this.tracker = new EnemyTracker(moves, () => (this.chilled ? 0.5 : 1) * this.hasteMult, opts.pattern);
  }
}

export interface EngineCallbacks {
  onLog: (entry: LogEntry) => void;
  onPauseChange: (paused: boolean) => void;
  onHpChange: () => void;
  /** 敵方開始蓄力大招時的敘述(可選;模擬器不接) */
  onTell?: (text: string) => void;
  /** 混亂發作:UI 隨機執行一個「就緒且可用」的行動,執行了回 true(可選;模擬器不接) */
  onConfusedAct?: () => boolean;
  /** 格擋接下一擊(perfect=完全格擋):UI 扣盾耐久用(完全格擋免費) */
  onBlocked?: (perfect: boolean) => void;
  /** 偷竊招命中(完全格擋擋得下):由 UI 執行偷竊與記帳(每場限一次的守門也在 UI) */
  onSteal?: () => void;
  /** 有一隻敵人倒下(多目標戰;最後一隻的勝利結算仍走 onHpChange) */
  onEnemyDown?: (unit: EnemyUnit) => void;
  /** 敵人陣容/目標變動(加入新敵、切換目標):UI 重建敵欄 */
  onUnitsChanged?: () => void;
  /** 某隻敵人吃到一下傷害(跳字動畫用;彈丸逐顆回報) */
  onUnitHit?: (unit: EnemyUnit, dmg: number) => void;
  /** 玩家吃到一下傷害(跳字動畫用;含持續傷害) */
  onPlayerHit?: (dmg: number) => void;
  /** 某隻敵人完成了一次行動(教堂神父的孕育結算等);move=剛結算的那一招 */
  onEnemyAct?: (unit: EnemyUnit, move: EnemyMove) => void;
}

/**
 * 核心排程引擎,實作 design-notes.md § 2.1–2.9:
 * - 玩家行動槽跑滿即暫停等待輸入(Wait 模式,§2.6)
 * - 敵方(可以是複數隻,2026-09 多目標改版)同時進攻;攻擊打「目前目標」
 */
export class CombatEngine {
  playerCategories: CategoryTracker[];
  /** 戰場上的敵人們(多目標):全滅才算勝利 */
  units: EnemyUnit[] = [];
  /** 玩家目前選定的攻擊目標(死了自動跳到下一隻活的) */
  targetIdx = 0;
  paused = false;
  playerHp = 30;
  playerMaxHp = 30;
  playerSpeed = 1;
  /** 玩家身上的異常狀態(§2.11.2 累積制):值滿 100 升一級(最高 3),等級越高持續傷害越重 */
  playerStatus: Record<StatusKind, { gauge: number; level: number }> = {
    poison: { gauge: 0, level: 0 },
    bleed: { gauge: 0, level: 0 },
  };
  private dotTimer = 0;
  /** 環境流血(教堂血雨 C):每 2 秒額外扣的血——場地效果,不吃異常清除 */
  stormBleed = 0;
  /** 血雨領域(教堂 C):道具轉盤整體拖慢到這個秒數(null=正常) */
  itemFieldSeconds: number | null = null;
  /** 換彈剩餘秒數(2026-09 改版):期間你的所有行動條凍結,敵方照常進逼 */
  reloadLock = 0;
  /** 剛剛那次 useSubAction 是換彈(UI 據此跳過彈藥/耐久消耗) */
  justReloaded = false;
  /** 暈眩剩餘秒數:你的所有行動條凍結(敵方照常行動——被壓制的恐懼感) */
  stunLeft = 0;
  /** 遲緩剩餘秒數:行動條充能減半 */
  slowLeft = 0;
  /** 控制免疫剩餘秒數(醒神鹽):期間不吃暈眩/遲緩/混亂 */
  controlImmuneLeft = 0;
  /** 危機意識(改造藥劑):開戰後第一次充能全體 ×2,放出任一行動即恢復正常 */
  firstStrikeBoost = false;
  /** 我方下一擊傷害 ×1.5(凍結觸發的獎勵) */
  playerEmpowerNext = false;
  /** 裝備中的盾(格擋參數;null=沒帶盾,不能格擋) */
  shield: { label: string; reduce: number; cd: number } | null = null;
  /** 格擋窗口剩餘秒數(0.5s;前 0.1s 完全格擋) */
  blockWindowLeft = 0;
  /** 完美格擋窗延長秒數(匕首格擋輔助:0.1s → 0.1+bonus) */
  perfectWindowBonus = 0;
  /** 格擋冷卻剩餘秒數 */
  blockCooldownLeft = 0;
  /** 混亂條(§用戶規格 2026-09):滿 100 後,下一個充能完成的行動被隨機執行 */
  confusionGauge = 0;
  /** 混亂已滿,等著奪走下一個行動(行動條未滿就等它滿的那一刻) */
  confusionPending = false;
  /** 各計時的總量(UI 畫倒數條用:剩餘/總量) */
  stunTotal = 0;
  slowTotal = 0;
  controlImmuneTotal = 0;
  private logId = 0;
  private rafHandle = 0;
  private lastT = 0;
  /** 玩家已經明確「暫不使用」過的就緒子行動,避免同一個就緒狀態下一幀又立刻重新暫停 */
  private acknowledged = new Set<string>();

  constructor(
    categories: CategoryDef[],
    enemyMoves: EnemyMove[],
    private readonly cb: EngineCallbacks,
    opts?: { enemyHp?: number; enemyLabel?: string; freezeResist?: boolean; pattern?: string[] },
  ) {
    this.playerCategories = categories.map((c) => new CategoryTracker(c, () => this.playerSpeed * (this.slowLeft > 0 ? 0.5 : 1) * (this.firstStrikeBoost ? 2 : 1)));
    this.units.push(
      new EnemyUnit(enemyMoves, {
        hp: opts?.enemyHp ?? 15,
        label: opts?.enemyLabel ?? "敵人",
        freezeResist: opts?.freezeResist,
        pattern: opts?.pattern,
      }),
    );
  }

  /** 加一隻敵人上場(組隊遭遇/護贓觸手):開戰時一次排好 */
  addEnemy(moves: EnemyMove[], opts: EnemyUnitOpts): EnemyUnit {
    const u = new EnemyUnit(moves, opts);
    this.units.push(u);
    this.cb.onUnitsChanged?.();
    return u;
  }

  /** 目前目標(選定的那隻;死了自動退到第一隻活的) */
  get targetUnit(): EnemyUnit | null {
    const u = this.units[this.targetIdx];
    if (u && u.hp > 0) return u;
    return this.units.find((x) => x.hp > 0) ?? null;
  }

  /** 連鎖戰(高階遺跡):清場換下一波——玩家血量/異常/行動條原封不動,敵方全新 */
  replaceEnemies(moves: EnemyMove[], opts: EnemyUnitOpts) {
    this.units = [new EnemyUnit(moves, opts)];
    this.targetIdx = 0;
    this.cb.onUnitsChanged?.();
    this.cb.onHpChange();
    if (this.units[0].tracker.currentMove.tell) this.cb.onTell?.(this.units[0].tracker.currentMove.tell);
  }

  /** Boss 蛻變(教堂半血,2026-09 核可 A):整套招式表換新,可帶加速與連招腳本 */
  transformUnit(unit: EnemyUnit, moves: EnemyMove[], opts?: { hasteMult?: number; pattern?: string[] }) {
    unit.moves = moves;
    if (opts?.hasteMult) unit.hasteMult = opts.hasteMult;
    unit.tracker = new EnemyTracker(moves, () => (unit.chilled ? 0.5 : 1) * unit.hasteMult, opts?.pattern);
    this.cb.onUnitsChanged?.();
    if (unit.tracker.currentMove.tell) this.cb.onTell?.(unit.tracker.currentMove.tell);
  }

  /** 開啟血雨領域(教堂 C):道具轉盤立即拖慢到 seconds */
  setItemField(seconds: number) {
    this.itemFieldSeconds = seconds;
    for (const cat of this.playerCategories) this.applyItemField(cat);
  }

  private applyItemField(cat: CategoryTracker) {
    if (cat.def.id !== "item" || !this.itemFieldSeconds) return;
    for (const t of cat.trackers) t.costMult = this.itemFieldSeconds / (t.subAction.baseCost || 1);
  }

  /** 切換攻擊目標(點敵欄或 Tab):只有活著的能選 */
  setTarget(idx: number) {
    if (this.units[idx] && this.units[idx].hp > 0) {
      this.targetIdx = idx;
      this.cb.onUnitsChanged?.();
    }
  }

  // ---- 相容取值(模擬器與舊碼):單敵時代的欄位映射到多目標結構 ----

  /** 全場剩餘血量總和(全滅 = 0,勝利判定沿用) */
  get enemyHp(): number {
    return this.units.reduce((s, u) => s + u.hp, 0);
  }

  /** dev/測試便利:直接設「目前目標」的血量 */
  set enemyHp(v: number) {
    const t = this.targetUnit;
    if (t) t.hp = Math.max(0, Math.min(t.maxHp, v));
  }

  get enemyMaxHp(): number {
    return this.units.reduce((s, u) => s + u.maxHp, 0);
  }

  get enemyLabel(): string {
    return this.targetUnit?.label ?? this.units[0]?.label ?? "敵人";
  }

  /** 相容:目前目標的行動追蹤器(撤退追擊/模擬器讀 currentMove 用) */
  get enemy(): EnemyTracker {
    return (this.targetUnit ?? this.units[0]).tracker;
  }

  get enemyFreeze(): number {
    return this.targetUnit?.freeze ?? 0;
  }

  get enemyChilled(): boolean {
    return this.targetUnit?.chilled ?? false;
  }

  /** 舉盾格擋(§用戶規格 2026-09):開 0.5s 防禦窗,前 0.1s 完全格擋;冷卻由盾決定 */
  useBlock(): boolean {
    if (!this.shield || this.blockCooldownLeft > 0 || this.blockWindowLeft > 0) return false;
    if (this.stunLeft > 0) return false; // 暈眩中舉不起盾
    if (this.reloadLock > 0) return false; // 換彈中雙手占著,舉不起盾
    this.blockWindowLeft = BLOCK_WINDOW;
    this.blockCooldownLeft = this.shield.cd;
    // 格擋自成一類(2026-09 用戶定案):對其他類別而言就是「別類的招」——舉盾讓所有行動條重頭跑;
    // 反向不成立:出招不重置盾的冷卻(盾 CD 是裝備計時,不是充能條,否則盾永遠舉不起來)
    for (const c of this.playerCategories) {
      c.resetAll();
      this.applyItemField(c);
      for (const t of c.trackers) this.acknowledged.delete(this.key(c.def.id, t.subAction.id));
    }
    this.cb.onLog({ id: this.logId++, actor: "你", target: "舉起了盾", symbol: "[]", damage: 0 });
    this.resume(); // 舉盾也是一個決定:Wait 暫停直接解除,CD 繼續跑(2026-09 用戶反饋)
    return true;
  }

  /** 解除控制效果並給予免疫窗口(醒神鹽)——混亂也是「腦子的事」,一併醒掉 */
  clearControl(immuneSeconds: number) {
    this.stunLeft = 0;
    this.slowLeft = 0;
    this.confusionGauge = 0;
    this.confusionPending = false;
    this.controlImmuneLeft = Math.max(this.controlImmuneLeft, immuneSeconds);
    this.controlImmuneTotal = Math.max(this.controlImmuneTotal, this.controlImmuneLeft);
  }

  /** 道具解除異常(如繃帶止血) */
  clearStatus(kind: StatusKind) {
    this.playerStatus[kind] = { gauge: 0, level: 0 };
  }

  start() {
    cancelAnimationFrame(this.rafHandle); // 可重入:對話框收放連按也不會疊出第二條迴圈
    this.lastT = performance.now();
    const loop = (t: number) => {
      // rAF 的幀時間戳可能早於 start() 當下的 performance.now()——dt 夾成非負,
      // 否則行動條會被倒扣成負數、消退式子反向增值(2026-09 Tab 畫面壞掉的病根)
      const dt = Math.min(0.1, Math.max(0, (t - this.lastT) / 1000));
      this.lastT = t;
      this.step(dt);
      this.rafHandle = requestAnimationFrame(loop);
    };
    this.rafHandle = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.rafHandle);
  }

  private step(dt: number) {
    if (this.enemyHp <= 0 || this.playerHp <= 0) return;

    // 混亂發作(在暫停中也會作祟——它奪走的就是「你的決定」):
    // 任何行動就緒的瞬間,隨機執行一個可用行動(UI 依 canUse 挑,執行成功才解除)
    if (this.confusionPending && this.stunLeft <= 0) {
      const anyReady = this.playerCategories.some((c) => c.trackers.some((t) => t.ready));
      if (anyReady && this.cb.onConfusedAct?.()) {
        this.confusionPending = false;
        this.confusionGauge = 0;
      }
    }

    if (!this.paused) {
      // 控制效果倒數
      if (this.blockWindowLeft > 0) this.blockWindowLeft = Math.max(0, this.blockWindowLeft - dt);
      if (this.blockCooldownLeft > 0) this.blockCooldownLeft = Math.max(0, this.blockCooldownLeft - dt);
      if (this.stunLeft > 0) this.stunLeft = Math.max(0, this.stunLeft - dt);
      if (this.slowLeft > 0) this.slowLeft = Math.max(0, this.slowLeft - dt);
      if (this.controlImmuneLeft > 0) this.controlImmuneLeft = Math.max(0, this.controlImmuneLeft - dt);
      if (this.reloadLock > 0) this.reloadLock = Math.max(0, this.reloadLock - dt);
      // 計量自然消退(2026-09 用戶定案):敵我雙方所有累積條每秒 -1——
      // 疊加要跟時間賽跑;等級一旦升上去就不退,退的是還沒滿的計量
      this.playerStatus.poison.gauge = Math.max(0, this.playerStatus.poison.gauge - dt);
      this.playerStatus.bleed.gauge = Math.max(0, this.playerStatus.bleed.gauge - dt);
      if (!this.confusionPending) this.confusionGauge = Math.max(0, this.confusionGauge - dt);
      for (const u of this.units) {
        if (u.hp <= 0) continue;
        u.freeze = Math.max(0, u.freeze - dt);
        if (u.staggerLeft <= 0) u.staggerGauge = Math.max(0, u.staggerGauge - dt);
        if (u.riposteLeft > 0) u.riposteLeft = Math.max(0, u.riposteLeft - dt);
      }
      // 暈眩/換彈中:你的行動條全部凍結,敵方照常進逼
      if (this.stunLeft <= 0 && this.reloadLock <= 0) {
        for (const cat of this.playerCategories) cat.tick(dt);
      }
      // 每一隻活著的敵人各自進逼(多目標:同時進攻)
      for (const u of this.units) {
        if (u.hp <= 0) continue;
        if (u.staggerLeft > 0) {
          u.staggerLeft = Math.max(0, u.staggerLeft - dt); // 踉蹌中:這隻整個停擺
          continue;
        }
        u.tracker.tick(dt);
        if (u.tracker.progress >= 1) {
          const resolvedMove = u.tracker.currentMove;
          this.resolveEnemyAttack(u);
          this.cb.onEnemyAct?.(u, resolvedMove);
          if (this.playerHp <= 0) return;
        }
      }

      // 異常狀態持續傷害:每 2 秒依等級總和扣血(§2.11.2)
      this.dotTimer += dt;
      if (this.dotTimer >= 2) {
        this.dotTimer -= 2;
        const dot = this.playerStatus.poison.level + this.playerStatus.bleed.level + this.stormBleed;
        if (dot > 0 && this.playerHp > 0) {
          this.playerHp = Math.max(0, this.playerHp - dot);
          this.cb.onPlayerHit?.(dot);
          this.cb.onLog({ id: this.logId++, actor: "傷勢與毒素", target: "你", symbol: "~", damage: dot });
          this.cb.onHpChange();
          if (this.playerHp <= 0) return;
        }
      }

      // 任一「尚未被回應過」的子行動跑滿 → 觸發決策點,模擬時鐘暫停(§2.6)
      // 玩家可以選擇使用,也可以明確選擇「暫不使用」(見 skip()),讓速度較慢的類別有機會繼續累積。
      // 道具類例外(2026-09 用戶反饋:每次出招道具歸零重充、一就緒又暫停,被迫狂點「暫不使用」)——
      // 道具就緒只是「隨時可用」,不打斷節奏;要用就在任何暫停時或即時點下去
      const hasNewlyReady = this.playerCategories.some(
        (c) => c.def.id !== "item" && c.trackers.some((t) => t.ready && !this.acknowledged.has(this.key(c.def.id, t.subAction.id))),
      );
      if (hasNewlyReady) {
        // 就緒寬限:差不到 PAUSE_SNAP_SECONDS 的行動條一併補滿,暫停畫面上不會出現「99% 但按不下去」
        for (const c of this.playerCategories) {
          for (const t of c.trackers) {
            if (!t.ready && t.actualCost - t.elapsed <= PAUSE_SNAP_SECONDS) {
              t.costMult = 1; // 與 tick() 跑滿時的處理一致:拖長的那一輪算跑完了
              t.elapsed = t.actualCost;
            }
          }
        }
        this.paused = true;
        this.cb.onPauseChange(true);
      }
    }
  }

  private resolveEnemyAttack(unit: EnemyUnit) {
    const move = unit.tracker.currentMove;
    if (move.damage > 0) {
      // 格擋判定:防禦窗內接下這一擊——前 0.1s 完全格擋(傷害/控制/異常全免),
      // 之後半格擋(依盾減傷,附帶效果照吃);一面盾一次窗只接一擊(多敵齊上時擋最先到的那擊)
      let blocked: "perfect" | "partial" | null = null;
      let dmg = move.damage;
      let viaRiposte = false;
      if (unit.riposteLeft > 0) {
        // 招架(特殊武器):刀已經迎上去了——這一擊照完美格擋處理(整擊無效,大招踉蹌),不用盾
        blocked = "perfect";
        dmg = 0;
        viaRiposte = true;
        unit.riposteLeft = 0;
        this.cb.onLog({ id: this.logId++, actor: "你", target: `招架!刃口彈開了攻擊,${unit.label}的這一擊落空！`, symbol: "◎", damage: 0 });
      } else if (this.blockWindowLeft > 0 && this.shield) {
        blocked = this.blockWindowLeft >= BLOCK_WINDOW - (BLOCK_PERFECT + this.perfectWindowBonus) ? "perfect" : "partial";
        // 穿盾招(百手壓下):普通格擋的減傷上限只有一半,想無傷只能抓 0.1s 的完全格擋
        const reduce = move.pierceBlock ? Math.min(this.shield.reduce, 0.5) : this.shield.reduce;
        dmg = blocked === "perfect" ? 0 : Math.max(0, Math.ceil(dmg * (1 - reduce)));
        this.blockWindowLeft = 0;
        this.cb.onBlocked?.(blocked === "perfect");
      }
      if (blocked === "perfect") {
        if (!viaRiposte) this.cb.onLog({ id: this.logId++, actor: "你", target: `完全格擋!那一擊落在盾面正中,力道順著弧面滑開了`, symbol: "◎", damage: 0 });
        // 2026-09 定案(方案C):完美格擋「大招」(heavy)→ 對方被反彈的力道掀得踉蹌 3 秒(輸出窗)
        if (move.heavy) {
          unit.staggerGauge = 0;
          unit.staggerLeft = Math.max(unit.staggerLeft, PERFECT_PARRY_STAGGER);
          this.cb.onLog({ id: this.logId++, actor: "你", target: `將招式彈了回去！${unit.label}晃了兩步,一時間動彈不得`, symbol: "!!", damage: 0 });
        }
      } else {
        this.playerHp = Math.max(0, this.playerHp - dmg);
        if (dmg > 0) this.cb.onPlayerHit?.(dmg);
        this.cb.onLog({
          id: this.logId++,
          actor: unit.label,
          target: "你",
          symbol: move.symbol,
          damage: dmg,
          blocked: blocked === "partial",
        });
      }

      // 控制效果:暈眩(行動凍結)/遲緩(充能減半);醒神鹽的免疫窗口可以擋掉;完全格擋全免
      if (blocked === "perfect") {
        /* 完全格擋:控制與異常一併被盾面彈開 */
      } else if (move.control && this.controlImmuneLeft > 0) {
        this.cb.onLog({ id: this.logId++, actor: "你", target: "咬牙穩住了身形", symbol: "=", damage: 0 });
      } else if (move.control) {
        if (move.control.kind === "stun") {
          this.stunLeft = Math.max(this.stunLeft, move.control.duration);
          this.stunTotal = Math.max(this.stunTotal, this.stunLeft);
          this.cb.onLog({ id: this.logId++, actor: "你", target: "被震得踉蹌,一時動彈不得", symbol: "!!", damage: 0 });
        } else {
          this.slowLeft = Math.max(this.slowLeft, move.control.duration);
          this.slowTotal = Math.max(this.slowTotal, this.slowLeft);
          this.cb.onLog({ id: this.logId++, actor: "你", target: "手腳發沉,動作慢了下來", symbol: "!", damage: 0 });
        }
      }

      // 命中附帶異常值疊加(累積制,不是機率):滿 100 升一級,最高 3 級;完全格擋全免
      if (move.status && blocked !== "perfect") {
        const s = this.playerStatus[move.status.kind];
        s.gauge += move.status.amount;
        if (s.gauge >= 100 && s.level < 3) {
          s.gauge -= 100;
          s.level++;
          const name = move.status.kind === "poison" ? "中毒" : "流血";
          this.cb.onLog({ id: this.logId++, actor: "你", target: `陷入${name} Lv${s.level}`, symbol: "!", damage: 0 });
        } else if (s.gauge >= 100) {
          s.gauge = 100; // 已滿級,計量封頂
        }
      }
      if (blocked !== "perfect") this.applyConfusion(move);
      if (blocked !== "perfect" && move.steal) this.cb.onSteal?.(); // 完全格擋能擋下偷竊
      this.cb.onHpChange();
    } else {
      // 零傷害的行為(如發狂者的「顫抖」、哼歌者的「哼唱」):空轉或純異常疊加
      this.cb.onLog({ id: this.logId++, actor: unit.label, target: move.label, symbol: move.symbol, damage: 0 });
      this.applyConfusion(move);
    }
    unit.tracker.rollNextMove();
    unit.chilled = false; // 寒滯只吃一招
    // 大招才有蓄力描寫:「牠抬起了手」比招式名更能讓玩家學會判讀
    if (unit.tracker.currentMove.tell) this.cb.onTell?.(unit.tracker.currentMove.tell);
  }

  /** 混亂值疊加:免疫窗口(醒神鹽)擋得掉;滿 100 進入「發作待機」 */
  private applyConfusion(move: EnemyMove) {
    if (!move.confusion) return;
    if (this.controlImmuneLeft > 0) {
      this.cb.onLog({ id: this.logId++, actor: "你", target: "咬住舌尖,把歌聲擋在腦子外", symbol: "=", damage: 0 });
      return;
    }
    if (this.confusionPending) return; // 發作待機中不再疊
    this.confusionGauge = Math.min(100, this.confusionGauge + move.confusion);
    if (this.confusionGauge >= 100) {
      this.confusionPending = true;
      this.cb.onLog({ id: this.logId++, actor: "你", target: "歌聲在你腦子裡打轉——你分不清哪個念頭是自己的", symbol: "??", damage: 0 });
    }
  }

  /** 玩家選擇使用某個已就緒的子行動(攻擊打「目前目標」);回傳是否真的執行了 */
  useSubAction(categoryId: CategoryId, subActionId: string): boolean {
    const cat = this.playerCategories.find((c) => c.def.id === categoryId);
    if (!cat) return false;
    const tracker = cat.trackers.find((t) => t.subAction.id === subActionId);
    if (!tracker || !tracker.ready) return false;
    if (this.reloadLock > 0) return false; // 換彈中:雙手都占著

    // 換彈(2026-09 用戶定案):點選=所有行動清空,凍結 reload 秒後各 CD 才重新起跑
    if (tracker.needsReload) {
      tracker.needsReload = false;
      tracker.magazineUsed = 0;
      this.reloadLock = tracker.subAction.reloadCost ?? 1;
      this.justReloaded = true;
      for (const c of this.playerCategories) {
        c.resetAll();
        this.applyItemField(c);
        for (const t of c.trackers) this.acknowledged.delete(this.key(c.def.id, t.subAction.id));
      }
      this.cb.onLog({ id: this.logId++, actor: "你", target: `彈殼落地。你低著頭把新的一輪子彈壓進${tracker.subAction.label},內心默默數著數`, symbol: "=", damage: 0 });
      this.resume();
      return true;
    }
    this.justReloaded = false;

    let dmg = tracker.subAction.damage;
    if (dmg > 0 && this.playerEmpowerNext) {
      dmg = Math.round(dmg * 1.5); // 凍結獎勵:下一擊 ×1.5
      this.playerEmpowerNext = false;
    }
    const heal = tracker.subAction.heal ?? 0;

    // 霰彈(2026-09 用戶定案):每擊 pellets 顆彈丸,各自砸向隨機一隻活敵——群戰神器
    let pelletsDone = false;
    let suppressedHit = false; // 壓制(劍類):這一擊有沒有把對方的動作條推回去
    let ripostedHit = false; // 招架(特殊武器):這一擊有沒有抓中對方攻擊落地前的窗口

    if (tracker.subAction.pellets && dmg > 0) {
      pelletsDone = true;
      let total = 0;
      const hitUnits = new Set<EnemyUnit>();
      const downed: EnemyUnit[] = [];
      for (let i = 0; i < tracker.subAction.pellets; i++) {
        const living = this.units.filter((x) => x.hp > 0);
        if (living.length === 0) break;
        const u2 = living[Math.floor(Math.random() * living.length)];
        let d = dmg;
        if (u2.staggerLeft > 0) d = Math.round(d * 1.25);
        u2.hp = Math.max(0, u2.hp - d);
        this.cb.onUnitHit?.(u2, d);
        total += d;
        hitUnits.add(u2);
        if (u2.hp <= 0 && !downed.includes(u2)) downed.push(u2);
      }
      this.cb.onLog({
        id: this.logId++,
        actor: "你",
        target: hitUnits.size > 1 ? `彈丸四散,掃中 ${hitUnits.size} 隻` : ([...hitUnits][0]?.label ?? "敵人"),
        symbol: tracker.subAction.symbol,
        damage: total,
      });
      for (const x of downed) this.cb.onEnemyDown?.(x);
      if (downed.length > 0) this.cb.onUnitsChanged?.();
    }

    // 連發(自動步槍):對目前目標連打 N 發,逐發跳字;目標倒了剩餘子彈掃向下一隻
    if (!pelletsDone && tracker.subAction.burst && dmg > 0) {
      pelletsDone = true;
      let total = 0;
      const hitUnits = new Set<EnemyUnit>();
      const downed: EnemyUnit[] = [];
      // 各發傷害可遞減(6/5/5);凍結獎勵等倍率照比例帶進每一發
      const burstScale = tracker.subAction.damage > 0 ? dmg / tracker.subAction.damage : 1;
      for (let i = 0; i < tracker.subAction.burst; i++) {
        const u2 = this.targetUnit;
        if (!u2 || u2.hp <= 0) break;
        let d = Math.round((tracker.subAction.burstDamages?.[i] ?? tracker.subAction.damage) * burstScale);
        if (u2.staggerLeft > 0) d = Math.round(d * 1.25);
        u2.hp = Math.max(0, u2.hp - d);
        this.cb.onUnitHit?.(u2, d);
        total += d;
        hitUnits.add(u2);
        if (u2.hp <= 0) {
          downed.push(u2);
          this.cb.onEnemyDown?.(u2); // 立即結算,讓 targetUnit 跳到下一隻活的
        }
      }
      this.cb.onLog({
        id: this.logId++,
        actor: "你",
        target: hitUnits.size > 1 ? `連發掃倒,貫穿 ${hitUnits.size} 隻` : ([...hitUnits][0]?.label ?? "敵人"),
        symbol: tracker.subAction.symbol,
        damage: total,
      });
      if (downed.length > 0) this.cb.onUnitsChanged?.();
    }

    // 全體攻擊(2026-09 用戶定案):對所有活敵同等傷害——人越多,總傷害越高(火焰卷軸/未來的全體法術)
    if (!pelletsDone && tracker.subAction.aoe && dmg > 0) {
      pelletsDone = true;
      let total = 0;
      let hitCount = 0;
      let soleLabel = "敵人";
      const downed: EnemyUnit[] = [];
      for (const u2 of this.units) {
        if (u2.hp <= 0) continue;
        let d = dmg;
        if (u2.staggerLeft > 0) d = Math.round(d * 1.25);
        u2.hp = Math.max(0, u2.hp - d);
        this.cb.onUnitHit?.(u2, d);
        total += d;
        hitCount++;
        soleLabel = u2.label;
        if (u2.hp <= 0) downed.push(u2);
      }
      this.cb.onLog({
        id: this.logId++,
        actor: "你",
        target: hitCount > 1 ? `席捲全場,吞沒 ${hitCount} 隻` : soleLabel,
        symbol: tracker.subAction.symbol,
        damage: total,
      });
      for (const x of downed) this.cb.onEnemyDown?.(x);
      if (downed.length > 0) this.cb.onUnitsChanged?.();
    }

    const target = this.targetUnit;
    if (!pelletsDone && dmg > 0 && target) {
      // 招架(特殊武器,2026-09 用戶定案):出手瞬間對方的攻擊若在窗口內落地 → 那一擊會被架開(見 resolveEnemyAttack),
      // 這一刀照常命中並額外 +bonus;匕首的格擋輔助延長窗口
      const rip = tracker.subAction.riposte;
      if (rip && target.staggerLeft <= 0) {
        const remain = target.tracker.actualCost - target.tracker.elapsed;
        const window = rip.window + this.perfectWindowBonus;
        if (remain >= 0 && remain <= window) {
          ripostedHit = true;
          dmg += rip.bonus;
          target.riposteLeft = window + 0.05; // 留一點餘裕給同一幀的結算
        }
      }
      if (target.staggerLeft > 0) dmg = Math.round(dmg * 1.25); // 踉蹌中受創加成
      target.hp = Math.max(0, target.hp - dmg);
      this.cb.onUnitHit?.(target, dmg);
      // 壓制(劍類,2026-09 用戶定案):砍在對方蓄力過半時,把牠的動作條往回推——
      // 大招推得少、巨體減半;踉蹌中的對手條本來就凍著,不重複算
      const sup = tracker.subAction.suppress;
      if (sup && target.hp > 0 && target.staggerLeft <= 0 && target.tracker.progress >= sup.threshold) {
        let push = target.tracker.currentMove.heavy ? sup.heavyPush : sup.push;
        if (target.freezeResist) push /= 2;
        target.tracker.elapsed = Math.max(0, target.tracker.elapsed - target.tracker.actualCost * push);
        suppressedHit = true;
      }
      // 名刀鬼雪:命中疊加凍結值(Boss 抗性減半);滿 100 → 寒滯+強化下一擊,歸零重疊
      // 踉蹌值(2026-09 實裝):重武器命中疊加;巨體(同凍結抗性)減半;
      // 疊滿 100 → 踉蹌 STAGGER_DURATION 秒(行動條凍結+受創 ×1.25),期間不再疊加
      if (tracker.subAction.stagger && target.hp > 0 && target.staggerLeft <= 0) {
        target.staggerGauge += target.freezeResist ? Math.round(tracker.subAction.stagger / 2) : tracker.subAction.stagger;
        if (target.staggerGauge >= 100) {
          target.staggerGauge = 0;
          target.staggerLeft = STAGGER_DURATION;
          this.cb.onLog({ id: this.logId++, actor: "你", target: `這一下落在要害上。${target.label}的腳步亂了,重心還沒找回來`, symbol: "!!", damage: 0 });
        }
      }
      if (tracker.subAction.freeze && target.hp > 0) {
        target.freeze += target.freezeResist ? Math.round(tracker.subAction.freeze / 2) : tracker.subAction.freeze;
        if (target.freeze >= 100) {
          target.freeze = 0;
          target.chilled = true;
          this.playerEmpowerNext = true;
          if (target.freezeInterruptArmed) {
            // 教堂蛻變 B:鬼雪凍滿可以打斷牠一次——當前蓄力直接歸零
            target.freezeInterruptArmed = false;
            target.tracker.elapsed = 0;
            this.cb.onLog({ id: this.logId++, actor: "你", target: "寒氣炸進肢林深處——牠僵在半空,蓄力被打斷了", symbol: "*", damage: 0 });
          }
          this.cb.onLog({ id: this.logId++, actor: "你", target: "霜順著傷口炸開——牠的動作凍住了半拍", symbol: "*", damage: 0 });
        }
      }
    }
    if (heal > 0) this.playerHp = Math.min(this.playerMaxHp, this.playerHp + heal);
    if (!pelletsDone)
    this.cb.onLog({
      id: this.logId++,
      actor: "你",
      target: heal > 0 ? "自己" : (dmg > 0 && target ? target.label : "敵人"),
      symbol: tracker.subAction.symbol,
      damage: dmg,
      heal,
      suppressed: suppressedHit || undefined,
      riposted: ripostedHit || undefined,
    });
    // 目標倒下:通知 UI(護贓觸手歸還贓物等),目標自動跳到下一隻活的
    if (!pelletsDone && dmg > 0 && target && target.hp <= 0) {
      this.cb.onEnemyDown?.(target);
      this.cb.onUnitsChanged?.();
    }
    this.cb.onHpChange();

    this.firstStrikeBoost = false; // 危機意識:第一個行動放出去之後恢復正常充能

    // §2.3.2 定案(2026-09 用戶規格):
    // - 同類別:CD 補償——用掉的那一招歸零,其餘打對折保留(快招連刺時重招 0.2→0.3→0.35…收斂)
    // - 跨類別(近戰/遠程/法術/道具/格擋互相之間):重頭跑——出了別類的招,其他類全部歸零
    // - 道具例外(2026-09 用戶定案):整類是一個轉盤——用任何道具全類重轉(無補償),
    //   強力道具(slowReuse,如繃帶)讓下一輪回轉拖長為該秒數
    tracker.elapsed = 0;
    // 槍械彈匣(2026-09 定案:彈匣單位=子彈):每擊扣彈耗,扣光→下一個動作變「換彈」
    if (tracker.subAction.magazine) {
      tracker.magazineUsed += tracker.subAction.ammoPerUse ?? 1;
      if (tracker.magazineUsed >= tracker.subAction.magazine) tracker.needsReload = true;
    }
    if (cat.def.id === "item") {
      const nextSeconds = Math.max(tracker.subAction.slowReuse ?? 1, this.itemFieldSeconds ?? 0); // 下一輪回轉秒數(血雨領域可拖慢)
      for (const t of cat.trackers) {
        t.elapsed = 0;
        t.costMult = nextSeconds / (t.subAction.baseCost || 1);
        this.acknowledged.delete(this.key(cat.def.id, t.subAction.id));
      }
    } else {
      for (const t of cat.trackers) {
        if (t !== tracker) t.elapsed *= CARRYOVER_RATIO;
        this.acknowledged.delete(this.key(cat.def.id, t.subAction.id));
      }
    }
    for (const other of this.playerCategories) {
      if (other === cat) continue;
      other.resetAll();
      this.applyItemField(other);
      for (const t of other.trackers) this.acknowledged.delete(this.key(other.def.id, t.subAction.id));
    }

    this.resume();
    return true;
  }

  /**
   * 玩家選擇「暫不使用」目前就緒的子行動——不會觸發任何歸零或折損,
   * 純粹讓時鐘繼續走,好讓速度較慢的類別(如法術)有機會不被打斷地繼續累積。
   */
  skip() {
    for (const cat of this.playerCategories) {
      for (const t of cat.trackers) {
        if (t.ready) this.acknowledged.add(this.key(cat.def.id, t.subAction.id));
      }
    }
    this.resume();
  }

  private resume() {
    this.paused = false;
    this.cb.onPauseChange(false);
  }

  private key(categoryId: CategoryId, subActionId: string) {
    return `${categoryId}:${subActionId}`;
  }
}

/** 使用某類別的行動後,其他類別保留的預讀進度比例(design-notes.md 待補:目前先用 0.5 當原型數值) */
const CARRYOVER_RATIO = 0.5;
/** 決策暫停的就緒寬限(2026-09 用戶定案):暫停觸發那一刻,0.05 秒內就會跑滿的行動條直接補滿視為就緒——
 * 免得獵弓(1.0s)先滿把鐵槍(1.2s)卡在 99% 差幾毫秒,還得多按一次「暫不使用」 */
const PAUSE_SNAP_SECONDS = 0.05;
/** 踉蹌持續秒數(重武器疊滿觸發):行動條凍結+受創 ×1.25 */
const STAGGER_DURATION = 2.5;
/** 完美格擋大招的硬直秒數(2026-09 方案C):同踉蹌效果 */
const PERFECT_PARRY_STAGGER = 3.0;

// 格擋窗口(§用戶規格 2026-09):啟動後 0.5 秒內的第一擊被接下;前 0.1 秒是完全格擋
export const BLOCK_WINDOW = 0.5;
export const BLOCK_PERFECT = 0.1;
