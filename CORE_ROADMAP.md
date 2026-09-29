# Ocean Data Visualization Platform — FINAL COMPLETE CORE ROADMAP

**Document type:** Planning / roadmap revision only. No code was written, no project file was modified, and no phase was started to produce this. Read-only audit + corrected roadmap.

**Original problem statement (the sole basis for CORE):**
> *"Develop a web-based interactive 3D visualization platform that integrates numerical ocean model outputs and in-situ observations."*

Two co-equal core pillars: **(1) numerical ocean model outputs** (gridded fields) and **(2) in-situ observations**. This roadmap covers everything the problem statement requires — not what is easiest to build.

Source facts marked **(verified)** were confirmed against the live catalogs on **2026-09-10**. Sources marked **(to confirm)** must be located in the live catalog at implementation time and must never be fabricated.

---

## 1. HEADLINE COUNTING

```
TOTAL CORE PHASES:              14
COMPLETED CORE PHASES:           3   (Phases 1, 2, 3)
PARTIALLY COMPLETED CORE PHASES: 1   (Phase 14 — foundation only)
REMAINING CORE PHASES:          10   (Phases 4–13)
CURRENT CORE PHASE:              Phase 4 — Gridded model-field ingestion foundation
```

```
OPTIONAL FEATURES:  ecosystem/creatures, Gemini + WoRMS/OBIS species intelligence,
                    OceanCodex, coral, shipwreck, seabed anchoring, torch, radar,
                    cinematic camera/presets, PFZ, SAR/drift, feature-detection,
                    historical playback, WebGPU (absent).
STATUS:             ~85% "feature-present" — extensive and largely working, BUT
                    carries a data-integrity flaw (synthetic telemetry mislabeled as
                    real agencies) and several self-labeled "prototype" toy engines.
                    OPTIONAL COMPLETION DOES NOT COUNT TOWARD CORE COMPLETION.
```

---

## 2. PROJECT STATUS — PERCENTAGES (with calculation)

### CORE ≈ **35%**

Calculated by requirement-coverage over the 44 mandatory core requirements (below), scoring each COMPLETE = 1.0, PARTIAL = fractional, NOT STARTED = 0.0. Synthetic/hardcoded code (`OceanDataManager`, PFZ, Drift, FeatureDetection, Historical, synthetic `InstrumentManager`) is scored **0** — it is never counted as real model/observation data.

- COMPLETE (1.0 each) — reqs 11, 26, 29, 30, 31, 32, 33, 34, 35, 36, 39, 44 → **12.0**
- PARTIAL — 4 (0.5), 10 (0.5), 12 (0.5), 13 (0.25), 17 (0.25), 37 (0.5), 38 (0.5), 42 (0.3), 43 (0.3) → **3.6**
- NOT STARTED (0.0) — the remaining 23 reqs → **0.0**
- **Total = 15.6 / 44 = 35.5% ≈ 35%**

Interpretation: the **in-situ observations sub-pillar is ~90% done**, but it is roughly half of one of two pillars. The **numerical-model-output pillar (fields, currents, depth slices, isosurfaces, volume, time animation) is ~0–5%**, and the multi-source / OGC / CF / OPeNDAP scope is unstarted. Those drag CORE to ~35%.

### OPTIONAL ≈ **85%**

Of ~17 optional feature groups, ~15 exist and function; ~2 are prototype-grade or integrity-flawed. 15/17 ≈ 88%, discounted to **~85%** for the mislabeled-telemetry defect and the toy simulation engines. This is "is the feature present and working," not scientific validity.

### OVERALL PROJECT ≈ **45%** (see caveat)

Weighted **80% core / 20% optional** because the problem statement is entirely core and optional work must not substitute for it:
`0.80 × 35% + 0.20 × 85% = 28% + 17% = 45%`.

> ⚠️ **The number that matters for the mandate is CORE ≈ 35%.** The 45% "overall" figure includes optional work that does **not** satisfy the problem statement. Do not read 45% as "the project is nearly half done against its purpose" — against its purpose it is ~35%.

---

## 3. MANDATORY CORE REQUIREMENTS — coverage map (44)

| # | Requirement | Status | Phase |
|---|---|---|---|
| 1 | Numerical ocean model ingestion | NOT STARTED | 4 |
| 2 | Real NetCDF ingestion | NOT STARTED | 4 |
| 3 | ASCII/delimited text ingestion | NOT STARTED | 12 |
| 4 | INCOIS data sources | PARTIAL (Argo done; model griddap not) | 2✅ / 4 |
| 5 | Copernicus numerical ocean model | NOT STARTED | 10 |
| 6 | OPeNDAP / THREDDS | NOT STARTED | 4 (reader) / 10 (first real use) |
| 7 | Real temperature fields | NOT STARTED | 4→5 |
| 8 | Real salinity fields | NOT STARTED | 4→5 |
| 9 | REAL current vectors (U/V) | NOT STARTED | 10 |
| 10 | Depth dimension | PARTIAL (real in Argo profiles; not in fields) | 2✅ / 4–5 |
| 11 | Latitude/longitude spatial dims | COMPLETE | 1–3✅ |
| 12 | Time dimension | PARTIAL (timestamps real; no time axis/animation) | 2✅ / 7 |
| 13 | 3D depth-resolved visualization | PARTIAL (3D scene + surface markers; no depth-resolved field) | 3✅ / 5–7 |
| 14 | Horizontal depth slices | NOT STARTED | 5 |
| 15 | Isosurfaces | NOT STARTED | 8 |
| 16 | Volumetric rendering | NOT STARTED | 9 |
| 17 | Variable selector | PARTIAL (TEMP/PSAL toggle on profile chart only) | 1✅ / 5 |
| 18 | Dynamic scientific colorbar | NOT STARTED | 6 |
| 19 | Color min/max | NOT STARTED | 6 |
| 20 | Linear/log scale | NOT STARTED | 6 |
| 21 | Opacity | NOT STARTED | 6 |
| 22 | Vertical exaggeration | NOT STARTED (method exists, no UI) | 6 |
| 23 | Depth selector | NOT STARTED | 5 |
| 24 | Time slider | NOT STARTED | 7 |
| 25 | Time-step animation | NOT STARTED | 7 |
| 26 | Real Argo observations | COMPLETE | 2✅ |
| 27 | Real Glider observations | NOT STARTED | 11 |
| 28 | Real CTD observations | NOT STARTED | 11 |
| 29 | Observation markers | COMPLETE | 2✅ |
| 30 | Click observation → profile | COMPLETE | 2✅ |
| 31 | Depth-vs-variable profile chart | COMPLETE | 2✅ |
| 32 | Observation timestamps | COMPLETE | 2✅ |
| 33 | Observation metadata | COMPLETE | 2✅ |
| 34 | QC information where available | COMPLETE | 2✅ |
| 35 | Dataset catalog | COMPLETE | 1✅ |
| 36 | Modular adapter architecture | COMPLETE (foundation) | 1✅ |
| 37 | Backend spatial/depth/time subsetting | PARTIAL (obs bbox/limit/time; no field subsetting) | 1✅ / 4 |
| 38 | Browser not sent huge raw datasets | PARTIAL (obs limited; fields N/A yet) | 1✅ / 4 |
| 39 | Indian Ocean / Indian EEZ visualization | COMPLETE | 3✅ |
| 40 | OGC WMS/WCS compatibility | NOT STARTED | 13 |
| 41 | CF Conventions compatibility | NOT STARTED | 4 (parse) / 13 (harden) |
| 42 | Extensibility (moorings/HF radar/ADCP/BGC/ML) | PARTIAL (adapter arch extensible) | 14 |
| 43 | Deployment-ready for INCOIS infrastructure | PARTIAL (split services; no deploy packaging) | 14 |
| 44 | No fabricated scientific data | COMPLETE for the real pipeline (optional layer needs relabel) | standing / 4 |

---

## 4. DATA SOURCE TABLE — actual source per variable

Do not claim a source supports a variable it does not. Verified where marked.

| Requirement | Actual dataset / source | Format / API | Status |
|---|---|---|---|
| **Temperature model field** | INCOIS ERDDAP `incois_argo_10d_VAM` (+ `incois_argo_10day_McCreary`, monthly variants) — TEMP; Copernicus `GLOBAL_ANALYSISFORECAST_PHY_001_024` `thetao`; HYCOM GOFS3.1 `water_temp` | ERDDAP griddap (NetCDF/CSV); OPeNDAP; copernicusmarine subset | NOT STARTED (INCOIS source **verified**) |
| **Salinity model field** | INCOIS `incois_argo_10d_VAM` — SAL; Copernicus `so`; HYCOM `salinity` | ERDDAP griddap; OPeNDAP | NOT STARTED (INCOIS source **verified**) |
| **Current U/V** | **Copernicus `GLOBAL_ANALYSISFORECAST_PHY_001_024`** — `uo`/`vo`, 50 depth levels **(verified)** [auth]; **OR HYCOM GOFS3.1 / ESPC-D-V02** — `water_u`/`water_v` depth-resolved **(verified)** [no auth]. **INCOIS griddap has NO current dataset (verified).** | copernicusmarine toolbox / subset / WMS; or THREDDS OPeNDAP (NetCDF) | NOT STARTED (sources **verified**) |
| **Argo** | INCOIS ERDDAP `Indian_ARGO_Floats` | ERDDAP tabledap (JSON) | **COMPLETE** ✅ |
| **Glider** | IOOS Glider DAC ERDDAP (`gliders.ioos.us/erddap`); INCOIS glider dataset if published | ERDDAP tabledap | NOT STARTED (source **to confirm**) |
| **CTD** | NCEI World Ocean Database; or INCOIS/NIOT CTD casts | ERDDAP / NODC | NOT STARTED (source **to confirm**) |
| **NetCDF** | *Format*, not a source — carried by HYCOM/Copernicus/ERDDAP griddap responses | `netCDF4` / `xarray` | NOT STARTED |
| **ASCII** | ERDDAP `.csv`/`.tsv`; generic delimited uploads | text/delimited parser | NOT STARTED |
| **OPeNDAP** | HYCOM `tds.hycom.org` **(verified)**; Copernicus OPeNDAP endpoints | `pydap` / `xarray` | NOT STARTED (HYCOM endpoint **verified**) |
| **THREDDS** | HYCOM GOFS3.1 THREDDS (`GLBy0.08/expt_93.0`, …) **(verified)** | THREDDS catalog + OPeNDAP | NOT STARTED (**verified**) |
| **Copernicus** | CMEMS `GLOBAL_ANALYSISFORECAST_PHY_001_024` (uo/vo/thetao/so + 50 levels) **(verified)**; reanalysis `GLOBAL_MULTIYEAR_PHY_001_030` (GLORYS12V1) | copernicusmarine toolbox (free account) | NOT STARTED (**verified**) |
| **INCOIS** | ERDDAP `https://erddap.incois.gov.in/erddap` — tabledap Argo (done); griddap TEMP/SAL (VAM/McCreary); **no gridded currents (verified)** | ERDDAP tabledap/griddap | **PARTIAL** (Argo done) |

---

## 5. CURRENTS (U/V) — the authoritative source and integration plan

`incois_argo_10d_VAM` contains **TEMP/SAL only — no currents (verified)**. The INCOIS ERDDAP **griddap catalog contains no ocean-current velocity dataset at all (verified 2026-09-10)**. Therefore currents must come from a real numerical ocean model outside INCOIS's gridded catalog:

**Primary (satisfies "Copernicus numerical ocean model", req 5 + 9):**
- **CMEMS `GLOBAL_ANALYSISFORECAST_PHY_001_024`** — `uo` (eastward), `vo` (northward), plus `thetao`, `so`, over **50 depth levels (0–5500 m)** — verified.
- **Access:** requires a free Copernicus Marine account. Ingested **server-side only** via the `copernicusmarine` Python toolbox (ARCO/Zarr subset) or the subset service; credentials live in the Python ingestion service, **never in the browser**. The server subsets by bbox + depth + time and returns compact typed arrays/JSON — the browser never receives the global grid (req 37/38).

**No-auth alternative that also satisfies OPeNDAP/THREDDS (req 6):**
- **HYCOM GOFS 3.1 / ESPC-D-V02** via `tds.hycom.org` THREDDS OPeNDAP — `water_u`/`water_v`/`water_temp`/`salinity` on depth levels (verified). One source delivers currents **and** exercises the OPeNDAP/THREDDS requirement, with no authentication.

**INCOIS-specific note:** if a specifically-INCOIS current product is required, it is not in the public griddap index; candidates are INCOIS **HF-radar surface currents** (surface only; separate service — to confirm) or INDOFOS operational model output (not in the public ERDDAP griddap). These would be added as additional adapters, not as a substitute for the depth-resolved Copernicus/HYCOM source.

**Integration path (Phase 10):** reuse Phase 4's NetCDF/CF + OPeNDAP reader and server-side subsetting; add a `CurrentField` adapter that returns `U`/`V` on the canonical `ModelField` grid; the frontend renders vector glyphs / streamlines (arrows scaled by speed, optional LIC), colored by speed magnitude, reusing the depth selector (Phase 5), colorbar (Phase 6) and time slider (Phase 7).

---

## 6. CORE PHASE PLAN

### Phase 1 — Ingestion & gateway framework + modular adapters + catalog
- **Purpose:** The service backbone every data type flows through.
- **Requirements covered:** 35, 36, part of 43, standing 44.
- **Actual data source:** N/A (framework).
- **Backend work:** Python FastAPI ingestion (`ingestion/app.py`); adapter registry (`catalog.py`); canonical model (`models.py` — `Observation`, `ProfileLevel`, `ModelField` schema); TLS-aware HTTP client + TTL cache (`http_client.py` + `truststore`); Node/Express gateway (`server/index.js`) with 502-on-unreachable; Vite proxy.
- **Frontend work:** `OceanDataService` client (throws `DataError`, never fabricates).
- **Acceptance criteria:** requests proxy cleanly; unreachable upstream ⇒ explicit 502; no synthetic fallback anywhere in the real path.
- **Dependencies:** none.
- **Status:** **COMPLETE** ✅

### Phase 2 — Real Argo in-situ observations (INCOIS ERDDAP), end-to-end
- **Purpose:** The in-situ observations pillar for Argo.
- **Requirements covered:** 4 (Argo part), 26, 29, 30, 31, 32, 33, 34, 17 (profile toggle), 10 (profile depth), 37/38 (obs subsetting).
- **Actual data source:** INCOIS ERDDAP tabledap `Indian_ARGO_Floats` **(verified, real)**.
- **Backend work:** `erddap_argo.py` (`list_observations` with bbox/time/`orderByMax`; `get_profile` with PRES/TEMP/PSAL raw+adjusted + QC; depth-from-pressure honestly labelled); `/api/observations`, `/api/observations/{id}/profile`.
- **Frontend work:** `ObservationLayer` (real `argo_float.glb` markers by lat/lon), `ObservationProfileViewer` (depth-vs-TEMP/PSAL, QC coloring), `DataVizPanel` (dataset/bbox/limit controls).
- **Acceptance criteria:** markers at real positions; click → real profile; nothing interpolated/invented.
- **Dependencies:** Phase 1.
- **Status:** **COMPLETE** ✅

### Phase 3 — 3D globe geographic entry + Indian EEZ + coordinate transforms
- **Purpose:** Geographic entry point; pick a real location → enter the ocean centered there.
- **Requirements covered:** 11, 39, part of 13.
- **Actual data source:** user-supplied Earth basemap (`src/assets/earth/earth.png`); honest placeholder if absent.
- **Backend work:** none.
- **Frontend work:** `GlobeView` (real textured sphere), `GlobeCoordinateTransform` (ray-sphere→lat/lon: `asin(y/r)`, `atan2(z,−x)−180`), `SelectedLocation` bridge, `GeoTransform` (lat/lon↔ocean world), bidirectional Globe↔Ocean mode switch.
- **Acceptance criteria:** boots into globe; real lat/lon on pick; Explore/Return preserves selection; region drives the real Argo query.
- **Dependencies:** Phase 2.
- **Status:** **COMPLETE** ✅

### Phase 4 — Gridded model-field ingestion foundation (NetCDF · CF · OPeNDAP · subsetting) ⭐ NEXT
- **Purpose:** Build the model-output backend the entire pillar depends on; turn verified INCOIS TEMP/SAL griddap into real fields.
- **Requirements covered:** 1, 2, 6 (reader), 7, 8 (backend), 10 (field depth axis), 12 (field time axis), 37, 38, 41 (parse). Also: relabel/quarantine the synthetic `OceanDataManager`/`InstrumentManager` demo layer so real and synthetic never blur (req 44 hygiene).
- **Actual data source:** INCOIS ERDDAP griddap `incois_argo_10d_VAM` (TEMP/SAL, 24 depth levels 5–2000 m, time axis) **(verified)**; reader also built to consume NetCDF + OPeNDAP/THREDDS for later phases.
- **Backend work:** griddap/NetCDF/OPeNDAP readers (`xarray`/`netCDF4`/`pydap`); CF attribute parsing (standard_name/units/`_FillValue −9999`); populate canonical `ModelField`; **server-side spatial+depth+time subsetting**; implement `/api/model/field` (route already scaffolded) + `catalog.register()` for the model adapter.
- **Frontend work:** add `getModelField()` to `OceanDataService` (no viz yet).
- **Acceptance criteria:** `/api/model/field?var=TEMP&depth=…&bbox=…&time=…` returns a **real** subsetted INCOIS grid; 502 on unreachable; browser never receives the full grid; missing `−9999` handled.
- **Dependencies:** Phase 1.  **Blocks Phases 5–10.**
- **Status:** **NOT STARTED**

### Phase 5 — 3D depth-slice field visualization + variable selector + depth selector
- **Purpose:** Render a real TEMP/SAL horizontal slice at a chosen depth in the 3D scene.
- **Requirements covered:** 13, 14, 17 (field variable), 23, 10 (field depth).
- **Actual data source:** Phase 4 output (INCOIS TEMP/SAL).
- **Backend work:** none new (consumes Phase 4).
- **Frontend work:** field layer (colored slice mesh via `GeoTransform`); variable selector (TEMP/SAL); depth selector over the 24 levels; DataVizPanel toggle.
- **Acceptance criteria:** slice shows real values at correct lat/lon/depth; changing variable/depth re-queries and re-renders.
- **Dependencies:** Phase 4.
- **Status:** **NOT STARTED**

### Phase 6 — Scientific colorbar + color min/max + linear/log + opacity + vertical exaggeration
- **Purpose:** Make field values scientifically legible and adjustable.
- **Requirements covered:** 18, 19, 20, 21, 22.
- **Actual data source:** Phase 4 output.
- **Backend work:** none.
- **Frontend work:** dynamic value colorbar with units/ticks; min/max inputs; linear/log toggle; opacity slider; wire the existing (unused) `GeoTransform.setVerticalExaggeration` to a slider.
- **Acceptance criteria:** colorbar matches rendered colors and units; min/max + log + opacity + exaggeration visibly and correctly update the field.
- **Dependencies:** Phase 5.
- **Status:** **NOT STARTED**

### Phase 7 — Time dimension: time slider + time-step animation + observation time-window
- **Purpose:** Query and animate across time for both fields and observations.
- **Requirements covered:** 12, 24, 25 (obs timestamps already done in Phase 2).
- **Actual data source:** Phase 4 (field time axis) + Phase 2 (observation `start`/`end`, already supported by `OceanDataService` but never sent).
- **Backend work:** ensure `/api/model/field` accepts a time index/range (from Phase 4).
- **Frontend work:** time slider + play/pause animation re-querying fields; add start/end inputs to `DataVizPanel` for observations.
- **Acceptance criteria:** scrubbing/playing steps through real time steps; observation time-window filters real floats.
- **Dependencies:** Phases 4 (fields), 2 (obs).
- **Status:** **NOT STARTED**

### Phase 8 — Isosurfaces
- **Purpose:** 3D surfaces of constant value (e.g. the 20 °C isotherm).
- **Requirements covered:** 15.
- **Actual data source:** Phase 4 output.
- **Backend work:** optional server-side extraction, or send subsetted volume for client marching-cubes.
- **Frontend work:** isosurface mesh generation + threshold control.
- **Acceptance criteria:** isosurface reflects real field values at the chosen threshold/depth range.
- **Dependencies:** Phase 4 (+ Phase 6 color tooling).
- **Status:** **NOT STARTED**

### Phase 9 — Volumetric rendering
- **Purpose:** True depth-resolved 3D volumetric field.
- **Requirements covered:** 16, deepens 13.
- **Actual data source:** Phase 4 output (multi-level volume).
- **Backend work:** compact multi-level volume subsetting/encoding.
- **Frontend work:** 3D-texture ray-march volume shader; transfer function tied to the colorbar.
- **Acceptance criteria:** volume renders real multi-level data; interactive depth/opacity.
- **Dependencies:** Phase 4 (+ Phases 6, 8 tooling).
- **Status:** **NOT STARTED**

### Phase 10 — Real current vectors via Copernicus / HYCOM (OPeNDAP/THREDDS) + current-vector viz
- **Purpose:** Deliver real ocean currents — the variable INCOIS gridded products cannot provide.
- **Requirements covered:** 5 (Copernicus), 6 (OPeNDAP/THREDDS first real use), 9 (real U/V vectors).
- **Actual data source:** **CMEMS `GLOBAL_ANALYSISFORECAST_PHY_001_024`** (`uo`/`vo`, 50 levels) **(verified, auth)** and/or **HYCOM GOFS3.1/ESPC-D-V02** (`water_u`/`water_v`) via THREDDS OPeNDAP **(verified, no auth)**. See §5.
- **Backend work:** `copernicusmarine` toolbox integration with server-side credentials (never in browser) and/or `pydap`/`xarray` OPeNDAP client for HYCOM; `CurrentField` adapter → canonical `ModelField` (U/V); server-side subsetting.
- **Frontend work:** vector-glyph / streamline / arrow layer colored by speed magnitude; reuses depth (5), colorbar (6), time (7).
- **Acceptance criteria:** real U/V rendered as vectors at correct lat/lon/depth/time; no fabricated velocities; 502 on unreachable.
- **Dependencies:** Phase 4 (reader + subsetting), Phases 5–7 (controls).
- **Status:** **NOT STARTED**

### Phase 11 — Additional real in-situ platforms: Glider + CTD
- **Purpose:** Broaden in-situ observations beyond Argo.
- **Requirements covered:** 27 (Glider), 28 (CTD).
- **Actual data source:** IOOS Glider DAC ERDDAP (gliders); NCEI WOD / INCOIS CTD casts **(to confirm)**.
- **Backend work:** glider + CTD tabledap adapters → canonical `Observation`/`ProfileLevel`; register in catalog.
- **Frontend work:** activate the commented-out `glider`/`buoy`/`ctd` marker paths in `ObservationLayer` (real `glider.glb`/`moored_buoy.glb` assets already present); profile viewer already generic.
- **Acceptance criteria:** real glider/CTD markers + profiles; no synthetic values (delete/quarantine dead `GliderManager`/`ArgoManager`).
- **Dependencies:** Phases 1, 2.
- **Status:** **NOT STARTED**

### Phase 12 — ASCII / delimited text ingestion
- **Purpose:** Ingest ASCII/text observation & model exports.
- **Requirements covered:** 3.
- **Actual data source:** ERDDAP `.csv`; generic delimited files.
- **Backend work:** delimited parser → canonical model; column mapping; unit/CF hints.
- **Frontend work:** minimal (appears via existing catalog/observation UI).
- **Acceptance criteria:** a real ASCII dataset ingests and renders identically to a native source; malformed input errors explicitly (no fabrication).
- **Dependencies:** Phase 1.
- **Status:** **NOT STARTED**

### Phase 13 — OGC WMS/WCS compatibility + CF-Conventions hardening
- **Purpose:** Standards compatibility for INCOIS/interop.
- **Requirements covered:** 40 (OGC WMS/WCS), 41 (CF hardening).
- **Actual data source:** consume CMEMS/INCOIS WMS View services; optionally expose our subsetted fields via a WMS/WCS-style endpoint.
- **Backend work:** OGC client (and/or lightweight server); enforce CF metadata end-to-end.
- **Frontend work:** optional WMS overlay layer.
- **Acceptance criteria:** a real OGC WMS layer displays; our field metadata is CF-valid.
- **Dependencies:** Phase 4.
- **Status:** **NOT STARTED**

### Phase 14 — Extensibility hooks + INCOIS deployment-readiness + scalability
- **Purpose:** Ready for future data types and real INCOIS deployment.
- **Requirements covered:** 42 (moorings/HF radar/ADCP/BGC/ML hooks), 43 (deployment-ready), scale side of 36/38.
- **Actual data source:** N/A (architecture) + future INCOIS feeds.
- **Backend work:** documented adapter contract for new platforms/variables; caching/rate-limit/pagination for large catalogs; containerization/config for INCOIS hosting; health/telemetry.
- **Frontend work:** generic layer registration so new variables/platforms appear without bespoke code.
- **Acceptance criteria:** a new adapter can be added without touching the frontend; deployable to INCOIS infra with documented config.
- **Dependencies:** Phases 4, 11.
- **Status:** **PARTIAL** (modular adapter foundation exists; explicit new-type hooks, scale hardening and deployment packaging not done).

---

## 7. VERY IMPORTANT — synthetic code is NOT numerical-model visualization

The following are **synthetic/hardcoded** (confirmed by the audit) and are scored **0** toward every model/observation requirement. They must stay completely separate from the real scientific pipeline:

- `src/ocean/OceanDataManager.js` — parametric TEMP/SAL/current formulas (`dataSource='demo'`). Feeds only PFZ/Drift.
- `src/simulation/PFZEngine.js` — hardcoded fishing-zone array; ignores its data input.
- `src/simulation/DriftSimulationEngine.js` — synthetic (runs on the synthetic field).
- `src/detection/FeatureDetectionEngine.js` — hardcoded eddies/heatwave.
- `src/simulation/HistoricalSimulation.js` — toy playback clock, no data.
- `src/instruments/InstrumentManager.js` — **synthetic telemetry mislabeled `'INCOIS'/'International Argo Program'/'NOAA'`; live and user-visible.** ⚠️ **Core-integrity fix required** (relabel/gate) — folded into Phase 4 kickoff so real fields are never confused with the demo layer. Relates to req 44.

Dead synthetic code (`src/instruments/ArgoManager.js`, `src/instruments/GliderManager.js`) is not imported; remove/quarantine during Phase 11.

---

## 8. ARGO AUTHENTICITY — conclusion carried forward (unchanged)

The Argo observation path is genuinely API-backed, end-to-end:

`INCOIS ERDDAP → Python ingestion → Node gateway → Vite → Three.js`

For returned Argo data: **latitude real · longitude real · platform number real · position real · timestamp real · float count = count of returned observations · profile values (PRES/TEMP/PSAL + QC) real · no synthetic fallback** (unreachable ⇒ HTTP 502). Source: INCOIS ERDDAP tabledap `Indian_ARGO_Floats`, base `https://erddap.incois.gov.in/erddap`; live-fetched with a short server-side TTL cache.

---

## 9. WHAT SHOULD WE IMPLEMENT NEXT?

**Exactly one phase: Phase 4 — Gridded model-field ingestion foundation** (NetCDF · CF · OPeNDAP/THREDDS readers + server-side subsetting + INCOIS TEMP/SAL griddap adapter + `/api/model/field`).

**Why this one:**
1. It is the **missing core pillar's foundation** — the entire numerical-model-output side (Phases 5–10, including currents) is blocked on it.
2. It converts a **verified real source** (INCOIS `incois_argo_10d_VAM` TEMP/SAL) into real fields — no new external accounts needed to start.
3. It builds the **NetCDF/CF/OPeNDAP reader** that Copernicus/HYCOM currents (Phase 10) reuse — so the currents fix rides on this foundation.
4. It enforces **backend subsetting** (reqs 37/38) so the browser never receives huge raw grids — a standards/scale requirement, not an afterthought.
5. The **scaffolding already exists** (`ModelField` schema, `/api/model` route, `get_bytes` download infra), making this the lowest-friction, highest-core-value next step.
6. Its kickoff also **quarantines/relabels the synthetic demo layer** (req 44 hygiene) so real and fake data can never be confused.

**Do NOT implement it yet. No files will be changed. Awaiting approval.**
