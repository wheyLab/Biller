import { useEffect, useState } from 'react';
import { api, rupees } from '../api';
import { Wordmark } from './Wordmark';

type Tab = 'summary' | 'orders' | 'customers' | 'menu' | 'stock' | 'config';
const TABS: Tab[] = ['summary', 'orders', 'customers', 'menu', 'stock', 'config'];

export function AdminApp() {
  const [tab, setTab] = useState<Tab>('summary');
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-6 py-3 border-b-2 border-cream/15">
        <div className="flex items-center gap-3">
          <Wordmark size="sm" />
          <span className="font-body uppercase tracking-widest text-xs text-cream/40">Back office</span>
        </div>
      </div>
      <div className="flex gap-2 px-6 py-2 border-b border-cream/10">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1 font-body uppercase text-xs tracking-widest border-2 ${tab === t ? 'border-red text-cream' : 'border-transparent text-cream/50'}`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'summary' && <Summary />}
        {tab === 'orders' && <Orders />}
        {tab === 'customers' && <Customers />}
        {tab === 'menu' && <Menu />}
        {tab === 'stock' && <Stock />}
        {tab === 'config' && <Config />}
      </div>
    </div>
  );
}

function Summary() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    api.summary(date).then(setData).catch(() => setData(null));
  }, [date]);
  return (
    <div>
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="bg-transparent border-2 border-cream/25 px-3 py-2 font-mono text-cream mb-4"
      />
      {data && data.low_stock?.length > 0 && (
        <div className="border-2 border-red p-3 mb-4">
          <div className="font-body uppercase text-xs tracking-widest text-red mb-1">Low protein stock</div>
          <div className="font-mono text-sm text-cream">
            {data.low_stock.map((b: any) => `${b.name} (${(b.stock_mg / 1000).toFixed(0)}g left)`).join(' · ')}
          </div>
        </div>
      )}
      {data && (
        <div className="grid grid-cols-3 gap-4">
          <Stat label="Orders" value={String(data.orders)} />
          <Stat label="Revenue" value={rupees(data.revenue_paise)} />
          <Stat label="Tax collected" value={rupees(data.tax_paise)} />
          {data.by_method.map((m: any) => (
            <Stat key={m.payment_method} label={m.payment_method} value={`${rupees(m.revenue_paise)} · ${m.orders}`} />
          ))}
        </div>
      )}
    </div>
  );
}

function Orders() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    api.orders().then((d) => setRows(d.orders)).catch(() => setRows([]));
  }, []);
  return (
    <table className="w-full font-mono text-sm text-cream/80">
      <thead className="text-cream/40 text-left">
        <tr><th>#</th><th>Time</th><th>Customer</th><th>Total</th><th>Pay</th><th>Pts</th></tr>
      </thead>
      <tbody>
        {rows.map((o) => (
          <tr key={o.id} className="border-t border-cream/10">
            <td>{o.order_number}</td>
            <td>{new Date(o.created_at).toLocaleString()}</td>
            <td>{o.customer_phone || (o.customer_username ? `@${o.customer_username}` : '—')}</td>
            <td>{rupees(o.total_paise)}</td>
            <td>{o.payment_method}</td>
            <td>+{o.points_earned}/-{o.points_redeemed}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Customers() {
  const [rows, setRows] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  useEffect(() => {
    api.customers().then((d) => setRows(d.customers)).catch(() => setRows([]));
  }, []);

  if (selectedId != null) {
    return <CustomerOrders id={selectedId} onBack={() => setSelectedId(null)} />;
  }

  const q = query.trim().toLowerCase();
  const filtered = q
    ? rows.filter((c) =>
        [c.first_name, c.phone, c.username].some((v) => v && String(v).toLowerCase().includes(q))
      )
    : rows;

  return (
    <div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name, phone, or username…"
        className="w-full max-w-sm bg-transparent border-2 border-cream/20 px-3 py-2 font-mono text-sm text-cream placeholder:text-cream/30 focus:border-red outline-none mb-4"
      />
      <table className="w-full font-mono text-sm text-cream/80">
        <thead className="text-cream/40 text-left">
          <tr><th>Phone</th><th>Username</th><th>Name</th><th>Points</th><th>Since</th></tr>
        </thead>
        <tbody>
          {filtered.map((c) => (
            <tr
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className="border-t border-cream/10 cursor-pointer hover:bg-cream/5"
            >
              <td>{c.phone || '—'}</td>
              <td>{c.username ? `@${c.username}` : '—'}</td>
              <td>{c.first_name || '—'}</td>
              <td>{c.points_balance}</td>
              <td>{new Date(c.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-center text-cream/40">No matching customers.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function CustomerOrders({ id, onBack }: { id: number; onBack: () => void }) {
  const [data, setData] = useState<{ customer: any; orders: any[] } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.customerOrders(id).then(setData).catch((e) => setError(e.message));
  }, [id]);

  return (
    <div>
      <button
        onClick={onBack}
        className="font-body text-xs text-cream/50 underline underline-offset-4 mb-4"
      >
        ← Back to customers
      </button>

      {error && <p className="font-body text-sm text-red">{error}</p>}
      {!error && !data && <p className="font-body text-sm text-cream/50">Loading…</p>}

      {data && (
        <>
          <div className="mb-4">
            <div className="font-display text-2xl text-cream">{data.customer.first_name || 'Member'}</div>
            <div className="font-mono text-xs text-cream/50">
              {data.customer.phone || (data.customer.username ? `@${data.customer.username}` : '—')}
              {' · '}
              {data.customer.points_balance} pts
              {' · customer since '}
              {new Date(data.customer.created_at).toLocaleDateString()}
            </div>
          </div>

          {data.orders.length === 0 && (
            <p className="font-body text-sm text-cream/50">No orders yet.</p>
          )}

          <div className="flex flex-col gap-3">
            {data.orders.map((o) => (
              <div key={o.id} className="border border-cream/15 p-3">
                <div className="flex justify-between font-mono text-sm text-cream">
                  <span>
                    #{o.order_number} · {new Date(o.created_at).toLocaleString()}
                  </span>
                  <span>{rupees(o.total_paise)}</span>
                </div>
                <ul className="mt-2 font-mono text-xs text-cream/70 flex flex-col gap-0.5">
                  {o.items.map((it: any, idx: number) => (
                    <li key={idx} className="flex justify-between">
                      <span>{it.quantity}× {it.name_snapshot}</span>
                      <span>{rupees(it.unit_price_paise_snapshot * it.quantity)}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex justify-between font-mono text-xs text-cream/40 uppercase">
                  <span>{o.payment_method}</span>
                  <span>
                    {o.points_earned > 0 && `+${o.points_earned}`}
                    {o.points_redeemed > 0 && ` -${o.points_redeemed}`} pts
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Menu() {
  const [rows, setRows] = useState<any[]>([]);
  const load = () => api.adminMenu().then((d) => setRows(d.items)).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  async function save(item: any, patch: any) {
    await api.updateMenu(item.id, { ...item, ...patch });
    load();
  }
  return (
    <table className="w-full font-mono text-sm text-cream/80">
      <thead className="text-cream/40 text-left">
        <tr><th>ID</th><th>Name</th><th>Tier</th><th>Price (paise)</th><th>Available</th></tr>
      </thead>
      <tbody>
        {rows.map((it) => (
          <tr key={it.id} className="border-t border-cream/10">
            <td>{it.id}</td>
            <td>{it.name}</td>
            <td>{it.tier || '—'}</td>
            <td>
              <input
                defaultValue={it.price_paise ?? ''}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  save(it, { price_paise: v === '' ? null : parseInt(v, 10) });
                }}
                className="w-24 bg-transparent border border-cream/20 px-2 py-1 text-cream"
              />
            </td>
            <td>
              <input
                type="checkbox"
                checked={!!it.is_available}
                onChange={(e) => save(it, { is_available: e.target.checked })}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const TYPE_LABEL: Record<string, string> = { whey: 'Whey', yeast: 'Yeast', plant: 'Plant-based' };

function Stock() {
  const [brands, setBrands] = useState<any[]>([]);
  const [options, setOptions] = useState<any[]>([]);
  const [restockGrams, setRestockGrams] = useState<Record<string, string>>({});
  const [newBrand, setNewBrand] = useState({ id: '', name: '', protein_type: 'whey' });
  const [error, setError] = useState('');

  const load = () =>
    api
      .stock()
      .then((d) => {
        setBrands(d.brands);
        setOptions(d.amount_options);
      })
      .catch(() => {});
  useEffect(() => {
    load();
  }, []);

  async function doRestock(id: string) {
    const grams = Number(restockGrams[id]);
    if (!grams) return;
    setError('');
    try {
      await api.restock(id, grams);
      setRestockGrams((s) => ({ ...s, [id]: '' }));
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function toggleActive(b: any) {
    await api.updateStockBrand(b.id, { is_active: !b.is_active });
    load();
  }

  async function createBrand() {
    setError('');
    try {
      await api.createStockBrand(newBrand);
      setNewBrand({ id: '', name: '', protein_type: 'whey' });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function savePrice(grams: number, price_paise: number) {
    await api.updateProteinOptionPrice(grams, price_paise);
    load();
  }

  return (
    <div className="flex flex-col gap-8">
      {error && <p className="font-body text-sm text-red">{error}</p>}

      <div>
        <h2 className="font-body uppercase text-xs tracking-widest text-cream/40 mb-3">Protein brands</h2>
        <table className="w-full font-mono text-sm text-cream/80">
          <thead className="text-cream/40 text-left">
            <tr>
              <th>Brand</th><th>Type</th><th>Stock (g)</th><th>Low at (g)</th><th>Restock</th><th>Active</th>
            </tr>
          </thead>
          <tbody>
            {brands.map((b) => {
              const low = b.stock_mg < b.low_stock_threshold_mg;
              return (
                <tr key={b.id} className="border-t border-cream/10">
                  <td>{b.name}</td>
                  <td>{TYPE_LABEL[b.protein_type] || b.protein_type}</td>
                  <td className={low ? 'text-red' : ''}>{(b.stock_mg / 1000).toFixed(1)}</td>
                  <td>{(b.low_stock_threshold_mg / 1000).toFixed(0)}</td>
                  <td>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        placeholder="g"
                        value={restockGrams[b.id] || ''}
                        onChange={(e) => setRestockGrams((s) => ({ ...s, [b.id]: e.target.value }))}
                        className="w-16 bg-transparent border border-cream/20 px-2 py-1 text-cream"
                      />
                      <button
                        onClick={() => doRestock(b.id)}
                        className="px-2 py-1 border border-cream/25 text-cream/70 hover:border-red hover:text-cream"
                      >
                        Add
                      </button>
                    </div>
                  </td>
                  <td>
                    <input type="checkbox" checked={!!b.is_active} onChange={() => toggleActive(b)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div>
        <h2 className="font-body uppercase text-xs tracking-widest text-cream/40 mb-3">Add a brand</h2>
        <div className="flex items-center gap-2">
          <input
            placeholder="id (e.g. levels)"
            value={newBrand.id}
            onChange={(e) => setNewBrand((s) => ({ ...s, id: e.target.value.trim().toLowerCase() }))}
            className="w-32 bg-transparent border border-cream/20 px-2 py-1 font-mono text-sm text-cream"
          />
          <input
            placeholder="Name"
            value={newBrand.name}
            onChange={(e) => setNewBrand((s) => ({ ...s, name: e.target.value }))}
            className="w-40 bg-transparent border border-cream/20 px-2 py-1 font-mono text-sm text-cream"
          />
          <select
            value={newBrand.protein_type}
            onChange={(e) => setNewBrand((s) => ({ ...s, protein_type: e.target.value }))}
            className="bg-ink border border-cream/20 px-2 py-1 font-mono text-sm text-cream"
          >
            <option value="whey">Whey</option>
            <option value="yeast">Yeast</option>
            <option value="plant">Plant-based</option>
          </select>
          <button
            onClick={createBrand}
            disabled={!newBrand.id || !newBrand.name}
            className="px-3 py-1 border border-cream/25 text-cream/70 hover:border-red hover:text-cream disabled:opacity-40"
          >
            Create
          </button>
        </div>
      </div>

      <div>
        <h2 className="font-body uppercase text-xs tracking-widest text-cream/40 mb-3">
          Protein amount pricing (dummy — decide real pricing later)
        </h2>
        <table className="w-full max-w-md font-mono text-sm text-cream/80">
          <thead className="text-cream/40 text-left">
            <tr><th>Grams</th><th>Powder used</th><th>Add-on price</th></tr>
          </thead>
          <tbody>
            {options.map((o) => (
              <tr key={o.grams} className="border-t border-cream/10">
                <td>{o.grams}g</td>
                <td>{(o.powder_mg / 1000).toFixed(1)}g powder</td>
                <td>
                  <input
                    defaultValue={o.price_paise}
                    onBlur={(e) => savePrice(o.grams, parseInt(e.target.value || '0', 10))}
                    className="w-24 bg-transparent border border-cream/20 px-2 py-1 text-cream"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Config() {
  const [cfg, setCfg] = useState<Record<string, string>>({});
  const load = () => api.config().then((d) => setCfg(d.config)).catch(() => setCfg({}));
  useEffect(() => { load(); }, []);
  return (
    <div className="flex flex-col gap-2 max-w-xl">
      {Object.entries(cfg).map(([k, v]) => (
        <label key={k} className="flex items-center gap-3 font-mono text-sm">
          <span className="w-72 text-cream/60">{k}</span>
          <input
            defaultValue={v}
            onBlur={(e) => api.updateConfig({ [k]: e.target.value }).then((d) => setCfg(d.config))}
            className="flex-1 bg-transparent border border-cream/20 px-2 py-1 text-cream"
          />
        </label>
      ))}
      <p className="text-cream/40 text-xs mt-3 font-body">
        Nightly backup: run <code>npm run export-db -- /path/on/usb/backup.sqlite</code> from the repo root.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-2 border-cream/15 p-4">
      <div className="font-body uppercase text-xs tracking-widest text-cream/40">{label}</div>
      <div className="font-display text-3xl text-cream mt-1">{value}</div>
    </div>
  );
}
