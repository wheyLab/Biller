import { useMemo } from 'react';
import type { ProteinData } from '../api';
import { CREATINE_ADDON_ID, NO_MILK_TIER } from '../proteinRules';

const TYPE_TITLE: Record<string, string> = { whey: 'Whey protein', yeast: 'Yeast protein', plant: 'Plant protein' };
// Logos lifted straight from the shop's own sign-board PDF (client/public/brands),
// so the poster carries the real brand marks instead of just typeset names.
const BRAND_LOGO: Record<string, string> = {
  muscleblaze: '/brands/muscleblaze.png',
  gnc: '/brands/gnc.png',
  on: '/brands/on.png',
  superyou: '/brands/superyou.png',
  origin: '/brands/origin.png',
};

// Whole-rupee prices only (no paise here), so this never prints ".00" —
// that's what was making the price grid wrap and go ragged at this width.
const short = (paise: number) => `₹${Math.round(paise / 100)}`;
const priceCell = (paise: number) => (paise > 0 ? `+${short(paise)}` : 'Base');

// A live replica of the shop's printed "Blend Your Protein" board, sitting
// permanently beside the menu poster exactly like it does on the wall.
// Pulled straight from /api/protein so an admin price edit shows up here
// immediately — never a second, driftable copy of the numbers. Every price
// cell is forced to one line (whitespace-nowrap) at this width; only the
// brand name is ever allowed to wrap, and it gets its own row so a wrapped
// name can never knock a price row out of alignment.
export function ProteinPoster({ protein }: { protein: ProteinData | null }) {
  const grouped = useMemo(() => {
    if (!protein) return {};
    const g: Record<string, typeof protein.brands> = {};
    for (const b of protein.brands) (g[b.protein_type] ||= []).push(b);
    return g;
  }, [protein]);

  const priceMap = useMemo(() => {
    const m = new Map<string, number>();
    protein?.brand_prices.forEach((bp) => m.set(`${bp.brand_id}:${bp.grams}`, bp.price_paise));
    return m;
  }, [protein]);

  const brandTiers = useMemo(
    () => (protein ? Object.entries(protein.mode_by_tier).filter(([, m]) => m === 'brand').map(([t]) => t) : []),
    [protein]
  );

  if (!protein) return null;
  const grams = protein.amount_options.map((o) => o.grams);
  // One column template, reused for the header, every brand row and the
  // Signature row, so the four price columns land at the exact same x
  // position everywhere — a row's label (logo, brand name or "Signature")
  // always sits in this same fixed first column, never pushing the prices
  // after it around.
  const NAME_COL = '13cqw';
  const rowCols = { gridTemplateColumns: `${NAME_COL} repeat(${grams.length}, 1fr)` };

  const priceRow = (id: string, name: string) => (
    <div key={id} className="grid items-center gap-x-[1.5cqw]" style={rowCols}>
      {BRAND_LOGO[id] ? (
        <img src={BRAND_LOGO[id]} alt={name} className="h-[5cqw] w-full object-contain object-left" />
      ) : (
        <div className="font-body text-[2.6cqw] font-bold leading-tight">{name}</div>
      )}
      {grams.map((g) => (
        <div key={g} className="whitespace-nowrap text-right font-mono text-[2.6cqw] leading-tight">
          {priceCell(priceMap.get(`${id}:${g}`) ?? 0)}
        </div>
      ))}
    </div>
  );

  // Flattened as one list of siblings (header, every brand row, every type
  // divider) so a single justify-between on the table spreads all of them
  // evenly across its full height — matching how the printed board isn't
  // cramped, it just has generous, even air between every line.
  const tableRows: React.ReactNode[] = [
    <div key="header" className="grid items-center gap-x-[1.5cqw]" style={rowCols}>
      <div className="whitespace-nowrap font-body text-[2.6cqw] font-bold leading-tight text-black/70">
        {TYPE_TITLE.whey}
      </div>
      {grams.map((g) => (
        <div key={g} className="whitespace-nowrap text-right font-display text-[3.6cqw] font-bold leading-none">
          {g}g
        </div>
      ))}
    </div>,
  ];
  (['whey', 'yeast', 'plant'] as const).forEach((type) => {
    const brands = grouped[type] || [];
    if (brands.length === 0) return;
    if (type !== 'whey') {
      tableRows.push(
        <div key={`${type}-divider`} className="flex items-center gap-[1.5cqw]">
          <div className="h-px flex-1 bg-black/25" />
          <span className="whitespace-nowrap font-body text-[2.2cqw] text-black/50">{TYPE_TITLE[type]}</span>
          <div className="h-px flex-1 bg-black/25" />
        </div>
      );
    }
    brands.forEach((b) => tableRows.push(priceRow(b.id, b.name)));
  });

  return (
    <div className="@container size-full overflow-hidden bg-card text-black">
      <div className="flex size-full flex-col gap-[2.4cqw] p-[4.5cqw]">
        <div className="text-center">
          <div className="font-display text-[5cqw] tracking-widest text-poster">WHEY LAB</div>
          <h1 className="font-display text-[9.5cqw] font-bold leading-[0.95] text-poster">
            BLEND YOUR
            <br />
            PROTEIN
          </h1>
          <p className="mt-[1.2cqw] font-body text-[2.8cqw] leading-tight text-black/60">
            Pick your protein. Set your grams. Make it yours
          </p>
        </div>

        <div className="flex min-h-0 flex-1 flex-col justify-between gap-y-[1.6cqw] rounded-[2cqw] border border-black/70 p-[3cqw]">
          {tableRows}
        </div>

        {brandTiers.length > 0 && (
          <p className="text-center font-body text-[2.3cqw] italic leading-tight text-poster">
            Brand choice available for {brandTiers.join(' & ')} only.
          </p>
        )}

        <div
          className="grid items-center gap-x-[1.5cqw] rounded-[2cqw] bg-poster px-[3cqw] py-[1.8cqw] text-cream"
          style={rowCols}
        >
          <span className="font-display text-[4cqw] font-bold leading-none">Signature</span>
          {protein.amount_options.map((o) => (
            <span key={o.grams} className="whitespace-nowrap text-right font-mono text-[2.5cqw]">
              {priceCell(o.signature_addon_price_paise)}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-[2cqw]">
          <div className="rounded-[2cqw] border border-poster p-[2.2cqw]">
            <div className="mb-[1.4cqw] text-center font-display text-[3.4cqw] font-bold text-poster">ADD-ON</div>
            <div className="flex flex-col gap-[1.4cqw]">
              {protein.addons.map((a) => (
                <div key={a.id} className="flex items-baseline justify-between gap-[1cqw] font-body text-[2.5cqw] font-bold leading-tight">
                  <span className="min-w-0 truncate">{a.name}</span>
                  <span className="whitespace-nowrap font-mono">+{short(a.price_paise)}</span>
                </div>
              ))}
            </div>
            {protein.addons.some((a) => a.id === CREATINE_ADDON_ID) && (
              <div className="mt-[1.2cqw] border-t border-black/15 pt-[1cqw] font-body text-[1.9cqw] italic leading-tight text-black/45">
                Creatine not on Bulk
              </div>
            )}
          </div>

          <div className="rounded-[2cqw] border border-poster p-[2.2cqw]">
            <div className="mb-[1.4cqw] text-center font-display text-[3.4cqw] font-bold text-poster">MILK</div>
            <div className="flex flex-col gap-[1.4cqw]">
              {protein.milk_options.map((m) => (
                <div key={m.id} className="flex items-baseline justify-between gap-[1cqw] font-body text-[2.5cqw] font-bold leading-tight">
                  <span className="min-w-0 truncate">{m.name}</span>
                  <span className="whitespace-nowrap font-mono">{m.price_paise > 0 ? `+${short(m.price_paise)}` : ''}</span>
                </div>
              ))}
            </div>
            <div className="mt-[1.2cqw] border-t border-black/15 pt-[1cqw] font-body text-[1.9cqw] italic leading-tight text-black/45">
              Not on {NO_MILK_TIER}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
