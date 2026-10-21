import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ScreensaverConfig, type ScreensaverMedia } from '../api';
import { Wordmark } from './Wordmark';

// Idle screen for the customer-facing display. After a quiet minute on the
// menu with an empty cart it loops: pushup board, offer, board, reel, ...
// Any tap or key wakes it straight back to the menu. It is only mounted on
// the menu phase, so it can never cover an order in progress.

const IMAGE_MS = 8000;
const BOARD_MS = 30000;      // long enough for both pushup boards (15 s each)
const VIDEO_MAX_MS = 120000; // safety net if a reel never fires "ended"

type Slide = { type: 'board' } | ScreensaverMedia;

// Board between every item, so the leaderboard comes round often.
function buildPlaylist(media: ScreensaverMedia[], boardUp: boolean): Slide[] {
  if (!boardUp) return media;
  if (media.length === 0) return [{ type: 'board' }];
  return media.flatMap((m) => [{ type: 'board' } as Slide, m]);
}

// The pushup board is a separate server. An opaque no-cors request is enough
// to know it's up; if it isn't, the screensaver just skips the board.
async function boardReachable(url: string) {
  try {
    await fetch(new URL('api/board', url), { mode: 'no-cors', cache: 'no-store' });
    return true;
  } catch {
    return false;
  }
}

export function Screensaver({ enabled }: { enabled: boolean }) {
  const [config, setConfig] = useState<ScreensaverConfig | null>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    api.screensaver().then(setConfig).catch(() => setConfig(null));
  }, []);

  // Idle timer: any touch, click, key or scroll restarts the countdown.
  useEffect(() => {
    if (!enabled || active || !config) return;
    let t: ReturnType<typeof setTimeout>;
    const arm = () => {
      clearTimeout(t);
      t = setTimeout(() => setActive(true), config.idle_seconds * 1000);
    };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, arm, { passive: true }));
    arm();
    return () => {
      clearTimeout(t);
      events.forEach((e) => window.removeEventListener(e, arm));
    };
  }, [enabled, active, config]);

  if (!active || !config) return null;
  return <Player initial={config} onWake={() => setActive(false)} />;
}

function Player({ initial, onWake }: { initial: ScreensaverConfig; onWake: () => void }) {
  const [playlist, setPlaylist] = useState<Slide[] | null>(null);
  const [boardUrl, setBoardUrl] = useState(initial.pushup_board_url);
  const [index, setIndex] = useState(0);
  const loading = useRef(false);

  // (Re)build the playlist from the folder; runs at start and on every loop,
  // so new offers/reels show up without touching the app.
  const refresh = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    const cfg = await api.screensaver().catch(() => initial);
    const up = await boardReachable(cfg.pushup_board_url);
    setBoardUrl(cfg.pushup_board_url);
    setPlaylist(buildPlaylist(cfg.media, up));
    setIndex(0);
    loading.current = false;
  }, [initial]);

  useEffect(() => { refresh(); }, [refresh]);

  const next = useCallback(() => {
    if (!playlist) return;
    if (index + 1 >= playlist.length) refresh();
    else setIndex(index + 1);
  }, [playlist, index, refresh]);

  // A key press wakes it too (staff using the keyboard hotkeys).
  useEffect(() => {
    window.addEventListener('keydown', onWake);
    return () => window.removeEventListener('keydown', onWake);
  }, [onWake]);

  const slide = playlist?.[index];
  const hasBoard = !!playlist?.some((s) => s.type === 'board');

  // Images and the board advance on a timer; videos advance when they end.
  useEffect(() => {
    if (!slide) return;
    const ms = slide.type === 'board' ? BOARD_MS : slide.type === 'image' ? IMAGE_MS : VIDEO_MAX_MS;
    // A one-slide playlist still "advances" so the folder gets re-read.
    const t = setTimeout(next, ms);
    return () => clearTimeout(t);
  }, [slide, next]);

  return (
    // onClick (not pointerdown) so the whole tap lands here and never falls
    // through to a menu item underneath once the screensaver disappears.
    <div className="fixed inset-0 z-[100] cursor-pointer bg-ink" onClick={onWake}>
      {/* The board stays loaded between its turns so it never flashes blank. */}
      {hasBoard && (
        <iframe
          src={boardUrl}
          title="Pushup leaderboard"
          className={`absolute inset-0 h-full w-full border-0 transition-opacity duration-700 ${
            slide?.type === 'board' ? 'opacity-100' : 'opacity-0'
          }`}
          tabIndex={-1}
        />
      )}

      {slide && slide.type !== 'board' && <MediaSlide key={`${index}-${slide.name}`} media={slide} onEnded={next} />}

      {playlist && playlist.length === 0 && <Fallback />}

      {/* Clicks inside an iframe never reach this page; this layer catches them. */}
      <div className="absolute inset-0" />

      <div className="pointer-events-none absolute right-6 top-6 bg-red px-4 py-2 font-display text-xl tracking-widest text-cream shadow-lg">
        TAP TO ORDER
      </div>
    </div>
  );
}

// Offers and reels are often portrait; show them whole (contain) over a
// blurred, full-bleed copy of themselves so there are no black bars.
function MediaSlide({ media, onEnded }: { media: ScreensaverMedia; onEnded: () => void }) {
  if (media.type === 'image') {
    return (
      <div className="animate-fade absolute inset-0 overflow-hidden">
        <img src={media.url} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-50 blur-2xl" />
        <img src={media.url} alt="" className="absolute inset-0 h-full w-full object-contain" onError={onEnded} />
      </div>
    );
  }
  return (
    <div className="animate-fade absolute inset-0 overflow-hidden">
      <video src={media.url} muted autoPlay playsInline className="absolute inset-0 h-full w-full scale-110 object-cover opacity-50 blur-2xl" />
      {/* Muted: browsers block autoplay with sound, and the counter stays quiet. */}
      <video src={media.url} muted autoPlay playsInline className="absolute inset-0 h-full w-full object-contain" onEnded={onEnded} onError={onEnded} />
    </div>
  );
}

// Nothing in the folder and no pushup board running: a plain brand card.
function Fallback() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-6">
      <Wordmark size="lg" />
      <div className="font-display text-4xl tracking-widest text-cream/60">TAP TO ORDER</div>
    </div>
  );
}
