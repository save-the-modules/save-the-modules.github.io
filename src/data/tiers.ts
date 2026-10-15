// Transcribed from the supplied 1792085305.png. Primary official publication not independently verified.
export const DATA_REVISION = "user-table-2026-10-16-critical-corrected-v2";
export const TIER_COUNT = 15;
const common = [
  4.77, 5.47, 6.18, 6.88, 7.59, 8.29, 9, 9.7, 10.4, 11.11, 11.81, 12.52, 13.22,
  13.93, 14.63,
] as const;
export const VERIFIED_TIERS: Record<string, readonly number[]> = {
  code: [
    9.54, 10.94, 12.34, 13.75, 15.15, 16.55, 17.95, 19.35, 20.75, 22.15, 23.56,
    24.96, 26.36, 27.76, 29.16,
  ],
  hit: common,
  ammo: [
    27.84, 31.95, 36.06, 40.17, 44.28, 48.39, 52.5, 56.6, 60.71, 64.82, 68.93,
    73.04, 77.15, 81.26, 85.37,
  ],
  attack: common,
  chargeDamage: common,
  chargeSpeed: [
    1.98, 2.28, 2.57, 2.86, 3.16, 3.45, 3.75, 4.04, 4.33, 4.63, 4.92, 5.21,
    5.51, 5.8, 6.09,
  ],
  critDamage: [
    6.64, 7.62, 8.6, 9.58, 10.56, 11.54, 12.52, 13.5, 14.48, 15.46, 16.44,
    17.42, 18.4, 19.38, 20.36,
  ],
  crit: [
    2.3, 2.64, 2.98, 3.32, 3.66, 4, 4.35, 4.69, 5.03, 5.37, 5.7, 6.05, 6.39,
    6.73, 7.07,
  ],
  defense: common,
};
export function tierValue(option: string, tier: number): number | null {
  return (
    VERIFIED_TIERS[option === "critical" ? "crit" : option]?.[tier - 1] ?? null
  );
}
// Explicit user correction after cross-check: crit 12%, critDamage 10%.
// These two probabilities supersede the attachment; all 135 tier values still follow it.
export const OPTION_WEIGHTS: Record<string, number> = {
  code: 0.1,
  hit: 0.12,
  ammo: 0.12,
  attack: 0.1,
  chargeDamage: 0.12,
  chargeSpeed: 0.12,
  critDamage: 0.10,
  crit: 0.12,
  defense: 0.1,
};
export const TIER_PROBABILITIES = Array.from({ length: 15 }, (_, i) =>
  i < 5 ? 0.12 : i < 10 ? 0.07 : 0.01,
);
export const SLOT_PROBABILITIES = [1, 0.5, 0.3] as const;
export const RULES = {
  source: "사용자 제공 표 · 원본 표기: 니케챈 (공식 공시 원문 미확보)",
  sourceImage: "1792085305.png",
  rerollModules: [1, 2, 3] as readonly number[],
  newPermanentLockModules: [2, 3] as readonly number[],
  resetCurrentTierExclusion: "exclude-and-renormalize",
  lockConsumption: "first-execution-not-selection",
  conditionalDuplicateDraw: "unverified",
} as const;
