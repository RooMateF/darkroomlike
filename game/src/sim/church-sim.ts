// 教堂 Boss 蒙地卡羅(2026-09 二階段版):驗證「鋼階頂配打不打得贏」。
// 用真引擎(CombatEngine)驅動,只在外層模擬玩家策略與消耗品記帳。
// 跑法:esbuild bundle → node(見開發筆記;不進遊戲 bundle)
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
  /** 格擋時機的人手抖動(秒,常態分布 σ):0.04=神反應,0.08=普通熟練,0.15=手殘 */
  blockJitter: number;
  crisis: boolean;
  noPhase2?: boolean;
  tuned?: boolean;
}

function runOnce(cfg: SimConfig): { win: boolean; t: number; hpLeft: number; bossHp: number; phase2: boolean } {
  const stocks = { bandage: cfg.bandages, elixir: cfg.elixirs, salt: cfg.salts, jerky: cfg.jerky };
  const carried = {
    weapons: { "steel-spear": 1, "steel-sword": 1, oniyuki: 1 },
    durability: { "steel-spear": 80, "steel-sword": 70, oniyuki: 60 },
    bandages: stocks.bandage,
    elixirs: stocks.elixir,
    salts: stocks.salt,
    jerky: stocks.jerky,
    loot: {},
  } as unknown as Carried;
  const categories = buildPlayerCategories(carried);

  const church = GUARDIANS.church;
  // 下修候選(提案用):一階段 hp360、低語slow1.8、撕裂11、鐘鳴24+暈1.2;二階段 4/11(血30)/22(暈1.0)、血雨1、道具1.3s、CD×0.9
  const p1Moves = cfg.tuned
    ? [
        { id: "whisper", label: "低語", baseCost: 1.6, symbol: "…", damage: 6, control: { kind: "slow" as const, duration: 1.8 }, tell: "x" },
        { id: "rend", label: "撕裂", baseCost: 1.2, symbol: "»", damage: 11, status: { kind: "bleed" as const, amount: 45 } },
        { id: "toll", label: "鐘鳴", baseCost: 3.0, symbol: "»", damage: 24, control: { kind: "stun" as const, duration: 1.2 }, tell: "x" },
      ]
    : church.moves;
  const p2Moves = cfg.tuned
    ? [
        { id: "stab", label: "百手穿刺", baseCost: 0.75, symbol: "»", damage: 4 },
        { id: "limb-sweep", label: "肢林橫掃", baseCost: 1.6, symbol: "»", damage: 11, status: { kind: "bleed" as const, amount: 30 }, tell: "x" },
        { id: "hundred-slam", label: "百手壓下", baseCost: 2.6, symbol: "»", damage: 22, control: { kind: "stun" as const, duration: 1.0 }, pierceBlock: true, tell: "x" },
      ]
    : CHURCH_PHASE2_MOVES;
  let tellSeen = false;
  const engine = new CombatEngine(categories, p1Moves, {
    onLog: () => {},
    onPauseChange: () => {},
    onHpChange: () => {},
    onTell: () => { tellSeen = true; },
  }, { enemyHp: cfg.tuned ? 360 : church.hp, enemyLabel: church.label, freezeResist: true });

  engine.playerMaxHp = 90; // 鋼甲
  engine.playerHp = 90;
  if (cfg.useShield) engine.shield = { label: "鋼盾", reduce: 0.8, cd: 3.5 };
  if (cfg.crisis) engine.firstStrikeBoost = true;

  const eng = engine as unknown as { step: (dt: number) => void };
  let transformed = false;
  let t = 0;
  const DT = 0.02;
  // 這一次格擋的預按提前量(反應誤差):目標是在落點前 0.05s 按下(完全格擋窗 0.1s)
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
    const tr = cat?.trackers.find((x) => x.subAction.id === id);
    return !!tr?.ready;
  };
  const weaponReady = (id: string): boolean => {
    const cat = engine.playerCategories.find((c) => c.def.id === "melee");
    return !!cat?.trackers.find((x) => x.subAction.id === id)?.ready;
  };

  while (t < 420) {
    eng.step(DT);
    t += DT;
    if (engine.playerHp <= 0) return { win: false, t, hpLeft: 0, bossHp: engine.enemyHp, phase2: transformed };
    if (engine.enemyHp <= 0) return { win: true, t, hpLeft: engine.playerHp, bossHp: 0, phase2: transformed };

    const u = engine.units[0];

    // 半血蛻變(照 main.ts churchCheck)
    if (!cfg.noPhase2 && !transformed && u.hp <= u.maxHp / 2) {
      transformed = true;
      engine.transformUnit(u, p2Moves, { hasteMult: cfg.tuned ? 1 / 0.9 : 1 / 0.85, pattern: CHURCH_PHASE2_PATTERN });
      u.freezeInterruptArmed = true;
      engine.stormBleed = cfg.tuned ? 1 : 2;
      engine.setItemField(cfg.tuned ? 1.3 : 1.5);
    }

    const move = u.tracker.currentMove;
    const timeToLand = u.tracker.actualCost - u.tracker.elapsed;

    // 醒神鹽:大控制招快落地、身上沒免疫 → 提前含上(和補血搶同一個道具盤)
    if (
      stocks.salt > 0 && itemReady("salt") && move.control && timeToLand < 1.1 &&
      engine.controlImmuneLeft < timeToLand && engine.stunLeft <= 0
    ) {
      useItem("salt");
      continue;
    }

    // 格擋:只接重擊(≥13);抓落點前 0.05s(誤差 cfg.blockJitter)
    if (
      cfg.useShield && engine.blockCooldownLeft <= 0 && engine.blockWindowLeft <= 0 &&
      move.damage >= 26 && timeToLand <= Math.max(0.01, nextPressLead) && engine.stunLeft <= 0
    ) {
      engine.useBlock();
      nextPressLead = 0.05 + (Math.random() * 2 - 1) * cfg.blockJitter;
      continue;
    }

    // 補血:血線越低越急;道具盤是單一轉盤,鹽/繃帶搶同一格
    if (engine.stunLeft <= 0) {
      if (stocks.bandage > 0 && itemReady("bandage") && engine.playerHp <= 55) { useItem("bandage"); continue; }
      if (stocks.elixir > 0 && itemReady("elixir") && (engine.playerHp <= 40 || engine.playerStatus.bleed.level >= 2)) { useItem("elixir"); continue; }
      if (stocks.bandage > 0 && itemReady("bandage") && engine.playerHp <= 70) { useItem("bandage"); continue; }
      if (stocks.jerky > 0 && itemReady("jerky") && stocks.bandage <= 0 && engine.playerHp <= 60) { useItem("jerky"); continue; }
    }

    // 輸出:鋼槍優先,鬼雪墊(疊凍結);格擋窗開著就別出手(出招不清窗,但省判斷)
    if (engine.stunLeft <= 0) {
      if (weaponReady("steel-spear")) { engine.useSubAction("melee", "steel-spear"); continue; }
      if (weaponReady("steel-sword")) { engine.useSubAction("melee", "steel-sword"); continue; }
      if (weaponReady("oniyuki")) { engine.useSubAction("melee", "oniyuki"); continue; }
    }
    if (engine.paused) engine.skip();
  }
  return { win: false, t, hpLeft: engine.playerHp, bossHp: engine.enemyHp, phase2: transformed }; // 超時=耗死
}

const N = 400;
const configs: SimConfig[] = [
  { name: "下修案:頂配σ0.08", salts: 5, bandages: 8, elixirs: 3, jerky: 4, useShield: true, blockJitter: 0.08, crisis: true, tuned: true },
  { name: "下修案:神格擋σ0.04", salts: 5, bandages: 8, elixirs: 3, jerky: 4, useShield: true, blockJitter: 0.04, crisis: true, tuned: true },
  { name: "下修案:手殘σ0.15", salts: 5, bandages: 8, elixirs: 3, jerky: 4, useShield: true, blockJitter: 0.15, crisis: true, tuned: true },
  { name: "下修案:無鹽", salts: 0, bandages: 8, elixirs: 3, jerky: 4, useShield: true, blockJitter: 0.08, crisis: true, tuned: true },
  { name: "下修案:無盾", salts: 5, bandages: 8, elixirs: 3, jerky: 4, useShield: false, blockJitter: 0.08, crisis: true, tuned: true },
  { name: "對照:只有一階段(無蛻變)σ0.08", salts: 5, bandages: 8, elixirs: 3, jerky: 4, useShield: true, blockJitter: 0.08, crisis: true, noPhase2: true },
  { name: "對照:只有一階段(無蛻變)無盾", salts: 5, bandages: 8, elixirs: 3, jerky: 4, useShield: false, blockJitter: 0.08, crisis: true, noPhase2: true },
  { name: "頂配(繃8藥3鹽5+鋼盾,格擋熟練σ0.08)", salts: 5, bandages: 8, elixirs: 3, jerky: 4, useShield: true, blockJitter: 0.08, crisis: true },
  { name: "頂配+神格擋(σ0.04)", salts: 5, bandages: 8, elixirs: 3, jerky: 4, useShield: true, blockJitter: 0.04, crisis: true },
  { name: "頂配+手殘格擋(σ0.15)", salts: 5, bandages: 8, elixirs: 3, jerky: 4, useShield: true, blockJitter: 0.15, crisis: true },
  { name: "無鹽(繃8藥3+鋼盾σ0.08)", salts: 0, bandages: 8, elixirs: 3, jerky: 4, useShield: true, blockJitter: 0.08, crisis: true },
  { name: "無盾(繃8藥3鹽5)", salts: 5, bandages: 8, elixirs: 3, jerky: 4, useShield: false, blockJitter: 0.08, crisis: true },
  { name: "無盾無鹽(舊頂配)", salts: 0, bandages: 8, elixirs: 3, jerky: 4, useShield: false, blockJitter: 0.08, crisis: true },
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
  console.log(`${cfg.name}: 勝率 ${rate}%(勝均時 ${avgT}s/餘血 ${avgHp});敗場:一階段死 ${diedP1}、二階段死 ${diedP2},死時 Boss 均餘 ${avgBossHp}`);
}
