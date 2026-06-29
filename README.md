# Vector Flight Decisions v0.3 Lookup + Upgrade Priority

Decision-first iPhone PWA prototype.

## New in v0.3

- Aircraft type lookup can now infer typical J/O/Y seat counts.
- Seat counts are editable and can be overridden by Boarding Totals readings.
- Add Flight includes paid ticket fare class, Premier status, upgrade instrument, and optional upgrade list position.
- Janus uses those fields as a heuristic upgrade-priority factor in desired/minimum cabin probabilities.
- Basic Economy / N is treated as not upgrade-eligible unless the model is later adjusted.

## Deployment

Upload the contents of this folder to the root of the GitHub repository used for Pages.

Files:
- index.html
- app.js
- styles.css
- manifest.webmanifest
- README.md

If existing files have the same names, uploading/replacing them is fine.

