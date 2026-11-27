import { createHash } from "node:crypto";
import { normalize, validDate, addDays, safeUrl } from "../../lib/model.mjs";
export const hash = (text) => createHash("sha256").update(text).digest("hex");
export function parseCSV(text) {
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("CSV tronqué : guillemets non fermés");
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  if (rows[0]?.[0]) rows[0][0] = rows[0][0].replace(/^\uFEFF/, "");
  return rows;
}
export function frenchDate(value) {
  const m = String(value)
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const date = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return validDate(date) ? date : null;
}
const MONTHS = [
  "janvier",
  "fevrier",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "aout",
  "septembre",
  "octobre",
  "novembre",
  "decembre",
];
const monthRE = MONTHS.join("|");
const makeDate = (year, month, day) =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const plainFrench = (text) => String(text).normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").toLowerCase();
const weekdayRE = "lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche";
function explicitDateRanges(text, year) {
  const ranges = [];
  const add = (y1, m1, d1, y2, m2, d2) => {
    const first = makeDate(y1, m1, d1);
    const last = makeDate(y2 || (Number(m2) < Number(m1) ? Number(y1) + 1 : y1), m2, d2);
    ranges.push([first, last]);
  };
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:er)?\\s*(?:-|–|au|et|&)\\s*(\\d{1,2})(?:er)?\\s+(${monthRE})(?:\\s+(20\\d{2}))?\\b`, "g"))) {
    const month = MONTHS.indexOf(m[3]) + 1;
    add(m[4] || year, month, m[1], m[4] || year, month, m[2]);
  }
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:er)?\\s+(${monthRE})(?:\\s+(20\\d{2}))?(?:\\s+\\d{1,2}\\s*h(?:\\s*\\d{1,2})?)?\\s*(?:au|et|&|[-–])\\s*(?:(?:${weekdayRE})\\s+)?(\\d{1,2})(?:er)?\\s+(${monthRE})(?:\\s+(20\\d{2}))?`, "g")))
    add(m[3] || year, MONTHS.indexOf(m[2]) + 1, m[1], m[6], MONTHS.indexOf(m[5]) + 1, m[4]);
  for (const m of text.matchAll(new RegExp(`\\b(?:${weekdayRE})\\s+(\\d{1,2})(?:er)?\\b[^.!?;\\n\\d]{0,40}?\\bet\\s+(?:${weekdayRE})\\s+(\\d{1,2})(?:er)?\\b[^.!?;\\n\\d]{0,60}?\\b(${monthRE})(?:\\s+(20\\d{2}))?`, "g"))) {
    const month = MONTHS.indexOf(m[3]) + 1;
    add(m[4] || year, month, m[1], m[4] || year, month, m[2]);
  }
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?\s*(?:au|et|&|[-–])\s*(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?\b/g))
    add(m[3] || year, m[2], m[1], m[6], m[5], m[4]);
  return [...new Map(ranges.map((r) => [r.join("/"), r])).values()];
}
export function inferEndDate(start, comment = "") {
  if (!validDate(start))
    return {
      end: null,
      method: null,
      review: comment ? "Date de début à confirmer." : null,
    };
  const text = plainFrench(comment)
    .replace(
      /\b(?:inscriptions?|date\s+limite|candidatures?|deadline|avant\s+le)\b[^.!?;\n]*/g,
      " ",
    );
  if (
    !text.trim() ||
    /(?:une seule|1 seule|un seul|1 seul) journee?/.test(text)
  )
    return { end: null, method: null, review: null };
  // Match connected date ranges. Collecting every date in a comment can turn
  // an unrelated training date into the end of a competition.
  const ranges = explicitDateRanges(text, Number(start.slice(0, 4)));
  const matching = ranges.filter(([first, last]) => first === start && validDate(last) && last > start && last <= addDays(start, 31));
  const ends = [...new Set(matching.map(([, last]) => last))];
  if (ends.length === 1)
    return { end: ends[0], method: "source_comment_range", review: null };
  const duration = text.match(
    /\b(?:sur|pendant)\s+(\d{1,2}|deux|trois)\s+jours\b/,
  );
  if (ranges.length)
    return {
      end: null,
      method: null,
      review:
        ends.length > 1 ? "Plusieurs dates de fin sont indiquées ; confirmation nécessaire." : "Les dates du commentaire ne correspondent pas à la date de début déclarée.",
    };
  if (duration) {
    const days = { deux: 2, trois: 3 }[duration[1]] || Number(duration[1]);
    if (days >= 2 && days <= 14)
      return {
        end: addDays(start, days - 1),
        method: "source_comment_duration",
        review: null,
      };
  }
  return { end: null, method: null, review: null };
}
export const normalizeDepartment = (value) => {
  const s = String(value ?? "")
    .trim()
    .toUpperCase();
  if (!s) return null;
  if (/^0*2[AB]$/.test(s)) return s.slice(-2);
  return /^\d+$/.test(s) ? String(Number(s)).padStart(2, "0") : s;
};
export function organizerUrl(value) {
  let s = String(value ?? "").trim();
  if (!s || /\s/.test(s)) return null;
  if (!/^https?:\/\//i.test(s)) {
    if (!/^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/.*)?$/i.test(s))
      return null;
    s = "https://" + s;
  }
  return safeUrl(s);
}
export function competitionType(type, name) {
  const s = normalize(type);
  if (s.includes("manchedecoupedefrance")) return "manche_cdf";
  if (s.includes("championnatdefrance")) return "championnat_france";
  if (s.includes("interregional")) return "championnat_interregional";
  if (s.includes("regional")) return "championnat_regional";
  if (s.includes("departemental")) return "championnat_departemental";
  return /open|coupe|contest|challenge|club/.test(normalize(name) + " " + s)
    ? "open"
    : "non_classe";
}
export function disciplines(value) {
  const s = normalize(value),
    out = [];
  if (s.includes("statique")) out.push("STA");
  if (s.includes("bipalmes")) out.push("DYNB");
  if (s.includes("monopalme")) out.push("DYN");
  if (s.includes("sanspalmes")) out.push("DNF");
  if (/\dx\d/.test(s)) out.push("SPRINT");
  return out;
}
export function readDeclarations(text) {
  const rows = parseCSV(text),
    header = (rows.shift() || []).map(normalize);
  const fields = {
    timestamp: "horodateur",
    club: "nomduclubouodorganisateur",
    club_id: "numeroffessmduclubouodorganisateur",
    department: "comitedepartementaldelorganisateur",
    name: "nomdelacompetition",
    start: "datededebutdelacompetition",
    end: "datedefindelacompetition",
    city: "villedelacompetition",
    type: "typedecompetition",
    venue: "nomdelapiscine",
    inclusive:
      "competitioninclusivepouvantaccueillirdescompetiteursensituationdehandicap",
    handi: "handisub",
    level: "niveaudelacompetition",
    url: "siteinternetdelacompetition",
    length: "tailledubassin",
    depth: "profondeurminidubassin",
    disciplines: "epreuvesproposees",
    comment: "commentaires",
  };
  const indexes = Object.fromEntries(
    Object.entries(fields).map(([k, v]) => [k, header.indexOf(v)]),
  );
  if (
    [
      "timestamp",
      "club",
      "club_id",
      "name",
      "start",
      "city",
      "type",
      "level",
      "comment",
    ].some((k) => indexes[k] < 0)
  )
    throw new Error(
      "Le schéma de la feuille FFESSM a changé ; import suspendu.",
    );
  return rows
    .map((r) =>
      Object.fromEntries(
        Object.entries(indexes).map(([k, i]) => [
          k,
          i < 0 ? "" : String(r[i] || "").trim(),
        ]),
      ),
    )
    .filter((r) => r.name)
    .map((r) => ({
      key: "ffessm:" + hash(`${r.timestamp}|${r.club_id}`).slice(0, 20),
      name: r.name,
      start: frenchDate(r.start),
      end: frenchDate(r.end),
      raw_date: r.start,
      raw_end: r.end,
      city: r.city || null,
      department: normalizeDepartment(r.department),
      organizer: r.club,
      type: competitionType(r.type, r.name),
      level: normalize(r.level).includes("selective")
        ? "selective"
        : normalize(r.level).includes("formatlibre")
          ? "free"
          : "unknown",
      venue: r.venue || null,
      info_url: organizerUrl(r.url),
      comment: r.comment,
      disciplines: disciplines(r.disciplines),
      pool_length: r.length.replace(/\s*m$/i, ""),
      pool_depth: r.depth,
      events_text: r.disciplines,
      inclusive: /^oui/i.test(r.inclusive) || /^x$/i.test(r.handi),
      fingerprint: hash(JSON.stringify(r)),
    }));
}
export function decodeHTML(s) {
  return String(s)
    .replace(/&nbsp;/g, " ")
    .replace(/&[lr]squo;/g, "'")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCodePoint(parseInt(n, 16)),
    );
}
export function semanticHTML(html) {
  return decodeHTML(
    html
      .replace(/<(script|style|nav|footer|header)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}
export function sourceFingerprintHTML(html) {
  const content = html.replace(
    /<(script|style|nav|footer|header)\b[^>]*>[\s\S]*?<\/\1>/gi,
    " ",
  );
  const references = [
    ...content.matchAll(
      /<(?:a|img|iframe|source)\b[^>]*?(?:href|src)\s*=\s*["']([^"']+)["']/gi,
    ),
  ]
    .map((match) => decodeHTML(match[1]).trim())
    .filter(Boolean);
  return semanticHTML(html) + "\n" + [...new Set(references)].sort().join("\n");
}
export function extractStructuredEvents(html) {
  const out = [];
  const visit = (x) => {
    if (!x || typeof x !== "object") return;
    if (Array.isArray(x)) return x.forEach(visit);
    if ([x["@type"]].flat().some((t) => ["Event", "SportsEvent"].includes(t)))
      out.push(x);
    if (x["@graph"]) visit(x["@graph"]);
    if (x.itemListElement)
      for (const i of x.itemListElement) visit(i.item || i);
  };
  for (const m of html.matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      visit(JSON.parse(m[1]));
    } catch {}
  }
  return out;
}

// Text-only announcements are imported only when their event title, year,
// competition date and a previously verified French commune are unambiguous.
// Article publication dates and arbitrary page/footer dates are never inputs.
export function extractTextEvent(html, url, places = []) {
  const name = semanticHTML(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "");
  if (!/coupe|competition|championnat|contest|challenge|trophee/.test(normalize(name)) ||
      /selection|modalites|resultats|bilan|calendrier/.test(normalize(name)))
    return { event: null, issue: null };
  const body = html.match(/<(?:main|article)\b[^>]*>([\s\S]*?)<\/(?:main|article)>/i)?.[1];
  const issue = (message) => ({ event: null, issue: `${name} : ${message}` });
  if (!body) return issue("contenu de l’annonce à vérifier.");
  const blocks = body.replace(/<time\b[^>]*>[\s\S]*?<\/time>/gi, " ")
    .split(/<\/?(?:p|div|section|h[1-6])\b[^>]*>/gi)
    .map(semanticHTML).filter((s) => /competition|coupe|championnat|accueill|aura lieu|se deroul|rendez.vous/.test(plainFrench(s)));
  const text = plainFrench(blocks.join("\n")).replace(/\b(?:inscriptions?|date\s+limite|candidatures?|deadline|avant\s+le)\b[^.!?;\n]*/g, " ");
  const titleYears = [...new Set(name.match(/\b20\d{2}\b/g) || [])];
  const dates = [];
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:er)?\\s+(${monthRE})(?:\\s+(20\\d{2}))?\\b`, "g"))) {
    const year = m[3] || (titleYears.length === 1 ? titleYears[0] : null);
    if (!year) return issue("année de compétition non précisée.");
    dates.push(makeDate(year, MONTHS.indexOf(m[2]) + 1, m[1]));
  }
  const ranges = explicitDateRanges(text, Number(titleYears[0]));
  const unique = [...new Set([...dates, ...ranges.flat()])].sort();
  if (!unique.length || unique.some((d) => !validDate(d)))
    return issue("date de compétition non exploitable ; confirmation nécessaire.");
  const start = unique[0], inferred = inferEndDate(start, text);
  if (inferred.review || (unique.length > 1 && (!inferred.end || unique.some((d) => d > inferred.end))))
    return issue("plusieurs dates possibles ; confirmation nécessaire.");
  const content = plainFrench(semanticHTML(body));
  const cities = [...new Map(places.filter((p) => p.city && p.commune_code && plainFrench(p.city).length >= 4)
    .filter((p) => {
      const needle = plainFrench(p.city).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[- ]/g, "[- ]");
      return new RegExp(`(?:^|[^a-z])${needle}(?=$|[^a-z])`).test(content);
    }).map((p) => [p.commune_code, p])).values()];
  if (cities.length !== 1) return issue("commune absente ou ambiguë ; confirmation nécessaire.");
  const city = cities[0];
  return { issue: null, event: {
    "@type": "SportsEvent", name, startDate: start, endDate: inferred.end || start, url,
    location: { address: { addressCountry: "FR", addressLocality: city.city }, name: null },
    __text_evidence: blocks.join(" "), __commune: city,
  } };
}

export function pageDateEvidence(event, html) {
  if (!event.start || !event.city) return [];
  const chunks = html
    .replace(/<(script|style|nav|footer|header)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .split(/<\/?(?:li|p|tr|h[1-6])\b[^>]*>|<br\b[^>]*>/gi);
  return [...new Set(chunks.map(semanticHTML))]
    .filter(
      (t) =>
        t.length < 600 &&
        normalize(t).includes(normalize(event.city)) &&
        !/formation|stageinitial|plongeesportive|entrainement/.test(normalize(t)),
    )
    .flatMap((text) => {
      const inferred = inferEndDate(event.start, text);
      return inferred.end ? [{ end: inferred.end, evidence: text }] : [];
    });
}
