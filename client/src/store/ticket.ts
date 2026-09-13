import { useSyncExternalStore } from 'react';

// One small store for the running ticket. Lines are keyed by menu item id.
// Every line carries its own protein brand + amount (all units of that item
// in this order share one choice — ordering the same smoothie twice with two
// different brands is just two different line items in practice).
// Customer / payment selection stays in component state; this only holds the cart.
export interface TicketLine {
  quantity: number;
  proteinBrandId: string;
  proteinGrams: number;
}

export interface TicketState {
  lines: Record<string, TicketLine>;
}

let state: TicketState = { lines: {} };
const listeners = new Set<() => void>();

function emit() {
  state = { lines: { ...state.lines } };
  listeners.forEach((l) => l());
}

export const ticket = {
  add(id: string, defaultBrandId: string, defaultGrams: number) {
    const existing = state.lines[id];
    state.lines[id] = existing
      ? { ...existing, quantity: existing.quantity + 1 }
      : { quantity: 1, proteinBrandId: defaultBrandId, proteinGrams: defaultGrams };
    emit();
  },
  dec(id: string) {
    const existing = state.lines[id];
    if (!existing) return;
    const next = existing.quantity - 1;
    if (next <= 0) delete state.lines[id];
    else state.lines[id] = { ...existing, quantity: next };
    emit();
  },
  remove(id: string) {
    delete state.lines[id];
    emit();
  },
  setProtein(id: string, proteinBrandId: string, proteinGrams: number) {
    const existing = state.lines[id];
    if (!existing) return;
    state.lines[id] = { ...existing, proteinBrandId, proteinGrams };
    emit();
  },
  clear() {
    state.lines = {};
    emit();
  },
};

export function useTicket(): TicketState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state
  );
}
