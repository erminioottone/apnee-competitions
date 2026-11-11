import { readFile } from "node:fs/promises";
import {
  validateDataset,
  validCoordinates,
  haversineKm,
} from "../lib/model.mjs";
const data = JSON.parse(
  await readFile(new URL("../events.json", import.meta.url), "utf8"),
);
const cache = JSON.parse(
  await readFile(new URL("../data/locations.json", import.meta.url), "utf8"),
);
const errors = validateDataset(data);
for (const e of data.events.filter(
  (e) => e.country === "FR" && e.commune_code && validCoordinates(e),
)) {
  const ref = Object.values(cache).find(
    (l) => l.commune_code === e.commune_code,
  );
  if (ref && haversineKm(e.lat, e.lon, ref.lat, ref.lon) > 15)
    errors.push(`${e.id}: coordonnées éloignées de la commune déclarée`);
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `${data.events.length} événements : schéma, dates, URL, départements et coordonnées validés.`,
  );
