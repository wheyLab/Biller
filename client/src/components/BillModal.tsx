import { useEffect, useMemo, useRef, useState } from 'react';
import { api, rupees } from '../api';

// A perforated bottom edge, like tear-off thermal paper: a zigzag clip-path
// across the width, alternating between the full edge and a shallow notch.
function perforatedBottomClipPath(teeth = 18, notchPx = 6) {
  const points = ['0% 0%', '100% 0%', '100% 100%'];
  const steps = teeth * 2;
  for (let i = 0; i < steps; i++) {
    const x = 100 - ((i + 1) * 100) / steps;
    const y = i % 2 === 0 ? `calc(100% - ${notchPx}px)` : '100%';
    points.push(`${x}% ${y}`);
  }
  points.push('0% 100%');
  return `polygon(${points.join(', ')})`;
}

// A small illustrated printer body: rounded housing, vent ridges, a status
// LED, and a slot bezel the paper appears to emerge from. Pure SVG so it
// isn't flattened by the app-wide "no rounded corners" reset (which targets
// the CSS border-radius property, not SVG shape geometry).
function PrinterHousing({ printing }: { printing: boolean }) {
  return (
    <svg
      viewBox="0 0 400 88"
      preserveAspectRatio="none"
      className="w-full h-[88px] block"
      aria-hidden="true"
    >
      <rect x="0" y="0" width="400" height="88" rx="14" className="fill-ink" />
      <rect x="2" y="2" width="396" height="22" rx="10" className="fill-cream" opacity="0.05" />
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x={18 + i * 7} y="12" width="3" height="16" rx="1.5" className="fill-cream" opacity="0.15" />
      ))}
      <circle cx="376" cy="20" r="5" className={printing ? 'fill-red' : 'fill-cream'} opacity={printing ? 1 : 0.3}>
        {printing && (
          <animate attributeName="opacity" values="1;0.35;1" dur="1s" repeatCount="indefinite" />
        )}
      </circle>
      {/* slot bezel: recessed opening the paper feeds through */}
      <rect x="20" y="60" width="360" height="20" rx="8" className="fill-black" opacity="0.55" />
      <rect x="28" y="66" width="344" height="8" rx="4" className="fill-black" />
    </svg>
  );
}

// Must match the duration in the .animate-receipt-feed CSS rule (index.css).
const FEED_MS = 2200;

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

// Post-sale confirmation / digital bill. Shown to operator and customer on the
// mirrored screen. Plays a receipt-printer feed animation once the bill loads,
// then settles into a normal scrollable, auto-dismissable card.
export function BillModal({ orderId, onClose }: { orderId: number; onClose: () => void }) {
  const [bill, setBill] = useState<any>(null);
  const [phase, setPhase] = useState<'printing' | 'done'>('printing');
  const reducedMotion = usePrefersReducedMotion();
  const clipPath = useMemo(() => perforatedBottomClipPath(), []);

  useEffect(() => {
    api.bill(orderId).then(setBill).catch(() => setBill(null));
  }, [orderId]);

  // onClose is a fresh function every parent render (the parent re-renders every
  // second for its clock), so it's read via a ref rather than a dep — otherwise
  // this listener would tear down and re-attach every second.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Drive the phase change with a timer, not onAnimationEnd: browsers can
  // throttle/skip CSS animation events for a backgrounded or unfocused tab,
  // which would otherwise leave the receipt stuck "printing" forever with
  // overflow locked to hidden (undismissable scroll, wrong status label).
  useEffect(() => {
    if (!bill) return;
    if (reducedMotion) {
      setPhase('done');
      return;
    }
    const t = setTimeout(() => setPhase('done'), FEED_MS);
    return () => clearTimeout(t);
  }, [bill, reducedMotion]);

  return (
    <div className="fixed inset-0 bg-ink/90 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="w-[420px] max-w-full flex flex-col items-stretch" onClick={(e) => e.stopPropagation()}>
        {/* Printer housing */}
        <div className="relative bg-ink border-2 border-cream/20 border-b-0">
          <PrinterHousing printing={phase === 'printing'} />
          <div className="absolute inset-0 px-4 flex items-center justify-between">
            <span className="font-display text-lg text-red tracking-wide">
              {phase === 'printing' ? 'PRINTING…' : 'PAID'}
            </span>
          </div>
        </div>

        {/* Output slot: clips the paper until it feeds out from under the bezel */}
        <div
          className="relative -mt-5 border-x-2 border-b-2 border-cream/20 bg-ink"
          style={{ maxHeight: 'calc(100vh - 160px)', overflow: 'hidden', overflowY: phase === 'done' ? 'auto' : 'hidden' }}
        >
          {bill ? (
            <div
              key={orderId}
              className={reducedMotion ? '' : 'animate-receipt-feed'}
              style={{ clipPath, animationDuration: reducedMotion ? undefined : `${FEED_MS}ms` }}
            >
              <div className="bg-cream text-ink px-5 pt-2 pb-3 font-mono text-xs leading-snug">
                {/* Header: centered business identity, like a real till receipt */}
                <div className="text-center">
                  <div className="text-sm font-bold uppercase tracking-wide">{bill.business?.name}</div>
                  {bill.business?.gstin && <div className="mt-0.5">GSTIN {bill.business.gstin}</div>}
                  {bill.business?.address && <div>{bill.business.address}</div>}
                </div>

                <Dashes />
                <div className="text-center font-bold tracking-[0.3em]">RECEIPT</div>
                <Dashes />

                <Row l="Order #" v={String(bill.order_number)} />
                <Row l="Date" v={new Date(bill.created_at).toLocaleString()} />
                <Row l="Payment" v={bill.payment_method.toUpperCase()} />

                <Dashes />

                <div className="flex gap-2 font-bold uppercase">
                  <span className="flex-1">Item</span>
                  <span className="w-6 text-center">Qty</span>
                  <span className="w-20 text-right">Amount</span>
                </div>
                <div className="border-t border-ink/40 my-0.5" />
                <ul>
                  {bill.items.map((i: any, idx: number) => (
                    <li key={idx} className="flex gap-2">
                      <span className="flex-1">{i.name}</span>
                      <span className="w-6 text-center">{i.quantity}</span>
                      <span className="w-20 text-right">{rupees(i.line_total_paise)}</span>
                    </li>
                  ))}
                </ul>

                <Dashes />

                {bill.discount_paise > 0 && <Row l="Discount" v={`-${rupees(bill.discount_paise)}`} />}
                {(bill.reward_lines ?? []).map((r: { note: string; discount_paise: number }) => (
                  <div key={r.note} className="flex justify-between gap-2 font-bold">
                    <span>{r.note}</span>
                    <span className="shrink-0">{r.discount_paise > 0 ? `-${rupees(r.discount_paise)}` : ''}</span>
                  </div>
                ))}
                <Row l="Subtotal" v={rupees(bill.taxable_paise)} />
                <Row l="CGST 2.5%" v={rupees(bill.cgst_paise)} />
                <Row l="SGST 2.5%" v={rupees(bill.sgst_paise)} />

                <div className="border-t-2 border-ink/60 my-0.5" />
                <div className="flex justify-between items-baseline">
                  <span className="font-bold text-base">TOTAL</span>
                  <span className="font-bold text-base">{rupees(bill.total_paise)}</span>
                </div>
                {bill.points_earned > 0 && <Row l="Points earned" v={`+${bill.points_earned}`} />}

                <Dashes />
                <div className="text-center">
                  Thank you · See you again
                  <br />
                  <span className="text-ink/50">Powered by Whey Lab</span>
                </div>
              </div>
            </div>
          ) : (
            <p className="p-6 text-cream/60">Saved.</p>
          )}
        </div>

        <button onClick={onClose} className="mt-3 w-full py-3 bg-red text-cream font-display text-xl">
          NEW ORDER
        </button>
      </div>
    </div>
  );
}

function Row({ l, v }: { l: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-ink/60">{l}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}

// Dashed rule, like the perforated divider lines on a real till receipt.
function Dashes() {
  return <div className="border-t border-dashed border-ink/50 my-0.5" />;
}
