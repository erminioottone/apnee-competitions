import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import {
  normalize,
  validCoordinates,
  haversineKm,
  validDate,
  safeUrl,
  calendarICS,
  validateDataset,
} from "../lib/model.mjs";
import {
  hash,
  readDeclarations,
  inferEndDate,
  semanticHTML,
  decodeHTML,
  extractStructuredEvents,
  pageDateEvidence,
} from "./lib/importer.mjs";
const root = path.resolve(new URL("..", import.meta.url).pathname);
async function readJSON(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw e;
  }
}
async function save(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file + ".tmp",
    typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n",
  );
  await rename(file + ".tmp", file);
}
export async function fetchText(url, fetcher = fetch) {
  let error;
  for (let attempt = 0; attempt < 2; attempt++)
    try {
      const res = await fetcher(url, {
        signal: AbortSignal.timeout(15000),
        headers: {
          "user-agent":
            "apnee-competitions/2.0 (+https://github.com/erminioottone/apnee-competitions)",
        },
        redirect: "follow",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text.trim()) throw new Error("Réponse vide");
      return { text, status: res.status };
    } catch (e) {
      error = e;
      if (attempt === 0 && !/HTTP 4\d\d/.test(e.message))
        await new Promise((r) => setTimeout(r, 250));
      else break;
    }
  throw error;
}
export function monitorEntry(
  previous,
  success,
  now,
  acknowledged,
  handled = false,
) {
  if (success.error)
    return {
      ...previous,
      checked_at: now,
      error: success.error,
      status: 0,
      changed: false,
      needs_review: !!previous?.needs_review || !!previous?.changed,
    };
  const digest = success.hash,
    changed =
      !!previous?.hash &&
      !(previous.checked_at && !previous.algorithm) &&
      previous.hash !== digest,
    reviewed = handled || acknowledged === digest;
  return {
    algorithm: "semantic-v1",
    url: success.url,
    status: success.status,
    checked_at: now,
    last_success: now,
    hash: digest,
    changed,
    reviewed_hash: reviewed
      ? digest
      : previous?.reviewed_hash ||
        (!previous?.changed && !previous?.needs_review && !changed
          ? digest
          : null),
    needs_review: reviewed
      ? false
      : !!previous?.needs_review || !!previous?.changed || changed,
  };
}
const identity = (e) => normalize(e.name) + "|" + normalize(e.city);
const newID = (r) =>
  `${r.start || "date-a-confirmer"}-${normalize(r.city || "france")}-${normalize(r.name).slice(0, 32)}-${r.key.slice(-8)}`;
const sourceNotes = (r) =>
  [
    r.venue
      ? `Lieu : ${r.venue}${r.pool_length ? ` (bassin ${r.pool_length} m${r.pool_depth ? `, profondeur mini ${r.pool_depth} m` : ""})` : ""}.`
      : null,
    r.events_text ? `Épreuves : ${r.events_text}.` : null,
    r.inclusive ? "Accueil inclusif déclaré par l’organisateur." : null,
  ]
    .filter(Boolean)
    .join(" ");
async function locate(city, department, config, cache, fetcher, now) {
  const original = city,
    aliases = Object.fromEntries(
      Object.entries(config.city_aliases || {}).map(([k, v]) => [
        normalize(k),
        v,
      ]),
    );
  city =
    aliases[normalize(city) + (department || "")] ||
    aliases[normalize(city)] ||
    city;
  const key = normalize(city) + ":" + (department || ""),
    old = cache[key] || cache[normalize(original) + ":" + (department || "")];
  if (old && new Date(now) - new Date(old.verified_on) < 180 * 86400000)
    return old;
  try {
    const url =
      "https://geo.api.gouv.fr/communes?" +
      new URLSearchParams({
        nom: city,
        fields: "nom,code,codeDepartement,mairie,centre",
        limit: "10",
      });
    const { text } = await fetchText(url, fetcher);
    const matches = JSON.parse(text).filter(
      (c) =>
        normalize(c.nom) === normalize(city) &&
        (!department ||
          c.codeDepartement === department ||
          (department === "20" && ["2A", "2B"].includes(c.codeDepartement))),
    );
    if (matches.length !== 1)
      throw new Error(
        `Commune ambiguë ou introuvable : ${city}${department ? " (" + department + ")" : ""}`,
      );
    const c = matches[0],
      p = (c.mairie || c.centre)?.coordinates;
    if (!p || !validCoordinates({ lat: p[1], lon: p[0] }))
      throw new Error("Coordonnées de référence absentes");
    return (cache[key] = {
      city: c.nom,
      department: c.codeDepartement,
      commune_code: c.code,
      lat: p[1],
      lon: p[0],
      verified_on: now.slice(0, 10),
      source_url: "https://geo.api.gouv.fr/communes/" + c.code,
    });
  } catch (e) {
    if (old)
      return {
        ...old,
        cache_warning:
          "Référence géographique conservée après un échec de vérification.",
      };
    throw e;
  }
}
export async function importDeclarations(
  rows,
  previous,
  config,
  cache,
  fetcher,
  now,
) {
  const events = [],
    issues = [],
    used = new Set();
  for (const r of rows) {
    let prior =
      previous.find((e) => e.source_key === r.key) ||
      previous.find(
        (e) =>
          !used.has(e.id) && identity(e) === identity(r) && e.start === r.start,
      ) ||
      previous.find(
        (e) =>
          !used.has(e.id) &&
          normalize(e.name) === normalize(r.name) &&
          (!r.start || e.start === r.start),
      );
    const placeholder =
      r.type === "championnat_france" && !r.start
        ? previous.find((e) => e.type === "championnat_france" && !e.start)
        : null;
    if (!prior && placeholder) prior = placeholder;
    const id = prior?.id || newID(r);
    used.add(id);
    const proposedOverride =
        config.overrides?.[id] || config.overrides?.[r.key],
      override =
        proposedOverride &&
        Object.entries(proposedOverride.when || {}).every(([k, v]) =>
          k === "city" ? normalize(r[k]) === normalize(v) : r[k] === v,
        )
          ? proposedOverride
          : null,
      start = override?.fields?.start || r.start,
      inference = inferEndDate(start, r.comment),
      review = [];
    if (r.raw_date && !r.start && !override?.fields?.start)
      review.push(`Date source invalide : ${r.raw_date}.`);
    if (inference.review) review.push(inference.review);
    if (r.raw_end && (!r.end || !start || r.end < start))
      review.push("Date de fin déclarée invalide ou antérieure au début.");
    const e = {
      id,
      source_key: r.key,
      federation: "FFESSM",
      type: r.type,
      level: r.level,
      name: r.name,
      start,
      end: r.end && start && r.end >= start ? r.end : inference.end,
      city: r.city,
      department: r.department,
      country: "FR",
      lat: null,
      lon: null,
      commune_code: null,
      locations: [],
      venue: r.venue,
      organizer: r.organizer,
      info_url: r.info_url || prior?.info_url || config.active_declarations_url,
      source_id: "ffessm-declarations",
      source_url: config.active_declarations_url,
      verified_on: prior?.verified_on || now.slice(0, 10),
      notes: sourceNotes(r),
      disciplines: r.disciplines,
      source_comment: r.comment,
      date_status: review.length ? "review" : start ? "confirmed" : "unknown",
      date_inference: r.end ? "source_end_date" : inference.method,
      availability: "listed",
      source_fingerprint: r.fingerprint,
      review_notes: review,
      revision: prior?.revision || 0,
    };
    if (
      prior?.end &&
      !e.end &&
      prior.start === start &&
      prior.date_inference &&
      r.comment !== prior.source_comment &&
      !/une seule|1 seule/.test(r.comment)
    ) {
      e.end = prior.end;
      e.date_status = "review";
      review.push(
        "Le commentaire justifiant la date de fin a changé ; dernière date connue conservée en attente de confirmation.",
      );
    }
    if (
      prior?.end &&
      !e.end &&
      prior.start === start &&
      prior.date_inference === "source_page_range"
    ) {
      e.end = prior.end;
      e.date_inference = prior.date_inference;
      e.date_sources = prior.date_sources;
    }
    if (r.city) {
      const towns = r.city.split(/\s+et\s+/i);
      for (const town of towns)
        try {
          const loc = await locate(
            town,
            r.department,
            config,
            cache,
            fetcher,
            now,
          );
          const point = { ...loc };
          const old =
            prior?.locations?.find(
              (l) => l.commune_code === loc.commune_code,
            ) || (towns.length === 1 ? prior : null);
          if (
            validCoordinates(old) &&
            haversineKm(old.lat, old.lon, loc.lat, loc.lon) < 15
          )
            Object.assign(point, { lat: old.lat, lon: old.lon });
          e.locations.push(point);
          if (loc.cache_warning) review.push(loc.cache_warning);
        } catch (error) {
          review.push(error.message);
        }
      if (e.locations.length) {
        const l = e.locations[0];
        Object.assign(e, {
          lat: l.lat,
          lon: l.lon,
          department: l.department,
          commune_code: l.commune_code,
        });
        if (towns.length === 1) e.city = l.city;
      }
    }
    if (override) {
      Object.assign(e, override.fields);
      e.override_reason = override.reason;
      if (e.locations.length && override.fields.lat != null)
        Object.assign(e.locations[0], {
          lat: e.lat,
          lon: e.lon,
          commune_code: e.commune_code,
          department: e.department,
        });
    }
    const comparable = (x) =>
      JSON.stringify(
        Object.fromEntries(
          Object.entries(x).filter(
            ([k]) => !["verified_on", "revision"].includes(k),
          ),
        ),
      );
    if (prior && comparable(prior) !== comparable(e)) {
      e.verified_on = now.slice(0, 10);
      e.revision = (prior.revision || 0) + 1;
    }
    for (const message of e.review_notes)
      issues.push({
        event_id: id,
        name: e.name,
        source_id: e.source_id,
        message,
        source_url: e.source_url,
      });
    events.push(e);
  }
  for (const old of previous.filter(
    (e) => e.source_id === "ffessm-declarations" && !used.has(e.id),
  )) {
    const archived = (old.end || old.start || "9999") < now.slice(0, 10);
    if (archived) {
      events.push({ ...old, availability: "archived", review_notes: [] });
      continue;
    }
    const e = {
      ...old,
      revision: (old.revision || 0) + (old.availability === "missing" ? 0 : 1),
      availability: "missing",
      review_notes: [
        ...new Set([
          ...(old.review_notes || []),
          "Événement absent du dernier calendrier source ; dernière information connue conservée.",
        ]),
      ],
    };
    events.push(e);
    issues.push({
      event_id: e.id,
      name: e.name,
      source_id: e.source_id,
      message: e.review_notes.at(-1),
      source_url: e.source_url,
    });
  }
  return { events, issues };
}
async function structuredImport(
  html,
  source,
  previous,
  config,
  cache,
  fetcher,
  now,
) {
  const candidates = extractStructuredEvents(html),
    events = [],
    issues = [];
  const articleHTML =
    [...html.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/gi)]
      .map((m) => m[0])
      .join(" ") || html;
  const links = [
    ...articleHTML.matchAll(
      /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    ),
  ]
    .map((m) => ({
      url: safeUrl(decodeHTML(m[1]), source.url),
      title: semanticHTML(m[2]),
    }))
    .filter(
      (x) =>
        x.url &&
        !/\.(?:pdf|jpg|png|ics)(?:\?|$)/i.test(x.url) &&
        new URL(x.url).origin === new URL(source.url).origin &&
        /competition|coupe|championnat|indoor|outdoor/.test(normalize(x.title)),
    );
  for (const url of [...new Set(links.map((x) => x.url))].slice(0, 6))
    try {
      const { text } = await fetchText(url, fetcher);
      candidates.push(...extractStructuredEvents(text));
    } catch (e) {
      issues.push({
        source_id: source.id,
        message: `Annonce inaccessible : ${e.message}`,
        source_url: url,
      });
    }
  // Publication dates in news articles are not competition dates.
  for (const e of candidates) {
    const start = String(e.startDate || "").slice(0, 10),
      end = String(e.endDate || e.startDate || "").slice(0, 10),
      a = e.location?.address || {},
      country =
        typeof a.addressCountry === "object"
          ? a.addressCountry.name
          : a.addressCountry;
    if (
      !validDate(start) ||
      !validDate(end) ||
      end < start ||
      !["FR", "France", "FRANCE"].includes(country)
    )
      continue;
    const city = a.addressLocality || null,
      url = safeUrl(e.url, source.url) || source.url,
      id = `${source.id}-${hash(url + "|" + e.name).slice(0, 20)}`,
      prior = previous.find((x) => x.id === id);
    const event = {
      id,
      name: String(e.name || "Compétition AIDA"),
      federation: source.federation || "AIDA",
      type: "open",
      level: "unknown",
      start,
      end: end === start ? null : end,
      city,
      department: null,
      country: "FR",
      lat: null,
      lon: null,
      commune_code: null,
      locations: [],
      venue: e.location?.name || null,
      info_url: url,
      source_id: source.id,
      source_url: source.url,
      organizer: typeof e.organizer?.name === "string" ? e.organizer.name : "",
      verified_on: prior?.verified_on || now.slice(0, 10),
      notes: "Dates structurées publiées par la source officielle.",
      date_status: "confirmed",
      date_inference: "structured_event",
      availability: "listed",
      cancelled: /EventCancelled$/.test(e.eventStatus || ""),
      revision: prior?.revision || 0,
      review_notes: [],
      disciplines: [],
    };
    if (city)
      try {
        const l = await locate(city, null, config, cache, fetcher, now);
        Object.assign(event, {
          lat: l.lat,
          lon: l.lon,
          commune_code: l.commune_code,
          department: l.department,
        });
        event.locations = [l];
      } catch (error) {
        event.review_notes.push(error.message);
        issues.push({
          event_id: id,
          name: event.name,
          source_id: source.id,
          message: error.message,
          source_url: source.url,
        });
      }
    if (
      prior &&
      JSON.stringify({ ...prior, revision: 0 }) !==
        JSON.stringify({ ...event, revision: 0 })
    ) {
      event.revision = (prior.revision || 0) + 1;
      event.verified_on = now.slice(0, 10);
    }
    events.push(event);
  }
  return {
    events: [...new Map(events.map((e) => [e.id, e])).values()],
    issues,
  };
}
export async function updateData({
  directory = root,
  fetcher = fetch,
  now = new Date().toISOString(),
} = {}) {
  const config = await readJSON(path.join(directory, "data/config.json")),
    previous = await readJSON(path.join(directory, "events.json"), {
      events: [],
      sources: [],
    }),
    cache = await readJSON(path.join(directory, "data/locations.json"), {}),
    manual = await readJSON(
      path.join(directory, "data/manual-events.json"),
      [],
    ),
    oldMonitoring = await readJSON(
      path.join(directory, "sources-status.json"),
      { sources: {} },
    );
  const status = { last_run: now, sources: {} },
    issues = [],
    sources = config.sources.map((s) => ({
      ...s,
      url:
        s.adapter === "ffessm_csv" &&
        oldMonitoring.sources?.[s.id]?.url?.startsWith(
          "https://docs.google.com/spreadsheets/",
        )
          ? oldMonitoring.sources[s.id].url
          : s.url,
    })),
    responses = new Map();
  let events = previous.events.filter(
      (e) => !manual.some((m) => m.id === e.id && m.source_id === e.source_id),
    ),
    primaryImported = false,
    primaryError = null;
  await Promise.all(
    sources
      .filter((s) => s.monitor)
      .map(async (s) => {
        try {
          responses.set(s.id, await fetchText(s.url, fetcher));
        } catch (e) {
          responses.set(s.id, { error: e.message });
        }
      }),
  );
  const national = responses.get("ffessm-national"),
    declaration = sources.find((s) => s.adapter === "ffessm_csv");
  if (national?.text && declaration) {
    const links = [
        ...national.text.matchAll(
          /<a\b[^>]*href=["']([^"']*docs\.google\.com\/spreadsheets\/d\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
        ),
      ],
      link = links.find((m) => /calendrier.*complet/i.test(semanticHTML(m[2]))),
      id = link?.[1].match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)?.[1];
    if (id) {
      const url = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv`;
      if (url !== declaration.url)
        try {
          responses.set(declaration.id, await fetchText(url, fetcher));
          declaration.url = url;
        } catch (e) {
          responses.set(declaration.id, {
            error: "Nouveau calendrier inaccessible : " + e.message,
          });
        }
    }
  }
  config.active_declarations_url = declaration?.url.replace(
    /\/gviz\/.*$/,
    "/edit?usp=sharing",
  );
  for (const s of sources.filter((s) => s.monitor)) {
    const response = responses.get(s.id);
    let digest = null,
      handled = false;
    if (!response.error)
      try {
        if (s.adapter === "ffessm_csv") {
          const rows = readDeclarations(response.text),
            count = previous.events.filter(
              (e) =>
                e.source_id === s.id &&
                (!e.availability || e.availability === "listed"),
            ).length,
            sourceChanged =
              previous.sources?.find((source) => source.id === s.id)?.url !==
              s.url;
          if (
            rows.length < (config.minimum_source_rows ?? 1) ||
            (!sourceChanged && count > 10 && rows.length < count * 0.6)
          )
            throw new Error(
              "Baisse anormale du nombre de lignes : import suspendu.",
            );
          if (new Set(rows.map((r) => r.key)).size !== rows.length)
            throw new Error("Identifiants source dupliqués : import suspendu.");
          const imported = await importDeclarations(
            rows,
            previous.events,
            config,
            cache,
            fetcher,
            now,
          );
          const importedIDs = new Set(imported.events.map((e) => e.id));
          events = [
            ...events.filter(
              (e) => e.source_id !== s.id && !importedIDs.has(e.id),
            ),
            ...imported.events,
          ];
          issues.push(...imported.issues);
          primaryImported = true;
          digest = hash(
            JSON.stringify(rows.map((r) => [r.key, r.fingerprint]).sort()),
          );
          handled = true;
        } else {
          digest = hash(semanticHTML(response.text));
          if (s.adapter === "structured_events") {
            const imported = await structuredImport(
              response.text,
              s,
              previous.events,
              config,
              cache,
              fetcher,
              now,
            );
            issues.push(...imported.issues);
            const ids = new Set(imported.events.map((e) => e.id));
            events = [
              ...events.filter((e) => !ids.has(e.id)),
              ...imported.events,
            ];
          }
        }
      } catch (e) {
        response.error = e.message;
      }
    if (response.error && s.adapter === "ffessm_csv")
      primaryError = response.error;
    status.sources[s.id] = monitorEntry(
      oldMonitoring.sources?.[s.id],
      response.error
        ? { error: response.error }
        : { url: s.url, status: response.status, hash: digest },
      now,
      config.acknowledged_hashes?.[s.id],
      handled,
    );
    if (response.error)
      issues.push({
        source_id: s.id,
        message: "Échec de vérification : " + response.error,
        source_url: s.url,
      });
    if (status.sources[s.id].needs_review)
      issues.push({
        source_id: s.id,
        message:
          "Source modifiée : vérifier les annonces non structurées puis acquitter son empreinte dans data/config.json.",
        source_url: s.url,
      });
  }
  for (const e of events.filter(
    (e) => e.federation === "FFESSM" && e.availability === "listed",
  )) {
    const evidence = sources
      .filter(
        (s) =>
          s.adapter !== "ffessm_csv" &&
          responses.get(s.id)?.text &&
          !responses.get(s.id)?.error,
      )
      .flatMap((s) =>
        pageDateEvidence(e, responses.get(s.id).text).map((item) => ({
          ...item,
          source_id: s.id,
          source_url: s.url,
        })),
      );
    if (!evidence.length) continue;
    const ends = [...new Set(evidence.map((x) => x.end))];
    if (
      ends.length > 1 ||
      (e.end && e.end !== ends[0] && e.date_inference !== "source_page_range")
    ) {
      const message =
        "Les sources officielles donnent des dates de fin différentes ; confirmation nécessaire.";
      e.date_status = "review";
      e.review_notes = [...new Set([...e.review_notes, message])];
      issues.push({
        event_id: e.id,
        name: e.name,
        source_id: e.source_id,
        message,
        source_url: evidence[0].source_url,
      });
    } else if (!e.end || e.date_inference === "source_page_range") {
      e.end = ends[0];
      e.date_inference = "source_page_range";
      e.date_sources = evidence;
    }
  }
  const automaticIDs = new Set(events.map((e) => e.id));
  const retainedManual = manual.filter((e) => !automaticIDs.has(e.id));
  for (const e of retainedManual)
    for (const message of e.review_notes || [])
      issues.push({
        event_id: e.id,
        name: e.name,
        source_id: e.source_id,
        message,
        source_url: e.source_url,
      });
  events = [...events, ...retainedManual].sort(
    (a, b) =>
      (a.start || "9999").localeCompare(b.start || "9999") ||
      a.id.localeCompare(b.id),
  );
  if (!primaryImported) {
    const oldQueue = await readJSON(path.join(directory, "review-queue.json"), {
      items: [],
    });
    issues.push(
      ...oldQueue.items.filter(
        (i) => i.event_id && i.source_id === "ffessm-declarations",
      ),
    );
  }
  const data = {
      schema_version: 2,
      dataset_version: previous.dataset_version,
      as_of: previous.as_of,
      disclaimer: config.disclaimer,
      events,
      sources,
    },
    before = new Map(previous.events.map((e) => [e.id, e])),
    changes = [];
  const stable = (x) =>
    JSON.stringify(x, (_k, v) =>
      v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(
            Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
          )
        : v,
    );
  const material = (e) =>
    stable(
      Object.fromEntries(
        Object.entries(e).filter(
          ([k]) => !["verified_on", "revision"].includes(k),
        ),
      ),
    );
  for (const e of events) {
    const old = before.get(e.id);
    if (!old || material(old) !== material(e)) {
      if (old) {
        e.revision = (old.revision || 0) + 1;
        e.verified_on = now.slice(0, 10);
      }
      changes.push({
        id: e.id,
        name: e.name,
        kind: !old
          ? "added"
          : e.availability === "missing"
            ? "source_missing"
            : "updated",
        start: e.start,
        end: e.end,
      });
    } else {
      e.revision = old.revision || 0;
      e.verified_on = old.verified_on;
    }
  }
  if (changes.length || previous.schema_version !== 2) {
    data.as_of = now.slice(0, 10);
    data.dataset_version = now;
  }
  const errors = validateDataset(data);
  if (errors.length)
    throw new Error("Validation bloquante : " + errors.join("; "));
  const oldHistory = await readJSON(
      path.join(directory, "update-history.json"),
      { updates: [] },
    ),
    history = changes.length
      ? { updates: [{ at: now, changes }, ...oldHistory.updates].slice(0, 30) }
      : oldHistory,
    queue = {
      generated_at: now,
      items: [...new Map(issues.map((i) => [JSON.stringify(i), i])).values()],
    };
  status.import = {
    automatic: primaryImported,
    error: primaryError,
    event_count: events.length,
    changes: changes.length,
    review_count: queue.items.length,
  };
  await save(path.join(directory, "events.json"), data);
  await save(path.join(directory, "sources-status.json"), status);
  await save(path.join(directory, "data/locations.json"), cache);
  await save(path.join(directory, "review-queue.json"), queue);
  await save(path.join(directory, "update-history.json"), history);
  await save(
    path.join(directory, "calendar.ics"),
    calendarICS(
      events.filter((e) => e.country === "FR"),
      data.dataset_version.includes("T") ? data.dataset_version : now,
    ),
  );
  console.log(
    JSON.stringify({
      events: events.length,
      changes: changes.length,
      automatic_import: primaryImported,
      review: queue.items.length,
      failed_sources: Object.entries(status.sources)
        .filter(([, s]) => s.error)
        .map(([id]) => id),
    }),
  );
  return { data, status, queue, history };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  await updateData();
