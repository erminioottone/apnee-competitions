import test from "node:test";
import assert from "node:assert/strict";
import {
  haversineKm,
  distanceToEvent,
  validCoordinates,
  filterEvents,
  isPast,
  monitoringHealth,
  calendarICS,
  safeUrl,
} from "../lib/model.mjs";
const event = {
  id: "test",
  name: "Apnée Saint-Raphaël",
  federation: "FFESSM",
  type: "championnat_regional",
  level: "selective",
  start: "2027-04-03",
  end: "2027-04-04",
  lat: 43.4252,
  lon: 6.7684,
  city: "Saint-Raphaël",
  country: "FR",
  disciplines: ["STA"],
  info_url: "https://example.com",
  revision: 2,
};
test("Correct Saint-Raphaël coordinates give sensible distances", () => {
  assert.equal(
    Math.round(haversineKm(43.6045, 1.4442, event.lat, event.lon)),
    430,
  );
  assert.equal(
    Math.round(haversineKm(44.8378, -0.5792, event.lat, event.lon)),
    607,
  );
  assert.equal(haversineKm(0, 0, 0, 0), 0);
  assert.ok(Number.isFinite(haversineKm(0, 0, 0, 180)));
});
test("Distances use the closest location and reject invalid saved GPS", () => {
  assert.equal(validCoordinates({ lat: 2 }), false);
  assert.equal(validCoordinates({ lat: NaN, lon: 1 }), false);
  assert.equal(
    distanceToEvent(
      { lat: 0, lon: 0 },
      {
        locations: [
          { lat: 0, lon: 0 },
          { lat: 43, lon: 6 },
        ],
      },
    ),
    0,
  );
});
test("A two-day event remains visible on day two", () => {
  assert.equal(isPast(event, "2027-04-04"), false);
  assert.equal(isPast(event, "2027-04-05"), true);
  assert.equal(
    filterEvents(
      [event],
      { scope: "france", selective: true, showPast: false, query: "raphael" },
      "2027-04-04",
    ).length,
    1,
  );
  assert.equal(
    filterEvents(
      [event],
      { scope: "france", selective: true, discipline: "DNF" },
      "2027-04-04",
    ).length,
    0,
  );
});
test("HTTP errors, stale checks and pending reviews never look healthy", () => {
  const m = {
    last_run: "2026-11-11T06:00:00Z",
    sources: {
      failed: { error: "timeout", status: 0 },
      pending: { status: 200, needs_review: true },
      imported: { status: 200, changed: true, needs_review: false },
    },
  };
  const h = monitoringHealth(m, new Date("2026-11-11T07:00:00Z"));
  assert.deepEqual(h.failed, ["failed"]);
  assert.deepEqual(h.pending, ["pending"]);
  assert.equal(h.stale, false);
  assert.equal(
    monitoringHealth(m, new Date("2026-11-14T00:00:00Z")).stale,
    true,
  );
});
test("Calendar uses exclusive end dates, stable UIDs and escaped UTF-8 lines", () => {
  const s = calendarICS(
    [{ ...event, name: "Apnée, test; " + "é".repeat(100) }],
    "2026-11-11T06:00:00Z",
  );
  assert.match(s, /DTEND;VALUE=DATE:20270405/);
  assert.match(s, /UID:test@apnee-competitions/);
  assert.match(s, /SUMMARY:Apnée\\, test\\;/);
  assert.match(s, /SEQUENCE:2/);
  for (const line of s.split("\r\n"))
    assert.ok(new TextEncoder().encode(line).length <= 75);
  assert.equal(safeUrl("javascript:alert(1)"), null);
});
