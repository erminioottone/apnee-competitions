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
  sourceFingerprintHTML,
  pageDateEvidence,
  extractTextEvent,
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
test("Unrelated training dates cannot extend a competition", () => {
  for (const text of [
    "Compétition les 3 et 4 avril 2027. Entraînement au club le 20 avril 2027.",
    "Compétition les 3 et 4 avril 2027, entraînement au club le 20 avril 2027.",
    "Compétition les 3 et 4 avril 2027. Entraînement les 20 et 21 avril 2027.",
    "Compétition du 03/04/2027 au 04/04/2027. Assemblée le 20/04/2027.",
  ]) assert.equal(inferEndDate("2027-04-03", text).end, "2027-04-04", text);
  assert.ok(inferEndDate("2027-04-03", "Du 3 au 4 avril 2027 ou du 3 au 5 avril 2027").review);
  assert.ok(inferEndDate("2027-04-30", "Du 30 au 31 avril 2027").review);
});
test("Text announcements use the event year, never the publication date", () => {
  const places = [{ city: "Nice", commune_code: "06088", department: "06" }];
  const html = '<h1>Coupe du NUC 2027</h1><main><time>23 novembre 2026</time><div>Nice accueille une compétition AIDA indoor le 20 février.</div><div>Inscription avant le 10 février 2027.</div></main><footer>Paris, le 12 mars 2027</footer>';
  const parsed = extractTextEvent(html, "https://example.com/nuc", places);
  assert.equal(parsed.event.startDate, "2027-02-20");
  assert.equal(parsed.event.location.address.addressLocality, "Nice");
  assert.ok(!parsed.event.__text_evidence.includes("Inscription"));
  assert.equal(extractTextEvent(html.replace("NUC 2027", "NUC"), "https://example.com/nuc", places).event, null);
  assert.equal(extractTextEvent(html.replace("20 février", "31 février"), "https://example.com/nuc", places).event, null);
  assert.equal(extractTextEvent(html, "https://example.com/nuc", []).event, null);
  assert.ok(extractTextEvent(html.replace("Nice accueille", "Nice et Paris accueillent"), "https://example.com/nuc", [...places, { city: "Paris", commune_code: "75056" }]).issue);
  assert.equal(extractTextEvent(html.replace("Coupe du NUC 2027", "Modalités de sélection Indoor 2027"), "https://example.com/nuc", places).issue, null);
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
test("Replacement posters and PDF links change the source fingerprint", () => {
  const a =
    '<p>Calendrier</p><a href="season-1.pdf">Télécharger</a><img src="poster-1.jpg"><script>randomA</script>';
  assert.notEqual(
    sourceFingerprintHTML(a),
    sourceFingerprintHTML(a.replace("season-1.pdf", "season-2.pdf")),
  );
  assert.notEqual(
    sourceFingerprintHTML(a),
    sourceFingerprintHTML(a.replace("poster-1.jpg", "poster-2.jpg")),
  );
  assert.equal(
    sourceFingerprintHTML(a),
    sourceFingerprintHTML(a.replace("randomA", "randomB")),
  );
});
