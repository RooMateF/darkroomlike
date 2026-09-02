// 對應 design-notes.md § 3.2 的符號說明

export type TileType = "plain" | "brush" | "rubble" | "wall" | "water" | "depot" | "resource" | "event" | "site" | "exit" | "landmark" | "chest" | "slopeL" | "slopeV" | "slopeR";

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
