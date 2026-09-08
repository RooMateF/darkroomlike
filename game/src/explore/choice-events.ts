// 選擇式小劇情事件(2026-09 用戶核可):踩到事件點(?)時有機率開出「停下來抉擇」的一幕。
// 每則一場遊戲只出現一次(觸發即記名,抽完後事件點回到平常的碎片/補給)。
// 寫作原則:worldbuilding.md § 8.2 認知揭露弧線——只給線索,不說破;
// 效果都是小補給或純氛圍,不碰主線。
// ⑥「唱歌的風」帶小 Boss 戰(哼歌的東西:混亂機制;文本 2026-09 核可)。
// ⑧「埋在土裡的門」是長線伏筆:「帶著能開它的東西回來」——之後章節接回收。

export type ChoiceEventEffect =
  | { kind: "gain"; gains: Record<string, number>; hp?: number }
  | { kind: "water"; amount: number }
  | { kind: "trade"; gains: Record<string, number>; costs: Record<string, number> }
  | { kind: "boss"; enemyId: string };

export interface ChoiceEventOption {
  label: string;
  result: string;
  effect?: ChoiceEventEffect;
  /** 機率分歧(2026-09):加權抽一個結局,抽中的 result/effect 取代頂層 */
  outcomes?: { weight: number; result: string; effect?: ChoiceEventEffect }[];
}

export interface ChoiceEventDef {
  id: string;
  text: string;
  options: ChoiceEventOption[];
}

export const CHOICE_EVENTS: ChoiceEventDef[] = [
  {
    id: "iron-box",
    text: "碎石堆的縫隙裡卡著一只鏽死的鐵盒,鎖孔的形狀很陌生——不是村裡任何一把鑰匙能開的樣子。搖一搖,裡面有東西在響。",
    options: [
      {
        label: "砸開它",
        result: "石頭砸下去,盒蓋凹成了怪樣才彈開。裡面是幾卷用油紙包著的乾糧,嘗了一小口,應該是還能吃。盒底刻著一行小字,但你不認得那種字。",
        effect: { kind: "gain", gains: { ration: 3 } },
      },
      {
        label: "硬撬開它",
        result: "你把匕首插進鎖縫硬撬。鐵皮的斷口從你掌心拖出一道口子,傷口不太深,但卻一直滲血。盒蓋開了——油紙包的乾糧一份沒碎,完完整整。",
        effect: { kind: "gain", gains: { ration: 4 }, hp: -5 },
      },
      {
        label: "整個帶走",
        result: "你把盒子塞進背包側袋。路上它一直輕輕地響,像在數自己的心跳。",
        effect: { kind: "gain", gains: { iron: 2 } },
      },
      {
        label: "放回原處",
        result: "你把盒子放回原處。不知道為什麼,轉身的時候你數了三次自己的腳步。",
      },
    ],
  },
  {
    id: "dry-well",
    text: "一口石砌的老井,井繩早已腐朽幾乎斷裂。往下看,黑得像沒有底。你丟了顆小石子下去——聲音回來得太慢了一點。",
    options: [
      {
        label: "大聲喊一句",
        result: "回音一層層地往下掉,越掉越細。最後回上來的那一聲,尾音有點不像你的。你決定當作只是普通的風聲。",
      },
      {
        label: "垂繩子下去撈",
        result: "繩子繃直了一瞬,又鬆了。拉上來時,鉤上掛著一只完好的水袋——皮質袋的款式很舊,卻一點沒壞。",
        effect: { kind: "water", amount: 5 },
      },
      {
        label: "垂繩下去看看",
        result: "",
        outcomes: [
          { weight: 1, result: "你抓著繩子下到井底。淤泥裡半埋著一捆用油布纏好的東西——拆開是幾根還能用的鐵件。爬上來的時候,你盡量不去想剛才回音的事。", effect: { kind: "gain", gains: { iron: 4 } } },
          { weight: 1, result: "繩子在半途中斷了。你在井底躺了一會兒,先確認每一根骨頭還聽話,才慢慢爬起來。淤泥裡倒是真的半埋著一捆鐵件——算是不幸中的補償。", effect: { kind: "gain", gains: { iron: 4 }, hp: -8 } },
        ],
      },
      {
        label: "用石頭把井口蓋住",
        result: "你搬了三塊大石把井口壓住。做完才想到:你其實說不上來,自己是在防什麼東西掉下去,還是防什麼東西上來。",
      },
    ],
  },
  {
    id: "tree-marks",
    text: "一棵老樹的樹皮上刻著整齊的橫線,一道疊一道,像在數日子。最上面那道刻痕還很新,樹脂都沒乾。",
    options: [
      {
        label: "補上一道",
        result: "你掏出小刀,在最上面添了一道。不知道為什麼,這麼做讓你安心了一點——不管數日子的是誰,現在多了一個人一起數。",
      },
      {
        label: "摸摸新刻痕",
        result: "樹脂黏在指尖,涼的。刻痕的邊緣很利落,是一刀刻成的——手勁比你穩得多。",
      },
      {
        label: "在附近搜一圈",
        result: "樹背面的草被壓平了一小片,像有什麼在這裡坐了很久。草窩裡落著幾支削好的弓矢。",
        effect: { kind: "gain", gains: { arrow: 3 } },
      },
    ],
  },
  {
    id: "half-signpost",
    text: "草叢裡倒著半截木牌,漆掉得只剩幾個模糊的字形。箭頭指向的方向,連路的影子都沒有。",
    options: [
      {
        label: "照箭頭走幾步看看",
        result: "走出十來步,腳下忽然踏實——荒草底下埋著一段平整的硬路,直得不可思議,又在幾步之外斷得乾乾淨淨。",
      },
      {
        label: "把路標扶正",
        result: "你把木牌重新立好,拿石頭圍著壓實。要是有下一個路過的人,至少他會知道:這裡曾經有路。",
      },
      {
        label: "拆了當木材",
        result: "木牌又乾又輕,是上好的木材。你把它拆成幾段捆好。",
        effect: { kind: "gain", gains: { wood: 4 } },
      },
    ],
  },
  {
    id: "cold-campfire",
    text: "一圈石頭圍著一堆燒盡的灰。灰燼透著一股冷意,但從燃燒的結果來看,當時生這堆火的人很熟悉在野外過夜。石圈旁邊擺著一只倒扣的陶碗。",
    options: [
      {
        label: "翻開陶碗",
        result: "碗底下壓著一小包用布裹好的鹽和兩條肉乾,擺得整整齊齊——是留給後來人的。你收下了,然後把自己的一點東西壓回碗下。",
        effect: { kind: "trade", gains: { jerky: 2 }, costs: { ration: 1 } },
      },
      {
        label: "在灰裡撥一撥",
        result: "灰底下有一小截沒燒完的骨頭。你看了兩眼,分不出是什麼動物的。你把灰撥回去蓋好。",
      },
      {
        label: "沿石圈找腳印",
        result: "腳印朝北去,步距很長,走得很急。第七步之後,腳印沒有了——不是被蓋掉,是沒有了。",
      },
    ],
  },
  {
    id: "singing-wind",
    text: "風穿過蘆葦的時候,有一段聲音不太像風——像誰在很遠的地方哼一支忘了一半的歌。",
    options: [
      {
        label: "跟著哼",
        result: "你低聲跟了一遍。風停了一拍——一個不可名狀的生物哼著歌朝你衝過來。",
        effect: { kind: "boss", enemyId: "siren" },
      },
      {
        label: "朝聲音走近一點",
        result: "聲音永遠在「再過去一點」的地方。走了十幾步,你的靴子灌了水,聲音卻沒近半分。腳邊的泥裡半埋著一捲繃帶,還乾著。",
        effect: { kind: "gain", gains: { bandage: 1 } },
      },
      {
        label: "摀住耳朵快步離開",
        result: "你走出很遠才把手放下。風還是風的聲音了。",
      },
    ],
  },
  {
    id: "stone-cairn",
    text: "路邊堆著一座及膝的石堆,每顆石頭都挑得大小相仿——像是誰堆起來的,像是個記號,又像是座墳墓。",
    options: [
      {
        label: "添一顆石頭",
        result: "你挑了顆合手的石頭放上去。石堆穩穩地接住了它。不知道為什麼,你覺得這樣做是對的。",
      },
      {
        label: "搬開看看底下",
        result: "石頭底下是一塊摺好的皮革,包著一小捆處理好的皮料。你猶豫了一下,還是收下了——然後把石堆照原樣堆了回去。",
        effect: { kind: "gain", gains: { hide: 2 } },
      },
      {
        label: "繞開走",
        result: "你從另一側繞了過去。走遠了回頭看,石堆的影子被夕陽拉得很長,像個站著的人。",
      },
    ],
  },
  {
    id: "buried-door",
    text: "地面鼓起一塊,邊緣露出一角平整的板面。你踢開浮土——是一扇門。平放著,嵌在土裡。門把冰涼,是那種又硬又輕、說不出名字的材料。",
    options: [
      {
        label: "用力拉開",
        result: "門沒動。倒是門板深處傳來「咚」的一聲悶響,像有什麼東西也推了門一下——從另一邊。你鬆了手。",
      },
      {
        label: "把土蓋回去",
        result: "你把浮土踢回去,踩實,又在上面壓了塊石頭。走出很遠,你才發現自己一直屏著氣。",
      },
      {
        label: "在門邊做記號",
        result: "你在旁邊立了根樹枝,綁上一撮草。也許哪天,你會帶著能開它的東西回來。",
      },
    ],
  },
  // ---- 2026-09 擴充批(用戶反饋:第一章復用的事件太多)——林地/廢墟/濕地各自的東西;兩則帶小 Boss ----
  {
    id: "hunter-blind",
    text: "兩棵樹之間吊著一張皮繩編的床,離地一人高,繩結打得很講究。床底下的地面被踩實了一小圈,圈裡有一堆燒過的骨頭——不是人的。",
    options: [
      {
        label: "爬上去看看",
        result: "吊床上鋪著一張硬掉的獸皮,皮底下壓著幾支箭和兩條肉乾,用布包得好好的。誰在這裡守過很多個夜,守的東西已經不在了。",
        effect: { kind: "gain", gains: { arrow: 3, jerky: 2 } },
      },
      {
        label: "翻翻骨頭堆",
        result: "骨頭被啃得很乾淨,最大的一根從中間折斷了——斷口很平,不是牙咬的,是手掰的。",
      },
      {
        label: "解下皮繩帶走",
        result: "皮繩泡過油,還很韌。你解了一半,把另一半留在樹上——萬一有人回來。",
        effect: { kind: "gain", gains: { hide: 3 } },
      },
    ],
  },
  {
    id: "overturned-cart",
    text: "碎石堆裡半埋著一節車廂,漆掉光了,只認得出一個箭頭。車門變形卡死,縫裡吹出來的風有一股鐵鏽和舊布的味道。",
    options: [
      {
        label: "撬開車門",
        result: "",
        outcomes: [
          { weight: 1, result: "門彈開的瞬間在你手背上割了一道。車裡的座椅都爛了,行李架上倒是有一只沒開過的鐵盒——幾把還沒鏽透的鐵件。", effect: { kind: "gain", gains: { iron: 5 }, hp: -4 } },
          { weight: 1, result: "門開了。座椅之間滾出幾顆用油紙包著的子彈,紙都黃了,銅殼還亮。", effect: { kind: "gain", gains: { bullet: 4 } } },
        ],
      },
      {
        label: "從車窗鑽進去",
        result: "你擠進去,踩到一本泡爛的冊子——翻開的那一頁印著一張表:出發、到站、出發、到站。最後一列沒有時間。",
      },
      {
        label: "繞過去",
        result: "你從車廂另一頭繞過去。走遠了,風還在從那道門縫裡吹出來,沒有停過。",
      },
    ],
  },
  {
    id: "kneeling-man",
    text: "路邊跪著一個人,額頭抵著地,嘴裡念個不停。他的衣服很乾淨,乾淨得不像走過這片原野。你走近了,他也沒抬頭。",
    options: [
      {
        label: "停下來聽",
        result: "他念的是一段像經文的東西:「……先把痛全部吃下去,才有資格被放開……」念完一遍,又從頭開始。你聽了三遍,每一遍的字都一樣,語氣卻越來越像在求誰。",
      },
      {
        label: "遞水給他",
        result: "他抬起頭,接過水囊,只喝了很小一口就還給你。「你會回去的。」他說,然後把一小袋種子塞進你手裡——袋口繡著兩個套在一起的圓。",
        effect: { kind: "gain", gains: { grain: 6 } },
      },
      {
        label: "悄悄離開",
        result: "你放輕腳步走開。走出很遠,還聽得見那段念誦——聲音沒有變小。",
      },
    ],
  },
  {
    id: "boar-thicket",
    text: "灌木叢後面傳來低沉的鼻息,一下、一下,很有節奏。灌木在晃,晃動的範圍比一個人還寬。",
    options: [
      {
        label: "繞開",
        result: "你放輕腳步,從上風處繞了一大圈。鼻息一直沒停,也沒有跟上來。",
      },
      {
        label: "蹲下來等牠走",
        result: "",
        outcomes: [
          { weight: 2, result: "你蹲在原地等了很久。灌木終於安靜下來,地上留下一片翻開的黑土——牠在找東西吃,不是在找你。土裡露出幾顆被拱出來的塊莖。", effect: { kind: "gain", gains: { ration: 2 } } },
          { weight: 1, result: "鼻息忽然停了。灌木炸開——一頭野豬撞了出來。", effect: { kind: "boss", enemyId: "boar" } },
        ],
      },
      {
        label: "拉弓",
        result: "你拉開弓。箭還沒離弦,灌木已經朝你衝過來了。",
        effect: { kind: "boss", enemyId: "boar" },
      },
    ],
  },
  {
    id: "tree-bell",
    text: "一棵矮樹的枝椏上掛著一只黃銅小鈴,鈴舌是一小截骨頭。沒有風,鈴卻在很輕、很輕地響。",
    options: [
      {
        label: "摘下來帶走",
        result: "你把鈴摘下來塞進背包,它安靜了。走了一段路,背包裡響了一聲——只有一聲。",
        effect: { kind: "gain", gains: { iron: 1 } },
      },
      {
        label: "撥一下",
        result: "鈴聲比想像中大得多。遠處有什麼應了一聲——短短的,像回答。你決定不撥第二次。",
      },
      {
        label: "不碰它",
        result: "你退開兩步。鈴還在響,響的節奏跟你的心跳一樣快。你走快了些。",
      },
    ],
  },
  {
    id: "tentacle-deer",
    text: "一頭鹿站在林間空地上低頭吃草。牠的左半邊是鹿,右側肋骨下方垂著幾條沒有毛的、會動的東西,尖端輕輕探著空氣。牠抬頭看了你一眼,又低下去繼續吃。",
    options: [
      {
        label: "繞過去",
        result: "你貼著空地邊緣走。牠一直吃牠的草,右側那幾條東西朝你的方向探了探,又收了回去。",
      },
      {
        label: "慢慢靠近",
        result: "",
        outcomes: [
          { weight: 2, result: "你走到十步以內,牠沒有跑。你看清了:那幾條東西的尖端各有一個很小的、會開合的口。牠打了個響鼻,轉身走進林子,草地上留下幾撮蹭掉的毛。", effect: { kind: "gain", gains: { hide: 2 } } },
          { weight: 1, result: "你踩斷了一根枯枝。牠猛地抬頭——右側那幾條東西同時繃直,朝你甩過來。你退得快,只被掃到肩膀。", effect: { kind: "gain", gains: {}, hp: -6 } },
        ],
      },
      {
        label: "拉弓",
        result: "箭上弦的聲音很輕,但牠聽見了。牠沒有跑。牠轉過身面對著你,那幾條東西全部立了起來。",
        effect: { kind: "boss", enemyId: "deer" },
      },
    ],
  },
];
