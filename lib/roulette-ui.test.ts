import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(
  new URL("../components/matchmaking-roulette.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../components/matchmaking-roulette.module.css", import.meta.url),
  "utf8",
);

test("roulette accepts the public roster and builds a two-sided avatar reel", () => {
  assert.match(component, /candidates:\s*PublicPlayer\[\]/);
  assert.match(component, /sanitizeCandidates\(candidates,\s*player,\s*reveal\.opponent\)/);
  assert.match(component, /buildReelSequence\(/);
  assert.match(component, /const current = sequence\[frame\]/);
  assert.match(component, /player=\{current\.left\}/);
  assert.match(component, /player=\{current\.right\}/);
  assert.match(component, /<Image[\s\S]*player\.avatarUrl[\s\S]*player\.nickname/);
  assert.doesNotMatch(component, /mysteryAvatar|LOCKED PLAYER|>\?<\/div>/);
});

test("the precomputed reel explicitly includes every sanitized candidate", () => {
  assert.match(component, /for \(const candidate of roster\)/);
  assert.match(component, /sequence\.push\(\{\s*left:\s*candidate,/);
  assert.match(component, /right:\s*roster\[/);
});

test("roulette timing slows down before the authoritative VS impact", () => {
  assert.match(component, /const REEL_DELAYS\s*=\s*\[[^\]]*70[^\]]*520[^\]]*\]/);
  assert.match(component, /window\.setTimeout\([\s\S]*getReelDelay\(currentFrame/);
  assert.match(component, /return REEL_DELAYS\[/);
  assert.match(component, /player=\{player\}[\s\S]*reveal\.opponent[\s\S]*player=\{reveal\.opponent\}/);
  assert.match(component, /reveal\.bye/);
  assert.match(component, /useReducedMotion\(\)/);
  assert.match(component, /Promise\.all\(roster\.map[\s\S]*preloadAvatar/);
  assert.match(component, /new window\.Image\(\)/);
  assert.match(component, /image\.decode/);
  assert.match(component, /if \(!assetsReady\) return/);
  assert.match(component, /if \(reduceMotion \|\| sequence\.length === 0\)[\s\S]*setSpinning\(false\)/);
});

test("final player cards are accessible and the stale lock copy is gone", () => {
  assert.match(component, /onSelectPlayer\?:\s*\(player:\s*PublicPlayer\)\s*=>\s*void/);
  assert.match(component, /type="button"[\s\S]*aria-label=\{`ดูโปรไฟล์/);
  assert.match(component, /onClick=\{\(\)\s*=>\s*onSelectPlayer\?\.\(player\)\}/);
  assert.doesNotMatch(component, /คู่แข่งขันถูกล็อกไว้แล้ว · กดซ้ำก็ได้คู่เดิม/);
  assert.match(styles, /min-height:\s*44px/);
  assert.doesNotMatch(styles, /\.locked\s*\{/);
});

test("player profile stacks above the roulette overlay", () => {
  const profileStyles = readFileSync(new URL("../components/player-profile-sheet.module.css", import.meta.url), "utf8");
  assert.match(styles, /z-index:\s*100/);
  assert.match(profileStyles, /\.backdrop\{z-index:\s*120\}/);
});
