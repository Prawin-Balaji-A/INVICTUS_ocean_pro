import test from 'node:test';
import assert from 'node:assert/strict';
import { KnowledgeBuilder } from '../src/intelligence/KnowledgeBuilder.js';

test('local knowledge: resolves instantly offline from pre-indexed master knowledge file', async () => {
  const profile = await KnowledgeBuilder.buildProfile('blue_tang.glb');
  assert.ok(profile, 'Profile must exist');
  assert.equal(profile.identity.commonName, 'Blue Tang');
  assert.equal(profile.identity.scientificName, 'Paracanthurus hepatus');
  assert.equal(profile.classification.family, 'Acanthuridae');
  assert.equal(profile._meta.isLoaded, true);
  assert.ok(profile.ecology.habitat, 'Ecology habitat should be populated');
  assert.ok(profile.interestingFact, 'Interesting fact should be populated');
});

test('local knowledge: all 44 assets resolve locally without network calls', async () => {
  const sampleAssets = [
    'sperm_whale.glb',
    'bannerfish.glb',
    'octopus.glb',
    'sea_turtle.glb',
    'black_marlin.glb',
    'discus_01.glb',
    'discus_07.glb'
  ];

  for (const asset of sampleAssets) {
    const local = KnowledgeBuilder.findLocalProfile(asset);
    assert.ok(local, `Expected local profile for ${asset}`);
    assert.ok(local.identity, `Expected identity for ${asset}`);
    assert.ok(local.identity.commonName, `Expected common name for ${asset}`);
  }
});

test('local knowledge: unknown asset returns deterministic unresolved fallback without hallucination', async () => {
  const fallback = await KnowledgeBuilder.buildProfile('non_existent_creature_xyz.glb');
  assert.ok(fallback);
  assert.equal(fallback._meta.source, 'unresolved');
  assert.equal(fallback.identity.scientificName, null);
  assert.equal(fallback.classification.class, null);
});
