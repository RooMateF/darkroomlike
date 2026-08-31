// 前期梯隊敵人名冊(bestiary.md 第一節),遭遇時隨機抽一種
// 遵守核心寫作原則:描述只給可觀察的外觀/行為線索,不說破汙染來源

import type { EnemyMove } from "./types";

export interface EnemyDef {
  id: string;
  label: string;
  /** 遭遇時的一句側寫(£log 顯示) */
  intro: string;
  hp: number;
  moves: EnemyMove[];
  /** 擊倒後的掉落(固定量,先求簡單) */
  loot: Record<string, number>;
  /**
   * 擊倒後額外掉出「異晶」的機率(0~1)。只有汙染沾身的生物會掉——
   * 人類敵人(迷途者/掠奪者/老兵)沒有。無法自行加工,是日後交易所的兌換材料。
   */
  shardChance?: number;
}

export const ENEMIES: EnemyDef[] = [
  {
    id: "drifter",
    label: "迷途者",
    intro: "一個衣衫襤褸的身影擋住去路,眼神疲憊而警戒。",
    hp: 10,
    moves: [{ id: "swing", label: "揮擊", baseCost: 1.4, symbol: "»", damage: 2 }],
    loot: { ration: 1 },
  },
  {
    id: "crazed",
    label: "輕度發狂者",
    intro: "那個人的動作不太連貫,喉嚨裡發出意義不明的聲音。",
    hp: 12,
    moves: [
      { id: "flail", label: "亂抓", baseCost: 0.7, symbol: "»»", damage: 2 },
      // 「空轉」:什麼都不做的行為抽搐,跑條快但沒有傷害——不連貫感的具體呈現
      { id: "stall", label: "顫抖", baseCost: 0.6, symbol: "…", damage: 0 },
      { id: "lunge", label: "撲咬", baseCost: 1.8, symbol: "»»»", damage: 6 },
    ],
    loot: { bandage: 1 },
    shardChance: 0.25,
  },
  {
    id: "spawn",
    label: "孳生失敗體",
    intro: "一團不斷蠕動的小東西朝你湧來,形狀說不出像什麼。",
    hp: 6,
    moves: [{ id: "swarm", label: "啃咬", baseCost: 0.5, symbol: "·»", damage: 1, status: { kind: "poison", amount: 25 } }],
    loot: { meat: 1 },
    shardChance: 0.35,
  },
  {
    id: "mutant-hound",
    label: "變異犬",
    intro: "四肢比例不太對勁的犬型生物壓低了身子,眼睛的位置有些不自然。",
    hp: 14,
    moves: [{ id: "pounce", label: "撲咬", baseCost: 0.9, symbol: "»»»", damage: 3, status: { kind: "bleed", amount: 30 } }],
    loot: { hide: 2, meat: 2 },
    shardChance: 0.3,
  },
  {
    id: "raider",
    label: "廢土掠奪者",
    intro: "拿著拼裝武器的人影繞著你打量——他要的是你身上的東西。",
    hp: 18,
    moves: [
      { id: "slash", label: "揮砍", baseCost: 1.0, symbol: "»»»", damage: 4 },
      { id: "heavy", label: "重擊", baseCost: 1.8, symbol: "»»»»»", damage: 7 },
    ],
    loot: { wood: 3, stone: 3, arrow: 2 },
  },
];

export function pickRandomEnemy(): EnemyDef {
  return ENEMIES[Math.floor(Math.random() * ENEMIES.length)];
}

/** 中期梯隊:Lv3~5 地城的層間敵人(bestiary.md 第二節) */
export const MID_ENEMIES: EnemyDef[] = [
  {
    id: "spawn-pack",
    label: "成群的孳生體",
    intro: "牆縫裡湧出的東西比外面見過的更多、更急。",
    hp: 18,
    moves: [
      { id: "swarm", label: "圍咬", baseCost: 0.5, symbol: "·»", damage: 2, status: { kind: "poison", amount: 20 } },
      { id: "surge", label: "湧上", baseCost: 1.2, symbol: "»»", damage: 4 },
    ],
    loot: { meat: 3 },
    shardChance: 0.5,
  },
  {
    id: "veteran",
    label: "廢土老兵",
    intro: "穿著拼湊護具的身影擋在通道中央,握武器的姿勢比外面那些人熟練得多。",
    hp: 22,
    moves: [
      { id: "slash", label: "劈砍", baseCost: 1.0, symbol: "»»»", damage: 5 },
      { id: "heavy", label: "蓄力斬", baseCost: 1.9, symbol: "»»»»»", damage: 9 },
    ],
    loot: { arrow: 3, bandage: 1 },
  },
  {
    id: "lurker",
    label: "潛伏的掠食者",
    intro: "你聽見水聲的時候,牠已經撲到面前了。",
    hp: 20,
    moves: [
      { id: "ambush", label: "突襲", baseCost: 0.8, symbol: "»»»", damage: 4, status: { kind: "bleed", amount: 25 } },
      { id: "drag", label: "拖咬", baseCost: 1.6, symbol: "»»»»", damage: 7 },
    ],
    loot: { hide: 4, meat: 3 },
    shardChance: 0.4,
  },
];

export function pickMidEnemy(): EnemyDef {
  return MID_ENEMIES[Math.floor(Math.random() * MID_ENEMIES.length)];
}

/** Lv3 遺跡最深處的看守 */
export const LV3_BOSS: EnemyDef = {
  id: "ruin-warden",
  label: "遺跡的看守",
  intro: "最深處的黑暗裡,一個高大的輪廓緩緩起身。牠在這裡守著什麼,守了很久很久。",
  hp: 80,
  moves: [
    { id: "sweep", label: "橫掃", baseCost: 1.1, symbol: "»»»", damage: 4 },
    { id: "slam", label: "重擊", baseCost: 2.2, symbol: "»»»»»", damage: 9 },
  ],
  loot: { hide: 4, meat: 4, shard: 2 },
};

/**
 * 地標守衛(嚴苛的戰鬥,bestiary.md 中期梯隊等級):
 * 打贏才解放對應地標。血量與傷害刻意高於前期雜兵一個檔次,
 * 用「慢條=痛」的節奏(design-notes.md § 2.9)給玩家判讀空間。
 */
export const GUARDIANS: Record<string, EnemyDef> = {
  mine: {
    id: "mine-guardian",
    label: "盤據礦坑的巨獸",
    intro: "黑暗裡站起一頭巨大的生物,肩膀擦過坑道的頂。牠低下頭,鼻息噴在你臉上。",
    hp: 110,
    moves: [
      { id: "swipe", label: "拍擊", baseCost: 1.1, symbol: "»»»", damage: 3 },
      { id: "crush", label: "重壓", baseCost: 2.4, symbol: "»»»»»»", damage: 8 },
    ],
    loot: { hide: 6, meat: 6, shard: 3 },
  },
  observatory: {
    id: "observatory-guardian",
    label: "不肯離開的守望者",
    intro: "圓頂下的人影轉過身——他的眼睛睜得太開了,開到不像還能閉上。「不准看,」他嘶啞地說,「還不到時候。」",
    hp: 90,
    moves: [
      { id: "stare", label: "凝視", baseCost: 0.7, symbol: "…", damage: 0 },
      { id: "swing", label: "揮舞", baseCost: 1.0, symbol: "»»", damage: 3 },
      { id: "shriek", label: "撲抓", baseCost: 1.7, symbol: "»»»»", damage: 6 },
    ],
    loot: { bandage: 2, ration: 2, shard: 2 },
  },
  shrine: {
    id: "shrine-guardian",
    label: "沼澤中的節肢巨物",
    intro: "水面炸開。比人還大的節肢生物撐開甲殼,無數細足在石台上敲出急促的聲響。",
    hp: 100,
    moves: [
      { id: "skitter", label: "亂刺", baseCost: 0.6, symbol: "·»", damage: 2, status: { kind: "poison", amount: 20 } },
      { id: "pincer", label: "鉗擊", baseCost: 1.7, symbol: "»»»»", damage: 7 },
    ],
    loot: { meat: 5, hide: 3, shard: 2 },
  },
  // 北嶺煤礦坑(Lv4):鐵階裝備的攻堅目標——比中央三地標硬一階,毒塵是特色威脅
  coalmine: {
    id: "coalmine-guardian",
    label: "煤層深處的掘穴者",
    intro: "煤壁在動。一雙裹滿煤灰的巨螯先探了出來,然後是佈滿環節的身軀——牠鑿穿岩層的聲音,你在坑道外就聽見了。",
    hp: 260,
    moves: [
      { id: "dig", label: "鑿擊", baseCost: 0.8, symbol: "»»", damage: 6 },
      { id: "dust", label: "揚塵", baseCost: 0.7, symbol: "…", damage: 0, status: { kind: "poison", amount: 40 } },
      { id: "collapse", label: "崩落", baseCost: 1.9, symbol: "»»»»»»", damage: 16 },
    ],
    loot: { coal: 8, stone: 6, shard: 3 },
  },
  // Lv5:本章的極限。2026-08 史詩化:Boss 戰要打一分鐘上下、手段盡出(補品/卷軸/換武器)。
  // 蒙地卡羅:380hp 鋼階頂配勝率 64%(單場 58 秒);鐵階 0%——「先去北嶺煉鋼」的高牆
  church: {
    id: "church-guardian",
    label: "不再祈禱的東西",
    intro: "祭壇前跪著一個背影,維持著祈禱的姿勢——但那個輪廓不屬於任何還能被稱為人的東西。它緩緩站了起來。站得太高了。",
    hp: 380,
    moves: [
      { id: "whisper", label: "低語", baseCost: 0.9, symbol: "…", damage: 0 },
      { id: "rend", label: "撕裂", baseCost: 1.2, symbol: "»»»»", damage: 10, status: { kind: "bleed", amount: 40 } },
      { id: "toll", label: "崩擊", baseCost: 2.4, symbol: "»»»»»»»", damage: 18 },
    ],
    loot: { shard: 5 },
  },
};

/** 地標解放後的一次性報酬(戰鬥頁勝利時發放) */
export const LANDMARK_REWARDS: Record<string, { loot?: Record<string, number>; weapon?: string; message: string }> = {
  mine: {
    loot: { iron: 10, stone: 8 },
    message: "礦坑解放了。坑道深處的鐵礦脈在火光下泛著光——村裡的人手可以來這裡工作了。",
  },
  observatory: {
    weapon: "bayonet",
    message: "守望者倒下的地方留著一把保養得極好的軍用刺刀——和這個時代的一切都格格不入。",
  },
  shrine: {
    loot: { scroll: 2 },
    message: "祭壇的石縫裡收著兩卷奇怪的卷軸,紙面溫熱,墨跡像還沒乾的火。",
  },
  coalmine: {
    loot: { coal: 15, stone: 10 },
    message: "煤礦解放了。黑亮的煤層一路延伸進山腹深處——爐火燒得更旺的日子,要開始了。",
  },
  church: {
    weapon: "alloy-blade",
    loot: { scroll: 2, bandage: 3 },
    message: "它倒下的地方留著一柄短刃——輕得不可思議,刃面像水一樣流動著光。這個時代做不出這種東西。上一個時代也做不出來。",
  },
};
