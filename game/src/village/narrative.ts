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
  tanneryBuilt: boolean;
  smithyBuilt: boolean;
  mineCleared: boolean;
  anyWeapon: boolean;
  waterskinDone: boolean;
}

export interface Milestone {
  id: string;
  check: (state: MilestoneState) => boolean;
  text: string;
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
    // 呼應 village-main.ts 的外出解鎖門檻(人口上限 20),用台詞暗示而不是寫成 UI 提示
    id: "ready-to-explore",
    check: (s) => s.populationCap >= 20,
    text: "『你已經站穩腳步了。』她望向村子外的黑暗。『外面到底有什麼,連我也說不清楚。但總要有人先踏出第一步。』",
  },
];
