import { useEffect } from 'react';

// Shown when UPI is chosen: the shop's QR code, large, with the amount due.
// It's the code only (no payee name); the customer's UPI app shows who they're paying.
export function UpiQrModal({ src, amount, onClose }: { src: string; amount: string; onClose: () => void }) {
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
        <div className="bg-white p-5">
          <img src={src} alt="UPI QR code" draggable={false} className="block h-[min(48vh,420px)] w-[min(48vh,420px)]" />
        </div>
        <p className="font-body text-sm text-cream/60">Scan with any UPI app</p>
        <button onClick={onClose} className="w-full bg-red py-3 font-display text-xl tracking-wide text-cream">
          CLOSE
        </button>
      </div>
    </div>
  );
}
