/**
 * GeminiAgent.js
 * Frontend abstraction for the Gemini Intelligence Layer.
 * Secures the architecture by ensuring the frontend NEVER holds an API key.
 * All intelligence calls are routed to a secure backend endpoint.
 */

export class GeminiAgent {
  /**
   * Instructs the backend Gemini agent to resolve a species identity and research its biology.
   * @param {string} assetName - e.g., "yellow_tang.glb"
   */
  static async researchSpecies(assetName) {
    try {
      // Backend endpoint
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout for Gemini research

      const response = await fetch('/api/intelligence/research', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ assetName }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Backend unavailable or returned error: ${response.status}`);
      }

      const data = await response.json();
      return data;
      
    } catch (error) {
      console.warn('[GeminiAgent] Backend intelligence unavailable. Falling back to local systems.', error.message);
      // Cleanly return null to signal that the intelligence layer is offline.
      return null;
    }
  }
}
