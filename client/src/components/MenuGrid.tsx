import type { MenuItem } from '../api';
import { rupees } from '../api';

const TIER_ORDER = ['Caffeinated', 'Originals', 'Daily', 'Signature', 'Clear Whey'];

// A single menu tile. Sold-out items keep a horizontal strike-through line —
// the established brand convention. Never greyed out, never badged.
function Tile({ item, hotkey, onAdd }: { item: MenuItem; hotkey?: string; onAdd: (id: string) => void }) {
  const soldOut = !item.is_available || item.price_paise == null;
  return (
    <button
      type="button"
      disabled={soldOut}
      onClick={() => onAdd(item.id)}
      className={`relative flex flex-col justify-between p-4 min-h-28 text-left border-2 transition-colors
        ${soldOut ? 'border-cream/15 cursor-default' : 'border-cream/25 hover:border-red active:bg-red/10'}`}
    >
      {hotkey && !soldOut && (
        <span className="absolute top-2 right-2 font-mono text-xs text-cream/40">{hotkey}</span>
      )}
      <span className="relative font-display text-2xl leading-tight text-cream">
        {item.name}
        {soldOut && <span className="absolute left-0 top-1/2 w-full h-0.5 bg-red" />}
      </span>
      <span className="font-mono text-lg text-cream/80">
        {item.price_paise != null ? rupees(item.price_paise) : '—'}
      </span>
    </button>
  );
}

export function MenuGrid({
  items,
  onAdd,
  hotkeys,
}: {
  items: MenuItem[];
  onAdd: (id: string) => void;
  hotkeys?: Record<string, string>;
}) {
  const tiers = TIER_ORDER.filter((t) => items.some((i) => i.tier === t));
  return (
    <div className="flex flex-col gap-6">
      {tiers.map((tier) => (
        <div key={tier}>
          <h2 className="font-body font-semibold uppercase tracking-widest text-xs text-red mb-2">{tier}</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {items
              .filter((i) => i.tier === tier)
              .map((i) => (
                <Tile key={i.id} item={i} hotkey={hotkeys?.[i.id]} onAdd={onAdd} />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
