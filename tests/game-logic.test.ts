import assert from "node:assert/strict";
import test from "node:test";
import {
  formatProbability,
  riskIncrement,
  rollHappening,
  scheduledRiskIncrement,
} from "../lib/game";
import { RANDOM_NICKNAMES } from "../lib/nicknames";

test("ランダム名ライブラリは重複なしの300語", () => {
  assert.equal(RANDOM_NICKNAMES.length, 300);
  assert.equal(new Set(RANDOM_NICKNAMES).size, 300);
});

test("通常時の確率上昇は50・51・150回で段階が切り替わる", () => {
  assert.equal(scheduledRiskIncrement(1), 1);
  assert.equal(scheduledRiskIncrement(50), 1);
  assert.equal(scheduledRiskIncrement(51), 10);
  assert.equal(scheduledRiskIncrement(149), 10);
  assert.equal(scheduledRiskIncrement(150), 20);
});

test("パワフルは上昇量2倍、クソデカは1〜5%", () => {
  assert.equal(riskIncrement(51, "powerful", () => 0), 20);
  assert.equal(riskIncrement(1, "giant", () => 0), 100);
  assert.equal(riskIncrement(1, "giant", () => 0.999), 500);
});

test("ハプニングは1%未満でのみ発生する", () => {
  assert.deepEqual(rollHappening(() => 0.5), { type: null, requiredPumps: 1 });
  const values = [0.009, 0.1, 0.75];
  assert.deepEqual(rollHappening(() => values.shift() ?? 0), { type: "force", requiredPumps: 5 });
});

test("確率表示は小数点以下2桁", () => {
  assert.equal(formatProbability(1), "0.01%");
  assert.equal(formatProbability(61), "0.61%");
  assert.equal(formatProbability(1000), "10.00%");
});
