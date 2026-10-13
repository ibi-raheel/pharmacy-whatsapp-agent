// The WhatsApp Cloud API webhook. Meta calls GET once to verify
// (WHATSAPP_VERIFY_TOKEN), then POSTs every incoming message. Each POST is
// checked against META_APP_SECRET (X-Hub-Signature-256) when it is set.
import { createServer } from "node:http";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { handle, type Config } from "./agent.ts";
import { fileStore } from "./store.ts";
import { makeProviders } from "./providers.ts";

const cfg: Config = JSON.parse(readFileSync(new URL("../config/branches.json", import.meta.url), "utf8"));
const store = fileStore();
const p = makeProviders();
const PORT = Number(process.env.PORT || 8787);

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  if (req.method === "GET" && url.pathname === "/webhook") {
    const ok = url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN;
    res.writeHead(ok ? 200 : 403).end(ok ? url.searchParams.get("hub.challenge") ?? "" : "forbidden");
    return;
  }
  if (req.method === "POST" && url.pathname === "/webhook") {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks);
    const secret = process.env.META_APP_SECRET;
    if (secret) {
      const want = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
      const got = String(req.headers["x-hub-signature-256"] ?? "");
      if (got.length !== want.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))) { res.writeHead(401).end(); return; }
    }
    res.writeHead(200).end("ok"); // answer Meta at once; reply on WhatsApp after
    try {
      const body = JSON.parse(raw.toString("utf8"));
      for (const entry of body.entry ?? []) for (const ch of entry.changes ?? []) for (const m of ch.value?.messages ?? []) {
        const msg = { from: m.from, text: m.text?.body ?? m.image?.caption, imageId: m.image?.id };
        for (const o of await handle(cfg, store, p, msg)) await p.send(o.to, o.text);
      }
    } catch (e) { console.error("[webhook]", e); }
    return;
  }
  res.writeHead(404).end();
}).listen(PORT, () => console.log(`pharmacy agent on :${PORT} (llm: ${p.mode.llm}, whatsapp: ${p.mode.whatsapp})`));
