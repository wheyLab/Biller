// Loyalty rules. All tunables come from app_config, never hardcoded constants.
import { getConfigInt, getConfig } from './db.js';

export function loyaltySettings(db) {
  return {
    earnPaisePerPoint: getConfigInt(db, 'loyalty.earn_paise_per_point', 1000),
    redeemThreshold: getConfigInt(db, 'loyalty.redeem_threshold_points', 100),
    // What a redemption is worth: a flat amount off any drink (₹99 by default).
    redeemValuePaise: getConfigInt(db, 'loyalty.redeem_value_paise', 9900),
    // Most points one order can earn, however big it is (0 = no cap).
    maxPointsPerOrder: getConfigInt(db, 'loyalty.max_points_per_order', 20),
    eligibleTiers: (getConfig(db, 'loyalty.redeem_eligible_tiers', 'Caffeinated,Originals,Daily') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    maxRedemptionsPerOrder: getConfigInt(db, 'loyalty.max_redemptions_per_order', 1),
  };
}

// 1 point per earnPaisePerPoint spent, rounded down, capped at maxPerOrder
// (0 = no cap). Based on amount actually paid.
export function pointsEarned(totalPaise, earnPaisePerPoint, maxPerOrder = 0) {
  if (earnPaisePerPoint <= 0) return 0;
  const points = Math.floor(totalPaise / earnPaisePerPoint);
  return maxPerOrder > 0 ? Math.min(points, maxPerOrder) : points;
}

export function canRedeem(pointsBalance, threshold) {
  return threshold > 0 && pointsBalance >= threshold;
}

export function isRedeemable(tier, eligibleTiers) {
  return eligibleTiers.includes(tier);
}
