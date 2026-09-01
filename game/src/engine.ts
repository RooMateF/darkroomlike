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
}

/** 類別內每個子行動各自累積進度,但共用同一次歸零(見 design-notes.md § 2.3.2) */
class SubActionTracker {
  elapsed = 0;

  constructor(
    public readonly subAction: SubAction,
    private readonly speedMultiplier: () => number,
  ) {}

  get actualCost(): number {
    return (this.subAction.baseCost * BASE_INTERVAL) / this.speedMultiplier();
  }

  get progress(): number {
    return Math.min(1, this.elapsed / this.actualCost);
  }

  get ready(): boolean {
    return this.progress >= 1;
  }

  tick(dt: number) {
    if (this.elapsed < this.actualCost) {
      this.elapsed = Math.min(this.actualCost, this.elapsed + dt);
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
    for (const t of this.trackers) t.elapsed = 0;
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
  readonly freezeResist: boolean;

  constructor(
    public readonly moves: EnemyMove[],
    opts: EnemyUnitOpts,
  ) {
    this.hp = opts.hp;
    this.maxHp = opts.hp;
    this.label = opts.label;
    this.tag = opts.tag;
    this.freezeResist = opts.freezeResist ?? false;
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
    this.blockWindowLeft = BLOCK_WINDOW;
    this.blockCooldownLeft = this.shield.cd;
    // 格擋自成一類(2026-09 用戶定案):對其他類別而言就是「別類的招」——舉盾讓所有行動條重頭跑;
    // 反向不成立:出招不重置盾的冷卻(盾 CD 是裝備計時,不是充能條,否則盾永遠舉不起來)
    for (const c of this.playerCategories) {
      c.resetAll();
      for (const t of c.trackers) this.acknowledged.delete(this.key(c.def.id, t.subAction.id));
    }
    this.cb.onLog({ id: this.logId++, actor: "你", target: "舉起了盾", symbol: "[]", damage: 0 });
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
    this.lastT = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(0.1, (t - this.lastT) / 1000);
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
      // 暈眩中:你的行動條全部凍結,敵方照常進逼
      if (this.stunLeft <= 0) {
        for (const cat of this.playerCategories) cat.tick(dt);
      }
      // 每一隻活著的敵人各自進逼(多目標:同時進攻)
      for (const u of this.units) {
        if (u.hp <= 0) continue;
        u.tracker.tick(dt);
        if (u.tracker.progress >= 1) {
          this.resolveEnemyAttack(u);
          if (this.playerHp <= 0) return;
        }
      }

      // 異常狀態持續傷害:每 2 秒依等級總和扣血(§2.11.2)
      this.dotTimer += dt;
      if (this.dotTimer >= 2) {
        this.dotTimer -= 2;
        const dot = this.playerStatus.poison.level + this.playerStatus.bleed.level;
        if (dot > 0 && this.playerHp > 0) {
          this.playerHp = Math.max(0, this.playerHp - dot);
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
      if (this.blockWindowLeft > 0 && this.shield) {
        blocked = this.blockWindowLeft >= BLOCK_WINDOW - BLOCK_PERFECT ? "perfect" : "partial";
        dmg = blocked === "perfect" ? 0 : Math.max(0, Math.ceil(dmg * (1 - this.shield.reduce)));
        this.blockWindowLeft = 0;
        this.cb.onBlocked?.(blocked === "perfect");
      }
      if (blocked === "perfect") {
        this.cb.onLog({ id: this.logId++, actor: "你", target: `完全格擋!盾面把${unit.label}的攻勢整個彈開`, symbol: "◎", damage: 0 });
      } else {
        this.playerHp = Math.max(0, this.playerHp - dmg);
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

    let dmg = tracker.subAction.damage;
    if (dmg > 0 && this.playerEmpowerNext) {
      dmg = Math.round(dmg * 1.5); // 凍結獎勵:下一擊 ×1.5
      this.playerEmpowerNext = false;
    }
    const heal = tracker.subAction.heal ?? 0;
    const target = this.targetUnit;
    if (dmg > 0 && target) {
      target.hp = Math.max(0, target.hp - dmg);
      // 名刀鬼雪:命中疊加凍結值(Boss 抗性減半);滿 100 → 寒滯+強化下一擊,歸零重疊
      if (tracker.subAction.freeze && target.hp > 0) {
        target.freeze += target.freezeResist ? Math.round(tracker.subAction.freeze / 2) : tracker.subAction.freeze;
        if (target.freeze >= 100) {
          target.freeze = 0;
          target.chilled = true;
          this.playerEmpowerNext = true;
          this.cb.onLog({ id: this.logId++, actor: "你", target: "霜順著傷口炸開——牠的動作凍住了半拍", symbol: "*", damage: 0 });
        }
      }
    }
    if (heal > 0) this.playerHp = Math.min(this.playerMaxHp, this.playerHp + heal);
    this.cb.onLog({
      id: this.logId++,
      actor: "你",
      target: heal > 0 ? "自己" : (dmg > 0 && target ? target.label : "敵人"),
      symbol: tracker.subAction.symbol,
      damage: dmg,
      heal,
    });
    // 目標倒下:通知 UI(護贓觸手歸還贓物等),目標自動跳到下一隻活的
    if (dmg > 0 && target && target.hp <= 0) {
      this.cb.onEnemyDown?.(target);
      this.cb.onUnitsChanged?.();
    }
    this.cb.onHpChange();

    this.firstStrikeBoost = false; // 危機意識:第一個行動放出去之後恢復正常充能

    // §2.3.2 定案(2026-09 用戶規格):
    // - 同類別:CD 補償——用掉的那一招歸零,其餘打對折保留(快招連刺時重招 0.2→0.3→0.35…收斂)
    // - 跨類別(近戰/遠程/法術/道具/格擋互相之間):重頭跑——出了別類的招,其他類全部歸零
    tracker.elapsed = 0;
    for (const t of cat.trackers) {
      if (t !== tracker) t.elapsed *= CARRYOVER_RATIO;
      this.acknowledged.delete(this.key(cat.def.id, t.subAction.id));
    }
    for (const other of this.playerCategories) {
      if (other === cat) continue;
      other.resetAll();
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

// 格擋窗口(§用戶規格 2026-09):啟動後 0.5 秒內的第一擊被接下;前 0.1 秒是完全格擋
export const BLOCK_WINDOW = 0.5;
export const BLOCK_PERFECT = 0.1;
