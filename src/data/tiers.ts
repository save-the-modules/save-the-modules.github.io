// Verified game values only. Empty until primary game data is verified.
// null means unregistered; it must never silently become zero.
export const VERIFIED_TIERS: Record<string, readonly number[]> = {};
export const TIER_COUNT = 15;
export function tierValue(
  option: string,
  tier: number,
  demo = false,
): number | null {
  if (!tier) return null;
  if (demo) {
    const base: Record<string, number> = {
      code: 2.2,
      attack: 1.2,
      ammo: 12,
      chargeDamage: 1.8,
      chargeSpeed: 0.25,
      hit: 1.1,
      crit: 0.65,
      critDamage: 0.65 * 2.88,
      defense: 1.4,
      critical: 0.65,
    };
    return Math.round((base[option] ?? 1) * (tier + 2) * 100) / 100;
  }
  const values = VERIFIED_TIERS[option === "critical" ? "crit" : option];
  return values?.[tier - 1] ?? null;
}
