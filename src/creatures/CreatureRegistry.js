import * as THREE from 'three';

/**
 * CreatureRegistry — Central registry of all loaded creatures.
 * Provides lookup by species, type, and generic entity access.
 */
export class CreatureRegistry {
  constructor() {
    this.creatures = [];
    this._nextId = 1;
  }

  register(creature) {
    creature.entityId = this._nextId++;
    creature.entityType = 'creature';
    this.creatures.push(creature);
    return creature;
  }

  getAll() {
    return this.creatures;
  }

  getByName(name) {
    return this.creatures.filter(c => c.name === name);
  }

  getByCategory(category) {
    return this.creatures.filter(c => c.category === category);
  }

  remove(creature) {
    const idx = this.creatures.indexOf(creature);
    if (idx !== -1) this.creatures.splice(idx, 1);
  }

  get count() {
    return this.creatures.length;
  }
}
