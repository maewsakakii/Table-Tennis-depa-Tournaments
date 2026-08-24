import assert from "node:assert/strict";
import test from "node:test";
import { defaultMatchDate, formatMatchDate } from "./match-date.ts";

test("default match dates start on 25 August 2026 and skip weekends", () => {
  assert.deepEqual(Array.from({ length: 7 }, (_, index) => defaultMatchDate(index)), [
    "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28",
    "2026-08-31", "2026-09-01", "2026-09-02",
  ]);
  assert.equal(formatMatchDate("2026-08-25"), "25/08/2026");
});
