import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { monitorEntry, updateData, importDeclarations } from "../scripts/update-data.mjs";
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

test("AIDA text imports update stable calendar entries and retain data when ambiguous", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "apnee-aida-test-"));
  await mkdir(path.join(dir, "data"));
  const source = { id: "aida-france", name: "AIDA", url: "https://example.com/news", adapter: "structured_events", text_events: true, federation: "AIDA", monitor: true };
  await writeFile(path.join(dir, "data/config.json"), JSON.stringify({ disclaimer: "test", sources: [source] }));
  await writeFile(path.join(dir, "data/manual-events.json"), "[]");
  await writeFile(path.join(dir, "data/locations.json"), JSON.stringify({ "nice:06": { city: "Nice", department: "06", commune_code: "06088", lat: 43.696, lon: 7.2714, verified_on: "2026-11-11" } }));
  let day = "20";
  const fetcher = async (url) => ({ ok: true, status: 200, text: async () => url === source.url
    ? '<article><a href="https://example.com/nuc">Coupe du NUC 2027</a></article>'
    : `<h1>Coupe du NUC 2027</h1><main><time>23 novembre 2026</time><p>Nice accueille une compétition AIDA indoor le ${day} février.</p></main>` });
  try {
    const first = await updateData({ directory: dir, fetcher, now: "2026-11-27T09:00:00Z" });
    const e = first.data.events[0];
    assert.equal(e.start, "2027-02-20");
    assert.equal(e.date_inference, "source_text_event");
    assert.equal(e.source_url, "https://example.com/nuc");
    assert.match(await readFile(path.join(dir, "calendar.ics"), "utf8"), /DTSTART;VALUE=DATE:20270220/);
    const again = await updateData({ directory: dir, fetcher, now: "2026-11-27T10:00:00Z" });
    assert.equal(again.status.import.changes, 0);
    day = "21";
    const moved = await updateData({ directory: dir, fetcher, now: "2026-11-27T11:00:00Z" });
    assert.equal(moved.data.events[0].id, e.id);
    assert.equal(moved.data.events[0].revision, e.revision + 1);
    assert.equal(moved.data.events[0].start, "2027-02-21");
    day = "31";
    const invalid = await updateData({ directory: dir, fetcher, now: "2026-11-27T12:00:00Z" });
    assert.equal(invalid.data.events[0].start, "2027-02-21");
    assert.equal(invalid.data.events[0].date_status, "review");
    assert.ok(invalid.queue.items.some((i) => /date de compétition/.test(i.message)));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("An explicit single-day correction replaces a previously inferred regional range", async () => {
  const prior = { id: "test", source_key: "ffessm:test", source_id: "ffessm-declarations", name: "Test", city: null, start: "2027-04-03", end: "2027-04-04", date_inference: "source_page_range", source_comment: "", review_notes: [] };
  const row = { key: "ffessm:test", name: "Test", start: "2027-04-03", type: "open", level: "unknown", city: null, department: null, comment: "Compétition sur une seule journée", disciplines: [] };
  const result = await importDeclarations([row], [prior], { active_declarations_url: "https://example.com" }, {}, async () => { throw new Error("No network needed"); }, "2026-11-27T12:00:00Z");
  assert.equal(result.events[0].end, null);
  assert.equal(result.events[0].date_status, "confirmed");
});

test("Health command fails on source outages after status has been saved", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "apnee-health-test-"));
  const file = path.join(dir, "status.json");
  const command = new URL("../scripts/check-health.mjs", import.meta.url).pathname;
  const status = { last_run: new Date().toISOString(), sources: { ffessm: { status: 200, needs_review: true } } };
  try {
    await writeFile(file, JSON.stringify(status));
    const healthy = spawnSync(process.execPath, [command, file], { encoding: "utf8" });
    assert.equal(healthy.status, 0);
    assert.match(healthy.stdout, /::warning::/);
    status.sources.ffessm = { status: 0, error: "offline" };
    status.import = { error: "offline" };
    await writeFile(file, JSON.stringify(status));
    const failed = spawnSync(process.execPath, [command, file], { encoding: "utf8" });
    assert.equal(failed.status, 1);
    assert.match(failed.stdout, /::error::/);
    assert.equal(JSON.parse(await readFile(file, "utf8")).sources.ffessm.error, "offline");
  } finally { await rm(dir, { recursive: true, force: true }); }
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
