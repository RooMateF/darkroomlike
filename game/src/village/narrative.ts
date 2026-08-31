// 開場與里程碑敘事文本(呼應 worldbuilding.md § 8:視角要「貼地」,不直接說破設定,只給暗示)

export const INTRO_LINES: string[] = [
  "你在一堆微弱的火堆旁醒來,身上滿是塵土與擦傷,記憶模糊得像隔著一層霧。",
  "『你醒了。』一個溫和的聲音傳來——是個陌生的女人,她正往火裡添著柴。",
  "『別擔心,你很安全。這裡什麼都沒有,只有我們兩個,還有這堆火。』",
  "她朝你伸出手。『如果你還走得動,我們可以先搭個能遮風擋雨的地方。』",
];

export interface MilestoneState {
  hutBuilt: boolean;
  firstGrowth: boolean;
  population: number;
  populationCap: number;
  farmBuilt: boolean;
  backpackDone: boolean;
  armorDone: boolean;
  tanneryBuilt: boolean;
  smithyBuilt: boolean;
  mineCleared: boolean;
  anyWeapon: boolean;
  waterskinDone: boolean;
}

export interface Milestone {
  id: string;
  check: (state: MilestoneState) => boolean;
  /** 一段或多段台詞(多段會逐行寫進紀錄) */
  text: string | string[];
}

/** 里程碑事件觸發一次性的敘事台詞,不重複出現。全部走「她」(代行者)的視角,語氣一致:溫和、務實,偶爾有一絲說不清的了然 */
export const MILESTONES: Milestone[] = [
  {
    id: "hut-built",
    check: (s) => s.hutBuilt,
    text: "『有屋頂真好。』她看著剛搭好的小屋,笑了笑。『這樣下雨天不用擠在火堆旁邊了。』",
  },
  {
    id: "first-growth",
    check: (s) => s.firstGrowth,
    text: "『又有人來了啊。』她說,語氣裡聽不出太多驚訝。『這裡,好像比我們想像的更容易被找到。』",
  },
  {
    id: "first-weapon",
    check: (s) => s.anyWeapon,
    text: "她拿起你削好的武器,掂了掂重量,又還給你。『但願用不上。』她頓了頓。『……不,還是帶著吧。』",
  },
  {
    id: "population-10",
    check: (s) => s.population >= 10,
    text: "傍晚的村子有了人聲。她站在火堆邊看了很久,輕聲說:『開始像一個家了。』",
  },
  {
    id: "farm-built",
    check: (s) => s.farmBuilt,
    text: "『種下去的東西會發芽,』她蹲在田邊,手指按進土裡,『這件事,不管世界變成什麼樣都不會變。』",
  },
  {
    id: "tannery-built",
    check: (s) => s.tanneryBuilt,
    text: "製革場的氣味不算好聞,她卻站在那裡看了很久。『能把獸皮變成皮革的地方,』她說,『就是能把日子過下去的地方。』",
  },
  {
    id: "smithy-built",
    check: (s) => s.smithyBuilt,
    text: "工匠鋪的第一聲鎚響傳遍村子時,她停下手邊的事聽了很久。『這個聲音,』她說,『是人還沒放棄的聲音。』",
  },
  {
    id: "smithy-iron",
    check: (s) => s.smithyBuilt && s.mineCleared,
    text: "爐子改好的那天,火燒得比以前旺得多。鐵條在爐口燒紅的顏色映在她臉上。『從今天起,』她說,『壞掉的東西,大部分都救得回來了。』",
  },
  {
    id: "waterskin-done",
    check: (s) => s.waterskinDone,
    text: "她幫你把新水袋的繩結繫緊,動作熟練得不像第一次做。『走遠一點也沒關係了。……但要記得回來。』",
  },
  {
    // 人手夠了、卻還沒有田:她點出缺口(玩家唯一一次接近「提示」的台詞,包在情理裡)
    id: "need-farm",
    check: (s) => s.populationCap >= 20 && !s.farmBuilt,
    text: "『人手是夠了。』她掀開存糧的木蓋,裡面空得能聽見回音。『但一支餓著肚子的隊伍,連半天的路都走不完。想出去看看的話——先開一塊田吧。』",
  },
  {
    // 呼應 village-main.ts 的外出解鎖門檻(人口上限 20 + 田),她在這裡第一次透露自己的「不能遠行」
    id: "ready-to-explore",
    check: (s) => s.populationCap >= 20 && s.farmBuilt,
    text: [
      "『你已經站穩腳步了。』她望向村子外的黑暗,沉默了好一陣,才回過頭來看你『就連我也說不清楚外面到底有什麼。但總得有人先踏出第一步。』",
      // 體溫細節=她身分的暗線(參 worldbuilding 代行者):「隱隱發燙」比常人體溫更進一步,但不評註、不解釋
      "她伸出雙手,把你的手緊緊裹進掌心。她的手很暖,甚至隱隱有些發燙。『因為一些原因……我還沒辦法離開這裡太遠。但我會為你的每一次遠征,獻上祈禱。』",
    ],
  },
  {
    id: "backpack-done",
    check: (s) => s.backpackDone,
    text: "新背包的針腳密得驚人,一夜之間就縫好了。『這樣旅途就有更多保障了呢!』她輕輕地笑著說道。",
  },
  {
    id: "armor-done",
    check: (s) => s.armorDone,
    // 結尾台詞待補(用戶重寫中)
    text: "她把皮甲的繫帶一條一條替你拉緊,動作慢,像是在確認每一個結。最後她在你肩上拍了拍:『合身。』",
  },
];
