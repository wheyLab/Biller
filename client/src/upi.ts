// The shop's UPI QR codes (cropped to the code only, files in public/upi/).
// One is picked at random the first time UPI is chosen on an order and then
// kept for that order, so the customer never sees it switch mid-payment.
export const UPI_QRS = [
  { id: 'qr-1', src: '/upi/qr-1.png' },
  { id: 'qr-2', src: '/upi/qr-2.png' },
] as const;

export const pickUpiQr = () => UPI_QRS[Math.floor(Math.random() * UPI_QRS.length)];
