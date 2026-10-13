// A JSON-file store: enough for one pharmacy's daily volume, and nothing to
// install. Swap for a database (e.g. the pharmacy's Supabase) by
// implementing the same Store interface.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Convo, Order, Store } from "./agent.ts";

type Data = { convos: Record<string, Convo>; orders: (Order & { remindedAt?: string })[] };

export function fileStore(path = "data/store.json"): Store & { data: Data } {
  const data: Data = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { convos: {}, orders: [] };
  const flush = () => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(data, null, 1)); };
  return memoryStore(data, flush);
}

export function memoryStore(data: Data = { convos: {}, orders: [] }, flush: () => void = () => {}): Store & { data: Data } {
  return {
    data,
    async convo(phone) { return data.convos[phone] ?? null; },
    async saveConvo(c) { data.convos[c.phone] = c; flush(); },
    async saveOrder(o) { data.orders.push(o); flush(); },
    async lastOrder(phone) { return [...data.orders].reverse().find(o => o.customer === phone) ?? null; },
    async dueRefills(now) {
      return data.orders.filter(o => o.refillDays && !o.remindedAt
        && now.getTime() - new Date(o.createdAt).getTime() >= (o.refillDays - 3) * 864e5); // 3 days before they run out
    },
    async markReminded(id, at) { const o = data.orders.find(x => x.id === id); if (o) o.remindedAt = at.toISOString(); flush(); },
  };
}
