import test from "node:test";
import assert from "node:assert/strict";
import {
  inferEndDate,
  parseCSV,
  frenchDate,
  normalizeDepartment,
  organizerUrl,
  readDeclarations,
  extractStructuredEvents,
  semanticHTML,
  pageDateEvidence,
} from "../scripts/lib/importer.mjs";
test("French explicit multi-day ranges and durations", () => {
  for (const [start, text, end] of [
    [
      "2026-11-28",
      "Compétition sur 2 jours (28-29 novembre 2026)",
      "2026-11-29",
    ],
    [
      "2027-04-03",
      "La compétition aura lieu les 3 & 4 avril 2027.",
      "2027-04-04",
    ],
    [
      "2027-02-12",
      "Vendredi 12 au soir et samedi 13 fin d’après-midi Février 2027",
      "2027-02-13",
    ],
    ["2027-04-03", "3 avril 16h au 4 avril 19h.", "2027-04-04"],
    ["2026-12-31", "du 31 décembre 2026 au 1 janvier 2027", "2027-01-01"],
    ["2027-02-28", "Compétition sur deux jours", "2027-03-01"],
    ["2028-02-28", "Compétition sur 3 jours", "2028-03-01"],
  ])
    assert.equal(inferEndDate(start, text).end, end, text);
});
test("Conflicting months are flagged, hours are not dates", () => {
  assert.match(
    inferEndDate(
      "2027-04-02",
      "vendredi 02 soir et samedi 03 fin d’après-midi Mars 2027",
    ).review,
    /correspondent/,
  );
  for (const s of [
    "Compétition de 13h à 19h",
    "8x50m, 4x50m, 2x50m",
    "Compétition sur une seule journée",
    "Piscine de 25 m, profondeur 2 m",
  ])
    assert.equal(inferEndDate("2027-04-03", s).end, null);
  assert.equal(frenchDate("28/03/0207"), null);
  assert.equal(frenchDate("31/04/2027"), null);
  assert.equal(frenchDate("29/02/2028"), "2028-02-29");
});
test("CSV handles BOM, escaped quotes, CRLF and multiline fields", () => {
  assert.deepEqual(parseCSV('\uFEFFa,b\r\n"two\nlines","say ""hello"""\r\n'), [
    ["a", "b"],
    ["two\nlines", 'say "hello"'],
  ]);
  assert.throws(() => parseCSV('a,"truncated'), /tronqué/);
  assert.throws(() => readDeclarations("<html>Failure</html>"), /schéma/);
});
test("Department normalization and safe organizer links", () => {
  assert.equal(normalizeDepartment("006"), "06");
  assert.equal(normalizeDepartment("083"), "83");
  assert.equal(normalizeDepartment("02B"), "2B");
  assert.equal(organizerUrl("WWW.orquoise.org"), "https://www.orquoise.org/");
  assert.equal(organizerUrl("Site Apnéa NC"), null);
  assert.equal(organizerUrl("javascript:alert(1)"), null);
});
test("Only Event structured data is imported, never article publication dates", () => {
  const h =
    '<script type="application/ld+json">{"@graph":[{"@type":"Article","datePublished":"2027-04-03"},{"@type":"SportsEvent","name":"AIDA","startDate":"2027-04-03"}]}</script>';
  assert.equal(extractStructuredEvents(h).length, 1);
  assert.equal(
    semanticHTML("<script>random</script><p>Dates &amp; lieux</p>"),
    "Dates & lieux",
  );
});
test("Registration deadlines cannot extend an event", () => {
  assert.equal(
    inferEndDate(
      "2027-04-03",
      "Compétition les 3 et 4 avril 2027. Inscriptions avant le 20 avril 2027.",
    ).end,
    "2027-04-04",
  );
});
test("Regional pages supply missing end dates only for the matching city", () => {
  const html =
    "<p>23 et 24 janvier 2027 – Compétition d’apnée de Massy, Manche de Coupe de France</p><p>Stage initial à Massy les 23 et 25 janvier 2027</p><p>26 et 27 janvier 2027 – Melun</p>";
  assert.deepEqual(
    pageDateEvidence({ city: "Massy", start: "2027-01-23" }, html).map(
      (e) => e.end,
    ),
    ["2027-01-24"],
  );
  assert.deepEqual(
    pageDateEvidence({ city: "Paris", start: "2027-01-23" }, html),
    [],
  );
});
