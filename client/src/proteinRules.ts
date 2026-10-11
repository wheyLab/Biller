// Small shared rules from the shop's printed "Blend Your Protein" board that
// aren't expressed in the API data itself (they're enforced server-side by
// tier/id, not by a flag on the records) — used by both the order-screen
// picker (TicketRail) and the poster display (ProteinPoster) so the two
// never drift apart.

// Creatine isn't offered on the Bulker/Bulk series.
export const CREATINE_EXCLUDED_TIER = 'Bulk';
export const CREATINE_ADDON_ID = 'creatine';

// Clear Protein has no milk base to swap — no milk option at all for it.
export const NO_MILK_TIER = 'Clear Protein';

// Ingredient callout printed under Seed Mix on the board — cosmetic only.
export const ADDON_NOTES: Record<string, string> = { seedmix: 'Pumpkin · Watermelon · Sunflower' };
