// 對應 design-notes.md § 3.2 的符號說明

export type TileType = "plain" | "brush" | "rubble" | "wall" | "water" | "depot" | "resource" | "event" | "site" | "exit" | "landmark" | "chest" | "slopeL" | "slopeV" | "slopeR" | "redmoon" | "poi";

export const TILE_SYMBOL: Record<TileType, string> = {
  plain: ".",
  brush: ";",
  rubble: ":",
  wall: "#",
  water: "~",
  depot: "S",
  resource: "$",
  event: "*",
  site: "?", // 可深入探索的地點(類似 ADR 的洞穴/礦坑/廢屋)
  exit: "^", // 地圖邊緣的出口,通往相鄰地圖(存檔用統一符號;畫面上依方位畫 ^ v < >)
  landmark: "!", // 地標(存檔用統一符號;畫面上依 LANDMARKS 定義各自的字母)
  chest: "▣", // 寶箱(迷宮 Boss 房):打贏守著它的東西才開得了
  // 山坡(2026-09 用戶定案):連續的 / | \\ 畫成山區;只有順著山勢的方向才走得上去
  slopeL: "/", // 從左邊(西側)才踏得上去
  slopeV: "|", // 直上直下(南北向)才走得過
  slopeR: "\\", // 從右邊(東側)才踏得上去
  redmoon: "☾", // 紅月窪地(紅月事件×3 後近村出現):踩上=固定三場連鎖戰,打贏即消失
  poi: "&", // 原野建物(存檔用統一符號;畫面上依 POIS 定義各自的小寫字母)
};

/** 有名字的特別地點(骨架層手工放置,固定座標);Lv4 中盤級,Lv5 幾乎無法戰勝(design-notes.md § 3.10.1) */
export interface LandmarkDef {
  id: string;
  label: string;
  symbol: string;
  x: number;
  y: number;
  /** 所在地圖(未填 = 中央地圖 A) */
  mapId?: string;
  /** 特殊探勘地點等級(4 或 5) */
  level: 4 | 5;
  /** 地城層數覆寫(未填:Lv4=3 層、Lv5=4 層);圍場 Boss 是單場決戰 */
  stages?: number;
  /** 踩上未解放的地標時的敘事 */
  introText: string;
  /** 解放後再訪的敘事(觀測台會輪播觀測紀錄,見 explore engine) */
  clearedText: string;
}

// 座標以 88x54 地圖為準(中心 44,27);2026-09 縮圖時等比換算
export const LANDMARKS: LandmarkDef[] = [
  {
    id: "mine",
    label: "鐵礦坑",
    symbol: "M",
    x: 62, // 東北廢墟(2026-09 拉近:原本太遠,走到一半水就見底)
    y: 13,
    level: 4,
    introText: "山壁上一道人工開鑿的坑口,軌道的殘骸沒入黑暗。深處傳來沉重的呼吸聲——有什麼把這裡當成了巢穴。",
    clearedText: "礦坑已經安全了。村裡的人可以來這裡採鐵。",
  },
  {
    id: "observatory",
    label: "廢棄觀測台",
    symbol: "O",
    x: 77, // 東南平原遠端
    y: 46,
    level: 4,
    introText: "山丘上立著一座奇怪的圓頂建築,頂端裂開一道縫,像一隻半闔的眼睛。門內有人影晃動——他似乎不歡迎訪客。",
    clearedText: "圓頂下滿地都是手寫的紙頁。牆上用炭條反覆寫著同一句話,你決定翻翻那些還能讀的紀錄。",
  },
  {
    id: "shrine",
    label: "沼澤祭壇",
    symbol: "A",
    x: 12, // 西南濕地深處
    y: 43,
    level: 4,
    introText: "水面中央露出一座石砌的平台,擺著燒過的痕跡與奇怪的刻紋。守著它的東西從水下浮了上來。",
    clearedText: "祭壇安靜了下來。石縫裡的刻紋在光線下泛著微弱的暖意,像是餘燼。",
  },
  {
    // 煤礦坑——鋼鐵時代的鑰匙(鋼=鐵+煤合煉)。2026-09 從北嶺搬進中央地圖北緣:
    // 用戶反饋「甚至在其他地圖上」太遠;北嶺保留為日後內容的骨架
    id: "coalmine",
    label: "煤礦坑",
    symbol: "K",
    x: 54, // 2026-09 外推:煤(鋼階)要比鐵礦坑更遠(用戶確認的進度曲線)
    y: 4,
    level: 4,
    introText: "半山腰裂開一道黑色的礦口,連風吹過都帶著煤灰味。坑道深處傳來規律的、像挖掘一樣的聲音——但這裡不像是有人類的樣子。",
    clearedText: "煤礦安全了。烏黑的煤層在礦燈下泛著油亮的光——村裡的爐火,可以燒得更旺了。",
  },
  {
    // 北圍場的住客(2026-09 核可):單場決戰;掉「藥劑配方-數數攻擊」(醫院解鎖後可製作,第二章內容)
    id: "counter",
    label: "數數的東西",
    symbol: "D",
    x: 29,
    y: 5,
    level: 4,
    stages: 1,
    introText: "圍牆裡側坐著一個灰色的輪廓,背對著你。牠的手指動個不停——一根、兩根、三根。你進來的那一刻,牠停了。",
    clearedText: "圍場安靜了。地上只留下一排排刻痕,數到一半。",
  },
  {
    // 東南迷宮的收贓者(2026-09 定案):單場決戰;勝利後迷宮視野全開、寶箱(名刀鬼雪)現身
    id: "scavenger",
    label: "拾荒的長手",
    symbol: "L",
    x: 73,
    y: 47,
    level: 4,
    stages: 1,
    introText: "牆縫裡塞滿了東西:水袋、鞋、認不得用途的工具,分門別類,擺得整整齊齊。牆的深處,一條過長的手臂緩緩收了回去。",
    clearedText: "牆縫的收藏還在,但再沒有東西守著它們了。",
  },
  {
    // 2026-09 反制式 Lv4(用戶要求):東北廢墟的舊時代碉堡——甲殼獸,重武器踉蹌才砍得進
    id: "bunker",
    label: "崩塌的碉堡",
    symbol: "B",
    x: 70,
    y: 8,
    level: 4,
    introText: "半埋在土裡的混凝土建築,射擊孔朝著北方——不管當年在防什麼,都是從那邊來的。門早就沒了。裡面有什麼在挪動,很重,殼碰到牆的聲音像石板互相磨。",
    clearedText: "碉堡安靜了。射擊孔透進幾道光,照著牆上一排排用刀刻的正字——數到一半就停了。",
  },
  {
    // 西南濕地的淹沒村落——霧體,鬼雪或火焰卷軸才打得動
    id: "drowned",
    label: "淹沒的村落",
    symbol: "V",
    x: 20,
    y: 50,
    level: 4,
    introText: "水面上露出一排屋脊,黑的,泡得發脹。沒有鳥落在上面。霧貼著水走,走得比風慢——而且是逆著風走的。",
    clearedText: "水退了半尺,露出門檻。屋裡的桌上還擺著碗,碗裡是乾透的泥。",
  },
  {
    // 東南平原的廢棄農莊——巢母,散彈/火焰清場
    id: "farmstead",
    label: "廢棄的農莊",
    symbol: "F",
    x: 62,
    y: 30,
    level: 4,
    introText: "籬笆倒了一半,田裡的作物長成了不該有的高度。穀倉的門板從裡面被撐破,破口的邊緣掛著一層半透明的膜,還在滴。",
    clearedText: "穀倉空了,風從破門吹進去又吹出來。田裡那些長得太高的東西,開始一片片枯黃。",
  },
  {
    id: "church",
    label: "靜默教堂",
    symbol: "C",
    x: 7, // 西北林地最深處——本章的極限挑戰
    y: 5,
    level: 5,
    introText: "林子深處立著一座不該存在於這裡的尖頂建築。黑鐵的大門緊閉著。四周沒有聲音,連你自己的腳步聲都像被什麼吸走了。",
    clearedText: "教堂恢復了真正的寂靜。長椅的灰塵上只剩你的腳印。祭壇後的牆上,掛著一幅被刮花的畫——畫裡的東西你看不出來,也不想看出來。",
  },
];

/** 不可通行的地形 */
export const BLOCKED: TileType[] = ["wall", "water"];

export interface Tile {
  type: TileType;
  revealed: boolean;
  /** 點過燈的據點(燈柱燃著):周圍一帶的遭遇率大幅下降 */
  lit?: boolean;
  /** 鋪了鐵軌(永久建設,死亡不失去):軌上移動省水糧、不遇敵 */
  rail?: boolean;
}

export interface Checkpoint {
  x: number;
  y: number;
  water: number;
}

/**
 * 原野建物(2026-09 用戶要求):地圖上要有符合故事背景的建築、遺跡、設施——但不多,重點是合理。
 * 不是地城:踩上去給一段側寫,第一次到訪有一份東西可拿(或一次視野);之後只剩一句再訪的話。
 * 位置依象限個性擺:林地放獵人小屋/伐木場/墓園,廢墟放哨塔/軍車,平原放堤壩,濕地路上放神龕。
 */
export interface PoiDef {
  id: string;
  label: string;
  /** 畫面符號(小寫,和地標的大寫區分) */
  symbol: string;
  x: number;
  y: number;
  mapId?: string;
  /** 第一次到訪 */
  firstText: string;
  /** 之後再訪 */
  againText: string;
  /** 第一次到訪拿到的東西(受揹負空間限制) */
  loot?: Record<string, number>;
  /** 第一次到訪揭開周圍這麼多格的視野(哨塔) */
  reveal?: number;
}

export const POIS: PoiDef[] = [
  {
    id: "hunter-lodge",
    label: "獵人的小屋",
    symbol: "h",
    x: 34,
    y: 18,
    firstText: "一間用整根原木疊起來的小屋,門楣上釘著一副鹿角。屋裡的火塘早涼了,牆上還掛著幾張撐開的皮,邊緣捲了。桌上擺著一把削好的箭,箭桿上刻著同一個記號。",
    againText: "小屋還是空的。門楣上的鹿角被風吹得輕輕晃。",
    loot: { arrow: 4, jerky: 2 },
  },
  {
    id: "sawmill",
    label: "伐木場的遺跡",
    symbol: "w",
    x: 18,
    y: 16,
    firstText: "林子裡清出過一大片空地,樹樁齊得像用尺量過。空地中央躺著一台鏽死的機器,鋸片比人還高,齒縫裡卡著木屑,還沒爛透。旁邊碼著幾垛原木,底下的已經朽了,上面的還能用。",
    againText: "鋸片上的鏽又厚了一層。原木垛只剩下面朽掉的那幾層。",
    loot: { wood: 12 },
  },
  {
    id: "graveyard",
    label: "無名的墓園",
    symbol: "g",
    x: 24,
    y: 24,
    firstText: "林子裡有一小片空地,幾十塊石頭排成整齊的列,每一塊都朝同一個方向。石頭上沒有名字,只有刻痕——同一個日期,刻了幾十遍。最後一列的石頭比較新,土也還鬆。",
    againText: "石頭還是那些石頭。風把落葉吹進刻痕裡,又吹出來。",
  },
  {
    id: "watchtower",
    label: "傾倒的哨塔",
    symbol: "t",
    x: 58,
    y: 12,
    firstText: "一座鋼架哨塔斜倒在碎石堆上,頂上的平台還掛著半截鐵絲網。你順著斜倒的架子爬上去——風大得睜不開眼,但這一帶的地形,在腳下攤成了一張圖。",
    againText: "哨塔還斜在那裡。架子在風裡哼著一種很細的聲音。",
    reveal: 7,
  },
  {
    id: "army-truck",
    label: "翻覆的軍車",
    symbol: "u",
    x: 68,
    y: 20,
    firstText: "一輛翻倒的軍用卡車,輪子朝天,車斗的帆布爛成了條。駕駛座的門開著,座椅上沒有人,只有一頂鋼盔,盔帶還扣著。車斗底下壓著幾口鐵箱,一口撬開了——裡面的子彈用油紙包得很整齊,像有人以為還會回來拿。",
    againText: "卡車還翻在那裡。鋼盔不見了——也許是風,也許不是。",
    loot: { bullet: 8, iron: 3 },
  },
  {
    id: "dam",
    label: "乾涸的堤壩",
    symbol: "d",
    x: 52,
    y: 33,
    firstText: "一道混凝土堤壩橫在乾涸的河床上,壩面裂開幾道縫,縫裡長出了樹。壩底的閘門鏽死在半開的位置——水早就從那裡走光了。閘門後面的凹槽裡卡著一截截被沖下來的石料,方方正正,不是河裡會有的東西。",
    againText: "堤壩的影子在河床上拉得很長。閘門後面什麼也沒剩。",
    loot: { stone: 8 },
  },
  {
    id: "wayside-shrine",
    label: "路邊的神龕",
    symbol: "n",
    x: 28,
    y: 40,
    firstText: "路邊立著一座及腰的小龕,石頭砌的,龕裡沒有神像,只有一個用炭畫的圓——圓裡又畫了一個圓。龕前擺著幾只碗,碗裡是曬乾的鹽粒,結成一小塊一小塊。有人定期來換。",
    againText: "碗裡的鹽又換過了。你來的時候沒碰見人,走的時候也沒有。",
    loot: { salt: 1 },
  },
];

export function poiAt(x: number, y: number, mapId = "A"): PoiDef | undefined {
  return POIS.find((p) => p.x === x && p.y === y && (p.mapId ?? "A") === mapId);
}
