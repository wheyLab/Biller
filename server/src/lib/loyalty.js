// Loyalty rules. All tunables come from app_config, never hardcoded constants.
import { getConfigInt, getConfig } from './db.js';

export function loyaltySettings(db) {
  return {
    earnPaisePerPoint: getConfigInt(db, 'loyalty.earn_paise_per_point', 1000),
    redeemThreshold: getConfigInt(db, 'loyalty.redeem_threshold_points', 150),
    eligibleTiers: (getConfig(db, 'loyalty.redeem_eligible_tiers', 'Caffeinated,Originals,Daily') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    maxRedemptionsPerOrder: getConfigInt(db, 'loyalty.max_redemptions_per_order', 1),
  };
}

// 1 point per earnPaisePerPoint spent, rounded down. Based on amount actually paid.
export function pointsEarned(totalPaise, earnPaisePerPoint) {
  if (earnPaisePerPoint <= 0) return 0;
  return Math.floor(totalPaise / earnPaisePerPoint);
}

export function canRedeem(pointsBalance, threshold) {
  return threshold > 0 && pointsBalance >= threshold;
}

export function isRedeemable(tier, eligibleTiers) {
  return eligibleTiers.includes(tier);
}
