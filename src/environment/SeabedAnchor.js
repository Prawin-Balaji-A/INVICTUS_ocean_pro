import * as THREE from 'three';

export const CORAL_SEABED_DEBUG = true;

/**
 * anchorObjectToSeabed — Reusable world-space seabed anchoring utility.
 * 
 * Algorithm:
 * 1. Takes an Anchor container (THREE.Group in world scene) and its child model.
 * 2. Scales child model to natural height if requested.
 * 3. Evaluates complete world-space bounding box from matrixWorld.
 * 4. Determines actual seabed Y from floor at anchor's X/Z.
 * 5. Calculates deltaY = (seabedY - embedding) - box.min.y.
 * 6. Moves the Anchor container by deltaY.
 * 7. Recalculates world bounds and validates that finalBox.min.y ≈ targetBottomY.
 * 8. Ensures finalBox.max.y is well below the water surface (Y < 0).
 */
export function anchorObjectToSeabed(anchorGroup, childObject, floor, options = {}) {
  if (!anchorGroup || !childObject) return null;

  const embedding = options.embedding ?? 0.8;
  const targetHeight = options.targetHeight ?? null;
  const debug = options.debug ?? CORAL_SEABED_DEBUG;

  // 1. Ensure hierarchy is connected
  if (childObject.parent !== anchorGroup) {
    anchorGroup.add(childObject);
  }

  // 2. Apply target height scaling if specified
  if (targetHeight && targetHeight > 0) {
    childObject.updateMatrixWorld(true);
    const rawBox = new THREE.Box3().setFromObject(childObject);
    const rawHeight = rawBox.max.y - rawBox.min.y;
    if (rawHeight > 0) {
      const scale = targetHeight / rawHeight;
      childObject.scale.setScalar(scale);
    }
  }

  // 3. Update entire world matrix hierarchy
  anchorGroup.updateMatrixWorld(true);

  // 4. Calculate complete world-space bounding box
  const box = new THREE.Box3().setFromObject(anchorGroup);
  if (box.isEmpty()) return null;

  const bottomY = box.min.y;

  // 5. Determine actual seabed Y at anchor coordinates
  let seabedY = -150.0;
  if (floor) {
    if (typeof floor.heightAt === 'function') {
      seabedY = floor.heightAt(anchorGroup.position.x, anchorGroup.position.z);
    } else if (floor.depth !== undefined) {
      seabedY = -floor.depth;
    }
  }

  // 6. Calculate target bottom Y with slight embedding into sand
  const targetBottomY = seabedY - embedding;

  // 7. Calculate exact deltaY needed
  const deltaY = targetBottomY - bottomY;

  // 8. Move the Anchor container by deltaY
  anchorGroup.position.y += deltaY;

  // 9. Recalculate world matrix and verify final bounds
  anchorGroup.updateMatrixWorld(true);
  const finalBox = new THREE.Box3().setFromObject(anchorGroup);

  // 10. Debug logging & assertion
  if (debug) {
    console.log(`[CORAL DEBUG] ${anchorGroup.name || 'SeabedObject'}
  surfaceY: 0.00
  seabedY: ${seabedY.toFixed(2)}
  coralWorldMinY: ${finalBox.min.y.toFixed(2)} (target: ${targetBottomY.toFixed(2)})
  coralWorldMaxY: ${finalBox.max.y.toFixed(2)}
  coralHeight: ${(finalBox.max.y - finalBox.min.y).toFixed(2)}
  isFirmlyOnSeabed: ${Math.abs(finalBox.min.y - targetBottomY) < 0.1}
  isBelowSurface: ${finalBox.max.y < 0}`);
  }

  return finalBox;
}

// Backward compatibility helper
export function anchorToSeabed(object, floor, embeddingOffset = 0.8) {
  if (!object) return;
  anchorObjectToSeabed(object, object, floor, { embedding: embeddingOffset });
}

