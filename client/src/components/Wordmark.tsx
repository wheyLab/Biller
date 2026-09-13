export function Wordmark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const cls = size === 'lg' ? 'text-6xl' : size === 'sm' ? 'text-2xl' : 'text-3xl';
  return (
    <div className="flex items-baseline gap-2 leading-none">
      <span className={`font-display tracking-wide text-cream ${cls}`}>WHEY</span>
      <span className={`font-display tracking-wide text-red ${cls}`}>LAB</span>
    </div>
  );
}
