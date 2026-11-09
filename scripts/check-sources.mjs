// Daily source monitoring for the static (GitHub Pages) deployment.
// Run manually or via .github/workflows/monitor.yml. Fetches each monitored
// official page, hashes it, compares with the stored hash, and rewrites
// sources-status.json. The workflow commits the file when it changes;
// the site shows a banner when a source changed since the dataset was curated.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const data = JSON.parse(readFileSync(new URL("../events.json", import.meta.url), "utf8"));

let previous = null;
const statusPath = new URL("../sources-status.json", import.meta.url);
if (existsSync(statusPath)) {
  try { previous = JSON.parse(readFileSync(statusPath, "utf8")); } catch { previous = null; }
}
const prevSources = (previous && previous.sources) || {};

const results = {};
for (const s of data.sources.filter(x => x.monitor)) {
  const entry = { url: s.url, checked_at: new Date().toISOString() };
  try {
    const res = await fetch(s.url, {
      headers: {
        "user-agent": "apnee-competitions-monitor/1.0 (unofficial freediving event aggregator for a club; contact via repo owner)"
      },
      redirect: "follow"
    });
    entry.status = res.status;
    const body = await res.text();
    entry.hash = createHash("sha256").update(body).digest("hex");
    const prevHash = prevSources[s.id] ? prevSources[s.id].hash : undefined;
    entry.changed = prevHash === undefined ? null : prevHash !== entry.hash;
  } catch (e) {
    entry.error = String((e && e.message) ? e.message : e);
  }
  results[s.id] = entry;
}

const payload = { last_run: new Date().toISOString(), sources: results };
writeFileSync(statusPath, JSON.stringify(payload, null, 2) + "\n");

for (const [id, e] of Object.entries(results)) {
  console.log(`${id}: status=${e.status ?? "ERR"} changed=${e.changed}${e.error ? " error=" + e.error.slice(0, 60) : ""}`);
}
