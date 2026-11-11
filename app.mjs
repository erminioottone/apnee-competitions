import {
  TYPE_LABELS,
  normalize,
  safeUrl,
  validCoordinates,
  filterEvents,
  isPast,
  monitoringHealth,
  calendarICS,
  validateDataset,
} from "./lib/model.mjs";
const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const PRESETS = [
  ["Toulouse", 43.6045, 1.4442],
  ["Castanet-Tolosan", 43.5167, 1.5181],
  ["Agen", 44.203, 0.6215],
  ["Montpellier", 43.6109, 3.8763],
  ["Bordeaux", 44.8378, -0.5792],
  ["Marseille", 43.2964, 5.3698],
  ["Lyon", 45.764, 4.8357],
  ["Paris", 48.8566, 2.3522],
  ["Massy", 48.7264, 2.2703],
  ["Besançon", 47.2428, 6.0243],
  ["Épinal", 48.1725, 6.4497],
  ["Dunkerque", 51.0345, 2.3769],
  ["Brest", 48.3904, -4.4861],
].map(([label, lat, lon]) => ({ label, lat, lon, source: "preset" }));
const defaults = {
  radius: 100,
  scope: "distance",
  fed: "all",
  type: "all",
  selective: false,
  showPast: false,
  query: "",
  discipline: "all",
  sort: "date",
};
const state = {
  ...defaults,
  home: PRESETS[0],
  data: null,
  monitoring: null,
  monitoringUnavailable: false,
  queue: [],
  history: [],
  results: [],
};
const params = new URLSearchParams(location.search);
for (const [key, values] of Object.entries({
  scope: ["distance", "france", "all"],
  fed: ["all", "FFESSM", "AIDA"],
  type: ["all", ...Object.keys(TYPE_LABELS)],
  discipline: ["all", "STA", "DYNB", "DYN", "DNF", "SPRINT"],
  sort: ["date", "distance"],
}))
  if (values.includes(params.get(key))) state[key] = params.get(key);
for (const k of ["selective", "showPast"]) state[k] = params.get(k) === "1";
if (params.has("radius"))
  state.radius =
    Math.max(
      10,
      Math.min(1500, Math.round(Number(params.get("radius")) / 10) * 10),
    ) || 100;
state.query = (params.get("query") || "").slice(0, 150);
try {
  const saved = JSON.parse(localStorage.getItem("apnee-home"));
  if (validCoordinates(saved) && typeof saved.label === "string")
    state.home = saved;
} catch {}
const preset = PRESETS.find((c) => c.label === params.get("home"));
if (preset) state.home = preset;
function syncHome() {
  $("homeSelect").replaceChildren(
    ...PRESETS.map((p, i) => new Option(p.label, String(i))),
  );
  const i = PRESETS.findIndex(
    (p) =>
      p.label === state.home.label &&
      p.lat === state.home.lat &&
      p.lon === state.home.lon &&
      state.home.source !== "gps",
  );
  if (i >= 0) $("homeSelect").value = String(i);
  else {
    $("homeSelect").add(
      new Option(
        state.home.source === "gps"
          ? "Ma position enregistrée"
          : state.home.label,
        "custom",
      ),
    );
    $("homeSelect").value = "custom";
  }
}
function setHome(home, persist = true) {
  if (!validCoordinates(home)) return;
  state.home = home;
  syncHome();
  if (persist)
    try {
      localStorage.setItem("apnee-home", JSON.stringify(home));
    } catch {}
  render();
}
function syncURL() {
  const p = new URLSearchParams();
  for (const k of Object.keys(defaults))
    if (state[k] !== defaults[k])
      p.set(k, typeof state[k] === "boolean" ? "1" : state[k]);
  if (state.home.source === "preset" && state.home.label !== PRESETS[0].label)
    p.set("home", state.home.label);
  if (state.home.source === "commune" && state.home.commune_code)
    p.set("commune", state.home.commune_code);
  try {
    history.replaceState(
      null,
      "",
      location.pathname + (p.size ? "?" + p : "") + location.hash,
    );
  } catch {}
}
function formatDate(s) {
  return s
    ? new Date(s + "T12:00:00").toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "Dates à confirmer";
}
function card({ ev: e, d }) {
  const review = e.review_notes || [],
    where =
      [e.city, e.department ? `(${e.department})` : null]
        .filter(Boolean)
        .join(" ") || "Lieu à confirmer";
  const range =
    e.end && e.end !== e.start
      ? `${formatDate(e.start)} – ${formatDate(e.end)}`
      : formatDate(e.start);
  const itinerary =
    "https://www.google.com/maps/dir/?" +
    new URLSearchParams({
      api: "1",
      destination: [e.venue, e.city, e.country === "FR" ? "France" : e.country]
        .filter(Boolean)
        .join(", "),
    });
  return `<article class="card${isPast(e) ? " past" : ""}${review.length ? " review" : ""}${e.cancelled ? " cancelled" : ""}"><div class="card-top"><h3>${esc(e.name)}</h3><span class="distance">${d === null ? "Lieu non localisé" : "≈ " + Math.round(d) + " km"}</span></div><div class="badges"><span class="badge fed-${esc(e.federation)}">${esc(e.federation)}</span><span class="badge">${esc(TYPE_LABELS[e.type])}</span>${e.level === "selective" ? '<span class="badge">Sélective</span>' : ""}${e.level === "free" ? '<span class="badge">Format libre</span>' : ""}${e.reference_only ? '<span class="badge">Référence internationale</span>' : ""}${e.cancelled ? '<span class="badge">Annulée</span>' : ""}${e.availability === "missing" ? '<span class="badge">Absente de la dernière source</span>' : ""}${isPast(e) ? '<span class="badge">Passée</span>' : ""}</div><p class="when">${esc(range)}${e.date_status === "review" ? " · <strong>Dates à vérifier</strong>" : ""}</p><div class="where">${esc(where)}${e.locations?.length > 1 ? " · Plusieurs communes" : ""}${d !== null ? " · Distance à vol d’oiseau" : ""}</div><div class="actions"><a href="${esc(safeUrl(e.info_url) || "#")}" target="_blank" rel="noopener noreferrer">Organisateur / inscription</a><a href="${esc(safeUrl(e.source_url) || "#")}" target="_blank" rel="noopener noreferrer">Source officielle</a>${e.city ? `<a href="${esc(itinerary)}" target="_blank" rel="noopener noreferrer">Itinéraire</a>` : ""}${e.start ? `<button type="button" data-calendar="${esc(e.id)}">Ajouter au calendrier</button>` : ""}</div>${e.notes ? `<p class="reg-note">${esc(e.notes)}</p>` : ""}${e.date_inference?.startsWith("source_comment") ? '<p class="source-note">Durée déduite automatiquement des dates ou de la durée indiquées par l’organisateur.</p>' : ""}${review.map((n) => `<p class="note">${esc(n)}</p>`).join("")}<div class="source-note">Vérifié / importé le ${esc(formatDate(e.verified_on))}. Inscriptions à confirmer auprès de l’organisateur.</div></article>`;
}
function renderMonitoring() {
  const h = monitoringHealth(state.monitoring);
  const labels = (ids) =>
    ids
      .map((id) => state.data?.sources.find((s) => s.id === id)?.name || id)
      .join(", ");
  const messages = [];
  if (h.stale || state.monitoringUnavailable)
    messages.push(
      "La dernière vérification automatique est ancienne ou indisponible. Les dernières données connues restent affichées.",
    );
  if (h.failed.length)
    messages.push("Sources non vérifiées : " + labels(h.failed) + ".");
  if (h.pending.length)
    messages.push(
      "Des sources ont changé et certaines annonces nécessitent une vérification : " +
        labels(h.pending) +
        ".",
    );
  if (state.monitoring?.import?.error)
    messages.push(
      "Import suspendu : les dernières données valides ont été conservées.",
    );
  const time = state.monitoring?.last_run
    ? new Date(state.monitoring.last_run).toLocaleString("fr-FR")
    : "";
  $("statusSlot").innerHTML = messages.length
    ? `<div class="banner">${messages.map(esc).join("<br>")}${time ? `<br>Dernière tentative : ${esc(time)}.` : ""}</div>`
    : `<div class="banner info">Calendrier actualisé automatiquement. Dernière vérification : ${esc(time)}.</div>`;
  if (state.data)
    $("sourceList").innerHTML = state.data.sources
      .map((s) => {
        const x = state.monitoring?.sources?.[s.id],
          label = !x
            ? "non vérifiée"
            : x.error
              ? "échec de vérification"
              : x.needs_review
                ? "annonces à vérifier"
                : "vérifiée";
        return `<li><a href="${esc(safeUrl(s.url) || "#")}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a> — ${label}</li>`;
      })
      .join("");
}
function render() {
  syncURL();
  $("radius").disabled = state.scope !== "distance";
  $("radiusValue").textContent = state.radius + " km";
  if (!state.data) return;
  state.results = filterEvents(state.data.events, state);
  const unlocated = state.results.filter((x) => x.d === null).length;
  $("metaLine").textContent =
    `${state.scope === "distance" ? state.results.length - unlocated : state.results.length} compétition(s)${state.scope === "distance" ? ` dans un rayon de ${state.radius} km autour de ${state.home.label}` : state.scope === "france" ? " en France et outre-mer" : " — tous les lieux"}${unlocated ? ` · ${unlocated} lieu(x) à confirmer, hors filtre de distance` : ""} · Données mises à jour le ${formatDate(state.data.as_of)}`;
  const located = state.results.filter((x) => x.d !== null),
    unknown = state.results.filter((x) => x.d === null);
  const cards =
    state.scope === "distance"
      ? (located.length
          ? '<h2 class="section">Dans le rayon choisi</h2>' +
            located.map(card).join("")
          : "") +
        (unknown.length
          ? '<h2 class="section">Lieu à confirmer</h2>' +
            unknown.map(card).join("")
          : "")
      : state.results.map(card).join("");
  $("results").innerHTML = state.results.length
    ? cards
    : '<p class="empty">Aucune compétition ne correspond à ces filtres. Essayez « Toute la France et outre-mer » ou élargissez le rayon.</p>';
  $("exportCalendar").disabled = !state.results.some((x) => x.ev.start);
}
function download(events, name) {
  const url = URL.createObjectURL(
    new Blob([calendarICS(events)], { type: "text/calendar;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function syncControls() {
  for (const [k, id] of Object.entries({
    radius: "radius",
    scope: "scope",
    discipline: "discipline",
    sort: "sort",
    query: "eventSearch",
  }))
    $(id).value = state[k];
  $("showPast").checked = state.showPast;
  $("selective").checked = state.selective;
  for (const [id, key] of [
    ["fedChips", "fed"],
    ["typeChips", "type"],
  ])
    for (const b of $(id).querySelectorAll("button")) {
      const on = b.dataset.value === state[key];
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    }
}
$("typeChips").innerHTML = [["all", "Toutes"], ...Object.entries(TYPE_LABELS)]
  .map(
    ([value, label]) =>
      `<button class="chip" type="button" data-value="${value}" aria-pressed="false">${esc(label)}</button>`,
  )
  .join("");
for (const [id, key] of [
  ["fedChips", "fed"],
  ["typeChips", "type"],
])
  $(id).addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) {
      state[key] = b.dataset.value;
      syncControls();
      render();
    }
  });
for (const [id, key] of [
  ["scope", "scope"],
  ["discipline", "discipline"],
  ["sort", "sort"],
])
  $(id).addEventListener("change", (e) => {
    state[key] = e.target.value;
    render();
  });
for (const [id, key] of [
  ["showPast", "showPast"],
  ["selective", "selective"],
])
  $(id).addEventListener("change", (e) => {
    state[key] = e.target.checked;
    render();
  });
$("eventSearch").addEventListener("input", (e) => {
  state.query = e.target.value;
  render();
});
$("radius").addEventListener("input", (e) => {
  state.radius = Number(e.target.value);
  render();
});
$("resetFilters").addEventListener("click", () => {
  Object.assign(state, defaults);
  syncControls();
  render();
});
$("homeSelect").addEventListener("change", (e) => {
  if (e.target.value !== "custom") {
    setHome(PRESETS[Number(e.target.value)]);
    $("originMessage").textContent = "";
  }
});
$("clearHome").addEventListener("click", () => {
  try {
    localStorage.removeItem("apnee-home");
  } catch {}
  setHome(PRESETS[0], false);
  $("originMessage").textContent =
    "Position enregistrée effacée. Point de départ : Toulouse.";
});
$("geoBtn").addEventListener("click", () => {
  if (!navigator.geolocation) {
    $("originMessage").textContent =
      "Géolocalisation indisponible. Recherchez une commune.";
    return;
  }
  $("geoBtn").disabled = true;
  $("originMessage").textContent = "Recherche de votre position…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      setHome({
        label: "Ma position enregistrée",
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        source: "gps",
      });
      $("geoBtn").disabled = false;
      $("originMessage").textContent =
        "Position enregistrée uniquement dans ce navigateur.";
    },
    () => {
      $("geoBtn").disabled = false;
      $("originMessage").textContent =
        "Géolocalisation refusée ou indisponible. Recherchez une commune.";
    },
    { timeout: 10000, maximumAge: 300000 },
  );
});
let townTimer,
  townRequest = 0;
function chooseTown(c) {
  const p = (c.mairie || c.centre)?.coordinates;
  if (!p) return;
  setHome({
    label: `${c.nom} (${c.codeDepartement})`,
    lat: p[1],
    lon: p[0],
    commune_code: c.code,
    source: "commune",
  });
  $("citySearch").value = "";
  $("cityOptions").replaceChildren();
  $("citySearch").setAttribute("aria-expanded", "false");
  $("originMessage").textContent =
    "Centre de commune sélectionné. Les distances restent approximatives.";
}
$("citySearch").addEventListener("input", () => {
  clearTimeout(townTimer);
  const query = $("citySearch").value.trim(),
    request = ++townRequest;
  $("cityOptions").replaceChildren();
  $("citySearch").setAttribute("aria-expanded", "false");
  if (query.length < 3 || (/^\d+$/.test(query) && query.length !== 5)) return;
  townTimer = setTimeout(async () => {
    try {
      const args = new URLSearchParams({
        fields: "nom,code,codeDepartement,codesPostaux,mairie,centre",
        limit: "8",
        boost: "population",
      });
      args.set(/^\d{5}$/.test(query) ? "codePostal" : "nom", query);
      const res = await fetch("https://geo.api.gouv.fr/communes?" + args, {
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) throw new Error();
      const towns = await res.json();
      if (request !== townRequest) return;
      for (const c of towns) {
        const b = document.createElement("button");
        b.type = "button";
        b.setAttribute("role", "option");
        b.textContent = `${c.nom} (${c.codeDepartement}) — ${(c.codesPostaux || []).join(", ")}`;
        b.addEventListener("click", () => chooseTown(c));
        $("cityOptions").appendChild(b);
      }
      $("citySearch").setAttribute("aria-expanded", String(towns.length > 0));
      $("originMessage").textContent = towns.length
        ? ""
        : "Aucune commune trouvée. Essayez le nom complet ou le code postal.";
    } catch {
      if (request === townRequest)
        $("originMessage").textContent =
          "Recherche de communes indisponible. Utilisez une ville proposée ou votre position.";
    }
  }, 400);
});
$("citySearch").addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") {
    $("cityOptions").querySelector("button")?.focus();
    e.preventDefault();
  }
  if (e.key === "Escape") {
    $("cityOptions").replaceChildren();
    $("citySearch").setAttribute("aria-expanded", "false");
  }
});
$("cityOptions").addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") {
    e.target.nextElementSibling?.focus();
    e.preventDefault();
  }
  if (e.key === "ArrowUp") {
    (e.target.previousElementSibling || $("citySearch")).focus();
    e.preventDefault();
  }
});
$("exportCalendar").addEventListener("click", () =>
  download(
    state.results.map((x) => x.ev),
    "apnee-competitions.ics",
  ),
);
$("results").addEventListener("click", (e) => {
  const b = e.target.closest("[data-calendar]");
  if (b) {
    const event = state.data.events.find((x) => x.id === b.dataset.calendar);
    if (event) download([event], event.id + ".ics");
  }
});
$("subscribeCalendar").href = new URL(
  "calendar.ics",
  location.href,
).href.replace(/^https?:/, "webcal:");
async function getJSON(url) {
  const r = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}
syncHome();
syncControls();
getJSON("events.json")
  .then((data) => {
    const errors = validateDataset(data);
    if (errors.length) throw new Error("Données invalides");
    state.data = data;
    $("disclaimer").textContent = data.disclaimer;
    render();
    renderMonitoring();
  })
  .catch(() => {
    $("results").innerHTML =
      '<div class="banner">Impossible de charger le calendrier. Réessayez dans quelques instants.</div>';
  });
getJSON("sources-status.json")
  .then((m) => {
    state.monitoring = m;
    renderMonitoring();
  })
  .catch(() => {
    state.monitoringUnavailable = true;
    renderMonitoring();
  });
getJSON("review-queue.json")
  .then((q) => {
    state.queue = q.items || [];
    $("reviewSummary").textContent =
      `Vérifications en attente (${state.queue.length})`;
    $("reviewList").innerHTML = state.queue.length
      ? state.queue
          .map(
            (i) =>
              `<li>${i.name ? `<strong>${esc(i.name)}</strong> : ` : ""}${esc(i.event_id ? i.message : "Source officielle à vérifier.")}${i.source_url ? ` <a href="${esc(safeUrl(i.source_url) || "#")}" target="_blank" rel="noopener noreferrer">Consulter la source</a>` : ""}</li>`,
          )
          .join("")
      : "<li>Aucune anomalie détectée lors du dernier import.</li>";
  })
  .catch(() => {
    $("reviewSummary").textContent =
      "Vérifications en attente — état indisponible";
  });
getJSON("update-history.json")
  .then((h) => {
    $("historyList").innerHTML =
      (h.updates || [])
        .slice(0, 5)
        .map(
          (u) =>
            `<p><strong>${esc(new Date(u.at).toLocaleString("fr-FR"))}</strong> · ${u.changes.length} ajout(s) ou modification(s)</p><ul>${u.changes
              .slice(0, 12)
              .map(
                (e) =>
                  `<li>${esc(e.name)}${e.start ? " — " + esc(formatDate(e.start)) + (e.end ? " au " + esc(formatDate(e.end)) : "") : ""}</li>`,
              )
              .join("")}</ul>`,
        )
        .join("") || "<p>Aucune modification récente.</p>";
  })
  .catch(() => {
    $("historyList").textContent = "Historique momentanément indisponible.";
  });
if (/^(?:\d{5}|2[AB]\d{3})$/.test(params.get("commune") || ""))
  getJSON(
    "https://geo.api.gouv.fr/communes/" +
      params.get("commune") +
      "?fields=nom,code,codeDepartement,mairie,centre",
  )
    .then(chooseTown)
    .catch(() => {
      $("originMessage").textContent =
        "La commune partagée est indisponible. Choisissez un point de départ.";
    });
