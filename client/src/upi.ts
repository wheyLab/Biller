// The shop's Paytm merchant UPI ID. Every QR is generated fresh per order
// with the exact amount baked in (no static, reusable image) — see
// UpiQrModal, which turns the link this builds into an actual QR code.
const MERCHANT_VPA = 'paytm.s2wyeti@pty';
const MERCHANT_NAME = 'Whey Lab';

// paise -> the plain "123.45" string UPI's `am` param expects (never a
// rounded float — paise is already an exact integer, this is just formatting).
const amountString = (paise: number) => (paise / 100).toFixed(2);

// A short, order-agnostic reference so the bank statement/UPI app timeline
// can be tied back to roughly when the QR was shown, since payment happens
// before the order itself is saved (no order_number to use yet).
const transactionRef = () => `WL${Date.now().toString(36).toUpperCase()}`;

// Standard UPI deep-link payload (the same thing a "Pay" button or a
// merchant's dynamic QR encodes) — any UPI app opens this with the amount
// pre-filled and only the PIN step left, no manual typing.
export function buildUpiLink(totalPaise: number): string {
  const params = new URLSearchParams({
    pa: MERCHANT_VPA,
    pn: MERCHANT_NAME,
    am: amountString(totalPaise),
    cu: 'INR',
    tr: transactionRef(),
  });
  return `upi://pay?${params.toString()}`;
}
