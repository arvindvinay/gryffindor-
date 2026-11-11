# gryffindor-

Two small web apps built on free APIs from the
[public-apis](https://github.com/public-apis/public-apis) list, which is copied into
`public-apis/` and kept up to date automatically.

| App | What it does | APIs used (no keys needed) |
|---|---|---|
| **[SafeAir Daily](apps/climate/)** | One personal safety score for heat, air quality, UV, pollen and earthquakes. Gives advice for your health profile (asthma, 65+, kids, outdoor workers…), a 24-hour risk timeline with the best time to go out, your own alert limits, and a family list to watch several people and cities. | Open-Meteo (weather, air quality, geocoding), USGS Earthquakes |
| **[Job Radar](apps/jobs/)** | Pulls jobs from several boards and ranks them by how well they fit your résumé. Shows which skills you have and which you're missing for each job, plus the skills that would unlock the most jobs. Your résumé never leaves your browser. | Arbeitnow, Remote OK |

Both are plain HTML/CSS/JavaScript with no build step and no server.

## Run locally

```bash
npm start          # or: python3 -m http.server 8000
# open http://localhost:8000
```

## Tests

```bash
npm test
```

The scoring logic (`apps/climate/risk.js`, `apps/jobs/fit.js`) has no DOM or network
code, so it's unit-tested in Node.

## Publish online (GitHub Pages)

1. Go to **Settings → Pages** and set **Source** to **GitHub Actions**.
2. Push to `claude/public-apis-repo-mjuqsh`, or run **Actions → Test and deploy apps → Run workflow**.
3. The site is published at `https://<your-username>.github.io/gryffindor-/`.

## Automatic updates of the API list

`.github/workflows/sync-public-apis.yml` checks the original repo every day and commits any
new changes into `public-apis/`. You can also run it by hand from **Actions → Sync public-apis**.
To update by hand:

```bash
git subtree pull --prefix=public-apis https://github.com/public-apis/public-apis master --squash
```

## Limits of this first version

- **SafeAir Daily** alerts work only while the page is open. Alerts while the phone is
  locked need a small backend with push notifications (next step). Pollen data covers
  Europe only. The app gives general guidance, not medical advice.
- **Job Radar** matches on keywords against about 100 known skills, not AI, so it can miss
  skills phrased unusually. You can add missed skills by hand. An AI fit score (e.g. with
  the Claude API) would need a small backend to keep the API key secret.
