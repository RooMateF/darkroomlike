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
  /** 凍結抗性(Boss):鬼雪的凍結值每擊疊加減半 */
  freezeResist?: boolean;
  /** 連招腳本(數數的東西):依 move id 順序循環出招,取代隨機抽 */
  pattern?: string[];
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
    shardChance: 0.3,
  },
  {
    id: "spawn",
    label: "孳生失敗體",
    intro: "一團不斷蠕動的小東西朝你湧來,形狀說不出像什麼。",
    hp: 6,
    moves: [{ id: "swarm", label: "啃咬", baseCost: 0.5, symbol: "·»", damage: 1, status: { kind: "poison", amount: 25 } }],
    loot: { meat: 1 },
    shardChance: 0.4,
  },
  {
    id: "mutant-hound",
    label: "變異犬",
    intro: "四肢比例不太對勁的犬型生物壓低了身子,眼睛的位置有些不自然。",
    hp: 14,
    moves: [{ id: "pounce", label: "撲咬", baseCost: 0.9, symbol: "»»»", damage: 3, status: { kind: "bleed", amount: 30 } }],
    loot: { hide: 2, meat: 2 },
    shardChance: 0.35,
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

// 事件小 Boss(選擇式小劇情觸發;文本 2026-09 核可)
// 哼歌的東西:混亂機制的教學者——哼唱不傷血但疊混亂,滿了行動被奪走;
// 醒神鹽是解法(解混亂+免疫窗口),沒鹽就得搶節奏速戰
export const EVENT_BOSSES: Record<string, EnemyDef> = {
  // 迷宮的偷竊戰(2026-09 用戶定案):血量偏低,但第一招「捲奪」0.3s 出手——
  // 沒有危機意識(首擊×2)基本必被偷;完美格擋(0.1s)也擋得下。每場只偷一件(戰鬥頁守門)
  tentacle: {
    id: "maze-tentacle",
    label: "蒼白的觸手",
    intro: "牆縫裡垂下一條蒼白的觸手,指尖在空中輕輕比劃,像在挑選。",
    hp: 12,
    moves: [
      { id: "snatch", label: "捲奪", baseCost: 0.3, symbol: "~»", damage: 1, steal: true },
      { id: "lash", label: "抽打", baseCost: 1.2, symbol: "»", damage: 4 },
    ],
    // 第一招必為捲奪(0.3s):沒有危機意識搶不到 0.3s 前的暫停窗;之後捲奪只是快戳(每場限偷一件)
    pattern: ["snatch", "lash"],
    loot: {},
  },
  siren: {
    id: "siren",
    label: "哼歌的東西",
    intro: "牠沒有嘴,歌聲卻從牠身體的某處滲出來。三個音,重複——你聽過這段旋律。",
    hp: 45,
    moves: [
      { id: "hum", label: "哼唱", baseCost: 2.0, symbol: "~♪", damage: 0, confusion: 60, tell: "牠的身體鼓了起來,像在吸氣。歌聲變近了。" },
      { id: "pounce", label: "撲抓", baseCost: 2.0, symbol: "»", damage: 7 },
      { id: "shriek", label: "走音尖鳴", baseCost: 2.5, symbol: "»!", damage: 4, control: { kind: "slow", duration: 2 } },
    ],
    loot: { hide: 3, shard: 2 },
    shardChance: 1,
    freezeResist: true,
  },
};

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
      { id: "swarm", label: "圍咬", baseCost: 0.5, symbol: "·»", damage: 3, status: { kind: "poison", amount: 20 } },
      { id: "surge", label: "湧上", baseCost: 1.2, symbol: "»»", damage: 5 },
    ],
    loot: { meat: 3, shard: 1 },
    shardChance: 0.65,
  },
  {
    id: "veteran",
    label: "廢土老兵",
    intro: "穿著拼湊護具的身影擋在通道中央,握武器的姿勢比外面那些人熟練得多。",
    hp: 22,
    moves: [
      { id: "slash", label: "劈砍", baseCost: 1.0, symbol: "»»»", damage: 6 },
      { id: "heavy", label: "蓄力斬", baseCost: 1.9, symbol: "»»»»»", damage: 12 },
    ],
    loot: { arrow: 3, bandage: 1 },
  },
  {
    id: "lurker",
    label: "潛伏的掠食者",
    intro: "你聽見水聲的時候,牠已經撲到面前了。",
    hp: 20,
    moves: [
      { id: "ambush", label: "突襲", baseCost: 0.8, symbol: "»»»", damage: 5, status: { kind: "bleed", amount: 25 } },
      { id: "drag", label: "拖咬", baseCost: 1.6, symbol: "»»»»", damage: 9 },
    ],
    loot: { hide: 4, meat: 3, shard: 1 },
    shardChance: 0.55,
  },
];

export function pickMidEnemy(): EnemyDef {
  return MID_ENEMIES[Math.floor(Math.random() * MID_ENEMIES.length)];
}

/** 外圍組隊遭遇(2026-09 用戶定案):2~3 隻車輪戰——最多一隻中期梯隊,壓力靠數量不靠血量 */
export function pickEnemyGroup(): EnemyDef[] {
  const size = Math.random() < 0.5 ? 2 : 3;
  const group: EnemyDef[] = [];
  let midUsed = false;
  for (let i = 0; i < size; i++) {
    if (!midUsed && Math.random() < 0.3) {
      group.push(pickMidEnemy());
      midUsed = true;
    } else {
      group.push(pickRandomEnemy());
    }
  }
  return group;
}

// 2026-09 格擋改版:Boss 傷害整體上調(約 +30~40%)——盾牌格擋(完美 0.1s 全免)
// 成為 Boss 戰的核心技術;會格擋的玩家能無傷,不格擋就得用血和補品硬換。
// 舊蒙地卡羅註記(無盾時代)保留供參考,數值已非現況。

/** Lv3 遺跡最深處的看守 */
export const LV3_BOSS: EnemyDef = {
  id: "ruin-warden",
  label: "遺跡的看守",
  intro: "最深處的黑暗裡,一個高大的輪廓緩緩起身。牠在這裡守著什麼,守了很久很久。",
  hp: 80,
  moves: [
    { id: "sweep", label: "橫掃", baseCost: 1.1, symbol: "»»»", damage: 6 },
    { id: "slam", label: "重擊", baseCost: 2.2, symbol: "»»»»»", damage: 16, tell: "牠的輪廓在黑暗裡拔高,雙臂舉過了頭頂。" },
  ],
  loot: { hide: 4, meat: 4, shard: 3 },
  freezeResist: true,
};

/**
 * 地標守衛(嚴苛的戰鬥,bestiary.md 中期梯隊等級):
 * 打贏才解放對應地標。血量與傷害刻意高於前期雜兵一個檔次,
 * 用「慢條=痛」的節奏(design-notes.md § 2.9)給玩家判讀空間。
 */
export const GUARDIANS: Record<string, EnemyDef> = {
  // 北圍場:數數的東西(2026-09 核可)——節奏教學型,連招腳本固定:
  // 輕拍/屈指×3 交錯,第七拍「清算」重擊;數牠的手指,搶在第三根前格擋或補滿
  counter: {
    id: "counter-guardian",
    label: "數數的東西",
    intro: "圍牆裡側坐著一個灰色的輪廓,背對著你。牠的手指動個不停——一根、兩根、三根。你進來的那一刻,牠停了。",
    hp: 70,
    moves: [
      { id: "tap", label: "輕拍", baseCost: 0.9, symbol: "»", damage: 2 },
      { id: "count", label: "屈指", baseCost: 1.5, symbol: "…", damage: 0, tell: "牠又屈起一根指頭。" },
      { id: "reckoning", label: "清算", baseCost: 2.2, symbol: "»»»»»", damage: 16, control: { kind: "stun", duration: 1.0 }, tell: "牠攤開手掌——三根手指,一起收了回去。" },
    ],
    pattern: ["tap", "count", "tap", "count", "tap", "count", "reckoning"],
    loot: {},
    freezeResist: true,
  },
  // 東南迷宮:拾荒的長手(2026-09 定案)——迷宮五盜的收贓者;
  // 血量門檻歸還贓物(95/85/75/65%各一件,50%全回+狂暴 CD×0.75),守門在戰鬥頁
  scavenger: {
    id: "scavenger-guardian",
    label: "拾荒的長手",
    intro: "牆縫裡塞滿了東西:水袋、鞋、認不得用途的工具,分門別類,擺得整整齊齊。牆的深處,一條過長的手臂緩緩收了回去。",
    hp: 90,
    moves: [
      { id: "grab", label: "抓奪", baseCost: 1.0, symbol: "~»", damage: 5 },
      { id: "swing", label: "掄臂", baseCost: 2.4, symbol: "»»»»»", damage: 14, tell: "那條過長的手臂高高掄了起來,影子罩住了你。" },
    ],
    loot: {},
    freezeResist: true,
  },
  mine: {
    id: "mine-guardian",
    label: "盤據礦坑的巨獸",
    intro: "黑暗裡站起一頭巨大的生物,肩膀擦過坑道的頂。牠低下頭,鼻息噴在你臉上。",
    hp: 110,
    moves: [
      { id: "swipe", label: "拍擊", baseCost: 1.1, symbol: "»»»", damage: 5 },
      { id: "crush", label: "重壓", baseCost: 2.4, symbol: "»»»»»»", damage: 15, tell: "巨獸壓低了身子,肩胛高高聳起——鼻息忽然停了。" },
    ],
    loot: { hide: 6, meat: 6, shard: 4 },
    freezeResist: true,
  },
  observatory: {
    id: "observatory-guardian",
    label: "不肯離開的守望者",
    intro: "圓頂下的人影轉過身——他的眼睛睜得太開了,開到不像還能閉上。「不准看,」他嘶啞地說,「還不到時候。」",
    hp: 90,
    moves: [
      { id: "stare", label: "凝視", baseCost: 0.7, symbol: "…", damage: 0 },
      { id: "swing", label: "揮舞", baseCost: 1.0, symbol: "»»", damage: 5 },
      { id: "shriek", label: "撲抓", baseCost: 1.7, symbol: "»»»»", damage: 11, tell: "他的十指扣成爪狀,慢慢舉了起來。" },
    ],
    loot: { bandage: 2, ration: 2, shard: 3 },
    freezeResist: true,
  },
  shrine: {
    id: "shrine-guardian",
    label: "沼澤中的節肢巨物",
    intro: "水面炸開。比人還大的節肢生物撐開甲殼,無數細足在石台上敲出急促的聲響。",
    hp: 100,
    moves: [
      { id: "skitter", label: "亂刺", baseCost: 0.6, symbol: "·»", damage: 4, status: { kind: "poison", amount: 30 } },
      { id: "pincer", label: "鉗擊", baseCost: 1.7, symbol: "»»»»", damage: 12, tell: "細足全部停住了。甲殼下的巨鉗張到了最開。" },
    ],
    loot: { meat: 5, hide: 3, shard: 3 },
    freezeResist: true,
  },
  // 北嶺煤礦坑(Lv4):鐵階裝備的攻堅目標——毒塵+崩落暈眩是特色威脅。
  // 蒙地卡羅(現實補給:繃2/藥1/肉16/鹽3,滿血進場):勝率 60%(單場 100 秒);
  // 不帶鹽 4%、殘血(40/50)進場 7%——鹽是反制、礦旁據點休整是紀律;囤到繃6藥2則 100%
  coalmine: {
    id: "coalmine-guardian",
    label: "煤層深處的掘穴者",
    intro: "煤壁在動。一雙裹滿煤灰的巨螯先探了出來,然後是佈滿環節的身軀——牠鑿穿岩層的聲音,你在坑道外就聽見了。",
    hp: 220,
    moves: [
      { id: "dig", label: "鑿擊", baseCost: 0.8, symbol: "»»", damage: 8 },
      { id: "dust", label: "揚塵", baseCost: 1.4, symbol: "…", damage: 4, status: { kind: "poison", amount: 55 }, tell: "牠的環節一節節收緊,甲縫裡滲出灰黑色的粉末。" },
      // 崩落:高傷+暈眩——被震住的那一秒多,補血條也是凍結的;醒神鹽是針對性的解法
      { id: "collapse", label: "崩落", baseCost: 2.6, symbol: "»»»»»»", damage: 22, control: { kind: "stun", duration: 1.2 }, tell: "牠高高抬起了雙螯——坑道頂上簌簌落下灰來。" },
    ],
    loot: { coal: 8, stone: 6, shard: 6 },
    freezeResist: true,
  },
  // Lv5:本章的極限。2026-08 控制型設計:數值堆滿也打不過,要靠「針對性準備」——
  // 醒神鹽擋鐘鳴/低語、藥劑清撕裂的流血、繃帶硬撐血線。
  // 蒙地卡羅(鋼階滿血):頂配(繃8藥3鹽5,120 秒全數耗盡)100%;同配無鹽 16%;
  // 次級配(繃5藥2鹽4)28%;鐵階即使帶鹽也是 0%——「先去北嶺煉鋼」的高牆
  church: {
    id: "church-guardian",
    label: "不再祈禱的東西",
    intro: "祭壇前跪著一個背影,維持著祈禱的姿勢——但那個輪廓不屬於任何還能被稱為人的東西。它緩緩站了起來。站得太高了。",
    hp: 440,
    moves: [
      // 低語:鑽進骨頭裡的聲音讓手腳發沉(遲緩)——充能減半,補血與輸出一起變慢
      { id: "whisper", label: "低語", baseCost: 1.6, symbol: "…", damage: 6, control: { kind: "slow", duration: 2.5 }, tell: "那個高大的輪廓朝你微微傾了過來。" },
      { id: "rend", label: "撕裂", baseCost: 1.2, symbol: "»»»»", damage: 13, status: { kind: "bleed", amount: 55 } },
      // 鐘鳴:整座教堂共振的一擊——高傷+暈眩;不帶醒神鹽硬扛,補血節奏會被打碎
      { id: "toll", label: "鐘鳴", baseCost: 3.0, symbol: "»»»»»»»", damage: 27, control: { kind: "stun", duration: 1.5 }, tell: "它緩緩抬起了手,指向頭頂的鐘。空氣忽地緊繃。" },
    ],
    loot: { shard: 8 },
    freezeResist: true,
  },
};

/** 地標解放後的一次性報酬(戰鬥頁勝利時發放) */
export const LANDMARK_REWARDS: Record<string, { loot?: Record<string, number>; weapon?: string; message: string }> = {
  counter: {
    loot: { shard: 4, iron: 6 },
    message: "灰色的輪廓癱了下去,手指終於停了。牠懷裡抱著一卷寫滿符號的皮紙——像是某種配方。帶回去吧,總有看得懂的一天。",
  },
  scavenger: {
    loot: { bigshard: 1 },
    message: "長手癱軟下去的瞬間,整座迷宮輕輕震了一下——牆縫裡的黑暗散了,通道亮了起來。牠身後,一只上鎖的箱子露了出來。",
  },
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
