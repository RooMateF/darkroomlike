// 教堂 Boss 蒙地卡羅(2026-09 二階段版):驗證「鋼階頂配打不打得贏」。
// 用真引擎(CombatEngine,含踉蹌系統)驅動,只在外層模擬玩家策略與消耗品記帳。
// 跑法:npx esbuild --bundle --platform=node → node(不進遊戲 bundle)
import { CombatEngine } from "../engine";
import { GUARDIANS, CHURCH_PHASE2_MOVES, CHURCH_PHASE2_PATTERN } from "../enemies";
import { buildPlayerCategories } from "../demo-data";
import type { Carried } from "../carried";

interface SimConfig {
  name: string;
  salts: number;
  bandages: number;
  elixirs: number;
  jerky: number;
  useShield: boolean;
  /** 格擋時機的人手抖動(秒):0.04=神反應,0.08=普通熟練,0.15=手殘 */
  blockJitter: number;
  crisis: boolean;
  /** 只打一階段(關掉半血蛻變) */
  noPhase2?: boolean;
  /** 帶鋼大劍(真踉蹌系統) */
  greatsword?: boolean;
  /** 提案①:完美格擋大招 → Boss 硬直 3s(尚未實裝,模擬層原型) */
  perfectStagger?: boolean;
  /** 提案②:舉盾不歸零其他行動條(尚未實裝,模擬層原型) */
  blockKeepsBars?: boolean;
}

function runOnce(cfg: SimConfig): { win: boolean; t: number; hpLeft: number; bossHp: number; phase2: boolean } {
  const stocks = { bandage: cfg.bandages, elixir: cfg.elixirs, salt: cfg.salts, jerky: cfg.jerky };
  const weapons: Record<string, number> = { "steel-spear": 1, "steel-sword": 1, oniyuki: 1 };
  if (cfg.greatsword) weapons["steel-greatsword"] = 1;
  const carried = {
    weapons,
    durability: { "steel-spear": 80, "steel-sword": 70, oniyuki: 60, "steel-greatsword": 75 },
    bandages: stocks.bandage,
    elixirs: stocks.elixir,
    salts: stocks.salt,
    jerky: stocks.jerky,
    loot: {},
  } as unknown as Carried;
  const categories = buildPlayerCategories(carried);

  const church = GUARDIANS.church;
  let pendingStagger = 0;
  const engine = new CombatEngine(categories, church.moves, {
    onLog: () => {},
    onPauseChange: () => {},
    onHpChange: () => {},
    onBlocked: (perfect) => { if (perfect && cfg.perfectStagger) pendingStagger = 3; },
  }, { enemyHp: church.hp, enemyLabel: church.label, freezeResist: true });

  engine.playerMaxHp = 90; // 鋼甲
  engine.playerHp = 90;
  if (cfg.useShield) engine.shield = { label: "鋼盾", reduce: 0.8, cd: 3.5 };
  if (cfg.crisis) engine.firstStrikeBoost = true;

  const eng = engine as unknown as { step: (dt: number) => void };
  let transformed = false;
  let t = 0;
  const DT = 0.02;
  let nextPressLead = 0.05 + (Math.random() * 2 - 1) * cfg.blockJitter;

  const useItem = (id: string): boolean => {
    const ok = engine.useSubAction("item", id);
    if (!ok) return false;
    if (id === "bandage") { stocks.bandage--; engine.clearStatus("bleed"); }
    if (id === "elixir") { stocks.elixir--; engine.clearStatus("poison"); engine.clearStatus("bleed"); }
    if (id === "salt") { stocks.salt--; engine.clearControl(6); }
    if (id === "jerky") stocks.jerky--;
    return true;
  };
  const itemReady = (id: string): boolean => {
    const cat = engine.playerCategories.find((c) => c.def.id === "item");
    return !!cat?.trackers.find((x) => x.subAction.id === id)?.ready;
  };
  const weaponReady = (id: string): boolean => {
    const cat = engine.playerCategories.find((c) => c.def.id === "melee");
    return !!cat?.trackers.find((x) => x.subAction.id === id)?.ready;
  };
  const useWeapon = (id: string): boolean => engine.useSubAction("melee", id);

  while (t < 420) {
    eng.step(DT);
    t += DT;
    if (engine.playerHp <= 0) return { win: false, t, hpLeft: 0, bossHp: engine.enemyHp, phase2: transformed };
    if (engine.enemyHp <= 0) return { win: true, t, hpLeft: engine.playerHp, bossHp: 0, phase2: transformed };

    const u = engine.units[0];
    // 提案①原型:完美格擋 → 硬直(借用引擎的踉蹌欄位)
    if (pendingStagger > 0) { u.staggerLeft = Math.max(u.staggerLeft, pendingStagger); pendingStagger = 0; }

    if (!cfg.noPhase2 && !transformed && u.hp <= u.maxHp / 2) {
      transformed = true;
      engine.transformUnit(u, CHURCH_PHASE2_MOVES, { hasteMult: 1 / 0.85, pattern: CHURCH_PHASE2_PATTERN });
      u.freezeInterruptArmed = true;
      engine.stormBleed = 1; // 2026-09 下修
      engine.setItemField(1.5);
    }

    const move = u.tracker.currentMove;
    const timeToLand = u.staggerLeft > 0 ? 99 : u.tracker.actualCost - u.tracker.elapsed;

    // 醒神鹽:大控制招快落地、身上沒免疫 → 提前含上
    if (
      stocks.salt > 0 && itemReady("salt") && move.control && timeToLand < 1.1 &&
      engine.controlImmuneLeft < timeToLand && engine.stunLeft <= 0
    ) { useItem("salt"); continue; }

    // 格擋:只接重擊(≥20)
    if (
      cfg.useShield && engine.blockCooldownLeft <= 0 && engine.blockWindowLeft <= 0 &&
      move.damage >= 20 && timeToLand <= Math.max(0.01, nextPressLead) && engine.stunLeft <= 0
    ) {
      if (cfg.blockKeepsBars) {
        const snap = engine.playerCategories.map((c) => c.trackers.map((tr) => ({ tr, e: tr.elapsed, m: tr.costMult })));
        engine.useBlock();
        for (const cat of snap) for (const x of cat) { x.tr.elapsed = x.e; x.tr.costMult = x.m; }
      } else {
        engine.useBlock();
      }
      nextPressLead = 0.05 + (Math.random() * 2 - 1) * cfg.blockJitter;
      continue;
    }

    // 補血
    if (engine.stunLeft <= 0) {
      if (stocks.bandage > 0 && itemReady("bandage") && engine.playerHp <= 55) { useItem("bandage"); continue; }
      if (stocks.elixir > 0 && itemReady("elixir") && (engine.playerHp <= 40 || engine.playerStatus.bleed.level >= 2)) { useItem("elixir"); continue; }
      if (stocks.bandage > 0 && itemReady("bandage") && engine.playerHp <= 70) { useItem("bandage"); continue; }
      if (stocks.jerky > 0 && itemReady("jerky") && stocks.bandage <= 0 && engine.playerHp <= 60) { useItem("jerky"); continue; }
    }

    // 輸出:大劍優先疊踉蹌,其次鋼槍/鋼劍輪替,鬼雪墊
    if (engine.stunLeft <= 0) {
      if (cfg.greatsword && weaponReady("steel-greatsword")) { useWeapon("steel-greatsword"); continue; }
      if (weaponReady("steel-spear")) { useWeapon("steel-spear"); continue; }
      if (weaponReady("steel-sword")) { useWeapon("steel-sword"); continue; }
      if (weaponReady("oniyuki")) { useWeapon("oniyuki"); continue; }
    }
    if (engine.paused) engine.skip();
  }
  return { win: false, t, hpLeft: engine.playerHp, bossHp: engine.enemyHp, phase2: transformed };
}

const N = 400;
const configs: SimConfig[] = [
  // ---- 一階段單獨(用戶提問 2026-09):現行規則 ----
  { name: "P1 頂配(無大劍)σ0.08", salts: 5, bandages: 8, elixirs: 3, jerky: 4, useShield: true, blockJitter: 0.08, crisis: true, noPhase2: true },
  { name: "P1 頂配+大劍 σ0.08", salts: 5, bandages: 8, elixirs: 3, jerky: 4, useShield: true, blockJitter: 0.08, crisis: true, noPhase2: true, greatsword: true },
  { name: "P1 頂配+大劍 神σ0.04", salts: 5, bandages: 8, elixirs: 3, jerky: 4, useShield: true, blockJitter: 0.04, crisis: true, noPhase2: true, greatsword: true },
  { name: "P1 頂配+大劍 手殘σ0.15", salts: 5, bandages: 8, elixirs: 3, jerky: 4, useShield: true, blockJitter: 0.15, crisis: true, noPhase2: true, greatsword: true },
  { name: "P1 +大劍 鐵路滿載 繃20藥6鹽6", salts: 6, bandages: 20, elixirs: 6, jerky: 10, useShield: true, blockJitter: 0.08, crisis: true, noPhase2: true, greatsword: true },
  { name: "P1 +大劍 無盾", salts: 5, bandages: 8, elixirs: 3, jerky: 4, useShield: false, blockJitter: 0.08, crisis: true, noPhase2: true, greatsword: true },
  // ---- 參考:一階段 + 提案①/② ----
  { name: "P1 +大劍+①完美格擋硬直 σ0.08", salts: 5, bandages: 8, elixirs: 3, jerky: 4, useShield: true, blockJitter: 0.08, crisis: true, noPhase2: true, greatsword: true, perfectStagger: true },
  { name: "P1 +大劍+①+② σ0.08", salts: 5, bandages: 8, elixirs: 3, jerky: 4, useShield: true, blockJitter: 0.08, crisis: true, noPhase2: true, greatsword: true, perfectStagger: true, blockKeepsBars: true },
  // ---- 參考:完整兩階段(現行+大劍) ----
  { name: "全程 頂配+大劍 σ0.08", salts: 5, bandages: 8, elixirs: 3, jerky: 4, useShield: true, blockJitter: 0.08, crisis: true, greatsword: true },
];

for (const cfg of configs) {
  let wins = 0;
  let tSum = 0;
  let hpSum = 0;
  let diedP1 = 0;
  let diedP2 = 0;
  let bossHpSum = 0;
  for (let i = 0; i < N; i++) {
    const r = runOnce(cfg);
    if (r.win) { wins++; tSum += r.t; hpSum += r.hpLeft; }
    else { if (r.phase2) diedP2++; else diedP1++; bossHpSum += r.bossHp; }
  }
  const rate = ((wins / N) * 100).toFixed(1);
  const avgT = wins ? (tSum / wins).toFixed(0) : "-";
  const avgHp = wins ? (hpSum / wins).toFixed(0) : "-";
  const lost = N - wins;
  const avgBossHp = lost ? (bossHpSum / lost).toFixed(0) : "-";
  console.log(`${cfg.name}: 勝率 ${rate}%(勝均時 ${avgT}s/餘血 ${avgHp});敗:P1死 ${diedP1}/P2死 ${diedP2},Boss均餘 ${avgBossHp}`);
}
