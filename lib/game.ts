export type Happening = "force" | "powerful" | "giant" | null;

export type TurnEvent = {
  type: Happening;
  requiredPumps: number;
};

export function rollHappening(random = Math.random): TurnEvent {
  if (random() >= 0.01) return { type: null, requiredPumps: 1 };
  const eventRoll = random();
  if (eventRoll < 1 / 3) {
    return { type: "force", requiredPumps: 2 + Math.floor(random() * 4) };
  }
  if (eventRoll < 2 / 3) return { type: "powerful", requiredPumps: 1 };
  return { type: "giant", requiredPumps: 1 };
}

export function scheduledRiskIncrement(totalPumpsAfterPress: number) {
  if (totalPumpsAfterPress <= 50) return 1;
  if (totalPumpsAfterPress < 150) return 10;
  return 20;
}

export function riskIncrement(
  totalPumpsAfterPress: number,
  event: Happening,
  random = Math.random,
) {
  if (event === "giant") return (1 + Math.floor(random() * 5)) * 100;
  const base = scheduledRiskIncrement(totalPumpsAfterPress);
  return event === "powerful" ? base * 2 : base;
}

export function formatProbability(riskBps: number) {
  return `${(riskBps / 100).toFixed(2)}%`;
}

export const HAPPENING_COPY: Record<Exclude<Happening, null>, { title: string; description: string }> = {
  force: {
    title: "強制シコシコ",
    description: "指定された回数まで、パスはおあずけ。",
  },
  powerful: {
    title: "パワフルな空気入れ",
    description: "このターンは危険度の上昇が2倍。",
  },
  giant: {
    title: "クソデカい空気入れ",
    description: "一撃で1〜5%上昇し、そのまま次の人へ。",
  },
};
