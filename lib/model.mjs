export const TYPE_LABELS = {
  manche_cdf: "Manche de Coupe de France",
  championnat_france: "Championnat de France",
  championnat_regional: "Championnat régional",
  championnat_interregional: "Championnat inter-régional",
  championnat_departemental: "Championnat départemental",
  championnat_monde: "Championnat du monde",
  open: "Open / compétition de club",
  non_classe: "Type à confirmer",
};
export const normalize = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/œ/g, "oe")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
export function safeUrl(value, base) {
  try {
    const u = new URL(String(value ?? "").trim(), base);
    return ["http:", "https:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export const validCoordinates = (p) =>
  !!p &&
  Number.isFinite(p.lat) &&
  Number.isFinite(p.lon) &&
  Math.abs(p.lat) <= 90 &&
  Math.abs(p.lon) <= 180;
export function haversineKm(lat1, lon1, lat2, lon2) {
  const r = (d) => (d * Math.PI) / 180;
  const a =
    Math.sin(r(lat2 - lat1) / 2) ** 2 +
    Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, a))));
}
export function distanceToEvent(home, ev) {
  if (!validCoordinates(home)) return null;
  const points = (ev.locations?.length ? ev.locations : [ev]).filter(
    validCoordinates,
  );
  return points.length
    ? Math.min(
        ...points.map((p) => haversineKm(home.lat, home.lon, p.lat, p.lon)),
      )
    : null;
}
export function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s ?? "")) return false;
  const d = new Date(s + "T12:00:00Z");
  return (
    !Number.isNaN(d.valueOf()) &&
    d.toISOString().slice(0, 10) === s &&
    Number(s.slice(0, 4)) >= 2000
  );
}
export function addDays(iso, n) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function todayISO(now = new Date(), timeZone = "Europe/Paris") {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (k) => p.find((x) => x.type === k).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export const isPast = (ev, today = todayISO()) =>
  !!(ev.end || ev.start) && (ev.end || ev.start) < today;
export function filterEvents(events, state, today = todayISO()) {
  return events
    .filter(
      (e) =>
        (!state.fed || state.fed === "all" || e.federation === state.fed) &&
        (!state.type || state.type === "all" || e.type === state.type) &&
        (!state.selective || e.level === "selective") &&
        (!state.discipline ||
          state.discipline === "all" ||
          e.disciplines?.includes(state.discipline)) &&
        (!state.query ||
          normalize(`${e.name} ${e.city} ${e.department} ${e.venue}`).includes(
            normalize(state.query),
          )) &&
        (state.showPast || !isPast(e, today)) &&
        (state.scope !== "france" || e.country === "FR"),
    )
    .map((ev) => ({ ev, d: distanceToEvent(state.home, ev) }))
    .filter(
      (x) => state.scope !== "distance" || x.d === null || x.d <= state.radius,
    )
    .sort((a, b) =>
      state.sort === "distance"
        ? (a.d ?? Infinity) - (b.d ?? Infinity) ||
          (a.ev.start || "9999").localeCompare(b.ev.start || "9999")
        : (a.ev.start || "9999").localeCompare(b.ev.start || "9999") ||
          (a.d ?? Infinity) - (b.d ?? Infinity),
    );
}
export function monitoringHealth(monitoring, now = new Date()) {
  const entries = Object.entries(monitoring?.sources || {});
  const stale =
    !monitoring?.last_run ||
    !Number.isFinite(Date.parse(monitoring.last_run)) ||
    now - new Date(monitoring.last_run) > 48 * 3600000;
  return {
    stale,
    failed: entries
      .filter(([, s]) => s.error || !(s.status >= 200 && s.status < 300))
      .map(([id]) => id),
    pending: entries
      .filter(([, s]) => ("needs_review" in s ? s.needs_review : s.changed))
      .map(([id]) => id),
  };
}
const icsEscape = (s) =>
  String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
function foldLine(line) {
  const lines = [];
  let part = "",
    bytes = 0;
  for (const c of line) {
    const n = new TextEncoder().encode(c).length;
    if (bytes + n > 75) {
      lines.push(part);
      part = " ";
      bytes = 1;
    }
    part += c;
    bytes += n;
  }
  return [...lines, part].join("\r\n");
}
export function calendarICS(events, stamp = new Date().toISOString()) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Apnee Competitions//FR",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:Apnée Compétitions France",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
  ];
  for (const e of events.filter((e) => validDate(e.start))) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${icsEscape(e.id)}@apnee-competitions`,
      `DTSTAMP:${stamp.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`,
      `DTSTART;VALUE=DATE:${e.start.replaceAll("-", "")}`,
      `DTEND;VALUE=DATE:${addDays(e.end || e.start, 1).replaceAll("-", "")}`,
      `SUMMARY:${icsEscape(e.name)}`,
      `LOCATION:${icsEscape([e.venue, e.city, e.department].filter(Boolean).join(", "))}`,
      `DESCRIPTION:${icsEscape([e.notes, ...(e.review_notes || []), e.info_url].filter(Boolean).join("\n"))}`,
      `URL:${safeUrl(e.info_url) || ""}`,
      `STATUS:${e.cancelled ? "CANCELLED" : e.availability === "missing" || e.date_status === "review" ? "TENTATIVE" : "CONFIRMED"}`,
      `SEQUENCE:${e.revision || 0}`,
      "END:VEVENT",
    );
  }
  return [...lines, "END:VCALENDAR", ""].map(foldLine).join("\r\n");
}
export function validateDataset(data) {
  const errors = [],
    ids = new Set(),
    sources = new Set((data.sources || []).map((s) => s.id));
  if (!Array.isArray(data.events) || !Array.isArray(data.sources))
    return ["events/sources doivent être des listes"];
  for (const e of data.events) {
    const fail = (m) => errors.push(`${e.id || "?"}: ${m}`);
    if (!e.id || ids.has(e.id)) fail("identifiant manquant ou dupliqué");
    ids.add(e.id);
    if (
      !e.name ||
      !["FFESSM", "AIDA"].includes(e.federation) ||
      !TYPE_LABELS[e.type]
    )
      fail("nom/fédération/type invalide");
    if (!sources.has(e.source_id)) fail("source inconnue");
    if (
      (e.start && !validDate(e.start)) ||
      (e.end && (!validDate(e.end) || !e.start || e.end < e.start))
    )
      fail("dates invalides");
    if ((e.lat != null || e.lon != null) && !validCoordinates(e))
      fail("coordonnées invalides");
    if (
      e.commune_code &&
      e.department &&
      !e.commune_code.startsWith(e.department)
    )
      fail("commune et département incohérents");
    if (!safeUrl(e.info_url) || !safeUrl(e.source_url)) fail("URL invalide");
    if (!validDate(e.verified_on)) fail("date de vérification invalide");
  }
  return errors;
}
