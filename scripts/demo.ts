// npm run demo — two customers order on WhatsApp, in practice mode (nothing
// is sent). Writes docs/demo-chat.html, a WhatsApp-style transcript.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { handle, runReminders, type Config, type Out } from "../src/agent.ts";
import { memoryStore } from "../src/store.ts";
import { makeProviders } from "../src/providers.ts";

const cfg: Config = JSON.parse(readFileSync(new URL("../config/branches.json", import.meta.url), "utf8"));
const store = memoryStore();
const p = makeProviders({});
let now = new Date("2026-07-02T10:00:00+05:00");
type Line = { who: "customer" | "agent" | "branch" | "note"; text: string; at: string; to?: string };
const log: Line[] = [];
const t = () => now.toISOString().slice(11, 16);
const AYESHA = "+92 3XX XXX 0101", BILAL = "+92 3XX XXX 0202"; // masked: sample customers

async function says(from: string, text?: string, imageId?: string) {
  log.push({ who: "customer", text: imageId ? "📷 Prescription photo" + (text ? ` · ${text}` : "") : text!, at: t(), to: from });
  now = new Date(now.getTime() + 40e3);
  for (const o of await handle(cfg, store, p, { from, text, imageId }, now)) push(o, from);
  now = new Date(now.getTime() + 20e3);
}
function push(o: Out, customer: string) {
  const branch = cfg.branches.find(b => b.whatsapp === o.to);
  log.push({ who: branch ? "branch" : "agent", text: o.text, at: t(), to: branch ? branch.name : customer });
  console.log(`${branch ? "  → " + branch.name : "  agent"}: ${o.text.split("\n")[0]}`);
}

console.log("Pharmacy WhatsApp agent — practice mode\n");
log.push({ who: "note", text: "Ayesha orders for her mother", at: t(), to: AYESHA });
await says(AYESHA, "Assalam o alaikum");
await says(AYESHA, "johar town");
await says(AYESHA, "2 panadol extra, metformin 500 one strip, augmentin 625");
await says(AYESHA, undefined, "img-7781");
await says(AYESHA, "can i take panadol with metformin?");
await says(AYESHA, "House 41, Block G, Johar Town, near the mosque");
await says(AYESHA, "1");

log.push({ who: "note", text: "Bilal sends a prescription", at: t(), to: BILAL });
await says(BILAL, "hi");
await says(BILAL, "2");
await says(BILAL, undefined, "img-9032");
await says(BILAL, "Street 7, Phase 5 DHA, house 112");
await says(BILAL, "1");

now = new Date(now.getTime() + 27 * 864e5);
log.push({ who: "note", text: "27 days later: the daily refill check", at: t(), to: AYESHA });
for (const o of await runReminders(store, now)) push(o, o.to);
await says(AYESHA, "refill");
await says(AYESHA, "1");

console.log(`\n${store.data.orders.length} orders placed, ${log.filter(l => l.who === "branch").length} branch tickets, 0 messages actually sent (practice mode).`);

const esc = (s: string) => s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!)).replace(/\n/g, "<br>");
const chat = (who: string) => log.filter(l => l.to === who).map(l => l.who === "note"
  ? `<div class="note">${esc(l.text)}</div>`
  : `<div class="b ${l.who === "customer" ? "me" : "them"}">${esc(l.text)}<span>${l.at}</span></div>`).join("");
const tickets = log.filter(l => l.who === "branch").map(l => `<div class="ticket"><b>${esc(l.to!)}</b><div>${esc(l.text)}</div></div>`).join("");
mkdirSync("docs", { recursive: true });
writeFileSync("docs/demo-chat.html", `<!doctype html><meta charset="utf-8"><title>Pharmacy WhatsApp agent</title><style>
body{margin:0;font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f0ebe3;display:flex;gap:22px;padding:24px;align-items:flex-start}
.phone{width:380px;background:#efe7dd;border-radius:22px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,.18);border:8px solid #1d1d1f}
.top{background:#075e54;color:#fff;padding:12px 14px;font-weight:600}.top small{display:block;font-weight:400;opacity:.8}
.feed{padding:12px 10px;display:flex;flex-direction:column;gap:6px}
.b{max-width:82%;padding:7px 9px 16px;border-radius:8px;position:relative;box-shadow:0 1px .5px rgba(0,0,0,.13);font-size:13.2px}
.b span{position:absolute;right:7px;bottom:3px;font-size:10px;color:#667781}.me{align-self:flex-end;background:#d9fdd3}.them{align-self:flex-start;background:#fff}
.note{align-self:center;background:#fff3c4;color:#54656f;font-size:11.5px;padding:4px 10px;border-radius:7px;margin:6px 0}
.side{width:360px}.side h3{margin:4px 0 10px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#54656f}
.ticket{background:#fff;border-left:4px solid #25d366;border-radius:8px;padding:10px 12px;margin-bottom:12px;font:12px/1.45 ui-monospace,Menlo,monospace;box-shadow:0 1px 2px rgba(0,0,0,.08)}
.ticket b{display:block;font:600 13px -apple-system,sans-serif;margin-bottom:4px}
.mode{background:#fff;border-radius:8px;padding:10px 12px;font-size:12.5px;margin-bottom:14px}
</style><div class="phone"><div class="top">Pharmacy · Delivery orders<small>${AYESHA} · Ayesha</small></div><div class="feed">${chat(AYESHA)}</div></div>
<div class="phone"><div class="top">Pharmacy · Delivery orders<small>${BILAL} · Bilal</small></div><div class="feed">${chat(BILAL)}</div></div>
<div class="side"><div class="mode"><b>Practice mode.</b> llm: ${p.mode.llm} · whatsapp: ${p.mode.whatsapp}. Nothing was sent; this is what would have gone out.</div><h3>Tickets sent to branches</h3>${tickets}</div>`);
console.log("Wrote docs/demo-chat.html");
