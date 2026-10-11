import type { MenuItem } from '../api';

// The billing menu, laid out like the printed menu poster: red board, big
// white category headings, cream item cards with a periodic-table style code,
// the drink photo, macros, name and a price tag. Tapping a card adds it to the
// ticket. It renders inside FitCanvas at a fixed 1920-wide design size, so all
// text is sized in cqw (canvas width units) and the whole thing scales as one.
const LAYOUT_TIERS = ['Originals', 'Bulk', 'Signature', 'Lab Blend', 'Clear Protein', 'Caffenizer'];

const rupeesShort = (paise: number) => {
  const r = paise / 100;
  return `₹${Number.isInteger(r) ? r : r.toFixed(2)}`;
};

// Sold-out items keep the brand convention: a horizontal red line through the
// name. Never greyed out, never badged.
function Card({ item, hotkey, onAdd }: { item: MenuItem; hotkey?: string; onAdd: (id: string) => void }) {
  const soldOut = !item.is_available || item.price_paise == null;
  const priceBg = item.tier === 'Caffenizer' ? 'bg-caffeine' : 'bg-poster';
  return (
    <div className="@container aspect-[226/320]">
      <button
        type="button"
        disabled={soldOut}
        onClick={() => onAdd(item.id)}
        className={`relative block size-full overflow-hidden bg-card text-left text-black transition
          ${soldOut ? 'cursor-default' : 'hover:ring-4 hover:ring-white active:scale-[0.98]'}`}
      >
        {hotkey && !soldOut && (
          <span className="absolute right-[4%] top-[3%] z-10 font-mono text-[4cqw] text-black/40">{hotkey}</span>
        )}

        <span className="absolute left-[5%] top-[4%] z-10 flex aspect-square w-[27%] items-center justify-center border border-black/60 leading-none">
          <span className="absolute left-[9%] top-[7%] font-mono text-[4.4cqw]">{item.badge}</span>
          <span className="font-body text-[14cqw] font-medium">{item.code}</span>
          <span className="absolute bottom-[7%] font-body text-[2.6cqw]">{item.name}</span>
        </span>

        {item.image && (
          <img
            src={item.image}
            alt=""
            draggable={false}
            onError={(e) => (e.currentTarget.style.display = 'none')}
            className="pointer-events-none absolute right-[3%] top-[9%] h-[60%] w-[70%] object-contain"
          />
        )}

        {item.macros && (
          <span className="absolute bottom-[27%] left-[6%] w-[88%] font-mono text-[3.9cqw] leading-tight text-black/70">
            {item.macros}
          </span>
        )}

        <span className="absolute bottom-[5%] left-[6%] w-[62%] font-body text-[10.5cqw] font-bold leading-[1.05]">
          {item.name}
        </span>
        {soldOut && <span className="absolute bottom-[12%] left-[6%] h-[0.7cqw] w-[58%] bg-poster" />}

        <span
          className={`absolute bottom-[5%] right-[5%] ${priceBg} px-[3cqw] py-[1.2cqw] font-body text-[7.2cqw] font-bold leading-none text-white`}
        >
          {item.price_paise != null ? rupeesShort(item.price_paise) : '—'}
        </span>
      </button>
    </div>
  );
}

function Section({
  title,
  items,
  hotkeys,
  onAdd,
  gridClass,
}: {
  title: string;
  items: MenuItem[];
  hotkeys?: Record<string, string>;
  onAdd: (id: string) => void;
  gridClass: string;
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <h2 className="mb-[1.2cqw] font-body text-[3.2cqw] font-extrabold leading-none text-white">{title}</h2>
      <div className={`grid gap-[1.2cqw] ${gridClass}`}>
        {items.map((i) => (
          <Card key={i.id} item={i} hotkey={hotkeys?.[i.id]} onAdd={onAdd} />
        ))}
      </div>
    </section>
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
  const of = (tier: string) => items.filter((i) => i.tier === tier);
  const otherTiers = [...new Set(items.map((i) => i.tier).filter((t): t is NonNullable<typeof t> => !!t))].filter(
    (t) => !LAYOUT_TIERS.includes(t)
  );
  const col = 'flex flex-col justify-between';
  const common = { hotkeys, onAdd };

  return (
    <div className="@container size-full">
      <div className="flex size-full flex-col gap-[2cqw] p-[2.4cqw]">
        <div className="grid min-h-0 flex-1 grid-cols-[2fr_4fr_2fr] gap-[2cqw]">
          <div className={col}>
            <Section title="Originals" items={of('Originals')} gridClass="grid-cols-2" {...common} />
            <Section title="Bulk" items={of('Bulk')} gridClass="grid-cols-2" {...common} />
          </div>

          <div className={col}>
            <h1 className="text-center font-body text-[7cqw] font-extrabold leading-none tracking-[0.04em] text-white">
              MENU
            </h1>
            <Section title="Signature" items={of('Signature')} gridClass="grid-cols-3 px-[12.5%]" {...common} />
            <Section title="Lab Blend" items={of('Lab Blend')} gridClass="grid-cols-4" {...common} />
          </div>

          <div className={col}>
            <Section title="Clear Protein" items={of('Clear Protein')} gridClass="grid-cols-2" {...common} />
            <Section title="Caffenizer" items={of('Caffenizer')} gridClass="grid-cols-2" {...common} />
          </div>
        </div>

        {otherTiers.map((t) => (
          <div key={t} className="shrink-0">
            <Section title={t} items={of(t)} gridClass="grid-cols-8" {...common} />
          </div>
        ))}
      </div>
    </div>
  );
}
