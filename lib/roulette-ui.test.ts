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

// framer-motion throws "Only two keyframes currently supported with spring and inertia
// animations". A spring paired with a 3+ keyframe array crashes the whole overlay to a
// blank screen, which is exactly what shipped once reduced motion was turned off.
test("no spring transition is paired with a multi-keyframe array", () => {
  const springs = [...component.matchAll(/transition=\{([\s\S]*?)\}\}/g)].map((match) => match[1]);
  for (const transition of springs) {
    if (!/type:\s*"spring"/.test(transition)) continue;
    assert.ok(!/\[[^\]]*,[^\]]*,[^\]]*\]/.test(transition), `spring transition must not carry keyframes: ${transition}`);
  }
  // The landing punch keeps its keyframes, so it must be a duration-based tween.
  assert.match(component, /scale: \[0\.2, 2\.1, 0\.92, 1\][\s\S]{0,400}?duration: 0\.62/);
});

test("the reel travels and the landing lands with an impact burst", () => {
  assert.match(component, /styles\.tickA/);
  assert.match(component, /styles\.tickB/);
  assert.match(component, /setImpact\(true\)/);
  assert.match(styles, /@keyframes reelTickA/);
  assert.match(styles, /@keyframes cameraShake/);
  assert.match(styles, /@keyframes shockRing/);
  // Reduced motion must still switch every new effect off.
  assert.match(styles, /prefers-reduced-motion: reduce[\s\S]*\.tickA,\.tickB,\.speedLines,\.overlayImpact,\.flash,\.shockwave \{ animation: none; \}/);
});
