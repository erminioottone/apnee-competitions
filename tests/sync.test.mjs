import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { monitorEntry, updateData } from "../scripts/update-data.mjs";
test("Review warnings persist until acknowledgement; failures keep good hashes", () => {
  const a = monitorEntry(
    { hash: "old" },
    { hash: "new", status: 200, url: "https://example.com" },
    "now",
  );
  assert.equal(a.needs_review, true);
  const b = monitorEntry(
    a,
    { hash: "new", status: 200, url: "https://example.com" },
    "later",
  );
  assert.equal(b.changed, false);
  assert.equal(b.needs_review, true);
  assert.equal(
    monitorEntry(b, { hash: "new", status: 200 }, "later", "new").needs_review,
    false,
  );
  assert.equal(monitorEntry(b, { error: "timeout" }, "later").hash, "new");
  assert.equal(monitorEntry(b, { error: "timeout" }, "later").status, 0);
});
test("Import is repeatable; end dates update; source failure preserves records", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "apnee-sync-test-"));
  await mkdir(path.join(dir, "data"));
  const source = {
    id: "ffessm-declarations",
    name: "FFESSM",
    url: "https://example.com/gviz/tq?tqx=out:csv",
    adapter: "ffessm_csv",
    monitor: true,
  };
  const config = {
    disclaimer: "test",
    minimum_source_rows: 1,
    sources: [source],
    overrides: {},
    city_aliases: {},
  };
  const header = [
    "Horodateur",
    "Nom de l'organisateur",
    "Nom du Club ou OD organisateur",
    "Numéro FFESSM du Club ou OD organisateur",
    "Email",
    "Téléphone",
    "Comité Départemental de l'organisateur",
    "Région",
    "Nom de la compétition",
    "Date de début de la compétition",
    "Ville de la compétition",
    "Type de compétition",
    "Nom de la piscine",
    "Compétition inclusive (pouvant accueillir des compétiteurs en situation de handicap)",
    "HandiSub",
    "Niveau de la compétition",
    "Site internet de la compétition",
    "Taille du bassin",
    "Profondeur mini du bassin",
    "Epreuves proposées",
    "Commentaires",
  ];
  const r = [
    "2026-09-01",
    "PRIVATE NAME",
    "Club",
    "01-01-01",
    "PRIVATE EMAIL",
    "PRIVATE PHONE",
    "083",
    "Sud",
    "Test apnée",
    "03/04/2027",
    "Saint-Raphaël",
    "Championnat Régional",
    "Pool",
    "",
    "",
    "Sélective",
    "example.com",
    "50m",
    "2",
    "Statique",
    "3 et 4 avril 2027",
  ];
  const csv = () =>
    [header, r]
      .map((row) =>
        row.map((x) => '"' + x.replaceAll('"', '""') + '"').join(","),
      )
      .join("\n");
  await writeFile(path.join(dir, "data/config.json"), JSON.stringify(config));
  await writeFile(path.join(dir, "data/manual-events.json"), "[]");
  await writeFile(
    path.join(dir, "data/locations.json"),
    JSON.stringify({
      "saintraphael:83": {
        city: "Saint-Raphaël",
        department: "83",
        commune_code: "83118",
        lat: 43.4252,
        lon: 6.7684,
        verified_on: "2026-11-11",
      },
    }),
  );
  let failed = false;
  const fetcher = async () => {
    if (failed) throw new Error("offline");
    return { ok: true, status: 200, text: async () => csv() };
  };
  try {
    const first = await updateData({
      directory: dir,
      fetcher,
      now: "2026-11-11T06:00:00Z",
    });
    assert.equal(first.data.events[0].end, "2027-04-04");
    assert.equal(first.data.events[0].level, "selective");
    assert.equal(first.data.events[0].type, "championnat_regional");
    assert.ok(!JSON.stringify(first.data).includes("PRIVATE"));
    const again = await updateData({
      directory: dir,
      fetcher,
      now: "2026-11-11T12:00:00Z",
    });
    assert.equal(again.status.import.changes, 0);
    assert.equal(again.data.dataset_version, first.data.dataset_version);
    r[20] = "3 et 5 avril 2027";
    const updated = await updateData({
      directory: dir,
      fetcher,
      now: "2026-11-11T18:00:00Z",
    });
    assert.equal(updated.data.events[0].id, first.data.events[0].id);
    assert.equal(updated.data.events[0].end, "2027-04-05");
    failed = true;
    const offline = await updateData({
      directory: dir,
      fetcher,
      now: "2026-11-12T00:00:00Z",
    });
    assert.equal(offline.data.events[0].end, "2027-04-05");
    assert.equal(offline.status.import.automatic, false);
    assert.ok(offline.status.sources[source.id].error);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
