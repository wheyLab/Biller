import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { CustomerIdentity } from '../api';
import { CHALLENGES, GAME_RULES, type Challenge } from '../game';
import { QUIZ_FOODS, type QuizFood } from '../quizFoods';

export interface WonSpin {
  spinId: number;
  challengeKey: Challenge['key'];
}

const SLICE = 360 / CHALLENGES.length;
const SPIN_MS = 4500;
const TEXT_ON = (color: string) => (color === '#F3EDE4' ? '#0D0D0D' : '#F3EDE4');

// Full-screen wheel on the mirrored counter screen: the customer watches it
// spin. The server picks the slice. On-screen games decide win/lose
// themselves; for the rest, staff mark it won or not.
export function SpinWheelModal({
  identity,
  billPaise,
  onWon,
  onClose,
}: {
  identity: CustomerIdentity;
  billPaise: number;
  onWon: (spin: WonSpin) => void;
  onClose: () => void;
}) {
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<{ spinId: number; challenge: Challenge; alreadySpun: boolean } | null>(null);
  const [error, setError] = useState('');
  // Outcome of an on-screen game: null while it's still being played.
  const [played, setPlayed] = useState<boolean | null>(null);
  // The challenge is revealed only once the wheel has visibly stopped (a slow
  // or busy screen can lag the CSS animation behind a plain timer).
  const pendingRef = useRef<{ spinId: number; challenge: Challenge; alreadySpun: boolean } | null>(null);

  function reveal() {
    if (!pendingRef.current) return;
    setResult(pendingRef.current);
    pendingRef.current = null;
    setSpinning(false);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !spinning) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, spinning]);

  async function spin() {
    setError('');
    setSpinning(true);
    try {
      const r = await api.spinWheel(identity, billPaise);
      if (r.already_used) throw new Error('This customer has already used today’s spin.');
      const challenge = CHALLENGES[r.slice_index];
      // Land the middle of the slice (± a little) under the pointer at the top.
      const jitter = (Math.random() - 0.5) * SLICE * 0.6;
      const target = 360 - (r.slice_index * SLICE + SLICE / 2) + jitter;
      const turns = r.already_spun ? 0 : 6;
      pendingRef.current = { spinId: r.spin_id, challenge, alreadySpun: r.already_spun };
      setRotation((rot) => rot - (rot % 360) + turns * 360 + target);
      // Fallback in case transitionend never fires (e.g. no rotation change).
      setTimeout(reveal, r.already_spun ? 800 : SPIN_MS + 2500);
    } catch (e) {
      setError((e as Error).message);
      setSpinning(false);
    }
  }

  const challenge = result?.challenge;
  const canWin = !!challenge && (!challenge.onScreen || played === true);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/95 p-4">
      <div className="no-scrollbar flex max-h-full w-full max-w-2xl flex-col items-center gap-4 overflow-y-auto border-2 border-cream/20 bg-ink p-6">
        <div className="flex w-full items-baseline justify-between">
          <h2 className="font-display text-3xl tracking-wide text-cream">SPIN THE WHEEL</h2>
          <button
            onClick={onClose}
            disabled={spinning}
            className="font-display text-3xl leading-none text-cream/50 disabled:opacity-20"
            aria-label="close"
          >
            ×
          </button>
        </div>

        {!result && <Wheel rotation={rotation} onStop={reveal} />}

        {!result && (
          <>
            <button
              onClick={spin}
              disabled={spinning}
              className="w-full max-w-md bg-red py-4 font-display text-3xl tracking-widest text-cream disabled:opacity-50"
            >
              {spinning ? 'SPINNING…' : 'SPIN'}
            </button>
            <p className="font-body text-xs text-cream/40">One spin per customer per day</p>
          </>
        )}

        {error && <p className="font-body text-sm text-red">{error}</p>}

        {challenge && result && (
          <div className="flex w-full flex-col gap-3">
            {result.alreadySpun && (
              <p className="font-body text-xs text-cream/60">Already spun today — this is today’s challenge.</p>
            )}
            <div className="border-2 p-4" style={{ background: challenge.color, borderColor: challenge.color, color: TEXT_ON(challenge.color) }}>
              <div className="font-body text-[10px] uppercase tracking-widest opacity-70">Your challenge</div>
              <div className="font-display text-4xl tracking-wide">{challenge.title}</div>
              <p className="mt-1 font-body text-sm opacity-90">{challenge.howToPlay}</p>
              <div className="mt-2 font-mono text-sm font-bold">WIN: {challenge.reward}</div>
            </div>

            {challenge.key === 'stopwatch' && <Stopwatch onResult={setPlayed} />}
            {challenge.key === 'proteinQuiz' && <ProteinQuiz onResult={setPlayed} />}
            {challenge.key === 'reaction' && <ReactionTest onResult={setPlayed} />}
            {challenge.key === 'weightGuess' && <WeightGuess onResult={setPlayed} />}

            <div className="grid grid-cols-2 gap-2">
              <button onClick={onClose} className="border-2 border-cream/25 py-3 font-display text-xl tracking-wide text-cream/70">
                {played === false ? 'CLOSE' : 'DIDN’T MAKE IT'}
              </button>
              <button
                onClick={() => onWon({ spinId: result.spinId, challengeKey: challenge.key })}
                disabled={!canWin}
                className="bg-red py-3 font-display text-xl tracking-wide text-cream disabled:opacity-30"
              >
                WON — APPLY
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Wheel({ rotation, onStop }: { rotation: number; onStop: () => void }) {
  const r = 150;
  const c = 160;
  const point = (deg: number, radius = r) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [c + radius * Math.cos(rad), c + radius * Math.sin(rad)];
  };

  return (
    <div className="relative w-full max-w-[360px]">
      <svg viewBox="0 0 40 30" className="absolute left-1/2 top-0 z-10 w-9 -translate-x-1/2 -translate-y-1">
        <polygon points="0,0 40,0 20,30" fill="#F3EDE4" stroke="#0D0D0D" strokeWidth="3" />
      </svg>
      <svg
        viewBox="0 0 320 320"
        className="block w-full"
        onTransitionEnd={onStop}
        style={{
          transform: `rotate(${rotation}deg)`,
          transition: `transform ${SPIN_MS}ms cubic-bezier(0.17, 0.67, 0.12, 0.99)`,
        }}
      >
        <circle cx={c} cy={c} r={r + 6} fill="#F3EDE4" />
        {CHALLENGES.map((ch, i) => {
          const start = i * SLICE;
          const end = start + SLICE;
          const [x1, y1] = point(start);
          const [x2, y2] = point(end);
          const mid = start + SLICE / 2;
          const [tx, ty] = point(mid, r * 0.6);
          return (
            <g key={ch.key}>
              <path d={`M${c},${c} L${x1},${y1} A${r},${r} 0 0 1 ${x2},${y2} Z`} fill={ch.color} stroke="#0D0D0D" strokeWidth={2} />
              <text
                x={tx}
                y={ty}
                fill={TEXT_ON(ch.color)}
                fontFamily="Anton, sans-serif"
                fontSize={15}
                letterSpacing={0.5}
                textAnchor="middle"
                dominantBaseline="middle"
                transform={`rotate(${mid}, ${tx}, ${ty})`}
              >
                {ch.wheelLabel}
              </text>
            </g>
          );
        })}
        <circle cx={c} cy={c} r={34} fill="#0D0D0D" stroke="#F3EDE4" strokeWidth={4} />
        <text x={c} y={c - 5} textAnchor="middle" dominantBaseline="middle" fontFamily="Anton, sans-serif" fontSize={13} fill="#F3EDE4">
          WHEY
        </text>
        <text x={c} y={c + 9} textAnchor="middle" dominantBaseline="middle" fontFamily="Anton, sans-serif" fontSize={13} fill="#E8341C">
          LAB
        </text>
      </svg>
    </div>
  );
}

const HIDE_AFTER_MS = 1000;

function Stopwatch({ onResult }: { onResult: (won: boolean) => void }) {
  const [state, setState] = useState<'idle' | 'running' | 'done'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(0);
  const frameRef = useRef(0);

  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

  const isWin = (t: number) => Math.abs(t - GAME_RULES.stopwatchTarget) <= GAME_RULES.stopwatchTolerance;

  function tick() {
    setElapsed((performance.now() - startRef.current) / 1000);
    frameRef.current = requestAnimationFrame(tick);
  }

  function tap() {
    if (state === 'idle') {
      startRef.current = performance.now();
      setState('running');
      frameRef.current = requestAnimationFrame(tick);
    } else if (state === 'running') {
      cancelAnimationFrame(frameRef.current);
      const final = (performance.now() - startRef.current) / 1000;
      setElapsed(final);
      setState('done');
      onResult(isWin(final));
    }
  }

  const hidden = state === 'running' && elapsed * 1000 > HIDE_AFTER_MS;
  const won = state === 'done' && isWin(elapsed);
  const lo = (GAME_RULES.stopwatchTarget - GAME_RULES.stopwatchTolerance).toFixed(2);
  const hi = (GAME_RULES.stopwatchTarget + GAME_RULES.stopwatchTolerance).toFixed(2);

  return (
    <button
      onClick={tap}
      disabled={state === 'done'}
      className={`w-full select-none border-2 py-5 text-center ${
        won ? 'border-red bg-red text-cream' : 'border-cream/25 bg-ink text-cream'
      }`}
    >
      <div className="font-mono text-6xl font-bold tabular-nums">{hidden ? '?.??' : elapsed.toFixed(2)}</div>
      <div className="mt-1 font-body text-sm text-cream/70">
        {state === 'idle' && 'TAP TO START'}
        {state === 'running' && 'TAP TO STOP AT 5.00'}
        {state === 'done' && (won ? 'NAILED IT! +5g protein' : `So close! Needed ${lo}–${hi}`)}
      </div>
    </button>
  );
}

function pickFoods(n: number): QuizFood[] {
  const pool = [...QUIZ_FOODS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

type Mark = 'right' | 'wrong';

// 5 random food cards. The customer says a guess out loud; staff tap the card
// to flip it, then mark the guess right or wrong. First to 3 decides it.
function ProteinQuiz({ onResult }: { onResult: (won: boolean) => void }) {
  const [foods] = useState(() => pickFoods(GAME_RULES.quizCards));
  const [flipped, setFlipped] = useState<boolean[]>(() => foods.map(() => false));
  const [marks, setMarks] = useState<(Mark | null)[]>(() => foods.map(() => null));

  const right = marks.filter((m) => m === 'right').length;
  const wrong = marks.filter((m) => m === 'wrong').length;
  const toLose = GAME_RULES.quizCards - GAME_RULES.quizToWin + 1;
  const decided = right >= GAME_RULES.quizToWin || wrong >= toLose;

  function mark(i: number, m: Mark) {
    const next = marks.map((x, j) => (j === i ? m : x));
    setMarks(next);
    const r = next.filter((x) => x === 'right').length;
    const w = next.filter((x) => x === 'wrong').length;
    if (r >= GAME_RULES.quizToWin) onResult(true);
    else if (w >= toLose) onResult(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between font-mono text-sm text-cream/70">
        <span>
          Right <span className="text-cream">{right}</span> · Wrong <span className="text-cream">{wrong}</span>
        </span>
        <span>
          {right >= GAME_RULES.quizToWin
            ? 'WINNER!'
            : wrong >= toLose
            ? 'Better luck next time'
            : `Get ${GAME_RULES.quizToWin} of ${GAME_RULES.quizCards} right`}
        </span>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {foods.map((f, i) => (
          <div key={f.name} className="flex flex-col gap-1">
            <button
              onClick={() => setFlipped((fl) => fl.map((x, j) => (j === i ? true : x)))}
              disabled={flipped[i] || decided}
              className="h-32 w-full [perspective:600px]"
              aria-label={`Flip ${f.name}`}
            >
              <div
                className="relative h-full w-full transition-transform duration-500 [transform-style:preserve-3d]"
                style={{ transform: flipped[i] ? 'rotateY(180deg)' : 'none' }}
              >
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 border-2 border-cream/30 bg-cream p-1 text-ink [backface-visibility:hidden]">
                  <div className="font-display text-lg leading-tight">{f.name.toUpperCase()}</div>
                  <div className="font-body text-[11px] text-ink/60">{f.serving}</div>
                  <div className="font-mono text-xl">?</div>
                </div>
                <div
                  className={`absolute inset-0 flex flex-col items-center justify-center border-2 p-1 [backface-visibility:hidden] [transform:rotateY(180deg)] ${
                    marks[i] === 'right' ? 'border-red bg-red text-cream' : 'border-cream/30 bg-ink text-cream'
                  }`}
                >
                  <div className="font-display text-4xl">{f.proteinG}g</div>
                  <div className="font-body text-[11px] opacity-70">protein</div>
                  <div className="font-body text-[11px] opacity-70">{f.name}</div>
                </div>
              </div>
            </button>
            {flipped[i] && marks[i] === null && !decided && (
              <div className="grid grid-cols-2 gap-1">
                <button onClick={() => mark(i, 'right')} className="bg-red py-1 font-display text-lg text-cream" aria-label="right">
                  ✓
                </button>
                <button onClick={() => mark(i, 'wrong')} className="border border-cream/30 py-1 font-display text-lg text-cream/70" aria-label="wrong">
                  ✗
                </button>
              </div>
            )}
            {marks[i] && (
              <div className={`text-center font-mono text-xs ${marks[i] === 'right' ? 'text-red' : 'text-cream/40'}`}>
                {marks[i] === 'right' ? 'RIGHT' : 'WRONG'}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Tap the instant the box turns red. Average over the tries must beat the limit.
function ReactionTest({ onResult }: { onResult: (won: boolean) => void }) {
  const [state, setState] = useState<'idle' | 'waiting' | 'go' | 'early' | 'done'>('idle');
  const [times, setTimes] = useState<number[]>([]);
  const goAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  function arm() {
    setState('waiting');
    timerRef.current = setTimeout(() => {
      goAtRef.current = performance.now();
      setState('go');
    }, 1500 + Math.random() * 2500);
  }

  function tap() {
    if (state === 'idle' || state === 'early') return arm();
    if (state === 'waiting') {
      if (timerRef.current) clearTimeout(timerRef.current);
      setState('early');
      return;
    }
    if (state === 'go') {
      const ms = Math.round(performance.now() - goAtRef.current);
      const next = [...times, ms];
      setTimes(next);
      if (next.length >= GAME_RULES.reactionTries) {
        setState('done');
        onResult(next.reduce((s, t) => s + t, 0) / next.length <= GAME_RULES.reactionMaxAvgMs);
      } else {
        arm();
      }
    }
  }

  const avg = times.length ? Math.round(times.reduce((s, t) => s + t, 0) / times.length) : 0;
  const won = state === 'done' && avg <= GAME_RULES.reactionMaxAvgMs;
  const label =
    state === 'idle'
      ? 'TAP TO START'
      : state === 'waiting'
      ? 'WAIT FOR RED…'
      : state === 'go'
      ? 'TAP!'
      : state === 'early'
      ? 'TOO SOON! TAP TO RETRY'
      : won
      ? `${avg}ms AVERAGE — WINNER!`
      : `${avg}ms average — needed under ${GAME_RULES.reactionMaxAvgMs}ms`;

  return (
    <div className="flex flex-col gap-2">
      <button
        onPointerDown={tap}
        disabled={state === 'done'}
        className={`h-40 w-full select-none border-2 font-display text-3xl tracking-wide ${
          state === 'go' || won ? 'border-red bg-red text-cream' : 'border-cream/25 bg-ink text-cream'
        }`}
      >
        {label}
      </button>
      <div className="flex justify-center gap-3 font-mono text-sm text-cream/70">
        {Array.from({ length: GAME_RULES.reactionTries }, (_, i) => (
          <span key={i}>{times[i] != null ? `${times[i]}ms` : '—'}</span>
        ))}
      </div>
    </div>
  );
}

// The customer's guess is locked in first, then staff enter the real weight.
function WeightGuess({ onResult }: { onResult: (won: boolean) => void }) {
  const [guess, setGuess] = useState('');
  const [locked, setLocked] = useState(false);
  const [actual, setActual] = useState('');
  const [diff, setDiff] = useState<number | null>(null);

  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 5);
  const input =
    'w-full border-2 border-cream/25 bg-transparent px-3 py-2 font-display text-4xl text-cream outline-none focus:border-red disabled:opacity-50';

  function check() {
    const d = Math.abs(Number(actual) - Number(guess));
    setDiff(d);
    onResult(d <= GAME_RULES.weightToleranceG);
  }

  const won = diff != null && diff <= GAME_RULES.weightToleranceG;

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span className="font-body text-xs uppercase tracking-widest text-cream/50">Customer’s guess (grams)</span>
        <div className="flex gap-2">
          <input inputMode="numeric" autoFocus value={guess} disabled={locked} onChange={(e) => setGuess(digits(e.target.value))} placeholder="0" className={input} />
          {!locked && (
            <button onClick={() => setLocked(true)} disabled={!guess} className="bg-red px-4 font-display text-xl text-cream disabled:opacity-30">
              LOCK
            </button>
          )}
        </div>
      </label>
      {locked && (
        <label className="flex flex-col gap-1">
          <span className="font-body text-xs uppercase tracking-widest text-cream/50">Actual weight (grams)</span>
          <div className="flex gap-2">
            <input inputMode="numeric" autoFocus value={actual} disabled={diff != null} onChange={(e) => setActual(digits(e.target.value))} placeholder="0" className={input} />
            {diff == null && (
              <button onClick={check} disabled={!actual} className="bg-red px-4 font-display text-xl text-cream disabled:opacity-30">
                REVEAL
              </button>
            )}
          </div>
        </label>
      )}
      {diff != null && (
        <div className={`border-2 py-3 text-center font-display text-2xl tracking-wide ${won ? 'border-red bg-red text-cream' : 'border-cream/25 text-cream'}`}>
          {won ? `OFF BY ${diff}g — WINNER!` : `Off by ${diff}g — needed within ${GAME_RULES.weightToleranceG}g`}
        </div>
      )}
    </div>
  );
}
