import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { 
    host: true, 
    open: true,
    proxy: {
      // Node is the single frontend-facing API gateway (architecture:
      // Three.js → Node → Python). ALL /api traffic goes to the Node backend on
      // :3000, which serves its own perf/intelligence routes and proxies the
      // scientific-data routes (/api/datasets, /api/observations, /api/model)
      // onward to the Python FastAPI ingestion service on :8000.
      '/api': {
        // Pinned to the IPv4 loopback literal (NOT 'localhost'). On Windows 11
        // 'localhost' resolves to ::1 (IPv6) first; if the Node gateway is bound
        // to 127.0.0.1 the proxy hop then intermittently fails with ECONNREFUSED
        // — the observed flaky /api/observations/.../profile symptom. Both ends
        // of this hop are now pinned to 127.0.0.1 so resolution can't mismatch.
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        // Surface any proxy-layer failure in the Vite terminal instead of only
        // as an opaque browser 500, so a real gateway/connection issue is
        // diagnosable rather than silent.
        configure: (proxy) => {
          proxy.on('error', (err, req) => {
            console.error(`[vite proxy] /api error for ${req?.url || '?'}: ${err.message}`);
          });
        }
      }
    }
  },
  build: {
    target: 'esnext',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
});
