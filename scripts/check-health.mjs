import { readFile } from "node:fs/promises";
import { monitoringHealth } from "../lib/model.mjs";

const status = JSON.parse(await readFile(process.argv[2] || new URL("../sources-status.json", import.meta.url), "utf8"));
const expectedSources = process.argv[2] ? Object.keys(status.sources || {})
  : JSON.parse(await readFile(new URL("../data/config.json", import.meta.url), "utf8")).sources.filter((s) => s.monitor).map((s) => s.id);
const health = monitoringHealth(status, new Date(), expectedSources);
const annotate = (level, text) => console.log(`::${level}::${text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")}`);
for (const id of health.pending) annotate("warning", `Source à vérifier : ${id}. Consultez review-queue.json.`);
if (status.import?.review_count) annotate("warning", `${status.import.review_count} vérification(s) de dates, de lieux ou d’annonces en attente. Consultez review-queue.json.`);
for (const id of health.failed) annotate("error", `Source inaccessible ou import invalide : ${id}. Les dernières données valides sont conservées.`);
if (health.importFailed) annotate("error", `Import suspendu : ${status.import.error}`);
if (health.stale) annotate("error", "La dernière vérification du calendrier date de plus de 48 heures ou est indisponible.");
if (health.failed.length || health.importFailed || health.stale) process.exitCode = 1;
else console.log(`Sources accessibles ; ${status.import?.review_count ?? health.pending.length} vérification(s) en attente.`);
