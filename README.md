# Boleh Lari?

A web app that answers one question for people in Malaysia: **"Is the haze too bad for my walk or run right now?"**

It checks live air quality (AQI) at popular running spots, factors in how hard you plan to exercise (heart-rate zone) and how that changes your breathing, and gives a plain-language verdict. It can also track a walk or run with GPS, similar to Strava, and log how much haze you breathed in along the way.

> Health figures are population averages for comparison, not medical advice.

---

## 1. How the project evolved

| Step | Request | What was built |
|------|---------|----------------|
| 1 | Running paths in Malaysia checked against real-time AQI | 17 curated spots, live AQI from Open-Meteo, map with colour-coded markers, list sorted by cleanest air, "cleaner hour" forecast |
| 2 | Look at heart zones and how breathing affects exposure | Heart-rate zone model (Z1–Z5), breathing volume per zone, nose vs mouth breathing, estimated PM2.5 dose, zone limits per AQI level |
| 3 | Make it a web app | Built as a React + Vite web app (runs in any browser, works on mobile) |
| 4 | Track walking routes like Strava, not just runs | GPS tracker with walk/run modes, live distance/pace/time, AQI re-sampled along the route, AQI-coloured route line, saved history |
| 5 | Minimal, user-friendly UI/UX | Full redesign: one verdict per spot, details on tap, collapsible plan settings, big tracker controls, mobile bottom-sheet layout |
| 6 | Speed up, MVP only | Stopped adding features, verified build and dev server |
| 7 | Map showed "API KEY REQUIRED" | Switched from CARTO tiles (now need a key) to free OpenStreetMap tiles, greyed out so AQI dots stand out |
| 8 | Rename | App renamed to **Boleh Lari?** ("Can I run?" in Malay) |

---

## 2. Features

### Spots tab
- Map of 17 running/walking spots across Peninsular Malaysia, Sabah and Sarawak.
- Each spot shows its live US AQI in a coloured dot and a one-line verdict, e.g. *Good for your run*, *Ease off to Zone 1*, *Treadmill day*.
- List is always sorted cleanest air first. Filter by state.
- Tap a spot (in the list or on the map) to expand it and fly the map there. Details include:
  - Loop distance and surface
  - Estimated PM2.5 reaching your lungs for your planned session, and how many hours of sitting outside that equals
  - A cleaner time window in the next 12 hours (05:00–21:00) if one is meaningfully better
  - AQI category and PM2.5 concentration
- Auto-refreshes every 15 minutes, plus a manual refresh button.

### Your plan (collapsible)
- Walk or Run
- Intensity zone Z1–Z5 (runs only), with your personal bpm range
- Duration, age, and a toggle for asthma / heart or lung conditions (makes advice stricter)
- "How effort changes your breathing" table: bpm, litres of air per minute, breathing mode per zone
- Saved to the browser, so it's remembered next visit

### Track tab
- Start / Pause / Resume / Finish / Discard.
- Large moving-time clock, distance, pace, and haze inhaled (µg PM2.5).
- Live banner with current AQI, verdict, and estimated effort from your speed (e.g. *Brisk walk, breathing ~25 L/min*).
- AQI is re-fetched for your actual position every 10 minutes or 1.5 km.
- Route line on the map is coloured by the AQI in effect for each stretch.
- History list of saved activities (date, distance, time, haze dose, sitting-equivalent). Tap to view the route, × to delete.
- Requests a screen wake lock so the phone doesn't sleep mid-session.

---

## 3. The science model

All numbers live in `src/lib/zones.ts`.

### Heart-rate zones
Max heart rate uses Tanaka et al. (2001): `HRmax = 208 − 0.7 × age`.

| Zone | Name | % HRmax | Air per minute | Breathing | PM2.5 deposition |
|------|------|---------|----------------|-----------|------------------|
| Rest | — | — | 7 L | Nose | 20% |
| Z1 | Recovery | 50–60% | 25 L | Nose | 25% |
| Z2 | Aerobic base | 60–70% | 40 L | Nose + mouth | 30% |
| Z3 | Tempo | 70–80% | 60 L | Mouth | 35% |
| Z4 | Threshold | 80–90% | 85 L | Mouth | 40% |
| Z5 | VO2 max | 90–100% | 120 L | Mouth | 45% |

Why this matters: harder efforts pull in up to ~17× more air than resting. Above ~35 L/min people switch to mouth breathing (Niinimaa et al. 1980), which bypasses the nose's filtering, and a larger share of fine particles deposits in the lungs (Daigle et al. 2003). Ventilation ranges are based on the US EPA Exposure Factors Handbook.

### Dose formula
```
inhaled (µg)   = PM2.5 (µg/m³) × litres per min × minutes / 1000
deposited (µg) = inhaled × deposition fraction
sitting-equivalent (h) = deposited ÷ (PM2.5 × 7 L/min × 60 × 0.20 / 1000)
```

### Advice thresholds (US AQI)

Runs, highest zone advised:

| AQI | Normal | Sensitive |
|-----|--------|-----------|
| 0–50 | Any | Any |
| 51–100 | Any | Up to Z3 |
| 101–150 | Up to Z2 | Up to Z1 |
| 151–200 | Up to Z1 | Indoors |
| 200+ | Indoors | Indoors |

Walks: fine up to AQI 150 (100 if sensitive), "short walk only" up to 200, "stay indoors" above.

### Effort from GPS speed (tracking)
| Speed | Effort |
|-------|--------|
| < 1 km/h | Stopped |
| < 4.5 km/h | Easy walk |
| < 6.5 km/h | Brisk walk (≈Z1) |
| < 8.5 km/h | Jog (≈Z2) |
| < 11 km/h | Run (≈Z3) |
| < 14 km/h | Run (≈Z4) |
| ≥ 14 km/h | Run (≈Z5) |

Speed-to-zone varies a lot with fitness, so this is a rough guide.

---

## 4. Data sources

- **Air quality:** [Open-Meteo Air Quality API](https://open-meteo.com/en/docs/air-quality-api). Free, no API key. Fields used: `us_aqi`, `pm2_5`, `pm10`, per-pollutant AQI sub-indices, and 48h hourly `us_aqi` forecast. All 17 spots are fetched in one request.
  - This is CAMS **model data on an ~11 km grid**, updated hourly, not a ground station reading. Nearby KL spots often share the same value.
  - Malaysia's official index is DOE's API, viewable on [APIMS](https://eqms.doe.gov.my/APIMS/main). It has no simple public API, which is why Open-Meteo was used.
- **Map tiles:** OpenStreetMap standard tiles via Leaflet. (CARTO was tried first but now requires an API key.)
- **Spots:** hand-curated in `src/data/routes.ts`. Coordinates are approximate start points; distances are typical loop lengths.

---

## 5. Tech stack

- React 19 + TypeScript 5.9
- Vite 7
- Leaflet 1.9 + react-leaflet 5
- No backend. No accounts. Everything (plan, activity history) is stored in `localStorage` on the device.

All dependency versions are pinned exactly in `package.json`.

---

## 6. Project structure

```
haze-run/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
└── src/
    ├── main.tsx                 # Entry point, loads Leaflet CSS + styles
    ├── App.tsx                  # Layout, tabs, map, spot list, map overlays
    ├── styles.css               # Minimal design system + mobile layout
    ├── data/
    │   └── routes.ts            # 17 curated spots
    ├── lib/
    │   ├── aqi.ts               # Open-Meteo fetchers, AQI colour bands, best window
    │   ├── zones.ts             # HR zones, breathing, dose, zone limits, speed→effort
    │   ├── verdict.ts           # Plain-language verdict + planned dose, user profile
    │   ├── track.ts             # Track types, distance/pace/dose summary, storage
    │   └── format.ts            # clamp, hour formatting
    ├── hooks/
    │   └── useTracker.ts        # GPS watch, filtering, AQI sampling, wake lock
    └── components/
        ├── Settings.tsx         # Collapsible "Your plan" + breathing table
        ├── TrackPanel.tsx       # Tracker UI + history
        └── Segmented.tsx        # Walk/Run toggle control
```

---

## 7. Running it

```bash
cd haze-run
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build to dist/
npm run preview    # serve the production build
```

### Testing GPS tracking on a phone
Browsers only allow location access on **HTTPS or localhost**.

1. `npx vite --host` to expose on your network.
2. Put it behind an HTTPS tunnel (e.g. ngrok) and open that URL on your phone.
3. Keep the tab open and the screen on. Browsers pause GPS when the page is in the background.

---

## 8. UI/UX decisions

- **One answer per spot.** The list leads with a verdict, not raw numbers. Numbers sit one tap away.
- **Cleanest first, always.** Sorting options were removed because that's the question users actually ask.
- **Plan collapsed by default.** A one-line summary ("Run · Zone 2 · 45 min") with Edit. The science table is nested further inside.
- **Shared plan.** Choosing Walk or Run in the plan also sets the tracker mode, and vice versa.
- **Tracker built for use mid-run.** Big clock, big buttons, Finish only appears after Pause to avoid accidental stops.
- **Muted map.** Greyscale tiles keep focus on the AQI colours.
- **Mobile.** Map sits on top, content slides up as a sheet.
- **Accessibility.** Semantic buttons/lists, `aria-expanded`/`aria-pressed`/`aria-live`, visible focus rings, screen-reader labels for AQI dots, `prefers-reduced-motion` respected. Full WCAG compliance would still need manual testing with assistive technologies.

---

## 9. GPS tracking details

`src/hooks/useTracker.ts`

- Uses `navigator.geolocation.watchPosition` with high accuracy.
- Drops fixes with accuracy worse than 35 m, steps under 3 m (standing-still jitter), and jumps implying > 40 km/h.
- Each pause starts a new segment, so the route line and distance don't bridge the gap.
- Moving time only counts stretches faster than 1 km/h.
- Dose is integrated per GPS step using the speed-based effort and the AQI sample in effect at that moment.
- Activities with fewer than 2 points aren't saved.

---

## 10. Known limitations / next steps

- AQI is a model estimate, not a station reading. A future version could blend in DOE APIMS or WAQI station data (WAQI needs a free token).
- No heart-rate monitor input; effort while tracking is inferred from speed.
- GPS stops when the browser is backgrounded. A native app or PWA with background location would fix that.
- History is per device only; no sync, export (GPX) or accounts.
- Spot coordinates are approximate start points, not full route polylines.
- OpenStreetMap's public tile server has a fair-use policy. For real traffic, use a tile provider with a key (MapTiler, Stadia, etc.).
- No automated tests yet.
