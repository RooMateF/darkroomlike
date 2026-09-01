import type { ResourceId } from "./types";

/** village-events.md 裡挑出的一小批範例事件,示範規則式生成怎麼接進遊戲主體(design-notes.md § 1.1) */

export interface EventContext {
  population: number;
  populationCap: number;
  /** 目前庫存(擋掉「損失根本沒有的東西」的荒謬敘事) */
  resources: Partial<Record<ResourceId, number>>;
  /** 各工作目前指派人數(擋掉「沒派獵人卻狩獵滿載」這類事件) */
  assignments: Record<string, number>;
  /** 建築是否已建成(擋掉「沒有田卻穀物豐收」) */
  hasBuilding: (id: string) => boolean;
  /** 已取得的永久被動(稀有訪客交換;已有的不會再遇到同一位) */
  perks: Record<string, boolean>;
}

interface EventBase {
  id: string;
  /**
   * 這個事件最早在第幾個生產週期後才可能被抽到(design-notes.md § 1.2「主線進度軟性偏移」)。
   * 預設 0 = 開局就可能出現。負面/高風險事件(尤其可能減損人口的)應該設較高的門檻,
   * 不能跟開局的溫和事件公平競爭機率。
   */
  minTick?: number;
  /**
   * 額外的觸發前提。用來擋掉「情境上根本不成立」的事件——
   * 例如人口已經滿了就不該再跳出「有人請求收留」,否則玩家只能被迫拒絕,選項形同虛設。
   */
  condition?: (ctx: EventContext) => boolean;
  /**
   * 抽選權重(預設 1)。稀有訪客用 0.06 之類的小值——
   * 平均要碰上幾十次事件才會出現一次,錯過了也得等緣分
   */
  weight?: number;
  /** 只由「延遲後續」觸發,不進隨機事件池(如流浪者報恩/引來土匪) */
  followUpOnly?: boolean;
}

export interface PassiveEvent extends EventBase {
  kind: "passive";
  text: string;
  effect: Partial<Record<ResourceId, number>>;
  /** 比例扣除(0.3 = 扣掉庫存的 30%):嚴重事件用比例才有痛感,固定值在後期通膨下毫無威懾 */
  effectPct?: Partial<Record<ResourceId, number>>;
  populationDelta?: number;
}

export interface ChoiceEvent extends EventBase {
  kind: "choice";
  text: string;
  options: {
    label: string;
    effect: Partial<Record<ResourceId, number>>;
    populationDelta?: number;
    resultText: string;
    /**
     * 這個選項的負值效果是「承受損失」而非「支付成本」(如鴉群的「隨牠們去」)——
     * 不檢查庫存、可以選,實際扣除時以歸零為底。支付成本型(繃帶 -1 收治人)則必須有足額庫存才能選
     */
    passiveLoss?: boolean;
    /** 選了之後,在 delayMin~delayMax 個週期後從 FOLLOWUP_POOLS[pool] 抽一個後續(可能什麼也沒發生) */
    followUp?: { pool: string; delayMin: number; delayMax: number };
    /** 機率結局:選了之後從這裡加權抽一個(戰鬥型選項的勝敗)。有 outcomes 時忽略頂層 effect/resultText */
    outcomes?: {
      weight: number;
      effect: Partial<Record<ResourceId, number>>;
      effectPct?: Partial<Record<ResourceId, number>>;
      populationDelta?: number;
      /** 人口比例損失(0.3 = 失去現有人口的 30%) */
      populationPct?: number;
      resultText: string;
    }[];
    /** 取得永久被動(稀有訪客的交換品) */
    grantPerk?: string;
    /** 比例扣除(0.3 = 扣掉庫存的 30%)——嚴重損失型選項用;不做庫存門檻(有多少扣多少) */
    effectPct?: Partial<Record<ResourceId, number>>;
  }[];
}

/** 永久被動的名稱(顯示用) */
export const PERK_LABEL: Record<string, string> = {
  stealth: "潛行",
  machinist: "機巧",
  blessing: "祝禱",
};

/**
 * 延遲後續池:id = null 代表「什麼也沒發生」。
 * 善意是一場賭注——報恩、引狼入室、或石沉大海
 */
export const FOLLOWUP_POOLS: Record<string, { id: string | null; weight: number }[]> = {
  wanderer: [
    { id: "wanderer-repay", weight: 35 },
    { id: "wanderer-bandits", weight: 25 },
    { id: null, weight: 40 },
  ],
};

export type VillageEvent = PassiveEvent | ChoiceEvent;

export const EVENTS: VillageEvent[] = [
  // village-events.md A. 資源事件 — 正面(開局就可能出現)
  { kind: "passive", id: "found-wood", text: "村民在附近發現遺落的木材。", effect: { wood: 5 } },
  // 「豐收/滿載」要有對應的生產活動才成立——沒有田不會豐收、沒派獵人不會有狩獵隊
  { kind: "passive", id: "good-harvest", text: "穀物豐收。", effect: { grain: 6 }, condition: (ctx) => ctx.hasBuilding("farm") && (ctx.assignments["farmer"] ?? 0) > 0 },
  { kind: "passive", id: "hunt-bounty", text: "狩獵隊滿載而歸。", effect: { hide: 3, meat: 4 }, condition: (ctx) => (ctx.assignments["hunter"] ?? 0) > 0 },

  // village-events.md B. 資源事件 — 負面(溫和的資源損失,開局就可能出現)
  { kind: "passive", id: "mold", text: "儲存的糧食發霉了。", effect: { grain: -3 }, condition: (ctx) => (ctx.resources.grain ?? 0) >= 3 },
  { kind: "passive", id: "tool-broken", text: "常用工具意外損毀。", effect: { stone: -2 } },
  { kind: "passive", id: "small-fire", text: "一場小規模火災燒毀了部分木材。", effect: { wood: -4 } },

  // village-events.md G. 貿易/訪客 — 需要玩家決策(開局就可能出現)
  // 未來型事件:餵不餵這個流浪者,是一場幾分鐘後才開獎的賭注(報恩/引來土匪/杳無音信)
  {
    kind: "choice",
    id: "hungry-wanderer",
    text: "一個瘦得脫形的流浪者在村口徘徊,乞求一點吃的。",
    condition: (ctx) => (ctx.resources.grain ?? 0) >= 50 || (ctx.resources.ration ?? 0) >= 10,
    options: [
      {
        label: "分他一頓熱食(穀物 -50)",
        effect: { grain: -50 },
        resultText: "他狼吞虎嚥地吃完,朝村子深深鞠了一躬,消失在路的盡頭。",
        followUp: { pool: "wanderer", delayMin: 30, delayMax: 72 },
      },
      {
        label: "塞給他一份乾糧(乾糧 -10)",
        effect: { ration: -10 },
        resultText: "他把乾糧緊緊抱在懷裡,一邊回頭道謝一邊小跑著離開了。",
        followUp: { pool: "wanderer", delayMin: 30, delayMax: 72 },
      },
      { label: "趕走他", effect: {}, resultText: "他沒有糾纏,拖著腳步消失在暮色裡。" },
    ],
  },
  // 流浪者的後續(不進隨機池,由 followUp 排程觸發)
  {
    kind: "passive",
    id: "wanderer-repay",
    followUpOnly: true,
    text: "之前那個流浪者回來了——氣色好了不少,身後還拖著一小車物資。「那頓飯救了我一命。」",
    effect: { wood: 15, stone: 10, ration: 4 },
  },
  {
    kind: "choice",
    id: "wanderer-bandits",
    followUpOnly: true,
    text: "糟了——之前那個流浪者帶著一夥土匪回來了。他把村子的位置,換成了自己的入夥資格。",
    options: [
      {
        label: "拿起武器抵抗",
        effect: {},
        resultText: "",
        passiveLoss: true,
        outcomes: [
          { weight: 65, effect: { wood: 10, stone: 8, hide: 4 }, resultText: "一場混戰。土匪沒料到村子敢拚命,丟下傷者和輜重潰逃了——那個流浪者跑得最快。" },
          { weight: 35, effect: {}, effectPct: { grain: 0.25, ration: 0.25 }, populationPct: 0.3, resultText: "寡不敵眾。土匪搶走了存糧,村裡有人沒能撐過那一夜。" },
        ],
      },
      {
        label: "交出存糧,破財消災",
        effect: {},
        effectPct: { grain: 0.3, meat: 0.3, ration: 0.3 },
        resultText: "土匪把糧倉搜刮了一輪,罵罵咧咧地走了。至少沒有人受傷。",
        passiveLoss: true,
      },
    ],
  },

  // ---- 超稀有訪客(weight 0.06):昂貴的一次性交換,換永久被動 ----
  {
    kind: "choice",
    id: "elder-stealth",
    weight: 0.06,
    minTick: 30,
    condition: (ctx) => !ctx.perks.stealth,
    text: "一位拄著杖的老者在村口駐足。他認得原野上那些東西的習性——「牠們靠聲音找人。我可以教你們怎麼移動,但你們得提供我一批過冬的東西。」",
    options: [
      {
        label: "供養他(皮革 -40、肉乾 -20)",
        effect: { leather: -40, jerky: -20 },
        grantPerk: "stealth",
        resultText: "老者住了幾天,教會了你貼地換步的走法。(獲得【潛行】:遠征的遭遇率降低)",
      },
      { label: "送他上路", effect: {}, resultText: "老者不置可否地點點頭,拄著杖走遠了。" },
    ],
  },
  {
    kind: "choice",
    id: "automaton-machinist",
    weight: 0.06,
    minTick: 50,
    condition: (ctx) => !ctx.perks.machinist && (ctx.resources.iron ?? 0) > 0,
    text: "一個渾身裹著破布的高大旅人站在村口。布縫間露出的不是皮膚。它伸出手,聲音像敲在金屬管上:「鐵。和燒的油。」",
    options: [
      {
        label: "給它(鐵礦 -60、燈油 -4)",
        effect: { iron: -60, oil: -4 },
        grantPerk: "machinist",
        resultText: "它半天之內改造了村裡所有的工具,沒有人看清它是怎麼做的。天黑前它就走了。(獲得【機巧】:手動採集成果 +25%)",
      },
      { label: "拒絕", effect: {}, resultText: "它靜止了很久,久到大家以為它壞了——然後一言不發地轉身離開。" },
    ],
  },
  {
    kind: "choice",
    id: "cultist-blessing",
    weight: 0.06,
    minTick: 60,
    condition: (ctx) => !ctx.perks.blessing && (ctx.resources.shard ?? 0) > 0,
    text: "一個穿著褪色祭袍的人站在村外,眼神還算清明。他盯著屋簷下掛著的異晶看了很久:「神的結晶……讓給我,我可以賜與你們一些神的恩賜。」",
    options: [
      {
        label: "與他交換(異晶 -100)",
        effect: { shard: -100 },
        grantPerk: "blessing",
        resultText: "他教了村民一段不成調的低吟。說也奇怪,唱過之後,傷口沒那麼容易惡化了。(獲得【祝禱】:戰鬥中毒/流血的累積減半)",
      },
      { label: "請他離開", effect: {}, resultText: "他望著屋簷下的異晶,又看了你一眼,一步三回頭地走了。" },
    ],
  },
  {
    kind: "choice",
    id: "trader",
    text: "一名流動商人來訪,提議用木材換取石材。",
    condition: (ctx) => (ctx.resources.wood ?? 0) >= 10, // 拿不出木材時,交易選項形同虛設
    options: [
      { label: "交易(木材 -10 → 石材 +8)", effect: { wood: -10, stone: 8 }, resultText: "交易順利完成。" },
      { label: "婉拒", effect: {}, resultText: "商人聳聳肩,繼續上路。" },
    ],
  },
  {
    kind: "choice",
    id: "wolf-pack",
    text: "偵查回報附近有野狼群出沒,是否要清剿?",
    options: [
      { label: "派人清剿(有損耗風險)", effect: { hide: 2, meat: 2, wood: -2 }, resultText: "清剿成功,順便帶回了一些戰利品。" },
      { label: "加強戒備就好", effect: {}, resultText: "村莊提高警戒,暫時相安無事。" },
    ],
  },

  // ---- village-events.md A. 資源事件 — 正面(擴充批) ----
  { kind: "passive", id: "driftwood", text: "河邊沖來大量浮木。", effect: { wood: 8 } },
  { kind: "passive", id: "stone-vein", text: "採石場挖到易開採的新岩層。", effect: { stone: 6 }, condition: (ctx) => (ctx.assignments["quarrier"] ?? 0) > 0 },
  { kind: "passive", id: "beehive", text: "村民發現蜂巢與周邊獵物聚集地。", effect: { meat: 3 } },
  { kind: "passive", id: "fur-bounty", text: "狩獵隊帶回了品質很好的皮毛。", effect: { hide: 4 }, condition: (ctx) => (ctx.assignments["hunter"] ?? 0) > 0 },
  { kind: "passive", id: "caravan-drop", text: "過路商隊匆忙離開,遺落了部分貨物。", effect: { wood: 3, stone: 3 }, minTick: 10 },
  { kind: "passive", id: "goodwill", text: "附近的倖存者主動送來一點吃的,作為之前借宿的答謝。", effect: { ration: 2 }, minTick: 15 },

  // ---- village-events.md B. 資源事件 — 負面(擴充批) ----
  { kind: "passive", id: "rat-plague", text: "老鼠啃食了存糧。", effect: { grain: -2, ration: -1 }, minTick: 8, condition: (ctx) => (ctx.resources.grain ?? 0) + (ctx.resources.ration ?? 0) >= 3 },
  { kind: "passive", id: "hide-rot", text: "一批生皮存放不當,發臭報廢了。", effect: { hide: -3 }, minTick: 8, condition: (ctx) => (ctx.resources.hide ?? 0) >= 3 },
  { kind: "passive", id: "arrow-damp", text: "弓矢受潮,部分不堪使用。", effect: { arrow: -2 }, minTick: 12, condition: (ctx) => (ctx.resources.arrow ?? 0) >= 2 },
  { kind: "passive", id: "granary-bug", text: "穀倉出現蟲害,損失不小。", effect: {}, effectPct: { grain: 0.25 }, minTick: 20, condition: (ctx) => ctx.hasBuilding("farm") && (ctx.resources.grain ?? 0) >= 8 },

  // ---- village-events.md C. 天氣/氛圍(無數值或輕微,調劑節奏) ----
  { kind: "passive", id: "clear-night", text: "難得的晴朗夜空。村裡的人們圍著火堆坐了很久。", effect: {} },
  { kind: "passive", id: "heavy-rain", text: "暴雨連日,戶外的工作進度慢了下來。", effect: { wood: -2, stone: -1 }, minTick: 6 },
  {
    kind: "passive",
    id: "red-moon",
    text: "今晚的月亮泛著詭異的紫紅色。村民議論紛紛,沒有人說得出原因。",
    effect: {},
    minTick: 30, // 呼應 worldbuilding.md § 3,前期偶爾閃現的異常訊號(認知揭露弧線的第一滴水)
  },
  {
    kind: "passive",
    id: "dead-silence",
    text: "整個下午,林子裡安靜得不太對勁——連鳥叫聲都沒有。",
    effect: { meat: -2 },
    minTick: 25,
    condition: (ctx) => (ctx.assignments["hunter"] ?? 0) > 0,
  },

  // ---- village-events.md D/G. 野獸與訪客(選擇型擴充) ----
  {
    kind: "choice",
    id: "crow-flock",
    text: "大群鴉鳥盤旋在晾曬場上空,不斷俯衝啄食。",
    minTick: 10,
    condition: (ctx) => (ctx.resources.meat ?? 0) >= 20,
    options: [
      { label: "派人驅趕(生肉 -20)", effect: { meat: -20 }, resultText: "花了些功夫把鴉群趕走,只損失了一點肉乾原料。" },
      { label: "隨牠們去", effect: {}, effectPct: { meat: 0.5 }, resultText: "鴉群飽餐一頓才離開——晾曬場的肉少了一半。", passiveLoss: true },
    ],
  },
  {
    kind: "choice",
    id: "wandering-smith",
    text: "一位旅行工匠來訪,願意用手藝換一頓飽飯。",
    minTick: 15,
    options: [
      { label: "款待他(穀物 -10)", effect: { grain: -10, stone: 10, wood: 10 }, resultText: "他幫忙修整了工具,效率提升了不少,臨走前還留下些材料。" },
      { label: "婉拒", effect: {}, resultText: "他點點頭,沒有多說什麼就上路了。" },
    ],
  },
  {
    kind: "choice",
    id: "injured-hunter",
    text: "一名外地獵人拖著受傷的腿來求助。",
    minTick: 12,
    // 兩個選項都要花東西:至少付得起其中一個,事件才會出現(否則玩家會被鎖在遮罩裡)
    condition: (ctx) => ctx.population < ctx.populationCap && ((ctx.resources.bandage ?? 0) >= 1 || (ctx.resources.ration ?? 0) >= 1),
    options: [
      { label: "收治他(繃帶 -1)", effect: { bandage: -1 }, populationDelta: 1, resultText: "傷好之後,他決定留下來——村裡多了一位好獵手。" },
      { label: "給點吃的請他離開", effect: { ration: -1 }, resultText: "他道了謝,一瘸一拐地消失在路的盡頭。" },
    ],
  },

  // ---- village-events.md E. 感染/瘟疫事件 — 會減損人口,門檻設較高,不會在開局出現 ----
  {
    kind: "passive",
    id: "mild-outbreak",
    text: "村民間爆發輕微的感染,儘管盡力照料,還是有人沒能撐過去。",
    effect: { grain: -2 },
    populationDelta: -1,
    minTick: 40,
  },
  {
    kind: "choice",
    id: "water-doubt",
    text: "有村民喝了水源的水之後開始上吐下瀉,大家對那口水井起了疑心。",
    minTick: 35,
    options: [
      { label: "暫停取水,徹底檢查(石材 -50)", effect: { stone: -50 }, resultText: "花了些材料重砌井口,情況穩定下來了。" },
      { label: "應該只是吃壞肚子", effect: {}, effectPct: { grain: 0.3 }, populationDelta: -5, resultText: "幾天後,又有人倒下了……這次沒能救回來。壞掉的存糧也只能整批倒掉。", passiveLoss: true },
    ],
  },
  {
    kind: "choice",
    id: "wolf-raid",
    text: "野狼群夜襲了村莊外圍,幾名值夜的村民受了傷。",
    options: [
      {
        label: "全力救治(消耗大量存糧)",
        effect: {},
        effectPct: { meat: 0.3, grain: 0.3, jerky: 0.2 },
        resultText: "所有人都保住了性命——但消耗了大量的存糧。",
        passiveLoss: true,
      },
      {
        label: "順其自然",
        effect: {},
        effectPct: { meat: 0.5, hide: 0.4 },
        populationDelta: -10,
        resultText: "沒人守夜的第二晚,狼群回來把晾曬場洗劫一空。村莊失去了一位居民。",
        passiveLoss: true,
      },
    ],
    minTick: 40,
  },
];
