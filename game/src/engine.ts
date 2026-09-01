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
  /** 混亂發作:UI 隨機執行一個「就緒且可用」的行動,執行了回 true(可選;模擬器不接) */
  onConfusedAct?: () => boolean;
  /** 格擋接下一擊(perfect=完全格擋):UI 扣盾耐久用(完全格擋免費) */
  onBlocked?: (perfect: boolean) => void;
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
  /** 控制免疫剩餘秒數(醒神鹽):期間不吃暈眩/遲緩/混亂 */
  controlImmuneLeft = 0;
  /** 危機意識(改造藥劑):開戰後第一次充能全體 ×2,放出任一行動即恢復正常 */
  firstStrikeBoost = false;
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
    opts?: { enemyHp?: number; enemyLabel?: string },
  ) {
    this.playerCategories = categories.map((c) => new CategoryTracker(c, () => this.playerSpeed * (this.slowLeft > 0 ? 0.5 : 1) * (this.firstStrikeBoost ? 2 : 1)));
    this.enemy = new EnemyTracker(enemyMoves, () => 1);
    if (opts?.enemyHp) {
      this.enemyHp = opts.enemyHp;
      this.enemyMaxHp = opts.enemyHp;
    }
    if (opts?.enemyLabel) this.enemyLabel = opts.enemyLabel;
  }

  /** 舉盾格擋(§用戶規格 2026-09):開 0.5s 防禦窗,前 0.1s 完全格擋;冷卻由盾決定 */
  useBlock(): boolean {
    if (!this.shield || this.blockCooldownLeft > 0 || this.blockWindowLeft > 0) return false;
    if (this.stunLeft > 0) return false; // 暈眩中舉不起盾
    this.blockWindowLeft = BLOCK_WINDOW;
    this.blockCooldownLeft = this.shield.cd;
    // 格擋自成一類(2026-09 用戶定案):跨類別互不干擾——舉盾不動任何行動條,只吃自己的冷卻
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
      // 格擋判定:防禦窗內接下這一擊——前 0.1s 完全格擋(傷害/控制/異常全免),
      // 之後半格擋(依盾減傷,附帶效果照吃);一面盾一次窗只接一擊
      let blocked: "perfect" | "partial" | null = null;
      let dmg = move.damage;
      if (this.blockWindowLeft > 0 && this.shield) {
        blocked = this.blockWindowLeft >= BLOCK_WINDOW - BLOCK_PERFECT ? "perfect" : "partial";
        dmg = blocked === "perfect" ? 0 : Math.max(0, Math.ceil(dmg * (1 - this.shield.reduce)));
        this.blockWindowLeft = 0;
        this.cb.onBlocked?.(blocked === "perfect");
      }
      if (blocked === "perfect") {
        this.cb.onLog({ id: this.logId++, actor: "你", target: `完全格擋!盾面把${this.enemyLabel}的攻勢整個彈開`, symbol: "◎", damage: 0 });
      } else {
        this.playerHp = Math.max(0, this.playerHp - dmg);
        this.cb.onLog({
          id: this.logId++,
          actor: this.enemyLabel,
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
      this.cb.onHpChange();
    } else {
      // 零傷害的行為(如發狂者的「顫抖」、哼歌者的「哼唱」):空轉或純異常疊加
      this.cb.onLog({ id: this.logId++, actor: this.enemyLabel, target: move.label, symbol: move.symbol, damage: 0 });
      this.applyConfusion(move);
    }
    this.enemy.rollNextMove();
    // 大招才有蓄力描寫:「牠抬起了手」比招式名更能讓玩家學會判讀
    if (this.enemy.currentMove.tell) this.cb.onTell?.(this.enemy.currentMove.tell);
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

    this.firstStrikeBoost = false; // 危機意識:第一個行動放出去之後恢復正常充能

    // §2.3.2 修訂(2026-09 用戶定案):CD 補償只在「同類別內」作用——
    // 用掉的那一招歸零,同類別其他行動打對折保留(快招連刺時重招 0.2 → 0.3 → 0.35 …收斂);
    // 跨類別(近戰/遠程/法術/道具/格擋)彼此完全獨立,互不干擾
    tracker.elapsed = 0;
    for (const t of cat.trackers) {
      if (t !== tracker) t.elapsed *= CARRYOVER_RATIO;
      this.acknowledged.delete(this.key(cat.def.id, t.subAction.id));
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
