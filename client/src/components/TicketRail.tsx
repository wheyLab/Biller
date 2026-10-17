import { useEffect, useMemo, useState } from 'react';
import type {
  StoryCredit,
  MenuItem,
  CustomerLookup,
  CustomerIdentity,
  OrderResult,
  ProteinBrand,
  ProteinAmountOption,
  ProteinBrandPrice,
  AddonOption,
  MilkOption,
  ProteinMode,
} from '../api';
import { api, rupees } from '../api';
import type { TicketLine } from '../store/ticket';
import { orderTotals } from '../money';
import { pickUpiQr } from '../upi';
import { UpiQrModal } from './UpiQrModal';
import { CREATINE_EXCLUDED_TIER, CREATINE_ADDON_ID, NO_MILK_TIER, ADDON_NOTES } from '../proteinRules';
import { CHALLENGES, GAME_RULES, computeReward, computeOffers } from '../game';
import { SpinWheelModal, type WonSpin } from './SpinWheelModal';

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
  brandPrices,
  addonOptions,
  milkOptions,
  modeByTier,
  onAdd,
  onDec,
  onRemove,
  onSetProtein,
  onToggleAddon,
  onSetMilk,
  onComplete,
  stage,
  className = '',
  onCheckout,
  onClear,
}: {
  items: MenuItem[];
  lines: Record<string, TicketLine>;
  identity: CustomerIdentity;
  customer: CustomerLookup | null;
  proteinBrands: ProteinBrand[];
  proteinOptions: ProteinAmountOption[];
  brandPrices: ProteinBrandPrice[];
  addonOptions: AddonOption[];
  milkOptions: MilkOption[];
  modeByTier: Record<string, ProteinMode>;
  onAdd: (id: string) => void;
  onDec: (id: string) => void;
  onRemove: (id: string) => void;
  onSetProtein: (id: string, brandId: string, grams: number) => void;
  onToggleAddon: (id: string, addonId: string) => void;
  onSetMilk: (id: string, milkId: string) => void;
  onComplete: (r: OrderResult) => void;
  // 'cart': the slide-in cart on the menu (items + totals, then Checkout).
  // 'pay': the final step once the customer is chosen (redeem, payment, complete).
  stage: 'cart' | 'pay';
  className?: string;
  onCheckout?: () => void;
  onClear?: () => void;
}) {
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const brandsById = useMemo(() => new Map(proteinBrands.map((b) => [b.id, b])), [proteinBrands]);
  const optionsByGrams = useMemo(() => new Map(proteinOptions.map((o) => [o.grams, o])), [proteinOptions]);
  const brandPriceMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const bp of brandPrices) m.set(`${bp.brand_id}:${bp.grams}`, bp.price_paise);
    return m;
  }, [brandPrices]);
  const addonsById = useMemo(() => new Map(addonOptions.map((a) => [a.id, a])), [addonOptions]);
  const milkById = useMemo(() => new Map(milkOptions.map((m) => [m.id, m])), [milkOptions]);
  const [payment, setPayment] = useState<Payment>('cash');
  // Which QR code this order shows; chosen at random on first use, then kept.
  const [upiQr, setUpiQr] = useState<ReturnType<typeof pickUpiQr> | null>(null);
  const [upiOpen, setUpiOpen] = useState(false);
  const [redeem, setRedeem] = useState(false);
  const [tenPercentOff, setTenPercentOff] = useState(false);
  const [manualDiscount, setManualDiscount] = useState(0);
  const [manualOpen, setManualOpen] = useState(false);
  const [wheelOpen, setWheelOpen] = useState(false);
  const [wonSpin, setWonSpin] = useState<WonSpin | null>(null);
  // Pushup challenge (null = off) and story challenge (confirmed today → banks
  // 10% off their next visit; a reward banked on an earlier day is used now).
  const [pushups, setPushups] = useState<string | null>(null);
  const [storyTag, setStoryTag] = useState(false);
  const [storyCredit, setStoryCredit] = useState<StoryCredit | null>(null);
  const [useStoryCredit, setUseStoryCredit] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const lineList = Object.entries(lines).map(([id, line]) => {
    const item = byId.get(id)!;
    const mode: ProteinMode = (item && modeByTier[item.tier || '']) || 'none';
    const proteinAddonPaise =
      mode === 'brand'
        ? brandPriceMap.get(`${line.proteinBrandId}:${line.proteinGrams}`) ?? 0
        : mode === 'amount'
        ? optionsByGrams.get(line.proteinGrams)?.signature_addon_price_paise ?? 0
        : 0;
    const addons = line.addonIds.map((a) => addonsById.get(a)).filter((a): a is AddonOption => !!a);
    const addonsPaise = addons.reduce((s, a) => s + a.price_paise, 0);
    const showMilk = item?.tier !== NO_MILK_TIER;
    const milk = showMilk ? milkById.get(line.milkId) ?? null : null;
    const milkPaise = milk?.price_paise ?? 0;
    return {
      id,
      item,
      line,
      mode,
      proteinAddonPaise,
      addons,
      showMilk,
      milk,
      unitPaise: (item?.price_paise || 0) + proteinAddonPaise + addonsPaise + milkPaise,
    };
  });
  const itemCount = lineList.reduce((n, l) => n + l.line.quantity, 0);
  const subtotal = lineList.reduce((s, l) => s + l.unitPaise * l.line.quantity, 0);

  const eligibleTiers = customer?.eligible_tiers || [];
  const redeemLine = useMemo(() => {
    const eligible = lineList.filter((l) => l.item && eligibleTiers.includes(l.item.tier || ''));
    eligible.sort((a, b) => b.unitPaise - a.unitPaise);
    return eligible[0] || null;
  }, [lineList, eligibleTiers]);

  const canRedeem = !!customer?.can_redeem && !!redeemLine;
  const redemptionDiscount = redeem && canRedeem ? redeemLine!.unitPaise : 0;
  const tenPercentDiscount = tenPercentOff ? Math.round(subtotal * 0.1) : 0;
  const gameLines = lineList.map((l) => ({
    tier: l.item?.tier ?? null,
    unitPaise: l.unitPaise,
    quantity: l.line.quantity,
    addonPricesPaise: l.addons.map((a) => a.price_paise),
  }));
  const gameReward = wonSpin ? computeReward(wonSpin.challengeKey, gameLines) : null;
  const gameDiscount = gameReward && !gameReward.error ? gameReward.discountPaise : 0;
  const offers = computeOffers({ pushups: pushups == null ? undefined : Number(pushups) }, gameLines);
  const offersDiscount = offers.error ? 0 : offers.discountPaise;
  const storyRewardOn = !!storyCredit?.usable_today && useStoryCredit;
  const storyDiscount = storyRewardOn ? Math.round((subtotal * GAME_RULES.storyNextVisitPercent) / 100) : 0;
  // A reward earned today and not yet used means nothing new can be banked.
  const storyWaiting = !!storyCredit?.pending && !storyCredit.usable_today;
  const discount = redemptionDiscount + tenPercentDiscount + manualDiscount + gameDiscount + offersDiscount + storyDiscount;
  const identified = !!(identity.phone || identity.username);
  const hasTier = (tier: string) => lineList.some((l) => l.item?.tier === tier);

  // Every discount on its own line, so staff and customer see exactly where the
  // final amount comes from. 0-value rewards (extra protein, banked story) are
  // listed too, with a word instead of an amount.
  const breakdown: { label: string; paise: number; text?: string }[] = [];
  if (redemptionDiscount > 0) breakdown.push({ label: `Points: free ${redeemLine!.item.name}`, paise: redemptionDiscount });
  if (tenPercentDiscount > 0) breakdown.push({ label: '10% off', paise: tenPercentDiscount });
  if (manualDiscount > 0) breakdown.push({ label: 'Discount', paise: manualDiscount });
  if (gameReward && !gameReward.error) {
    breakdown.push({ label: gameReward.note, paise: gameReward.discountPaise, text: gameReward.discountPaise ? undefined : 'FREE' });
  }
  if (offersDiscount > 0) breakdown.push({ label: offers.notes.join(', '), paise: offersDiscount });
  if (storyDiscount > 0) breakdown.push({ label: `Story reward ${GAME_RULES.storyNextVisitPercent}% off`, paise: storyDiscount });
  if (storyTag && !storyWaiting) {
    breakdown.push({ label: `Story: ${GAME_RULES.storyNextVisitPercent}% off next visit`, paise: 0, text: 'BANKED' });
  }

  useEffect(() => {
    if (stage !== 'pay' || !identified) return;
    let alive = true;
    api
      .storyCredit(identity)
      .then((c) => alive && setStoryCredit(c))
      .catch(() => alive && setStoryCredit(null));
    return () => {
      alive = false;
    };
  }, [stage, identified, identity.phone, identity.username]);
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
          addon_ids: l.line.addonIds,
          milk_id: l.showMilk ? l.line.milkId : undefined,
        })),
        payment_method: payment,
        phone: identity.phone || undefined,
        username: identity.username || undefined,
        redeem: redemptionDiscount > 0 ? { menu_item_id: redeemLine!.item.id } : undefined,
        ten_percent_off: tenPercentOff || undefined,
        manual_discount_paise: manualDiscount > 0 ? manualDiscount : undefined,
        game: wonSpin ? { spin_id: wonSpin.spinId } : undefined,
        offers: pushups != null ? { pushups: Number(pushups) } : undefined,
        story_tag: storyTag || undefined,
        use_story_credit: storyRewardOn || undefined,
      });
      onComplete(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className={`h-full flex flex-col bg-ink ${className}`}>
      <div className="px-4 py-3 border-b border-cream/10 flex items-baseline justify-between">
        {stage === 'cart' ? (
          <>
            <span className="font-display text-xl text-cream">Your order</span>
            <span className="font-mono text-sm text-cream/60">
              {itemCount} {itemCount === 1 ? 'item' : 'items'}
            </span>
          </>
        ) : (
          <>
            <span className="font-display text-xl text-cream">
              {customer ? customer.first_name || 'Member' : 'Walk-in'}
              {customer?.username && (
                <span className="font-mono text-sm text-cream/50 ml-2">@{customer.username}</span>
              )}
            </span>
            {customer && <span className="font-mono text-sm text-cream/60">{customer.points_balance} pts</span>}
          </>
        )}
      </div>

      <div className="no-scrollbar flex-1 overflow-y-auto p-4">
        <h2 className="font-body uppercase tracking-widest text-xs text-cream/50 mb-3">Ticket</h2>
        {lineList.length === 0 && <p className="text-cream/40 font-body text-sm">No items yet.</p>}
        <ul className="flex flex-col gap-3">
          {lineList.map(({ id, item, line, mode, showMilk, unitPaise }) => (
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
              <LineCustomizer
                tier={item.tier}
                mode={mode}
                brands={proteinBrands}
                options={proteinOptions}
                brandPriceMap={brandPriceMap}
                addonOptions={addonOptions}
                milkOptions={milkOptions}
                showMilk={showMilk}
                brandName={brandsById.get(line.proteinBrandId)?.name || line.proteinBrandId}
                selectedBrandId={line.proteinBrandId}
                selectedGrams={line.proteinGrams}
                selectedAddonIds={line.addonIds}
                selectedMilkId={line.milkId}
                onChangeProtein={(brandId, grams) => onSetProtein(id, brandId, grams)}
                onToggleAddon={(addonId) => onToggleAddon(id, addonId)}
                onSetMilk={(milkId) => onSetMilk(id, milkId)}
              />
            </li>
          ))}
        </ul>

        {stage === 'pay' && lineList.length > 0 && (
          <div className="mt-5 flex flex-col gap-3">
            <h2 className="font-body uppercase tracking-widest text-xs text-cream/50">Offers</h2>
        {stage === 'pay' && canRedeem && (
            <label className="flex items-center gap-2 font-body text-sm text-cream cursor-pointer">
              <input type="checkbox" checked={redeem} onChange={(e) => setRedeem(e.target.checked)} />
              Redeem {customer!.redeem_threshold} pts — free {redeemLine!.item.name}
            </label>
          )}
  
          {stage === 'pay' && lineList.length > 0 && (
            <label className="flex items-center gap-2 font-body text-sm text-cream cursor-pointer">
              <input type="checkbox" checked={tenPercentOff} onChange={(e) => setTenPercentOff(e.target.checked)} />
              10% off
            </label>
          )}
  
          {stage === 'pay' && lineList.length > 0 && (
            <div className="flex flex-col gap-2">
              {/* 1. Flyer customers spin the wheel. */}
              <OfferBlock title="Flyer — spin the wheel">
                {!identified ? (
                  <p className="font-body text-xs text-cream/50">Add the customer’s number to spin.</p>
                ) : wonSpin ? (
                  <div className={`font-body text-sm ${gameReward?.error ? 'text-cream/70' : 'text-cream'}`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-display text-lg tracking-wide">
                        {CHALLENGES.find((c) => c.key === wonSpin.challengeKey)?.title}
                      </span>
                      <button onClick={() => setWonSpin(null)} className="text-xs text-cream/40 underline underline-offset-4">
                        remove
                      </button>
                    </div>
                    <div>{gameReward?.error ?? gameReward?.note}</div>
                    {wonSpin.challengeKey === 'originals555' && !hasTier('Originals') && (
                      <QuickAdd items={items} tier="Originals" onAdd={onAdd} />
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => setWheelOpen(true)}
                    className="w-full border-2 border-dashed border-red py-2 font-display text-xl tracking-wide text-red"
                  >
                    SPIN THE WHEEL
                  </button>
                )}
              </OfferBlock>
  
              {/* 2. Pushups: ₹1 off per pushup on a Signature shake. */}
              <OfferBlock title="Pushup challenge">
                <label className="flex items-center gap-2 font-body text-sm text-cream cursor-pointer">
                  <input type="checkbox" checked={pushups != null} onChange={(e) => setPushups(e.target.checked ? '' : null)} />
                  ₹1 off per pushup on a Signature (max ₹{GAME_RULES.pushupMaxDiscountPaise / 100})
                </label>
                {pushups != null && (
                  <input
                    inputMode="numeric"
                    autoFocus
                    value={pushups}
                    onChange={(e) => setPushups(e.target.value.replace(/\D/g, '').slice(0, 3))}
                    placeholder="Pushups done"
                    className="mt-1 w-full bg-transparent border-2 border-cream/25 px-2 py-1 font-display text-2xl text-cream outline-none focus:border-red"
                  />
                )}
                {offers.error && <p className="mt-1 font-body text-sm text-cream/70">{offers.error}</p>}
                {pushups != null && !hasTier('Signature') && (
                  <QuickAdd items={items} tier="Signature" onAdd={onAdd} />
                )}
              </OfferBlock>
  
              {/* 3. Story: confirmed today → 10% off their next visit (a later day). */}
              <OfferBlock title="Story challenge">
                {!identified ? (
                  <p className="font-body text-xs text-cream/50">Add the customer’s number to bank a story reward.</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {storyCredit?.usable_today && (
                      <label className="flex items-center gap-2 font-body text-sm text-cream cursor-pointer">
                        <input type="checkbox" checked={useStoryCredit} onChange={(e) => setUseStoryCredit(e.target.checked)} />
                        Use story reward — {GAME_RULES.storyNextVisitPercent}% off today
                      </label>
                    )}
                    {storyWaiting ? (
                      <p className="font-body text-xs text-cream/50">
                        {GAME_RULES.storyNextVisitPercent}% off already waiting for their next visit.
                      </p>
                    ) : (
                      <label className="flex items-center gap-2 font-body text-sm text-cream cursor-pointer">
                        <input type="checkbox" checked={storyTag} onChange={(e) => setStoryTag(e.target.checked)} />
                        Story posted tagging @wheylab.in — checked
                      </label>
                    )}
                    {!storyWaiting && (
                      <p className="font-body text-xs text-cream/50">
                        Gives {GAME_RULES.storyNextVisitPercent}% off their next visit (not today).
                      </p>
                    )}
                  </div>
                )}
              </OfferBlock>
            </div>
          )}
  
          {stage === 'pay' && manualOpen && (
            <input
              inputMode="numeric"
              placeholder="Manual discount (paise)"
              onChange={(e) => setManualDiscount(Math.max(0, parseInt(e.target.value || '0', 10) || 0))}
              className="w-full bg-transparent border border-cream/20 px-2 py-1 font-mono text-cream/70 text-sm outline-none"
            />
          )}
          </div>
        )}
      </div>

      <div className="p-4 border-t-2 border-cream/15 flex flex-col gap-3">
        <div className="font-mono text-sm text-cream/80 flex flex-col gap-1">
          <Row label="Subtotal" value={rupees(totals.subtotal_paise)} />
          {breakdown.map((d) => (
            <div key={d.label} className="flex justify-between gap-3 text-red">
              <span className="truncate">{d.label}</span>
              <span className="shrink-0">{d.text ?? `-${rupees(d.paise)}`}</span>
            </div>
          ))}
          {totals.discount_paise > 0 && breakdown.filter((d) => d.paise > 0).length > 1 && (
            <Row label="Total savings" value={`-${rupees(totals.discount_paise)}`} />
          )}
          <Row label="Taxable" value={rupees(totals.taxable_paise)} />
          <Row label="CGST 2.5%" value={rupees(totals.cgst_paise)} />
          <Row label="SGST 2.5%" value={rupees(totals.sgst_paise)} />
        </div>
        <div className="flex justify-between items-baseline border-t-2 border-cream/15 pt-2">
          <span className="font-display text-2xl text-cream">{stage === 'pay' ? 'TO PAY' : 'TOTAL'}</span>
          <span className="font-display text-4xl text-red">{rupees(totals.total_paise)}</span>
        </div>

        {stage === 'cart' && (
          <>
            <button
              onClick={onCheckout}
              disabled={lineList.length === 0}
              className="w-full py-4 bg-red text-cream font-display text-2xl tracking-wide disabled:opacity-40"
            >
              CHECKOUT
            </button>
            <button onClick={onClear} className="font-body text-xs text-cream/40 underline underline-offset-4">
              Clear order
            </button>
          </>
        )}

        {stage === 'pay' && (<div className="grid grid-cols-3 gap-2">
          {(['cash', 'upi', 'card'] as Payment[]).map((m) => (
            <button
              key={m}
              onClick={() => {
                setPayment(m);
                if (m === 'upi' && lineList.length > 0) {
                  setUpiQr((q) => q ?? pickUpiQr());
                  setUpiOpen(true);
                }
              }}
              className={`py-2 font-body uppercase text-sm border-2 ${payment === m ? 'border-red bg-red text-cream' : 'border-cream/25 text-cream/70'}`}
            >
              {m}
            </button>
          ))}
        </div>)}

        {stage === 'pay' && error && <p className="font-body text-sm text-red">{error}</p>}

        {stage === 'pay' && (
          <button
            onClick={complete}
            disabled={busy || lineList.length === 0 || !!gameReward?.error || !!offers.error}
            className="w-full py-4 bg-red text-cream font-display text-2xl tracking-wide disabled:opacity-40"
          >
            {busy ? 'SAVING…' : 'COMPLETE ORDER'}
          </button>
        )}
      </div>
      {wheelOpen && (
        <SpinWheelModal
          identity={identity}
          onClose={() => setWheelOpen(false)}
          onWon={(spin) => {
            setWonSpin(spin);
            setWheelOpen(false);
          }}
        />
      )}
      {upiOpen && upiQr && (
        <UpiQrModal src={upiQr.src} amount={rupees(totals.total_paise)} onClose={() => setUpiOpen(false)} />
      )}
    </aside>
  );
}

// One collapsible panel per ticket line covering everything that can be
// customised for it: brand+grams (Originals/Lab Blend), grams-only
// (Signature), add-ons (everywhere, creatine excluded on Bulk), and milk
// (everywhere except Clear Protein). Collapsed by default, showing the
// current choice as one summary line; tap to expand and change it.
function LineCustomizer({
  tier,
  mode,
  brands,
  options,
  brandPriceMap,
  addonOptions,
  milkOptions,
  showMilk,
  brandName,
  selectedBrandId,
  selectedGrams,
  selectedAddonIds,
  selectedMilkId,
  onChangeProtein,
  onToggleAddon,
  onSetMilk,
}: {
  tier: string | null;
  mode: ProteinMode;
  brands: ProteinBrand[];
  options: ProteinAmountOption[];
  brandPriceMap: Map<string, number>;
  addonOptions: AddonOption[];
  milkOptions: MilkOption[];
  showMilk: boolean;
  brandName: string;
  selectedBrandId: string;
  selectedGrams: number;
  selectedAddonIds: string[];
  selectedMilkId: string;
  onChangeProtein: (brandId: string, grams: number) => void;
  onToggleAddon: (addonId: string) => void;
  onSetMilk: (milkId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const grouped = useMemo(() => {
    const g: Record<string, ProteinBrand[]> = {};
    for (const b of brands) (g[b.protein_type] ||= []).push(b);
    return g;
  }, [brands]);

  const addonNames = addonOptions.filter((a) => selectedAddonIds.includes(a.id)).map((a) => a.name);
  const milk = showMilk ? milkOptions.find((m) => m.id === selectedMilkId) : null;

  const summaryParts: string[] = [];
  if (mode === 'brand') summaryParts.push(`${brandName} ${selectedGrams}g`);
  else if (mode === 'amount') summaryParts.push(`${selectedGrams}g protein`);
  if (addonNames.length) summaryParts.push(addonNames.join(', '));
  if (milk && milk.price_paise > 0) summaryParts.push(milk.name);
  const summary = summaryParts.length ? summaryParts.join(' · ') : 'Customize';

  const nothingToCustomize = mode === 'none' && addonOptions.length === 0 && !showMilk;
  if (nothingToCustomize) return null;

  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="font-mono text-xs text-cream/50 hover:text-cream/80"
      >
        {summary} {open ? '▴' : '▾'}
      </button>
      {open && (
        <div className="mt-1.5 border border-cream/15 p-2 flex flex-col gap-2">
          {mode === 'brand' && (
            <>
              {Object.entries(grouped).map(([type, list]) => (
                <div key={type}>
                  <div className="font-body text-[10px] uppercase tracking-widest text-cream/40 mb-1">
                    {TYPE_LABEL[type] || type}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {list.map((b) => {
                      const price = brandPriceMap.get(`${b.id}:${selectedGrams}`) ?? 0;
                      return (
                        <button
                          key={b.id}
                          disabled={!b.in_stock}
                          onClick={() => onChangeProtein(b.id, selectedGrams)}
                          className={`px-2 py-1 font-mono text-xs border ${
                            selectedBrandId === b.id ? 'border-red text-cream' : 'border-cream/20 text-cream/60'
                          } ${!b.in_stock ? 'opacity-30 cursor-not-allowed' : ''}`}
                        >
                          {b.name}
                          {price > 0 ? ` +${rupees(price)}` : ''}
                          {!b.in_stock && ' (out)'}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              <div>
                <div className="font-body text-[10px] uppercase tracking-widest text-cream/40 mb-1">Amount</div>
                <div className="flex gap-1">
                  {options.map((o) => (
                    <button
                      key={o.grams}
                      onClick={() => onChangeProtein(selectedBrandId, o.grams)}
                      className={`px-2 py-1 font-mono text-xs border ${
                        selectedGrams === o.grams ? 'border-red text-cream' : 'border-cream/20 text-cream/60'
                      }`}
                    >
                      {o.grams}g
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {mode === 'amount' && (
            <div>
              <div className="font-body text-[10px] uppercase tracking-widest text-cream/40 mb-1">Amount</div>
              <div className="flex gap-1">
                {options.map((o) => (
                  <button
                    key={o.grams}
                    onClick={() => onChangeProtein(selectedBrandId, o.grams)}
                    className={`px-2 py-1 font-mono text-xs border ${
                      selectedGrams === o.grams ? 'border-red text-cream' : 'border-cream/20 text-cream/60'
                    }`}
                  >
                    {o.grams}g{o.signature_addon_price_paise > 0 ? ` +${rupees(o.signature_addon_price_paise)}` : ''}
                  </button>
                ))}
              </div>
            </div>
          )}

          {addonOptions.length > 0 && (
            <div>
              <div className="font-body text-[10px] uppercase tracking-widest text-cream/40 mb-1">Add-ons</div>
              <div className="flex flex-wrap gap-1">
                {addonOptions.map((a) => {
                  const excluded = a.id === CREATINE_ADDON_ID && tier === CREATINE_EXCLUDED_TIER;
                  if (excluded) return null;
                  const selected = selectedAddonIds.includes(a.id);
                  return (
                    <button
                      key={a.id}
                      title={ADDON_NOTES[a.id]}
                      onClick={() => onToggleAddon(a.id)}
                      className={`px-2 py-1 font-mono text-xs border ${
                        selected ? 'border-red text-cream' : 'border-cream/20 text-cream/60'
                      }`}
                    >
                      {a.name} +{rupees(a.price_paise)}
                    </button>
                  );
                })}
              </div>
              {addonOptions.some((a) => ADDON_NOTES[a.id]) && (
                <div className="font-body text-[10px] text-cream/30 mt-1">
                  {addonOptions
                    .filter((a) => ADDON_NOTES[a.id])
                    .map((a) => `${a.name}: ${ADDON_NOTES[a.id]}`)
                    .join(' · ')}
                </div>
              )}
            </div>
          )}

          {showMilk && milkOptions.length > 0 && (
            <div>
              <div className="font-body text-[10px] uppercase tracking-widest text-cream/40 mb-1">Milk</div>
              <div className="flex flex-wrap gap-1">
                {milkOptions.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => onSetMilk(m.id)}
                    className={`px-2 py-1 font-mono text-xs border ${
                      selectedMilkId === m.id ? 'border-red text-cream' : 'border-cream/20 text-cream/60'
                    }`}
                  >
                    {m.name}
                    {m.price_paise > 0 ? ` +${rupees(m.price_paise)}` : ''}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// One-tap add for an offer that needs a drink of a certain tier, so staff never
// have to leave the pay screen to go back to the menu.
function QuickAdd({ items, tier, onAdd }: { items: MenuItem[]; tier: string; onAdd: (id: string) => void }) {
  const options = items.filter((i) => i.tier === tier && i.is_available && i.price_paise != null);
  if (!options.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {options.map((i) => (
        <button key={i.id} onClick={() => onAdd(i.id)} className="border-2 border-red px-2 py-1 font-body text-xs text-cream">
          + {i.name} {rupees(i.price_paise!)}
        </button>
      ))}
    </div>
  );
}

function OfferBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-cream/15 px-3 py-2">
      <div className="mb-1 font-body text-[10px] uppercase tracking-widest text-cream/50">{title}</div>
      {children}
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
