import { useLayoutEffect, useRef, useState } from 'react';

// The menu is designed once on a 1920-wide canvas and scaled as one piece to
// the screen, so it looks identical on every display and never reflows (no
// scrollbars, nothing shifts when the cart opens). The canvas height follows
// the screen's aspect ratio so it fills edge to edge; only on screens wider
// than the design allows (ultrawide) is it centred with red side margins.
const DESIGN_W = 1920;
const MIN_H = 1000;

export function FitCanvas({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = ref.current!;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { w, h } = box;
  let frame: React.CSSProperties | null = null;
  if (w && h) {
    const fillH = (DESIGN_W * h) / w;
    const designH = Math.max(MIN_H, fillH);
    const scale = fillH >= MIN_H ? w / DESIGN_W : h / MIN_H;
    const x = (w - DESIGN_W * scale) / 2;
    const y = (h - designH * scale) / 2;
    frame = {
      width: DESIGN_W,
      height: designH,
      transform: `translate(${x}px, ${y}px) scale(${scale})`,
      transformOrigin: '0 0',
    };
  }

  return (
    <div ref={ref} className="absolute inset-0 overflow-hidden">
      {frame && <div style={frame}>{children}</div>}
    </div>
  );
}
