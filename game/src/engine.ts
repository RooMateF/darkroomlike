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

  constructor(
    private readonly moves: EnemyMove[],
    private readonly speedMultiplier: () => number,
  ) {
    this.currentMove = pickRandom(moves);
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
    this.currentMove = pickRandom(this.moves);
  }
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export interface EngineCallbacks {
  onLog: (entry: LogEntry) => void;
  onPauseChange: (paused: boolean) => void;
  onHpChange: () => void;
  /** 敵方開始蓄力大招時的敘述(可選;模擬器不接) */
  onTell?: (text: string) => void;
}

/**
 * 核心排程引擎,實作 design-notes.md § 2.1–2.9:
 * - 玩家行動槽跑滿即暫停等待輸入(Wait 模式,§2.6)
 * - 敵方不受暫停影響地持續運作,直到出招後重新選招(§2.9)
 */
export class CombatEngine {
  playerCategories: CategoryTracker[];
  enemy: EnemyTracker;
  paused = false;
  playerHp = 30;
  playerMaxHp = 30;
  enemyHp = 15;
  enemyMaxHp = 15;
  enemyLabel = "敵人";
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
  /** 控制免疫剩餘秒數(醒神鹽):期間不吃暈眩/遲緩 */
  controlImmuneLeft = 0;
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
    opts?: { enemyHp?: number; enemyLabel?: string },
  ) {
    this.playerCategories = categories.map((c) => new CategoryTracker(c, () => this.playerSpeed * (this.slowLeft > 0 ? 0.5 : 1)));
    this.enemy = new EnemyTracker(enemyMoves, () => 1);
    if (opts?.enemyHp) {
      this.enemyHp = opts.enemyHp;
      this.enemyMaxHp = opts.enemyHp;
    }
    if (opts?.enemyLabel) this.enemyLabel = opts.enemyLabel;
  }

  /** 解除控制效果並給予免疫窗口(醒神鹽) */
  clearControl(immuneSeconds: number) {
    this.stunLeft = 0;
    this.slowLeft = 0;
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

    if (!this.paused) {
      // 控制效果倒數
      if (this.stunLeft > 0) this.stunLeft = Math.max(0, this.stunLeft - dt);
      if (this.slowLeft > 0) this.slowLeft = Math.max(0, this.slowLeft - dt);
      if (this.controlImmuneLeft > 0) this.controlImmuneLeft = Math.max(0, this.controlImmuneLeft - dt);
      // 暈眩中:你的行動條全部凍結,敵方照常進逼
      if (this.stunLeft <= 0) {
        for (const cat of this.playerCategories) cat.tick(dt);
      }
      this.enemy.tick(dt);

      // 敵方出招不受玩家暫停狀態影響,出招後立刻重選下一招(§2.9)
      if (this.enemy.progress >= 1) {
        this.resolveEnemyAttack();
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
      // 玩家可以選擇使用,也可以明確選擇「暫不使用」(見 skip()),讓速度較慢的類別有機會繼續累積,
      // 不會因為冷兵器/熱武器天生較快,就強迫玩家每次都得用掉它們,永遠碰不到法術
      const hasNewlyReady = this.playerCategories.some((c) =>
        c.trackers.some((t) => t.ready && !this.acknowledged.has(this.key(c.def.id, t.subAction.id))),
      );
      if (hasNewlyReady) {
        this.paused = true;
        this.cb.onPauseChange(true);
      }
    }
  }

  private resolveEnemyAttack() {
    const move = this.enemy.currentMove;
    if (move.damage > 0) {
      this.playerHp = Math.max(0, this.playerHp - move.damage);
      this.cb.onLog({
        id: this.logId++,
        actor: this.enemyLabel,
        target: "你",
        symbol: move.symbol,
        damage: move.damage,
      });

      // 控制效果:暈眩(行動凍結)/遲緩(充能減半);醒神鹽的免疫窗口可以擋掉
      if (move.control && this.controlImmuneLeft > 0) {
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

      // 命中附帶異常值疊加(累積制,不是機率):滿 100 升一級,最高 3 級
      if (move.status) {
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
      this.cb.onHpChange();
    } else {
      // 零傷害的行為(如發狂者的「顫抖」):純粹的空轉,呈現不連貫感
      this.cb.onLog({ id: this.logId++, actor: this.enemyLabel, target: move.label, symbol: move.symbol, damage: 0 });
    }
    this.enemy.rollNextMove();
    // 大招才有蓄力描寫:「牠抬起了手」比招式名更能讓玩家學會判讀
    if (this.enemy.currentMove.tell) this.cb.onTell?.(this.enemy.currentMove.tell);
  }

  /** 玩家選擇使用某個已就緒的子行動;回傳是否真的執行了(未就緒時 false) */
  useSubAction(categoryId: CategoryId, subActionId: string): boolean {
    const cat = this.playerCategories.find((c) => c.def.id === categoryId);
    if (!cat) return false;
    const tracker = cat.trackers.find((t) => t.subAction.id === subActionId);
    if (!tracker || !tracker.ready) return false;

    const dmg = tracker.subAction.damage;
    const heal = tracker.subAction.heal ?? 0;
    if (dmg > 0) this.enemyHp = Math.max(0, this.enemyHp - dmg);
    if (heal > 0) this.playerHp = Math.min(this.playerMaxHp, this.playerHp + heal);
    this.cb.onLog({
      id: this.logId++,
      actor: "你",
      target: heal > 0 ? "自己" : "敵人",
      symbol: tracker.subAction.symbol,
      damage: dmg,
      heal,
    });
    this.cb.onHpChange();

    // 使用的類別:內部所有子行動計時一起歸零(§2.3.2),並清掉這個類別的「已回應」紀錄
    cat.resetAll();
    for (const t of cat.trackers) this.acknowledged.delete(this.key(cat.def.id, t.subAction.id));

    // 其他類別:不是完全不受影響,而是打折保留原本的預讀進度(「一回合一動」的節奏感)
    // 例如魔法原本預讀到 60%,近戰出手後,魔法會打折保留成 30% 繼續往下跑,而不是歸零重來
    for (const other of this.playerCategories) {
      if (other === cat) continue;
      for (const t of other.trackers) {
        t.elapsed *= CARRYOVER_RATIO;
      }
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
