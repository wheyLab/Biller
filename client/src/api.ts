export type Tier = 'Caffeinated' | 'Originals' | 'Daily' | 'Signature' | 'Clear Whey';

export interface MenuItem {
  id: string;
  name: string;
  tier: Tier | null;
  price_paise: number | null;
  sort_order: number;
  is_available: boolean;
}

export interface CustomerLookup {
  known: boolean;
  first_name: string | null;
  username: string | null;
  points_balance: number;
  can_redeem: boolean;
  redeem_threshold: number;
  eligible_tiers?: string[];
}

// Whichever identity the customer chose — at most one of these is set.
export interface CustomerIdentity {
  phone: string | null;
  username: string | null;
}

export type ProteinType = 'whey' | 'yeast' | 'plant';

export interface ProteinBrand {
  id: string;
  name: string;
  protein_type: ProteinType;
  in_stock: boolean;
}

export interface ProteinAmountOption {
  grams: number;
  powder_mg: number;
  price_paise: number;
}

export interface ProteinDefault {
  brandId: string;
  grams: number;
}

export interface OrderResult {
  id: number;
  order_number: number;
  subtotal_paise: number;
  discount_paise: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  tax_paise: number;
  total_paise: number;
  points_earned: number;
  points_redeemed: number;
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Something went wrong.');
  return data as T;
}

export const api = {
  menu: () => req<{ items: MenuItem[] }>('/api/menu'),
  lookup: (identifier: string) => req<CustomerLookup>(`/api/customers/${encodeURIComponent(identifier)}`),
  registerCustomer: (identity: CustomerIdentity, first_name: string) =>
    req<CustomerLookup>('/api/customers', {
      method: 'POST',
      body: JSON.stringify({ ...identity, first_name }),
    }),
  checkUsername: (username: string) =>
    req<{ available: boolean; reason?: string }>(`/api/customers/username/check/${encodeURIComponent(username)}`),
  suggestUsernames: (name: string) =>
    req<{ suggestions: string[] }>(`/api/customers/username/suggest?name=${encodeURIComponent(name)}`),
  createOrder: (body: unknown) =>
    req<OrderResult>('/api/orders', { method: 'POST', body: JSON.stringify(body) }),
  bill: (id: number) => req<Record<string, unknown>>(`/api/orders/${id}/bill`),
  protein: () =>
    req<{ brands: ProteinBrand[]; amount_options: ProteinAmountOption[]; default: ProteinDefault }>(
      '/api/protein'
    ),
  // admin
  stock: () => req<any>('/api/admin/stock'),
  createStockBrand: (body: unknown) =>
    req<any>('/api/admin/stock', { method: 'POST', body: JSON.stringify(body) }),
  updateStockBrand: (id: string, body: unknown) =>
    req<any>(`/api/admin/stock/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }),
  restock: (id: string, grams: number) =>
    req<any>(`/api/admin/stock/${encodeURIComponent(id)}/restock`, {
      method: 'POST',
      body: JSON.stringify({ grams }),
    }),
  updateProteinOptionPrice: (grams: number, price_paise: number) =>
    req<any>(`/api/admin/protein-options/${grams}`, { method: 'PUT', body: JSON.stringify({ price_paise }) }),
  summary: (date?: string) => req<any>(`/api/admin/summary${date ? `?date=${date}` : ''}`),
  orders: () => req<any>('/api/admin/orders'),
  customers: () => req<any>('/api/admin/customers'),
  customerOrders: (id: number) => req<any>(`/api/admin/customers/${id}/orders`),
  adminMenu: () => req<any>('/api/admin/menu'),
  updateMenu: (id: string, body: unknown) =>
    req<any>(`/api/admin/menu/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  config: () => req<any>('/api/admin/config'),
  updateConfig: (body: unknown) =>
    req<any>('/api/admin/config', { method: 'PUT', body: JSON.stringify(body) }),
};

export const rupees = (paise: number): string => {
  const sign = paise < 0 ? '-' : '';
  return `${sign}\u20B9${(Math.abs(paise) / 100).toFixed(2)}`;
};
