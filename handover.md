# Ocean Pro - Project Handover Document

## 1. Project Overview
**Ocean Pro** is an immersive, realistic 3D ocean ecosystem simulation built with Three.js and Vite. It simulates a dynamic marine environment, complete with volumetric lighting, advanced water shaders, boids-based ecosystem AI, and a robust marine knowledge base for educational and scientific data retrieval.

## 2. Core Architecture
- **Rendering Engine:** Three.js
- **Build System:** Vite
- **Main Entry:** `src/main.js` handles the core rendering loop, scene setup, camera logic, and rendering passes (Refraction, HDR, Volumetric Clouds, Post-processing).

### 2.1 Environmental Graphics & Shaders
- **`Ocean.js`**: Advanced procedural water shader. Evaluates Gerstner waves, computes surface normals, handles underwater vs. above-water states.
- **`Post.js`**: Comprehensive post-processing pipeline. Features realistic underwater depth absorption (Beer-Lambert law), caustics, sun shafts, bloom, and tone mapping.
- **`Sky.js`**: Camera-locked sky dome evaluating atmospheric scattering.
- **`Clouds.js`**: Volumetric ray-marched clouds interacting with HDR scene depth and casting shadows on the ocean surface.
- **`Floor.js`**: Benthic seabed shader.
- **`Particles.js`**: Floating marine snow / plankton rendering.

### 2.2 Ecosystem & AI (`src/ecosystem/`)
- **`EcosystemAI.js`**: The central brain driving the simulation. Orchestrates creature state machines and physics.
- **`DecisionSystem.js`**: Finite state machine (WANDER, FLEE, CHASE, ATTACK, SCHOOL) driven by environmental factors and memories.
- **`Steering.js`**: Craig Reynolds-style boids steering behaviors (Seek, Flee, Wander, Separate, Align, Cohesion).
- **`Perception.js` & `CreatureMemory.js`**: Simulates what creatures can "see" and remember (threats, prey, school members).
- **`BehaviorBuilder.js`**: Constructs dynamic behavioral profiles for each loaded species based on taxonomy.
- **`SchoolManager.js`**: Handles massive schooling logic and dynamic split/merge of fish schools.

### 2.3 Creature Management (`src/creatures/`)
- **`CreatureLoader.js`**: Efficiently loads GLTF/GLB models. Implements heavy performance optimizations (InstancedMesh where possible, grouping, animation mixers). It controls spawn rates, scales, and rotation offsets.
- **`CreatureRegistry.js`**: Maintains the list of spawned instances.

### 2.4 Intelligence & Taxonomy (`src/intelligence/`)
- **`KnowledgeBuilder.js`**: The central API for resolving an asset's identity. Prioritizes the authoritative local registry, checks local cache, and gracefully falls back to online databases.
- **`MarineKnowledgeBase.js`**: The authoritative offline registry. Contains highly detailed, verified biological profiles for dozens of marine species (Dolphins, Sharks, Whales, Rays, Reef Fish, Jellyfish) preventing taxonomy hallucinations.
- **`SpeciesResolver.js`**: Fetches vernacular/scientific matches from the World Register of Marine Species (WoRMS) API.
- **`GeminiAgent.js`**: Integrates with a Gemini LLM backend for intelligent biological profile research.

### 2.5 Benthic Environment & Instrumentation (`src/environment/` & `src/instruments/`)
- **`CoralManager.js`**: Procedurally generates and places instanced coral reefs firmly on the seabed floor.
- **`ShipwreckManager.js`**: Handles sunken artificial reefs (shipwrecks) acting as benthic sanctuary anchors.
- **`OceanEnvironment.js`**: Calculates depths, handles clamping creatures to the water column, and prevents breaching the surface or clipping the floor.

### 2.6 UI & Education (`src/ui/`, `src/education/`)
- **`UIManager.js`**: Submarine-styled HTML/CSS overlay dashboard. Displays FPS, active creature count, camera depth, and toggles for various tools.
- **`OceanCodex.js`**: Interactive HUD card. When the camera approaches or clicks a creature, it presents the biological profile (Common name, Scientific name, Taxonomy, Diet, Conservation status).
- **`Radar.js`**: A classic circular sonar/radar mini-map rendering creature blips relative to the camera in the XZ plane.

### 2.7 Oceanographic Simulation (`src/simulation/`)
- **`DriftSimulationEngine.js`**: Simulates Search and Rescue (SAR) drift vectors.
- **`PFZEngine.js`**: Predicts Potential Fishing Zones based on SST/Chlorophyll mock data.
- **`HistoricalSimulation.js`**: Time-travel simulation stepping.

## 3. What We Have Accomplished
Over the course of the project, we have successfully:
1. **Built a Performant 3D Engine:** Implemented volumetric lighting, shadows, atmospheric scattering, and complex water shaders while maintaining smooth frame rates.
2. **Optimized Large-Scale Rendering:** Reduced draw calls by tuning 42+ distinct marine species, halving excessive fish counts, and implementing frustum/depth culling (e.g., hiding corals/creatures during refraction passes).
3. **Refined Ecosystem AI:** Implemented sophisticated boids steering, ensuring fish school naturally, predators chase prey, and creatures respect surface/seabed boundaries.
4. **Resolved Taxonomy & Orientation Bugs:**
   - Fixed a visual bug where Dolphins appeared as vertical needles due to an incorrect pitch rotation in `CreatureLoader.js`.
   - Corrected the WoRMS taxonomy cache collision where Dolphins were classified as bony fishes (*Teleostei*) by enforcing the authoritative `MarineKnowledgeBase.js` (Class: *Mammalia*).
5. **Enhanced UI Immersion:**
   - Added an interactive Radar / Minimap.
   - Built a comprehensive Ocean Codex HUD for learning.
   - Added a **"Submarine Headlight"** — an active `SpotLight` attached to the camera that seamlessly illuminates the dark ocean depths when the camera goes underwater.

## 4. Current State & Where We Stand
The application is fully functional, visually stunning, and highly educational. It runs smoothly via `npm run dev` and bundles cleanly with `npm run build`.

The environment seamlessly transitions between above-water (sun, volumetric clouds, reflections) and underwater (depth absorption, submarine headlights, marine life, caustics, and seabed corals). 

The project is currently **stable and ready for handover**. Future expansion paths could include multiplayer, VR support, or live remote API data feeds for real-world ocean telemetry.
