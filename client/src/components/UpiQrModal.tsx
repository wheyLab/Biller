import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

// Shown when UPI is chosen: a QR generated fresh for this exact order total
// (via `link`, a upi://pay deep link — see upi.ts) so the customer's UPI app
// opens with the amount already filled in, nothing to type or get wrong.
export function UpiQrModal({ link, amount, onClose }: { link: string; amount: string; onClose: () => void }) {
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  // Regenerates whenever `link` changes, so if the total moves (a discount
  // toggled, a redemption applied) while this is open, the code shown always
  // matches what's about to be charged — never a stale amount.
  useEffect(() => {
    let cancelled = false;
    setError(false);
    QRCode.toDataURL(link, { margin: 1, width: 480 })
      .then((url) => !cancelled && setQrSrc(url))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [link]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/95 p-4" onClick={onClose}>
      <div
        className="flex max-h-full flex-col items-center gap-4 border-2 border-cream/20 bg-ink p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-3xl tracking-wide text-cream">SCAN TO PAY</h2>
        <div className="font-display text-5xl text-red">{amount}</div>
        <div className="flex h-[min(48vh,420px)] w-[min(48vh,420px)] items-center justify-center bg-white p-5">
          {qrSrc && <img src={qrSrc} alt="UPI QR code" draggable={false} className="block size-full" />}
          {error && <p className="px-4 text-center font-body text-sm text-ink/60">Couldn't generate the QR code.</p>}
        </div>
        <p className="font-body text-sm text-cream/60">Scan with any UPI app — the amount is already filled in</p>
        <button onClick={onClose} className="w-full bg-red py-3 font-display text-xl tracking-wide text-cream">
          CLOSE
        </button>
      </div>
    </div>
  );
}
