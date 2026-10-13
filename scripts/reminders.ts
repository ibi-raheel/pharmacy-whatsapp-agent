// Daily: send refill reminders that are due (schedule with cron).
import { runReminders } from "../src/agent.ts";
import { fileStore } from "../src/store.ts";
import { makeProviders } from "../src/providers.ts";
const p = makeProviders();
for (const o of await runReminders(fileStore())) console.log(o.to, (await p.send(o.to, o.text)).status);
