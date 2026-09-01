import type { CategoryDef } from "./types";
import { WEAPONS } from "./village/data";
import type { Carried } from "./carried";

/**
 * 依隨身行囊(整備頁打包的 carried)組出玩家的戰鬥類別。
 * - 冷兵器:攜帶中的近戰武器;一把都沒有時只剩「徒手」
 * - 熱武器:攜帶中的遠程武器(弓需要弓矢,授權判斷在 main.ts);沒有就整個類別不出現
 * - 法術:初期未解鎖,不出現(worldbuilding.md § 6:由建造者後續引導揭露)
 * - 道具:繃帶/肉乾/藥劑/卷軸,都是消耗品,用完就不能再按(乾糧是行軍糧,不進戰鬥道具欄也不回血)
 */
export function buildPlayerCategories(carried: Carried | null): CategoryDef[] {
  const carriedWeapons = WEAPONS.filter((w) => (carried?.weapons[w.id] ?? 0) > 0);

  const melee = carriedWeapons
    .filter((w) => w.category === "melee")
    .map((w) => ({ id: w.id, label: w.label, baseCost: w.baseCost, symbol: w.symbol, damage: w.damage, freeze: w.freeze }));
  const ranged = carriedWeapons
    .filter((w) => w.category === "ranged")
    .map((w) => ({ id: w.id, label: w.label, baseCost: w.baseCost, symbol: w.symbol, damage: w.damage }));

  // 類別按「戰鬥位置」命名,不按科技——獵弓是冷兵器,掛在「熱武器」底下說不通。
  // 之後火藥武器登場時另立「火器」類別(design-notes.md § 2.3.1 的四類架構保留)
  const categories: CategoryDef[] = [
    {
      id: "melee",
      label: "近戰",
      subActions: melee.length > 0 ? melee : [{ id: "fists", label: "徒手", baseCost: 0.7, symbol: ">", damage: 1 }],
    },
  ];
  if (ranged.length > 0) {
    categories.push({ id: "ranged", label: "遠程", subActions: ranged });
  }

  // 道具單一轉盤(2026-09 用戶定案):整類共用 1s 回轉,不再各自快慢——
  // 全滿常駐反而不好按;強力道具(slowReuse)用完後,下一輪回轉拖長為 1.2s
  const items = [];
  if ((carried?.bandages ?? 0) > 0) {
    // 繃帶:第一章只能機率拾取的稀有品,回復量大並止血(強力:拖慢下一輪)
    items.push({ id: "bandage", label: "繃帶", baseCost: 1.0, symbol: "+", damage: 0, heal: 20, slowReuse: 1.2 });
  }
  if ((carried?.jerky ?? 0) > 0) {
    // 肉乾:重但滋養——戰鬥中唯一能吃的食物(乾糧輕便卻不頂餓,回不了血);統一回 10
    items.push({ id: "jerky", label: "肉乾", baseCost: 1.0, symbol: "+", damage: 0, heal: 10 });
  }
  if ((carried?.elixirs ?? 0) > 0) {
    // 舊時代藥劑(交易所兌換):大量回復並解除所有異常——打硬仗的底牌(強力:拖慢下一輪)
    items.push({ id: "elixir", label: "舊時代藥劑", baseCost: 1.0, symbol: "+!", damage: 0, heal: 15, slowReuse: 1.2 });
  }
  if ((carried?.salts ?? 0) > 0) {
    // 醒神鹽:解除暈眩/遲緩並免疫 6 秒——看著敵方大招條升起時,提前含上一撮
    items.push({ id: "salt", label: "醒神鹽", baseCost: 1.0, symbol: "+=", damage: 0 });
  }
  if ((carried?.scrolls ?? 0) > 0) {
    // 火焰卷軸:一次性的高傷害——法術系統解鎖前,玩家第一次碰到「不屬於這個時代常識」的力量(強力:拖慢下一輪)
    items.push({ id: "fire-scroll", label: "火焰卷軸", baseCost: 1.0, symbol: "*~*", damage: 12, slowReuse: 1.2 });
  }
  if (items.length > 0) {
    categories.push({ id: "item", label: "道具", subActions: items });
  }
  return categories;
}

// 敵人名冊已移至 enemies.ts(依 bestiary.md 前期梯隊)
