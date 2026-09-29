import test from 'node:test';
import assert from 'node:assert/strict';
import { KnowledgeBuilder } from '../src/intelligence/KnowledgeBuilder.js';

test('depth envelope: verified profile extracts exact biological range', () => {
  const verifiedProfile = {
    identity: { commonName: 'Verified Reef Fish', scientificName: 'Centropyge bicolor' },
    classification: { class: 'Teleostei', family: 'Pomacanthidae' },
    ecology: { depth: '2 - 30 m' },
    _meta: { source: 'gemini+research', isLoaded: true }
  };

  const env = KnowledgeBuilder.resolveDepthEnvelope(verifiedProfile, 'fish');
  assert.equal(env.source, 'verified');
  assert.equal(env.isFallback, false);
  assert.equal(env.minDepth, -2);
  assert.equal(env.maxDepth, -30);
  assert.equal(env.preferredDepth, -16);
});

test('depth envelope: shallow fish uses natural shallow reef fallback', () => {
  const profile = {
    identity: { commonName: 'Bicolor Angelfish', ambiguous: true },
    classification: { class: 'Teleostei', family: 'Pomacanthidae' },
    ecology: { depth: null },
    _meta: { source: 'worms', isLoaded: true }
  };

  const env = KnowledgeBuilder.resolveDepthEnvelope(profile, 'fish');
  assert.equal(env.source, 'simulation-fallback');
  assert.equal(env.isFallback, true);
  assert.equal(env.minDepth, -2.5);
  assert.equal(env.maxDepth, -32.0);
  assert.equal(env.preferredDepth, -12.0);
});

test('depth envelope: mid-water fish uses mid-water pelagic fallback', () => {
  const env = KnowledgeBuilder.resolveDepthEnvelope(null, 'large_fish');
  assert.equal(env.source, 'simulation-fallback');
  assert.equal(env.isFallback, true);
  assert.equal(env.minDepth, -15.0);
  assert.equal(env.maxDepth, -65.0);
  assert.equal(env.preferredDepth, -32.0);
});

test('depth envelope: predator uses pelagic patrol fallback', () => {
  const env = KnowledgeBuilder.resolveDepthEnvelope(null, 'shark');
  assert.equal(env.source, 'simulation-fallback');
  assert.equal(env.isFallback, true);
  assert.equal(env.minDepth, -8.0);
  assert.equal(env.maxDepth, -75.0);
  assert.equal(env.preferredDepth, -35.0);
});

test('depth envelope: jellyfish uses mid-water drifter fallback', () => {
  const env = KnowledgeBuilder.resolveDepthEnvelope(null, 'jellyfish');
  assert.equal(env.source, 'simulation-fallback');
  assert.equal(env.isFallback, true);
  assert.equal(env.minDepth, -8.0);
  assert.equal(env.maxDepth, -50.0);
  assert.equal(env.preferredDepth, -22.0);
});

test('depth envelope: benthic creature uses demersal seabed fallback', () => {
  const env = KnowledgeBuilder.resolveDepthEnvelope(null, 'stingray');
  assert.equal(env.source, 'simulation-fallback');
  assert.equal(env.isFallback, true);
  assert.equal(env.minDepth, -115.0);
  assert.equal(env.maxDepth, -145.0);
  assert.equal(env.preferredDepth, -135.0);
});

test('depth envelope: unresolved DISCUS 07 uses safe simulation fallback with isFallback: true', () => {
  const unresolvedProfile = {
    identity: { commonName: 'Discus 07', scientificName: null, ambiguous: true },
    classification: {},
    ecology: { depth: null },
    _meta: { source: 'unresolved', isLoaded: true }
  };

  const env = KnowledgeBuilder.resolveDepthEnvelope(unresolvedProfile, 'fish');
  assert.equal(env.source, 'simulation-fallback');
  assert.equal(env.isFallback, true);
  assert.equal(env.minDepth, -2.5);
  assert.equal(env.maxDepth, -32.0);
  assert.equal(env.preferredDepth, -12.0);
});
