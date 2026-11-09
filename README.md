# Apnée Compétitions France

Site statique listant les compétitions d'apnée en France (FFESSM et AIDA France), filtrables par distance depuis un point de départ, avec lien vers la page organisateur de chaque compétition. Hébergé sur GitHub Pages, surveillance quotidienne des sources officielles via GitHub Actions.

Outil non officiel, indépendant de la FFESSM et d'AIDA France. Toujours confirmer dates, lieux et inscriptions sur les pages officielles citées dans chaque fiche.

## Fonctionnement

- `index.html` — l'application (HTML/CSS/JS pur, aucune dépendance).
- `events.json` — le jeu de données de la saison, assemblé à la main depuis les sources officielles (chaque événement cite sa source et sa date de vérification).
- `sources-status.json` — état de la dernière vérification des sources (généré automatiquement).
- `.github/workflows/monitor.yml` — cron quotidien (06:00 UTC) : télécharge chaque page source surveillée, la hache, compare, met à jour `sources-status.json` et commite si nécessaire. Le site affiche un bandeau quand une source a changé depuis la dernière mise à jour du jeu de données. Déclenchement manuel possible (onglet Actions → Source monitoring → Run workflow).

## Mise à jour des données

Aucun outil local requis : éditer `events.json` directement dans le navigateur sur GitHub (bouton crayon), respecter le schéma ci-dessous, commit. GitHub Pages redéploie en ~1 minute.

Schéma d'un événement :

```json
{
  "id": "kebab-case-unique",
  "federation": "FFESSM" | "AIDA",
  "type": "manche_cdf | championnat_france | championnat_monde | championnat_regional | championnat_interregional | championnat_departemental | selective | open | non_classe",
  "name": "string",
  "start": "YYYY-MM-DD | null",
  "end": "YYYY-MM-DD | null",
  "city": "string | null",
  "department": "string | null",
  "lat": 43.6045, "lon": 1.4442,
  "organizer": "string",
  "info_url": "https:// organizer or federation page",
  "source_id": "id from sources array",
  "source_url": "https:// where the info was read",
  "verified_on": "YYYY-MM-DD",
  "notes": "caveats, to-confirm items"
}
```

## Déploiement (GitHub Pages)

Le site est statique : branche `main`, dossier racine.

1. Settings → Pages → Build and deployment → Source : Deploy from a branch → Branch : `main`, dossier `/ (root)` → Save.
2. URL : `https://<owner>.github.io/apnee-competitions/` (premier build ~1 minute).

Plan gratuit GitHub : Pages et Actions sont inclus ; le dépôt doit être public pour Pages en plan gratuit.

## Limites

- Aucune API publique FFESSM/AIDA n'existe : le jeu de données est assemblé manuellement à partir des sources officielles ; les cron GitHub sont best-effort (retards possibles).
- Le cœur du jeu de données FFESSM provient de la feuille officielle des déclarations de la CNA (source primaire, voir `events.json` → `sources`) : compétitions déclarées par les clubs de toutes les régions, y compris l'outre-mer.
- AIDA France : les championnats du monde AIDA 2026 (indoor Budapest, outdoor Limassol) figurent à titre de référence (épreuves passées). Le calendrier AIDA France 2026-2027 n'était pas publié à la date de vérification ; la page Actualités d'AIDA France est surveillée chaque jour, ajouter les événements annoncés dans `events.json` (fédération `AIDA`).
- Coordonnées approximatives au niveau communal (géocodage OpenStreetMap/Nominatim).
- Couverture : compétitions FFESSM déclarées pour la saison 2026-2027 (toutes régions et outre-mer, 5 manches de Coupe de France, championnats régionaux/départementaux/inter-régionaux, sélectives et formats libres), championnat de France (date à venir) et événements AIDA.

## Confidentialité

Aucune donnée personnelle collectée, aucun cookie, aucune statistique. La position "domicile" reste dans le localStorage du navigateur.
