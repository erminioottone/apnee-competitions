# Apnée Compétitions France

Calendrier indépendant des compétitions FFESSM et AIDA, publié sur [GitHub Pages](https://erminioottone.github.io/apnee-competitions/). Application statique, sans dépendance, sans compte et sans suivi publicitaire. Node.js 22+ pour les imports et les tests.

## Mise à jour automatique

Le workflow **Refresh competition calendar** s’exécute toutes les six heures, à la minute 17 UTC (GitHub peut retarder les tâches planifiées). Il peut aussi être lancé depuis Actions → Refresh competition calendar → Run workflow.

1. Télécharge les sources officielles, avec délais d’expiration et nouvelle tentative.
2. Découvre un nouveau lien de calendrier FFESSM sur la page nationale lorsqu’il est publié. Le dernier lien connu reste utilisable si cette page devient indisponible.
3. Importe la feuille FFESSM par noms de colonnes : nouvelles compétitions, changements de date, disciplines, catégorie, statut sélectif et liens organisateurs. Les noms personnels, courriels et téléphones des déclarants ne sont pas importés.
4. Complète les dates de fin à partir des commentaires explicites et des annonces courtes des pages surveillées, lorsque commune et date de début correspondent. Exemples reconnus : « 28–29 novembre 2026 », « 3 & 4 avril 2027 », « vendredi 12 et samedi 13 février 2027 » et « sur deux jours ».
5. Résout les communes via l’API officielle geo.api.gouv.fr, en vérifiant le département et en conservant le code INSEE. Les références géographiques sont mises en cache pour 180 jours. Une homonymie ou des coordonnées éloignées déclenchent une correction ou une vérification.
6. Vérifie le schéma, les dates, les coordonnées et les liens ; conserve les derniers événements valides si une source est inaccessible ou si une feuille semble tronquée.
7. Actualise les fichiers générés, les enregistre dans Git et demande explicitement une reconstruction de GitHub Pages. Aucun service payant ni clé externe requis.

Les événements retirés de la source sont conservés : les événements futurs sont signalés à vérifier, les anciens sont archivés. Une disparition de ligne n’est pas interprétée comme une annulation.

## Dates de plusieurs jours

Les dates structurées et les durées explicitement publiées font autorité. Une date de fin est incluse dans l’affichage et dans le calcul des événements passés ; le flux iCalendar utilise une date de fin exclusive, conformément au format.

Le système n’invente pas de durée en cas de conflit. Par exemple, une compétition déclarée le 2 avril avec un commentaire parlant de mars est signalée dans `review-queue.json` et sur sa fiche. Une échéance d’inscription n’est pas utilisée comme date de fin. Un changement dans le commentaire qui justifiait une ancienne date nécessite une nouvelle vérification.

## Couverture AIDA et limites

La feuille FFESSM est importée automatiquement. Les pages AIDA France et les annonces qu’elles référencent sont surveillées ; les événements français au format JSON-LD Event/SportsEvent sont importés lorsqu’ils sont disponibles. La date de publication d’un article n’est jamais prise pour la date d’une compétition.

Les annonces uniquement en texte libre, image ou PDF ne permettent pas une importation complète garantie. Leurs modifications restent signalées jusqu’à vérification. Le calendrier AIDA France consulté lors de cette version ne fournit pas de flux structuré à jour. Les références internationales historiques restent dans `data/manual-events.json` et sont exclues du flux France.

Les coordonnées sont communales, pas systématiquement celles de la piscine. La présence de plusieurs communes est prise en compte par la distance minimale. Les itinéraires permettent de préparer le trajet réel.

## Utilisation

- Recherche du point de départ par ville, code postal ou position GPS ; position enregistrée et effaçable localement.
- Vue par rayon, France et outre-mer, ou tous les lieux avec références internationales.
- Recherche d’événements et filtres indépendants : fédération, catégorie, statut sélectif et discipline.
- Tri par date ou distance ; filtres partageables dans l’URL, sans coordonnées GPS.
- Export des résultats ou d’une compétition au format `.ics`.
- Abonnement France : `https://erminioottone.github.io/apnee-competitions/calendar.ics`. Utiliser « Ajouter par URL » dans une application de calendrier pour recevoir les modifications futures ; sa fréquence d’actualisation dépend de l’application. Télécharger un fichier seul ne crée pas un abonnement.
- Historique des changements et liste visible des vérifications en attente.

## Fichiers

| Fichier                                               | Rôle                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------- |
| `index.html`, `app.mjs`, `lib/model.mjs`              | Interface, filtres, distances, export iCalendar                     |
| `scripts/update-data.mjs`, `scripts/lib/importer.mjs` | Import, géocodage, rapprochement des dates et surveillance          |
| `data/config.json`                                    | Sources, alias de communes, corrections documentées, acquittements  |
| `data/manual-events.json`                             | Ajouts vérifiés sans source structurée                              |
| `data/locations.json`                                 | Cache des références géographiques officielles                      |
| `events.json`                                         | Calendrier généré ; ne pas modifier directement                     |
| `sources-status.json`                                 | Dernière tentative, dernier succès, erreurs et alertes persistantes |
| `review-queue.json`                                   | Cas ambigus à confirmer                                             |
| `update-history.json`                                 | Trente dernières mises à jour ayant modifié des événements          |
| `calendar.ics`                                        | Flux France généré automatiquement                                  |

## Corrections et vérifications

Les corrections pérennes vont dans `data/config.json`, sous `overrides`, par identifiant d’événement. Indiquer une raison et, si nécessaire, une condition `when` : la correction de l’année erronée de Nice s’applique seulement tant que le champ source contient `28/03/0207`. Une correction manuelle de date peut préciser `end`, `date_status: "confirmed"` et `review_notes: []`.

Pour acquitter une page non structurée après contrôle, copier son `hash` de `sources-status.json` dans `acknowledged_hashes[source_id]`. Une alerte demeure tant que la page n’est pas acquittée ; une simple journée sans changement ne l’efface pas. Les échecs HTTP et les vérifications datant de plus de 48 heures sont signalés séparément.

Les identifiants source restent stables lors des changements de date. Une correction d’une compétition existante conserve son UID iCalendar pour mettre à jour les abonnements.

## Développement et validation

```sh
npm test
npm run update
npm run validate
npm run dev
```

Aucune installation npm n’est requise. Les tests couvrent les homonymies, les plages de dates françaises, les conflits, les échéances d’inscription, les CSV multilignes, les erreurs réseau, les avertissements persistants, l’idempotence des imports, les filtres et les fichiers iCalendar.

Le workflow **Validate calendar and application** vérifie les changements sur les pull requests et sur `main`. Le workflow de mise à jour exécute également les tests avant chaque import.

Le déploiement conserve GitHub Pages sur `main`, dossier racine. Le workflow requiert `contents: write` pour les fichiers générés et `pages: write` pour demander leur publication. Les modifications applicatives sont publiées par le mécanisme GitHub Pages habituel.
