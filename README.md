# Vector — Flight Decisions v0.5

Decision-first nonrev support app for iPhone/GitHub Pages.

## What changed in v0.5

- New tracked-flight intake uses dropdowns where possible.
- Aircraft type dropdown auto-populates expected United J/O/Y seat counts.
- Manual override is always available; Boarding Totals observations should be treated as the source of truth.
- Observation workflow now supports typing any reading manually, including:
  - Boarding Totals J/O/Y available, booked, and capacity
  - Upgradable Premiers
  - Revenue standby and space-available standby
  - Your standby and upgrade positions
  - Public and employee J/O/Y fares
  - O and J upgrade offers in cash and miles
- Janus logic now uses dynamic observation fares and upgrade offers, not just values entered at flight creation.
- Local storage migrates from previous Vector prototype keys when possible.

## Data source notes

Aircraft layouts are seeded from publicly visible United fleet/seat-map information and AeroLOPA-style layout references. They are starting defaults only. Verify with Boarding Totals whenever available.

## Deploy

Upload the contents of this folder to the root of your GitHub Pages repository.
