import type { Metadata } from "next";
import GameApp from "@/components/game-app";

export const metadata: Metadata = {
  title: "何回でもシコシコしてよくてでも最低一回はシコってしなきゃいけなくて限界に達した人が負けっていうゲーム",
  description: "空気入れで風船を膨らませる、オンライン対応チキンレース。爆発させた人が負け。",
};

export default function Home() {
  return <GameApp />;
}
