import { useEffect, useMemo, useState } from 'react';
import type { MenuItem, CustomerLookup, CustomerIdentity, OrderResult, ProteinBrand, ProteinAmountOption } from '../api';
import { api, rupees } from '../api';
import type { TicketLine } from '../store/ticket';
import { orderTotals } from '../money';

type Payment = 'cash' | 'upi' | 'card';
const TYPE_LABEL: Record<string, string> = { whey: 'Whey', yeast: 'Yeast', plant: 'Plant-based' };

// The customer is chosen before the menu (number-first flow), so this rail just
// receives it and rings up the order.
export function TicketRail({
  items,
  lines,
  identity,
  customer,
  proteinBrands,
  proteinOptions,
  onAdd,
  onDec,
  onRemove,
  onSetProtein,
  onComplete,
}: {
  items: MenuItem[];
  lines: Record<string, TicketLine>;
  identity: CustomerIdentity;
  customer: CustomerLookup | null;
  proteinBrands: ProteinBrand[];
  proteinOptions: ProteinAmountOption[];
  onAdd: (id: string) => void;
  onDec: (id: string) => void;
  onRemove: (id: string) => void;
  onSetProtein: (id: string, brandId: string, grams: number) => void;
  onComplete: (r: OrderResult) => void;
}) {
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const brandsById = useMemo(() => new Map(proteinBrands.map((b) => [b.id, b])), [proteinBrands]);
  const optionsByGrams = useMemo(() => new Map(proteinOptions.map((o) => [o.grams, o])), [proteinOptions]);
  const [payment, setPayment] = useState<Payment>('cash');
  const [redeem, setRedeem] = useState(false);
  const [manualDiscount, setManualDiscount] = useState(0);
  const [manualOpen, setManualOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const lineList = Object.entries(lines).map(([id, line]) => {
    const addon = optionsByGrams.get(line.proteinGrams)?.price_paise ?? 0;
    return { id, item: byId.get(id)!, line, addonPaise: addon, unitPaise: (byId.get(id)?.price_paise || 0) + addon };
  });
  const subtotal = lineList.reduce((s, l) => s + l.unitPaise * l.line.quantity, 0);

  const eligibleTiers = customer?.eligible_tiers || [];
  const redeemLine = useMemo(() => {
    const eligible = lineList.filter((l) => l.item && eligibleTiers.includes(l.item.tier || ''));
    eligible.sort((a, b) => b.unitPaise - a.unitPaise);
    return eligible[0] || null;
  }, [lineList, eligibleTiers]);

  const canRedeem = !!customer?.can_redeem && !!redeemLine;
  const redemptionDiscount = redeem && canRedeem ? redeemLine!.unitPaise : 0;
  const discount = redemptionDiscount + manualDiscount;
  const totals = orderTotals(subtotal, discount);

  // Undocumented manual-discount override: keyboard only, no visible button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        setManualOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function complete() {
    if (lineList.length === 0) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.createOrder({
        items: lineList.map((l) => ({
          menu_item_id: l.item.id,
          quantity: l.line.quantity,
          protein_brand_id: l.line.proteinBrandId,
          protein_grams: l.line.proteinGrams,
        })),
        payment_method: payment,
        phone: identity.phone || undefined,
        username: identity.username || undefined,
        redeem: redemptionDiscount > 0 ? { menu_item_id: redeemLine!.item.id } : undefined,
      });
      onComplete(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="w-[380px] shrink-0 h-full flex flex-col bg-ink border-l-2 border-cream/15">
      <div className="px-4 py-3 border-b border-cream/10 flex items-baseline justify-between">
        <span className="font-display text-xl text-cream">
          {customer ? customer.first_name || 'Member' : 'Walk-in'}
          {customer?.username && (
            <span className="font-mono text-sm text-cream/50 ml-2">@{customer.username}</span>
          )}
        </span>
        {customer && <span className="font-mono text-sm text-cream/60">{customer.points_balance} pts</span>}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <h2 className="font-body uppercase tracking-widest text-xs text-cream/50 mb-3">Ticket</h2>
        {lineList.length === 0 && <p className="text-cream/40 font-body text-sm">No items yet.</p>}
        <ul className="flex flex-col gap-3">
          {lineList.map(({ id, item, line, unitPaise }) => (
            <li key={id} className="animate-land">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-display text-xl text-cream truncate">{item.name}</div>
                  <div className="font-mono text-xs text-cream/60">{rupees(unitPaise)}</div>
                </div>
                <div className="flex items-center gap-1 font-mono">
                  <button onClick={() => onDec(id)} className="w-7 h-7 border border-cream/30 text-cream">−</button>
                  <span className="w-6 text-center text-cream">{line.quantity}</span>
                  <button onClick={() => onAdd(id)} className="w-7 h-7 border border-cream/30 text-cream">+</button>
                </div>
                <div className="w-20 text-right font-mono text-cream">{rupees(unitPaise * line.quantity)}</div>
                <button onClick={() => onRemove(id)} className="text-red text-lg px-1" aria-label="remove">×</button>
              </div>
              <ProteinPicker
                brands={proteinBrands}
                options={proteinOptions}
                brandName={brandsById.get(line.proteinBrandId)?.name || line.proteinBrandId}
                selectedBrandId={line.proteinBrandId}
                selectedGrams={line.proteinGrams}
                onChange={(brandId, grams) => onSetProtein(id, brandId, grams)}
              />
            </li>
          ))}
        </ul>
      </div>

      <div className="p-4 border-t-2 border-cream/15 flex flex-col gap-3">
        {canRedeem && (
          <label className="flex items-center gap-2 font-body text-sm text-cream cursor-pointer">
            <input type="checkbox" checked={redeem} onChange={(e) => setRedeem(e.target.checked)} />
            Redeem {customer!.redeem_threshold} pts — free {redeemLine!.item.name}
          </label>
        )}

        {manualOpen && (
          <input
            inputMode="numeric"
            placeholder="Manual discount (paise)"
            onChange={(e) => setManualDiscount(Math.max(0, parseInt(e.target.value || '0', 10) || 0))}
            className="w-full bg-transparent border border-cream/20 px-2 py-1 font-mono text-cream/70 text-sm outline-none"
          />
        )}

        <div className="font-mono text-sm text-cream/80 flex flex-col gap-1">
          <Row label="Subtotal" value={rupees(totals.subtotal_paise)} />
          {totals.discount_paise > 0 && <Row label="Discount" value={`-${rupees(totals.discount_paise)}`} />}
          <Row label="Taxable" value={rupees(totals.taxable_paise)} />
          <Row label="CGST 2.5%" value={rupees(totals.cgst_paise)} />
          <Row label="SGST 2.5%" value={rupees(totals.sgst_paise)} />
        </div>
        <div className="flex justify-between items-baseline border-t-2 border-cream/15 pt-2">
          <span className="font-display text-2xl text-cream">TOTAL</span>
          <span className="font-display text-4xl text-red">{rupees(totals.total_paise)}</span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {(['cash', 'upi', 'card'] as Payment[]).map((m) => (
            <button
              key={m}
              onClick={() => setPayment(m)}
              className={`py-2 font-body uppercase text-sm border-2 ${payment === m ? 'border-red bg-red text-cream' : 'border-cream/25 text-cream/70'}`}
            >
              {m}
            </button>
          ))}
        </div>

        {error && <p className="font-body text-sm text-red">{error}</p>}

        <button
          onClick={complete}
          disabled={busy || lineList.length === 0}
          className="w-full py-4 bg-red text-cream font-display text-2xl tracking-wide disabled:opacity-40"
        >
          {busy ? 'SAVING…' : 'COMPLETE ORDER'}
        </button>
      </div>
    </aside>
  );
}

// Compact brand + grams picker under each ticket line. Collapsed by default
// (shows the current choice as one line — usually the default, no interaction
// needed); tap to expand and change it.
function ProteinPicker({
  brands,
  options,
  brandName,
  selectedBrandId,
  selectedGrams,
  onChange,
}: {
  brands: ProteinBrand[];
  options: ProteinAmountOption[];
  brandName: string;
  selectedBrandId: string;
  selectedGrams: number;
  onChange: (brandId: string, grams: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const grouped = useMemo(() => {
    const g: Record<string, ProteinBrand[]> = {};
    for (const b of brands) (g[b.protein_type] ||= []).push(b);
    return g;
  }, [brands]);

  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="font-mono text-xs text-cream/50 hover:text-cream/80"
      >
        {brandName} · {selectedGrams}g protein {open ? '▴' : '▾'}
      </button>
      {open && (
        <div className="mt-1.5 border border-cream/15 p-2 flex flex-col gap-2">
          {Object.entries(grouped).map(([type, list]) => (
            <div key={type}>
              <div className="font-body text-[10px] uppercase tracking-widest text-cream/40 mb-1">
                {TYPE_LABEL[type] || type}
              </div>
              <div className="flex flex-wrap gap-1">
                {list.map((b) => (
                  <button
                    key={b.id}
                    disabled={!b.in_stock}
                    onClick={() => onChange(b.id, selectedGrams)}
                    className={`px-2 py-1 font-mono text-xs border ${
                      selectedBrandId === b.id ? 'border-red text-cream' : 'border-cream/20 text-cream/60'
                    } ${!b.in_stock ? 'opacity-30 cursor-not-allowed' : ''}`}
                  >
                    {b.name}
                    {!b.in_stock && ' (out)'}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div>
            <div className="font-body text-[10px] uppercase tracking-widest text-cream/40 mb-1">Amount</div>
            <div className="flex gap-1">
              {options.map((o) => (
                <button
                  key={o.grams}
                  onClick={() => onChange(selectedBrandId, o.grams)}
                  className={`px-2 py-1 font-mono text-xs border ${
                    selectedGrams === o.grams ? 'border-red text-cream' : 'border-cream/20 text-cream/60'
                  }`}
                >
                  {o.grams}g{o.price_paise > 0 ? ` +${rupees(o.price_paise)}` : ''}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-cream/50">{label}</span>
      <span>{value}</span>
    </div>
  );
}
