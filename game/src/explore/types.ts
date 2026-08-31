// 對應 design-notes.md § 3.2 的符號說明

export type TileType = "plain" | "brush" | "rubble" | "wall" | "water" | "depot" | "resource" | "event" | "site" | "exit" | "landmark";

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
};

/** 有名字的特別地點(骨架層手工放置,固定座標);Lv4 中盤級,Lv5 幾乎無法戰勝(design-notes.md § 3.10.1) */
export interface LandmarkDef {
  id: string;
  label: string;
  symbol: string;
  x: number;
  y: number;
  /** 特殊探勘地點等級(4 或 5) */
  level: 4 | 5;
  /** 踩上未解放的地標時的敘事 */
  introText: string;
  /** 解放後再訪的敘事(觀測台會輪播觀測紀錄,見 explore engine) */
  clearedText: string;
}

// 座標以 105x65 地圖為準(中心 52,32)
export const LANDMARKS: LandmarkDef[] = [
  {
    id: "mine",
    label: "鐵礦坑",
    symbol: "M",
    x: 86, // 東北廢墟深處
    y: 10,
    level: 4,
    introText: "山壁上一道人工開鑿的坑口,軌道的殘骸沒入黑暗。深處傳來沉重的呼吸聲——有什麼把這裡當成了巢穴。",
    clearedText: "礦坑已經安全了。村裡的人可以來這裡採鐵。",
  },
  {
    id: "observatory",
    label: "廢棄觀測台",
    symbol: "O",
    x: 92, // 東南平原遠端
    y: 55,
    level: 4,
    introText: "山丘上立著一座奇怪的圓頂建築,頂端裂開一道縫,像一隻半闔的眼睛。門內有人影晃動——他似乎不歡迎訪客。",
    clearedText: "圓頂下滿地都是手寫的紙頁。牆上用炭條反覆寫著同一句話,你決定翻翻那些還能讀的紀錄。",
  },
  {
    id: "shrine",
    label: "沼澤祭壇",
    symbol: "A",
    x: 14, // 西南濕地深處
    y: 52,
    level: 4,
    introText: "水面中央露出一座石砌的平台,擺著燒過的痕跡與奇怪的刻紋。守著它的東西從水下浮了上來。",
    clearedText: "祭壇安靜了下來。石縫裡的刻紋在光線下泛著微弱的暖意,像是餘燼。",
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
}

export interface Checkpoint {
  x: number;
  y: number;
  water: number;
}
