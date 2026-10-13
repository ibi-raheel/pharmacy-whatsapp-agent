// Outside services. Each switches on only when its keys are present;
// without them it runs in PRACTICE MODE and sends nothing.
//   ANTHROPIC_API_KEY (+ AGENT_MODEL)  → reading messy orders into item lists
//   WHATSAPP_TOKEN + WHATSAPP_PHONE_ID → replying on the WhatsApp Cloud API
export type Providers = {
  mode: { llm: "practice" | "live"; whatsapp: "practice" | "live" };
  llm(system: string, prompt: string): Promise<string | null>;
  send(to: string, text: string): Promise<{ ref: string; status: "practice" | "sent" }>;
};

export function makeProviders(env: Record<string, string | undefined> = process.env): Providers {
  const mode = {
    llm: env.ANTHROPIC_API_KEY ? "live" as const : "practice" as const,
    whatsapp: env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID ? "live" as const : "practice" as const,
  };
  let n = 0;
  return {
    mode,
    async llm(system, prompt) {
      if (mode.llm === "practice") return null;
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: env.AGENT_MODEL || "claude-haiku-5-5", max_tokens: 400, system, messages: [{ role: "user", content: prompt }] }),
      });
      if (!r.ok) throw new Error(`anthropic ${r.status}`);
      const j: any = await r.json();
      return (j.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim() || null;
    },
    async send(to, text) {
      if (mode.whatsapp === "practice") return { ref: `practice-${++n}`, status: "practice" };
      const r = await fetch(`https://graph.facebook.com/v20.0/${env.WHATSAPP_PHONE_ID}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${env.WHATSAPP_TOKEN}` },
        body: JSON.stringify({ messaging_product: "whatsapp", to: to.replace(/\D/g, ""), type: "text", text: { body: text } }),
      });
      const j: any = await r.json();
      if (!r.ok) throw new Error(`whatsapp ${r.status}: ${j.error?.message ?? ""}`);
      return { ref: j.messages?.[0]?.id ?? "sent", status: "sent" };
    },
  };
}
