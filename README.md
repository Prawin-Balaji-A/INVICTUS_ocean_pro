# INVICTUS Ocean Pro

> **A Real-Time Marine Digital Twin & Scientific Oceanographic Intelligence Platform**  
> *Combining high-fidelity 3D WebGL physics, autonomous marine ecosystems, multi-source oceanographic observation networks (INCOIS, Copernicus Marine Service, IFREMER), and offline-first biological intelligence.*

[![Three.js](https://img.shields.io/badge/Three.js-r185-black?style=flat-square&logo=three.js)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-6.0-646CFF?style=flat-square&logo=vite)](https://vitejs.dev/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110+-009688?style=flat-square&logo=fastapi)](https://fastapi.tiangolo.com/)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square&logo=node.js)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

---

## 🌊 Overview

**INVICTUS Ocean Pro** is an ocean digital twin and scientific oceanographic exploration platform. It bridges numerical ocean model forecasting, real-time in-situ physical oceanography, and biological ecosystem dynamics in an interactive 3D environment.

Built with **Three.js**, **Node.js**, and **Python (FastAPI)**, the platform ingests heterogeneous physical ocean observations (Argo floats, gliders, moored buoys, surface drifters) and gridded model fields (sea surface temperature, salinity, currents, mixed layer depth), dynamically rendering them alongside living marine ecosystems.

```
                           ┌──────────────────────────────────────────────┐
                           │              INVICTUS Ocean Pro              │
                           │           Interactive 3D WebGL App           │
                           └──────────────────────┬───────────────────────┘
                                                  │
                 ┌────────────────────────────────┴────────────────────────────────┐
                 │                                                                 │
    ┌────────────▼────────────┐                                      ┌─────────────▼─────────────┐
    │    Node.js Gateway      │                                      │  Python Ingestion Service │
    │     (Port 3000)         │                                      │        (Port 8000)        │
    ├─────────────────────────┤                                      ├───────────────────────────┤
    │ • Ocean Codex API       │                                      │ • INCOIS ERDDAP Tabledap  │
    │ • Gemini AI Agent       │                                      │ • Copernicus Marine CMEMS │
    │ • WoRMS / FishBase /    │                                      │ • IFREMER Global Argo     │
    │   OBIS Integration      │                                      │ • NetCDF4 / Xarray Reader │
    │ • Knowledge Persistence │                                      │ • SSL Fallback Engine     │
    └─────────────────────────┘                                      └───────────────────────────┘
```

---

## 🔬 Core Capabilities

### 1. Physics-Based Ocean Simulation & Rendering
- **Spectral Gerstner Waves**: Procedurally generated multi-frequency wave spectrum with deep-water dispersion, three cascades of flow-aligned detail normal maps, and dynamic foam generation on breaking crests.
- **Subsurface Optics & Underwater Lighting**:
  - **Beer–Lambert Absorption**: Wavelength-dependent light attenuation (red light extinguishes in the shallows; blue and cyan penetrate into the deep).
  - **Snell's Window**: Realistic total internal reflection and refractive ceiling viewed from beneath the sea surface.
  - **Animated Volumetric God-Rays & Caustics**: Raymarched light shafts projected along the solar vector and modulated against moving seabed caustic patterns.
- **Dynamic Atmosphere**: Procedural sky dome with time-of-day progression, volumetric raymarched cloud slabs with Henyey–Greenstein phase scattering, and matching screen-space reflections (SSR).
- **Cinematic Presets**: One-click environment calibrations: *Tropical Noon*, *Golden Hour*, *Crimson Sunset*, *Blue Hour*, *Clear Dawn*, and *Stormy Seas*.

### 2. Heterogeneous Oceanographic Data Ingestion
- **INCOIS ERDDAP & LAS**:
  - Real-time observation retrieval from the **Indian Ocean Argo Floats** dataset (`Indian_ARGO_Floats`).
  - Access to the **INCOIS Ocean Observation Network (OON)**: Moored buoys, drifting buoys, automated weather stations (AWS), high-frequency (HF) radar, Rama buoys, and tide gauges.
  - Direct `tabledap` streaming with robust error handling and automated fallback paths for uninterrupted scientific research.
- **Copernicus Marine Service (CMEMS)**:
  - Gridded numerical ocean model fields: Sea Water Potential Temperature (`thetao`), Practical Salinity (`so`), Eastward/Northward Water Velocity (`uo`, `vo`), Mixed Layer Depth (`mlotst`), and Sea Surface Height (`zos`).
- **IFREMER Global Argo Network**:
  - Ingestion of worldwide profiling floats delivering verified vertical CTD profiles (Conductivity, Temperature, Depth).
- **Resilient Connectivity Engine**:
  - Python ingestion service equipped with OS CA certificate injection (`truststore`) to resolve enterprise SSL/TLS handshake failures against governmental ERDDAP servers.

### 3. 4D Scientific Data Cube & Analytics
- **Marching Cubes 3D Isosurfaces**: Client-side extraction of real-time 3D scalar surfaces (thermoclines and haloclines) directly within the water column.
- **Vertical CTD Profile Visualizer**: Interactive station inspection graphing Temperature (°C) and Salinity (PSU) versus Pressure/Depth (dbar/m).
- **Lagrangian Particle Drift Simulation**: 4th-order Runge-Kutta (RK4) advection engine simulating the trajectories of passive drifters, oil dispersion, or marine debris driven by Copernicus surface velocity vectors (`u`, `v`).
- **Potential Fishing Zone (PFZ) Engine**: Thermal front boundary and chlorophyll-a gradient detection identifying productive marine ecotones.
- **Interactive 3D Digital Earth**: Synchronized planetary globe view featuring geodesic coordinate projection, regional bounding boxes, and global bathymetric mapping.

### 4. Autonomous Marine Life & Ecosystem Simulation
- **44+ Photorealistic 3D Marine Species**:
  - **Pelagic Megafauna**: Sperm Whale (*Physeter macrocephalus*), Orca (*Orcinus orca*), Great White Shark (*Carcharodon carcharias*), Hammerhead Shark (*Sphyrna mokarran*), Manta Ray (*Mobula birostris*), Black Marlin (*Istiompax indica*).
  - **Reef & Demersal Organisms**: Blue Tang, Yellow Tang, Clownfish, Flame Angelfish, Emperor Angelfish, Discus varieties, Common Octopus, Green Sea Turtle.
  - **Gelatinous Drifters**: Moon Jellyfish (*Aurelia aurita*), Sea Nettle (*Chrysaora*), Barrel Jellyfish (*Rhizostoma pulmo*), Compass Jellyfish.
  - **Apex Freshwater Megafauna**: Arapaima (*Arapaima gigas*).
- **Ethological AI & Steering**:
  - Spatial-hashed Boid flocking (Separation, Alignment, Cohesion).
  - Predatory hunting behaviors and evasive flight reactions.
  - Strict depth-envelope compliance matching each creature's real biological bathymetric range.

### 5. Offline-First Ocean Codex & Intelligence Engine
- **Zero-Latency Biological Knowledge**: Master offline catalog (`src/data/marineKnowledge.json`) containing curated, authoritative scientific records for all 44 marine species:
  - Full taxonomic classification (Kingdom, Phylum, Class, Order, Family, Genus, Species).
  - Registry identifiers: **World Register of Marine Species (WoRMS AphiaID)**, **FishBase**, and **Ocean Biodiversity Information System (OBIS)**.
  - Ecological metrics: Diet, trophic level, IUCN Red List conservation status, depth distribution, and behavioral adaptations.
- **Admin Intelligence Suite**: Interactive research tool powered by the **Google Gemini API** combined with live scientific tools (WoRMS, FishBase, OBIS) to dynamically research, catalog, and persist new marine species into the master database.

---

## 🏗️ Architecture & Project Structure

```
ocean-pro/
├── src/                               # Frontend 3D Application
│   ├── assets/                        # 3D GLB Models & Textures
│   │   ├── bed/                       # Corals, reef structures, and shipwrecks
│   │   ├── container_Ship/            # Cargo vessel models & audio
│   │   ├── creatures/                 # 44+ 3D Marine organisms (small & others)
│   │   ├── earth/                     # High-res planetary textures
│   │   └── instruments/               # Argo float, glider, buoy, and ROV models
│   ├── creatures/                     # Asset discovery & loader registry
│   ├── data/                          # Master offline marine knowledge base
│   ├── dataviz/                       # Isosurfaces, Marching Cubes, CTD profile viewer
│   ├── detection/                     # Feature detection engine
│   ├── ecosystem/                     # Autonomous AI, flocking, and predator-prey logic
│   ├── education/                     # Ocean Codex UI & interactive dossier modal
│   ├── environment/                   # Coral anchors, seabed, and shipwreck managers
│   ├── geo/                           # Marine regions and geographic definitions
│   ├── globe/                         # 3D Interactive digital globe and controls
│   ├── instruments/                   # Argo float and ocean instrument tracking
│   ├── intelligence/                  # Knowledge builder and client caching
│   ├── ocean/                         # Ocean data manager
│   ├── performance/                   # Spatial hash, object pooling, and profiler
│   ├── shaders/                       # GLSL Gerstner waves, caustics, and post-processing
│   ├── ship/                          # Surface vessel kinematics and audio
│   ├── simulation/                    # Drift simulation (RK4) & PFZ engine
│   ├── ui/                            # Dashboard layout and HUD controls
│   └── main.js                        # Three.js application entry point
├── server/                            # Node.js Gateway & Intelligence Service
│   ├── intelligence/                  # Gemini Agent orchestration
│   ├── scripts/                       # Knowledge generator scripts
│   ├── tools/                         # ERDDAP, FishBase, OBIS, and WoRMS API wrappers
│   └── index.js                       # Express server (Port 3000)
├── ingestion/                         # Python Ocean Data Ingestion Service
│   ├── adapters/                      # INCOIS Argo, Copernicus CMEMS, IFREMER adapters
│   ├── app.py                         # FastAPI microservice (Port 8000)
│   ├── catalog.py                     # Dataset catalog definitions
│   ├── config.py                      # Service configuration & timeouts
│   ├── http_client.py                 # Resilient HTTP client with truststore SSL
│   ├── models.py                      # Pydantic observation & grid schemas
│   ├── netcdf_reader.py               # Xarray & NetCDF4 binary readers
│   └── requirements.txt               # Python package dependencies
├── test/                              # Automated Node Test Suites (47 tests)
│   ├── depth-envelope.test.js         # Biological bathymetric limits validation
│   ├── local-knowledge.test.js        # Offline codex resolution verification
│   ├── marching-cubes.test.js         # 3D isosurface geometric extraction tests
│   └── model-time-axis.test.js        # Time coordinate parsing & cache bounds tests
├── index.html                         # Application HTML5 shell
├── vite.config.js                     # Vite build configuration
└── package.json                       # Node dependencies & npm run scripts
```

---

## 🚀 Quickstart & Installation

### Prerequisites
- **Node.js**: v18.0.0 or later (v20+ recommended)
- **Python**: v3.10 or later
- **Modern Browser**: Chrome, Edge, Firefox, or Brave with WebGL 2.0 support

### Step 1: Clone the Repository
```bash
git clone https://github.com/Prawin-Balaji-A/INVICTUS_ocean_pro.git
cd INVICTUS_ocean_pro
```

### Step 2: Install Node Dependencies
```bash
npm install
```

### Step 3: Set Up Python Ingestion Environment
```bash
cd ingestion

# Create and activate Python virtual environment
python -m venv .venv

# Windows:
.venv\Scripts\activate

# macOS / Linux:
# source .venv/bin/activate

# Install required scientific packages
pip install -r requirements.txt

cd ..
```

### Step 4: Configure Environment Variables *(Optional)*
If utilizing live AI intelligence research with the Google Gemini agent, create a `.env` file in the root or in `server/`:
```env
PORT=3000
GEMINI_API_KEY=your_google_gemini_api_key_here
```
*(Note: The simulation and the complete 44-creature Ocean Codex run fully offline without requiring an API key).*

### Step 5: Start All Services
Launch the Vite client, Node.js gateway, and Python FastAPI ingestion service concurrently with a single command:
```bash
npm run dev
```

The services will start at:
- **3D Ocean Client**: `http://localhost:5173`
- **Node.js Gateway**: `http://localhost:3000`
- **Python Ingestion Service**: `http://localhost:8000` (API Docs: `http://localhost:8000/docs`)

---

## 🎮 Navigation & Controls

| Input | Action |
| :--- | :--- |
| **Left Click + Drag** | Orbit camera around focal point |
| **Right Click + Drag** / **Two-Finger Drag** | Pan camera laterally or descend underwater |
| **Mouse Wheel / Pinch** | Zoom in / out |
| **Double Click Water** | Spawn interactive floating buoyancy sphere |
| **Shift + Double Click Water** | Spawn interactive floating buoyancy cube |
| **Click Creature** | Lock target and open instant **Ocean Codex Dossier** |
| **GUI › ▼ Dive / ▲ Surface** | Animate smoothly across the waterline |
| **GUI (Top-Right Panel)** | Adjust environmental presets, wave height, sun elevation, water clarity, and fog |
| **Dataviz Panel (HUD)** | Toggle 4D Copernicus model slices, Marching Cubes isosurfaces, and Argo CTD profiles |
| **Globe Icon** | Toggle interactive 3D Planetary Digital Earth |

---

## 🧪 Testing & Verification

The project includes unit test suites verifying biological constraints, 3D Marching Cubes geometric generation, and offline codex resolution.

Run all tests:
```bash
npm test
```

Expected result:
```
✔ depth envelope: verified profile extracts exact biological range
✔ local knowledge: resolves instantly offline from pre-indexed master knowledge file
✔ local knowledge: all 44 assets resolve locally without network calls
✔ cell straddling the isovalue emits the surface at the exact linear crossing
✔ extraction is deterministic (same input → byte-identical output)
✔ clampIndex keeps an in-range index unchanged
✔ BoundedFieldCache evicts the least-recently-used entry past its cap
ℹ tests 47
ℹ pass 47
ℹ fail 0
```

To verify the production bundle:
```bash
npm run build
npm run preview
```

---

## 📡 Authoritative Scientific Data Sources

- **INCOIS (Indian National Centre for Ocean Information Services)**:
  - Indian Argo Project & Ocean Observation Network (OON)
  - URL: [https://incois.gov.in](https://incois.gov.in)
- **Copernicus Marine Service (E.U. Copernicus Programme)**:
  - Global Ocean Physical Analysis and Forecasting (GLOBAL_ANALYSISFORECAST_PHY_001_024)
  - URL: [https://marine.copernicus.eu](https://marine.copernicus.eu)
- **IFREMER (French Research Institute for Exploitation of the Sea)**:
  - Global Argo Data Assembly Centre (GDAC)
  - URL: [https://www.ifremer.fr](https://www.ifremer.fr)
- **WoRMS (World Register of Marine Species)**:
  - Authoritative marine taxonomic database & AphiaID classification
  - URL: [https://www.marinespecies.org](https://www.marinespecies.org)
- **FishBase & OBIS**:
  - Comprehensive global ichthyological and marine biogeographic observation records
  - URLs: [https://www.fishbase.se](https://www.fishbase.se) | [https://obis.org](https://obis.org)

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.
