import { useEffect, useMemo, useRef, useState } from 'react';
import type { MenuItem, OrderResult, CustomerLookup, CustomerIdentity, CustomerSuggestion, ProteinData } from '../api';
import { api } from '../api';
import { ticket, useTicket } from '../store/ticket';
import { FitCanvas } from './FitCanvas';
import { MenuGrid } from './MenuGrid';
import { ProteinPoster } from './ProteinPoster';
import { TicketRail } from './TicketRail';
import { BillModal } from './BillModal';

// menu (full-screen, opens here) -> customer (search existing or add new) -> pay
type Phase = 'menu' | 'customer' | 'pay';
const HOTKEY_SEQUENCE = '123456789qwertyuasdfgh'.split('');
const NO_IDENTITY: CustomerIdentity = { phone: null, username: null };

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function BillingApp() {
  const [phase, setPhase] = useState<Phase>('menu');
  const [identity, setIdentity] = useState<CustomerIdentity>(NO_IDENTITY);
  const [customer, setCustomer] = useState<CustomerLookup | null>(null);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [completed, setCompleted] = useState<OrderResult | null>(null);
  const [protein, setProtein] = useState<ProteinData | null>(null);
  // The cart overlays the menu (the menu never moves). It opens on add; the
  // customer can tuck it away to reach the items underneath, and it comes
  // back on the next add.
  const [cartHidden, setCartHidden] = useState(false);
  const { lines } = useTicket();
  const now = useClock();

  const loadMenu = () => api.menu().then((d) => setItems(d.items)).catch(() => setItems([]));
  useEffect(() => {
    loadMenu();
    api.protein().then(setProtein).catch(() => setProtein(null));
  }, []);

  // Every ticket line needs a protein choice; this is what "just tap the
  // item" defaults to when staff don't bother picking one explicitly.
  function addToTicket(id: string) {
    setCartHidden(false);
    ticket.add(
      id,
      protein?.default.brandId ?? 'muscleblaze',
      protein?.default.grams ?? 20,
      protein?.default.milkId ?? 'regular'
    );
  }

  const hotkeys = useMemo(() => {
    const map: Record<string, string> = {};
    const byKey: Record<string, string> = {};
    let i = 0;
    for (const it of items) {
      if (it.is_available && it.price_paise != null && i < HOTKEY_SEQUENCE.length) {
        const k = HOTKEY_SEQUENCE[i++];
        map[it.id] = k.toUpperCase();
        byKey[k] = it.id;
      }
    }
    return { map, byKey };
  }, [items]);

  // Kiosk behaviour: the billing screens shouldn't feel like a web page.
  // No right-click menu, and if the browser is showing its own toolbars,
  // go fullscreen on the first tap (a no-op in kiosk mode, which is already full).
  useEffect(() => {
    const noMenu = (e: Event) => e.preventDefault();
    const goFullscreen = () => {
      const chromeVisible = window.screen.height - window.innerHeight > 40;
      if (chromeVisible && !document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => {});
      }
    };
    window.addEventListener('contextmenu', noMenu);
    window.addEventListener('pointerdown', goFullscreen, { once: true });
    return () => {
      window.removeEventListener('contextmenu', noMenu);
      window.removeEventListener('pointerdown', goFullscreen);
    };
  }, []);

  // Hotkeys only while picking items on the menu.
  useEffect(() => {
    if (phase !== 'menu') return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      const id = hotkeys.byKey[e.key.toLowerCase()];
      if (id) {
        e.preventDefault();
        addToTicket(id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, hotkeys, protein]);

  // The cart is built first, so choosing a customer must never clear it.
  function startOrder(id: CustomerIdentity, cust: CustomerLookup | null) {
    setIdentity(id);
    setCustomer(cust);
    setPhase('pay');
  }

  // Back to the menu with the cart intact; forget any customer picked so far.
  function backToMenu() {
    setIdentity(NO_IDENTITY);
    setCustomer(null);
    setPhase('menu');
  }

  function reset() {
    ticket.clear();
    backToMenu();
  }

  const railProps = {
    items,
    lines,
    identity,
    customer,
    proteinBrands: protein?.brands ?? [],
    proteinOptions: protein?.amount_options ?? [],
    brandPrices: protein?.brand_prices ?? [],
    addonOptions: protein?.addons ?? [],
    milkOptions: protein?.milk_options ?? [],
    modeByTier: protein?.mode_by_tier ?? {},
    onAdd: addToTicket,
    onDec: ticket.dec,
    onRemove: ticket.remove,
    onSetProtein: ticket.setProtein,
    onToggleAddon: ticket.toggleAddon,
    onSetMilk: ticket.setMilk,
    onComplete: setCompleted,
  };

  if (phase === 'customer') {
    return (
      <Screen now={now} onBack={backToMenu}>
        <CustomerStep onStart={(id, cust) => startOrder(id, cust)} />
      </Screen>
    );
  }

  if (phase === 'pay') {
    return (
      <Screen now={now} onBack={() => setPhase('customer')}>
        <div className="flex-1 min-h-0 flex justify-center pt-4">
          <TicketRail {...railProps} stage="pay" className="w-full max-w-xl border-2 border-cream/15" />
        </div>
        {completed && (
          <BillModal
            orderId={completed.id}
            onClose={() => {
              setCompleted(null);
              reset();
              loadMenu();
            }}
          />
        )}
      </Screen>
    );
  }

  // phase === 'menu': the poster menu fills the screen and stays put; the cart
  // slides over it from the right once something has been added. The protein
  // board sits permanently beside it, exactly like the second sign on the
  // shop's wall — it's reference material customers glance at while ordering,
  // not part of the ordering flow itself.
  const itemCount = Object.values(lines).reduce((n, l) => n + l.quantity, 0);
  const hasItems = itemCount > 0;
  const cartShown = hasItems && !cartHidden;
  return (
    <div className="relative h-full overflow-hidden bg-poster">
      <div className="absolute inset-0 flex">
        <div className="relative min-w-0 flex-1">
          <FitCanvas>
            <MenuGrid items={items} onAdd={addToTicket} hotkeys={hotkeys.map} />
          </FitCanvas>
        </div>
        <div className="w-[320px] shrink-0 border-l-2 border-cream/15">
          <ProteinPoster protein={protein} />
        </div>
      </div>

      <aside
        inert={!cartShown}
        className={`absolute inset-y-0 right-0 w-[380px] border-l-2 border-cream/15 bg-ink transition-[transform,box-shadow] duration-300 ${
          cartShown ? 'translate-x-0 shadow-[-16px_0_40px_rgba(0,0,0,0.5)]' : 'translate-x-full shadow-none'
        }`}
      >
        <button
          onClick={() => setCartHidden(true)}
          aria-label="Hide order"
          className={`absolute -left-9 top-1/2 h-16 w-9 -translate-y-1/2 border-2 border-r-0 border-cream/15 bg-ink font-mono text-cream/70 transition-opacity ${cartShown ? 'opacity-100' : 'opacity-0'}`}
        >
          ▸
        </button>
        <TicketRail {...railProps} stage="cart" className="w-full" onCheckout={() => setPhase('customer')} onClear={ticket.clear} />
      </aside>

      {hasItems && cartHidden && (
        <button
          onClick={() => setCartHidden(false)}
          aria-label="Show order"
          className="absolute right-0 top-1/2 flex h-44 w-11 -translate-y-1/2 items-center justify-center bg-red font-display text-xl tracking-widest text-cream [writing-mode:vertical-rl]"
        >
          ORDER · {itemCount}
        </button>
      )}
    </div>
  );
}

// Shell for the pre-order screens: wordmark, clock, optional back.
function Screen({ now, onBack, children }: { now: Date; onBack?: () => void; children: React.ReactNode }) {
  return (
    <div className="h-full flex flex-col p-8">
      <div className="flex items-center justify-between">
        {onBack ? (
          <button onClick={onBack} className="font-body text-sm text-cream/50 underline underline-offset-4">
            ← Back
          </button>
        ) : (
          <span />
        )}
        <span className="font-mono text-cream/50 text-sm">{now.toLocaleString()}</span>
      </div>
      {children}
    </div>
  );
}

type IdMode = 'phone' | 'username';

// Small tab pair used by both New and Returning customer screens to pick
// between sharing a number and using a private handle instead.
function ModeTabs({ mode, onChange }: { mode: IdMode; onChange: (m: IdMode) => void }) {
  return (
    <div className="w-full grid grid-cols-2 gap-2 mb-1">
      {(['phone', 'username'] as IdMode[]).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={`py-2 font-body uppercase text-xs tracking-widest border-2 ${
            mode === m ? 'border-red text-cream' : 'border-cream/20 text-cream/50'
          }`}
        >
          {m === 'phone' ? 'Number' : 'Username'}
        </button>
      ))}
    </div>
  );
}

function useUsernameField(initial: string) {
  const [username, setUsername] = useState(initial);
  const [status, setStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle');
  const [reason, setReason] = useState('');

  useEffect(() => {
    const u = username.trim();
    if (!u) {
      setStatus('idle');
      return;
    }
    setStatus('checking');
    let cancelled = false;
    const t = setTimeout(() => {
      api
        .checkUsername(u)
        .then((r) => {
          if (cancelled) return;
          if (!r.available && r.reason) {
            setStatus('invalid');
            setReason(r.reason);
          } else {
            setStatus(r.available ? 'available' : 'taken');
            setReason(r.available ? '' : 'That username is taken.');
          }
        })
        .catch(() => !cancelled && setStatus('idle'));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [username]);

  return { username, setUsername, status, reason };
}

function UsernameStatus({ status, reason }: { status: string; reason: string }) {
  if (status === 'checking') return <p className="font-body text-xs text-cream/40">Checking…</p>;
  if (status === 'available') return <p className="font-body text-xs text-cream">✓ Available</p>;
  if (status === 'taken' || status === 'invalid') return <p className="font-body text-xs text-red">{reason}</p>;
  return null;
}

// One unified screen replacing the old "new or returning?" fork: a single
// search box with live suggestions as staff type a name or number, and — if
// nothing matches — an always-visible "add as new" form right below it, fed
// from whatever was already typed so nothing needs retyping.
function CustomerStep({
  onStart,
}: {
  onStart: (identity: CustomerIdentity, c: CustomerLookup | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<CustomerSuggestion[]>([]);
  const [searching, setSearching] = useState(false);

  const [mode, setMode] = useState<IdMode>('phone');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [handleSuggestions, setHandleSuggestions] = useState<string[]>([]);
  const { username, setUsername, status: uStatus, reason: uReason } = useUsernameField('');
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Live search as the main box is typed into.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const t = setTimeout(() => {
      api
        .searchCustomers(q)
        .then((r) => !cancelled && setSuggestions(r.customers))
        .catch(() => !cancelled && setSuggestions([]))
        .finally(() => !cancelled && setSearching(false));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  // Feed the search box into the "add as new" fields below, so if nothing
  // matches, whatever was already typed doesn't need retyping: digits go to
  // the number field, anything else is treated as the name. Only what the
  // search itself put there is replaced, so clearing the search clears it
  // again, while anything typed straight into those fields is left alone.
  const mirrored = useRef({ name: '', phone: '' });
  useEffect(() => {
    const q = query.trim();
    const digits = /^\d+$/.test(q);
    const next = { name: q && !digits ? q : '', phone: digits ? q.slice(0, 10) : '' };
    const prev = mirrored.current;
    mirrored.current = next;
    if (digits) setMode('phone');
    setName((n) => (n === prev.name ? next.name : n));
    setPhone((p) => (p === prev.phone ? next.phone : p));
  }, [query]);

  // A "new" customer whose number is already registered isn't new — surface
  // the existing account instead of silently merging into it.
  const [phoneLookup, setPhoneLookup] = useState<CustomerLookup | null>(null);
  useEffect(() => {
    if (mode !== 'phone' || phone.length !== 10) {
      setPhoneLookup(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      api
        .lookup(phone)
        .then((r) => !cancelled && setPhoneLookup(r.known ? r : null))
        .catch(() => !cancelled && setPhoneLookup(null));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [phone, mode]);

  // Suggest handles from the name, Instagram-style, while the field is untouched.
  useEffect(() => {
    if (mode !== 'username') return;
    const n = name.trim();
    if (!n) {
      setHandleSuggestions([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      api
        .suggestUsernames(n)
        .then((r) => {
          if (cancelled) return;
          setHandleSuggestions(r.suggestions);
          if (!usernameTouched && r.suggestions.length) setUsername(r.suggestions[0]);
        })
        .catch(() => {});
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, mode]);

  // A suggestion only carries the fields the search endpoint exposes; do the
  // full single-identifier lookup before starting so redemption eligibility
  // (can_redeem, eligible_tiers) is correct, not just a guess.
  function selectSuggestion(s: CustomerSuggestion) {
    const identity: CustomerIdentity = s.phone
      ? { phone: s.phone, username: null }
      : { phone: null, username: s.username };
    api
      .lookup(s.phone || s.username || '')
      .then((full) => onStart(identity, full))
      .catch(() =>
        onStart(identity, {
          known: true,
          first_name: s.first_name,
          username: s.username,
          points_balance: s.points_balance,
          can_redeem: false,
          redeem_threshold: 0,
        })
      );
  }

  const isDuplicatePhone = mode === 'phone' && phone.length === 10 && !!phoneLookup;
  const readyToAdd =
    !isDuplicatePhone &&
    name.trim().length > 0 &&
    (mode === 'phone' ? phone.length === 10 : username.trim().length > 0 && uStatus === 'available');

  async function addNew() {
    if (!readyToAdd) return;
    setBusy(true);
    setError('');
    try {
      const identity: CustomerIdentity =
        mode === 'phone' ? { phone, username: null } : { phone: null, username: username.trim() };
      const c = await api.registerCustomer(identity, name.trim());
      onStart(identity, c);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const showSuggestions = query.trim().length >= 2;

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 w-full">
      <h1 className="font-display text-4xl text-cream">Who's this order for?</h1>
      <div className="w-96 flex flex-col gap-3">
        <input
          autoFocus
          placeholder="Search name or number"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full bg-transparent border-2 border-cream/25 px-4 py-3 font-body text-xl text-cream placeholder:text-cream/30 focus:border-red outline-none"
        />

        {showSuggestions && (
          <div className="border border-cream/15">
            {searching && <p className="font-body text-xs text-cream/40 px-3 py-2">Searching…</p>}
            {!searching && suggestions.length === 0 && (
              <p className="font-body text-xs text-cream/40 px-3 py-2">No matches — add as new below.</p>
            )}
            {suggestions.map((s) => (
              <button
                key={`${s.phone || ''}-${s.username || ''}`}
                onClick={() => selectSuggestion(s)}
                className="w-full flex justify-between items-baseline px-3 py-2 font-body text-left text-cream hover:bg-cream/10 border-t border-cream/10 first:border-t-0"
              >
                <span>
                  {s.first_name || 'Member'}{' '}
                  <span className="font-mono text-xs text-cream/50">{s.username ? `@${s.username}` : s.phone}</span>
                </span>
                <span className="font-mono text-xs text-cream/60">{s.points_balance} pts</span>
              </button>
            ))}
          </div>
        )}

        <div className="mt-2 pt-3 border-t border-cream/10 flex flex-col gap-3">
          <p className="font-body uppercase tracking-widest text-xs text-cream/40">Not found? Add as new</p>
          <ModeTabs mode={mode} onChange={setMode} />

          <input
            placeholder="First name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-transparent border-2 border-cream/25 px-4 py-3 font-body text-xl text-cream placeholder:text-cream/30 focus:border-red outline-none"
          />

          {mode === 'phone' ? (
            <>
              <input
                inputMode="numeric"
                placeholder="Mobile number (10 digits)"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                className="w-full bg-transparent border-2 border-cream/25 px-4 py-3 font-mono text-xl text-cream placeholder:text-cream/30 focus:border-red outline-none"
              />
              {isDuplicatePhone && (
                <p className="font-body text-sm text-red">
                  Already registered — {phoneLookup!.first_name || 'Member'} · {phoneLookup!.points_balance} pts.
                  Search above to find them instead.
                </p>
              )}
            </>
          ) : (
            <>
              <input
                placeholder="Choose a username"
                value={username}
                onChange={(e) => {
                  setUsernameTouched(true);
                  setUsername(e.target.value.replace(/\s/g, '').toLowerCase());
                }}
                className="w-full bg-transparent border-2 border-cream/25 px-4 py-3 font-mono text-xl text-cream placeholder:text-cream/30 focus:border-red outline-none"
              />
              <UsernameStatus status={uStatus} reason={uReason} />
              {handleSuggestions.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {handleSuggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        setUsernameTouched(true);
                        setUsername(s);
                      }}
                      className={`px-3 py-1 font-mono text-sm border ${
                        username === s ? 'border-red text-cream' : 'border-cream/25 text-cream/60'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {error && <p className="font-body text-sm text-red">{error}</p>}
          <button
            onClick={addNew}
            disabled={!readyToAdd || busy}
            className="w-full py-4 bg-red text-cream font-display text-2xl disabled:opacity-40"
          >
            {busy ? 'SAVING…' : 'ADD & START ORDER'}
          </button>
        </div>

        <button
          onClick={() => onStart(NO_IDENTITY, null)}
          className="font-body text-xs text-cream/40 underline underline-offset-4 self-center mt-1"
        >
          Walk-in — no number
        </button>
      </div>
    </div>
  );
}
