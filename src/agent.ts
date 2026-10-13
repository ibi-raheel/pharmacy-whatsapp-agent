// =====================================================================
// The ordering agent: one WhatsApp conversation at a time.
// =====================================================================
// A small state machine, not a free-roaming chatbot: it always knows which
// question it is waiting on, so an order can't skip the delivery area or
// the confirmation. The AI model (when switched on) only does one job,
// turning a messy message ("2 panadol, the blue sugar tablets mom takes")
// into a clean item list. It never answers medical questions; those go to
// the pharmacist.
//
//   new → area → items → (prescription photo, if needed) → address → confirm → placed
//   any time: "menu" starts over · "human" hands over to branch staff ·
//   "refill" repeats the last order
// =====================================================================

import type { Providers } from "./providers.ts";

export type Branch = { id: string; name: string; whatsapp: string; areas: string[] };
export type Config = { branches: Branch[]; rxOnly: string[]; chronic: string[] };
export type Incoming = { from: string; text?: string; imageId?: string };

export type Order = {
  id: string; customer: string; branch: string; area: string; items: string[]; address: string;
  prescription: string | null; refillDays: number | null; status: "placed" | "confirmed" | "delivered"; createdAt: string;
};
export type Convo = {
  phone: string; state: "new" | "area" | "items" | "prescription" | "address" | "confirm" | "human" | "done";
  area?: string; branch?: string; items?: string[]; prescription?: string | null; address?: string; updatedAt: string;
};
export type Store = {
  convo(phone: string): Promise<Convo | null>;
  saveConvo(c: Convo): Promise<void>;
  saveOrder(o: Order): Promise<void>;
  lastOrder(phone: string): Promise<Order | null>;
  dueRefills(now: Date): Promise<Order[]>;
  markReminded(orderId: string, at: Date): Promise<void>;
};
export type Out = { to: string; text: string };

const MEDICAL = /\b(dose|dosage|how many|side effect|safe (to|for)|pregnan|can i take|instead of|interact|mg per)\b/i;
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function routeArea(cfg: Config, text: string): { branch: Branch; area: string } | null {
  const t = norm(text);
  const n = Number(t);
  if (Number.isInteger(n) && n >= 1 && n <= cfg.branches.length) { const b = cfg.branches[n - 1]; return { branch: b, area: b.areas[0] }; }
  for (const b of cfg.branches) for (const a of b.areas) if (t.includes(a)) return { branch: b, area: a };
  return null;
}

export async function parseItems(p: Providers, text: string): Promise<string[]> {
  const ai = await p.llm(
    "Extract the medicines and products a pharmacy customer is ordering. One per line as '<quantity> x <item>'. Keep the customer's own words for anything you can't identify. Output only the list.",
    text);
  const raw = ai ?? text;
  return raw.split(/\n|,|;| and /i).map(s => s.replace(/^[-*•\d.)\s]+(?=\D)/, "").trim()).filter(s => s.length > 1).slice(0, 20);
}

const areaMenu = (cfg: Config) => cfg.branches.map((b, i) => `${i + 1}. ${b.areas.slice(0, 2).map(a => a.replace(/\b\w/g, c => c.toUpperCase())).join(" / ")}`).join("\n");

export async function handle(cfg: Config, store: Store, p: Providers, msg: Incoming, now = new Date()): Promise<Out[]> {
  const out: Out[] = [];
  const say = (text: string) => out.push({ to: msg.from, text });
  const text = (msg.text ?? "").trim();
  let c: Convo = (await store.convo(msg.from)) ?? { phone: msg.from, state: "new", updatedAt: now.toISOString() };
  const save = async (patch: Partial<Convo>) => { c = { ...c, ...patch, updatedAt: now.toISOString() }; await store.saveConvo(c); };
  const branchOf = (id?: string) => cfg.branches.find(b => b.id === id);

  // Commands that work from anywhere
  if (/^(menu|start|hi|hello|salam|assalam)/i.test(text) && c.state !== "human") {
    await save({ state: "area", area: undefined, branch: undefined, items: undefined, prescription: undefined, address: undefined });
    say(`Assalam-o-Alaikum! I'm the pharmacy's ordering assistant. I take delivery orders here, no phone call needed.\n\nWhich area should we deliver to? Reply with a number or your area:\n${areaMenu(cfg)}\n\n(Type "human" any time to talk to our staff, or "refill" to repeat your last order.)`);
    return out;
  }
  if (/^(human|agent|staff|pharmacist)\b/i.test(text)) {
    await save({ state: "human" });
    const b = branchOf(c.branch) ?? cfg.branches[0];
    say(`Connecting you to our ${b.name} team. A pharmacist will reply here shortly.`);
    out.push({ to: b.whatsapp, text: `Customer ${msg.from} asked for a person. Last step: ${c.state}.` });
    return out;
  }
  if (MEDICAL.test(text)) {
    say("That's a question for our pharmacist, and I won't guess on medical advice. Type \"human\" and a pharmacist will answer you here.");
    return out;
  }
  if (/^refill\b/i.test(text)) {
    const last = await store.lastOrder(msg.from);
    if (!last) { say(`I can't find an earlier order for this number. Type "menu" to place a new one.`); return out; }
    await save({ state: "confirm", area: last.area, branch: last.branch, items: last.items, prescription: last.prescription, address: last.address });
    say(confirmText(cfg, c));
    return out;
  }

  switch (c.state) {
    case "human":
      return out; // staff are handling this chat; the agent stays quiet
    case "new":
      return handle(cfg, store, p, { ...msg, text: "menu" }, now);
    case "area": {
      const r = routeArea(cfg, text);
      if (!r) { say(`Sorry, I didn't catch the area. Reply with a number:\n${areaMenu(cfg)}`); break; }
      await save({ state: "items", area: r.area, branch: r.branch.id });
      say(`Great, our ${r.branch.name} delivers to your area. What would you like? Type the medicines (e.g. "2 Panadol, 1 Brufen syrup") or send a photo of the prescription.`);
      break;
    }
    case "items": {
      if (msg.imageId) {
        await save({ state: "address", items: ["As per prescription photo"], prescription: msg.imageId });
        say("Got the prescription photo. Our pharmacist will read it and confirm each item and the price. What's the full delivery address?");
        break;
      }
      const items = await parseItems(p, text);
      if (!items.length) { say("Please type what you need, or send a photo of the prescription."); break; }
      const rx = items.filter(i => cfg.rxOnly.some(r => norm(i).includes(r)));
      await save({ items, state: rx.length ? "prescription" : "address" });
      say(rx.length
        ? `I have:\n${items.map(i => "• " + i).join("\n")}\n\n${rx.join(", ")} needs a prescription. Please send a photo of it.`
        : `I have:\n${items.map(i => "• " + i).join("\n")}\n\nWhat's the full delivery address?`);
      break;
    }
    case "prescription":
      if (!msg.imageId) { say(`I still need a photo of the prescription for ${c.items?.filter(i => cfg.rxOnly.some(r => norm(i).includes(r))).join(", ")}. Or type "human" to talk to the pharmacist.`); break; }
      await save({ prescription: msg.imageId, state: "address" });
      say("Thank you, prescription received. What's the full delivery address?");
      break;
    case "address":
      if (text.length < 8) { say("Please send the full address: house number, street and block."); break; }
      await save({ address: text, state: "confirm" });
      say(confirmText(cfg, c));
      break;
    case "confirm": {
      if (/^2|change|edit/i.test(text)) { await save({ state: "items" }); say("No problem. Type the corrected order, or send a prescription photo."); break; }
      if (!/^1|yes|ok|confirm|haan|ji/i.test(text)) { say(`Reply 1 to place the order, or 2 to change it.`); break; }
      const b = branchOf(c.branch)!;
      const chronic = (c.items ?? []).some(i => cfg.chronic.some(k => norm(i).includes(k)));
      const order: Order = { id: "ORD-" + now.getTime().toString(36).toUpperCase(), customer: msg.from, branch: b.id, area: c.area!, items: c.items!,
        address: c.address!, prescription: c.prescription ?? null, refillDays: chronic ? 30 : null, status: "placed", createdAt: now.toISOString() };
      await store.saveOrder(order);
      await save({ state: "done" });
      say(`Order ${order.id} placed with our ${b.name}. A pharmacist will message you to confirm the price and delivery time.${chronic ? " Since this includes a regular medicine, I'll remind you here when your next refill is due." : ""}`);
      out.push({ to: b.whatsapp, text: branchTicket(order, b) });
      break;
    }
    case "done":
      say(`Your last order is with our team. Type "menu" for a new order, "refill" to repeat it, or "human" to talk to us.`);
      break;
  }
  return out;
}

function confirmText(cfg: Config, c: Convo) {
  const b = cfg.branches.find(x => x.id === c.branch)!;
  return `Please check your order:\n${(c.items ?? []).map(i => "• " + i).join("\n")}${c.prescription ? "\n• Prescription photo attached" : ""}\n\nDeliver to: ${c.address}\nFrom: ${b.name}\n\nReply 1 to place it, or 2 to change it.`;
}

export function branchTicket(o: Order, b: Branch) {
  return [`NEW DELIVERY ORDER ${o.id} · ${b.name}`, `Customer: ${o.customer}`, `Address: ${o.address}`, `Items:`, ...o.items.map(i => `• ${i}`),
    o.prescription ? `Prescription photo: ${o.prescription}` : "No prescription needed", `Confirm price and time with the customer on WhatsApp.`].join("\n");
}

// Run daily: remind customers whose regular medicine is due for a refill.
export async function runReminders(store: Store, now = new Date()): Promise<Out[]> {
  const out: Out[] = [];
  for (const o of await store.dueRefills(now)) {
    out.push({ to: o.customer, text: `Assalam-o-Alaikum! Your refill of ${o.items.slice(0, 2).join(", ")}${o.items.length > 2 ? " and more" : ""} is due. Reply "refill" and we'll deliver the same order again.` });
    await store.markReminded(o.id, now);
  }
  return out;
}
