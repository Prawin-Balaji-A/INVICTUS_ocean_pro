import { normalizeName } from '../SpeciesResolver.js';

/**
 * AssetManifest - the single source of truth for DISCOVERED creature GLB assets.
 *
 * This is purely TECHNICAL asset metadata (filename, url, display name, a coarse
 * UI bucket, and a cosmetic icon). It contains ZERO biological knowledge - all
 * biology (identity, taxonomy, ecology, behaviour) comes exclusively from the
 * dynamic intelligence pipeline (Gemini agent + WoRMS / FishBase / OBIS).
 *
 * Adding a new animal is an ASSET-ONLY operation: drop a '.glb' into
 * src/assets/creatures/small/ or src/assets/creatures/others/ and it is
 * discovered here automatically - no code edits required.
 */

// Build-time discovery from both creature directories
const smallAssetModules = import.meta.glob('/src/assets/creatures/small/*.glb', {
  query: '?url',
  import: 'default',
  eager: true,
});

const othersAssetModules = import.meta.glob('/src/assets/creatures/others/*.glb', {
  query: '?url',
  import: 'default',
  eager: true,
});

const groundAssetModules = import.meta.glob('/src/assets/creatures/ground/*.glb', {
  query: '?url',
  import: 'default',
  eager: true,
});

export function detectCategory(filename) {
  const lower = filename.toLowerCase();
  // Orca (killer whale) is the largest delphinid, NOT a great whale — check
  // before 'whale' so an "orca"/"orcinus"/"killer_whale" asset is bucketed as an
  // orca (its own size/behaviour tier) rather than a 40 m great whale.
  if (lower.includes('orca') || lower.includes('orcinus')) return 'orca';
  if (lower.includes('whale')) return 'whale';
  if (lower.includes('hammerhead')) return 'hammerhead';
  if (lower.includes('shark')) return 'shark';
  if (lower.includes('dolphin')) return 'dolphin';
  if (lower.includes('manta')) return 'manta';
  if (lower.includes('stingray') || lower.includes('ray')) return 'stingray';
  if (lower.includes('turtle')) return 'sea_turtle';
  if (lower.includes('octopus')) return 'octopus';
  if (lower.includes('jellyfish') || lower.includes('aurelia') ||
      lower.includes('chrysaora') || lower.includes('rhizostoma') ||
      lower.includes('compass')) return 'jellyfish';
  // Large pelagic / freshwater-giant bony fish — several metres long, clearly
  // bigger than reef fish yet not megafauna. Keyword-detected so any such asset
  // the user drops into others/ is sized in the dedicated "large_fish" band
  // instead of collapsing to the generic ~2 m 'fish' default.
  if (lower.includes('marlin') || lower.includes('arapaima') ||
      lower.includes('tuna') || lower.includes('swordfish') ||
      lower.includes('sailfish') || lower.includes('barracuda') ||
      lower.includes('grouper') || lower.includes('sturgeon') ||
      lower.includes('trevally')) return 'large_fish';
  return 'fish';
}

const UI_CATEGORY = {
  whale: 'megafauna', orca: 'megafauna', dolphin: 'megafauna', shark: 'megafauna',
  hammerhead: 'megafauna', manta: 'megafauna', sea_turtle: 'megafauna',
  stingray: 'benthic', octopus: 'invertebrate', jellyfish: 'invertebrate',
  large_fish: 'fish', fish: 'fish',
};

const CATEGORY_ICON = {
  whale: '🐋', orca: '🐋', dolphin: '🐬', shark: '🦈', hammerhead: '🦈', manta: '🐟',
  stingray: '🐟', sea_turtle: '🐢', octopus: '🐙', jellyfish: '🪼', large_fish: '🐟', fish: '🐟',
};

function buildManifest() {
  const list = [];
  
  for (const [path, url] of Object.entries(smallAssetModules)) {
    const filename = path.split('/').pop();
    const category = detectCategory(filename);
    list.push({
      filename,
      url,
      displayName: normalizeName(filename),
      category,
      uiCategory: UI_CATEGORY[category] || 'fish',
      icon: CATEGORY_ICON[category] || 'fish',
      directory: 'small',
      isSchooling: true,
      // Each small species forms ONE clearly-visible school. 7–11 individuals
      // (was 3–6) reads unmistakably as a school; the loader spawns a random
      // count in this range and SchoolManager keeps them in a single cohesive
      // school per species (maxSchoolSize raised to match).
      schoolSize: { min: 7, max: 11 }
    });
  }
  
  for (const [path, url] of Object.entries(othersAssetModules)) {
    const filename = path.split('/').pop();
    const category = detectCategory(filename);
    list.push({
      filename,
      url,
      displayName: normalizeName(filename),
      category,
      uiCategory: UI_CATEGORY[category] || 'megafauna',
      icon: CATEGORY_ICON[category] || 'fish',
      directory: 'others',
      isSchooling: false,
      spawnCount: 1
    });
  }
  
  for (const [path, url] of Object.entries(groundAssetModules)) {
    const filename = path.split('/').pop();
    const category = detectCategory(filename);
    list.push({
      filename,
      url,
      displayName: normalizeName(filename),
      category,
      uiCategory: UI_CATEGORY[category] || 'fish',
      icon: CATEGORY_ICON[category] || 'fish',
      directory: 'ground',
      isSchooling: false,
      spawnCount: 1
    });
  }
  
  return list;
}

export const DISCOVERED_ASSETS = buildManifest();

export function getSchoolingAssets() {
  return DISCOVERED_ASSETS.filter(a => a.isSchooling === true);
}

export function getIndividualAssets() {
  return DISCOVERED_ASSETS.filter(a => a.isSchooling === false);
}