/**
 * ObjectPool - Reusable object pool to reduce garbage collection
 * 
 * Pre-allocates objects and recycles them instead of creating new ones.
 */

import * as THREE from 'three';

// Pooled Vector3 for reuse in steering calculations
export class Vector3Pool {
  constructor(initialSize = 32) {
    this._pool = [];
    this._inUse = new Set();
    for (let i = 0; i < initialSize; i++) {
      this._pool.push(new THREE.Vector3());
    }
  }
  
  acquire() {
    if (this._pool.length > 0) {
      const obj = this._pool.pop();
      this._inUse.add(obj);
      return obj.set(0, 0, 0);
    }
    const obj = new THREE.Vector3();
    this._inUse.add(obj);
    return obj;
  }
  
  release(obj) {
    if (this._inUse.has(obj)) {
      this._inUse.delete(obj);
      obj.set(0, 0, 0);
      this._pool.push(obj);
    }
  }
  
  releaseAll() {
    for (const obj of this._inUse) {
      obj.set(0, 0, 0);
      this._pool.push(obj);
    }
    this._inUse.clear();
  }
}

// Pooled Box3 for reuse in frustum/bounds calculations
export class Box3Pool {
  constructor(initialSize = 16) {
    this._pool = [];
    this._inUse = new Set();
    for (let i = 0; i < initialSize; i++) {
      this._pool.push(new THREE.Box3());
    }
  }
  
  acquire() {
    if (this._pool.length > 0) {
      const obj = this._pool.pop();
      this._inUse.add(obj);
      return obj;
    }
    const obj = new THREE.Box3();
    this._inUse.add(obj);
    return obj;
  }
  
  release(obj) {
    if (this._inUse.has(obj)) {
      this._inUse.delete(obj);
      obj.makeEmpty();
      this._pool.push(obj);
    }
  }
}

// Generic object pool
export class ObjectPool {
  constructor(factory, initialSize = 32) {
    this._factory = factory;
    this._pool = [];
    this._inUse = new Set();
    for (let i = 0; i < initialSize; i++) {
      this._pool.push(factory());
    }
  }
  
  acquire() {
    if (this._pool.length > 0) {
      const obj = this._pool.pop();
      this._inUse.add(obj);
      return obj;
    }
    const obj = this._factory();
    this._inUse.add(obj);
    return obj;
  }
  
  release(obj) {
    if (this._inUse.has(obj)) {
      this._inUse.delete(obj);
      this._pool.push(obj);
    }
  }
  
  releaseAll() {
    for (const obj of this._inUse) {
      this._pool.push(obj);
    }
    this._inUse.clear();
  }
}

// Global pools - pre-allocated for use across the application
export const pools = {
  vec3: new Vector3Pool(64),
  box3: new Box3Pool(32),
};