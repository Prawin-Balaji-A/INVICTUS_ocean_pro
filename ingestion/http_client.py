"""Shared HTTP access for source adapters.

Uses `truststore` to make Python's TLS use the operating-system trust store.
INCOIS ERDDAP presents an incomplete certificate chain that Python's bundled
`certifi` roots cannot verify on their own, but the OS trust store can complete
the chain (this is why PowerShell / browsers accept it). Verified in Phase 0.

We do NOT disable TLS verification globally — that would be insecure and is
explicitly forbidden by the spec. `truststore` keeps verification ON while
using the platform's certificate store.
"""
from __future__ import annotations

import threading
import time
from typing import Any

# Route Python TLS through the OS trust store before requests is used.
import truststore

truststore.inject_into_ssl()

import requests  # noqa: E402  (import after inject_into_ssl)

from config import HTTP_TIMEOUT, CACHE_TTL_SECONDS

_session = requests.Session()
_session.headers.update({"User-Agent": "ocean-pro-ingestion/0.1 (INCOIS data viz)"})


class SourceUnavailable(RuntimeError):
    """Raised when a real upstream endpoint cannot be reached or returns an
    error. The caller surfaces this to the client as an explicit failure — we
    never substitute fabricated data (spec s33, s40)."""

    def __init__(self, url: str, detail: str, status: int | None = None):
        self.url = url
        self.detail = detail
        self.status = status  # upstream HTTP status when applicable (None for network/TLS/timeout)
        super().__init__(f"{detail} :: {url}")


class UpstreamUnavailable503(SourceUnavailable):
    """Raised specifically when INCOIS ERDDAP returns 503 after retries."""

    def __init__(self, dataset: str = "Indian_ARGO_Floats", source: str = "INCOIS ERDDAP", url: str = ""):
        self.dataset = dataset
        self.source = source
        super().__init__(url, f"{source} temporarily unavailable (HTTP 503)", status=503)


def get_text(url: str, timeout: float | None = None) -> str:
    """GET a URL and return the response body as text, or raise
    SourceUnavailable with the exact upstream error."""
    try:
        r = _session.get(url, timeout=timeout or HTTP_TIMEOUT)
    except requests.RequestException as exc:  # network / TLS / timeout
        raise SourceUnavailable(url, f"{type(exc).__name__}: {exc}") from exc
    if r.status_code != 200:
        # ERDDAP encodes useful diagnostics in the body; keep it short.
        raise SourceUnavailable(url, f"HTTP {r.status_code}: {r.text[:200].strip()}", status=r.status_code)
    return r.text


def get_bytes(url: str, timeout: float | None = None) -> bytes:
    """GET a URL and return raw bytes (used for NetCDF subset downloads)."""
    try:
        r = _session.get(url, timeout=timeout or HTTP_TIMEOUT)
    except requests.RequestException as exc:
        raise SourceUnavailable(url, f"{type(exc).__name__}: {exc}") from exc
    if r.status_code != 200:
        raise SourceUnavailable(url, f"HTTP {r.status_code}: {r.text[:200].strip()}", status=r.status_code)
    return r.content


# ---------------------------------------------------------------------------
# Minimal thread-safe TTL cache (metadata + marker lists), so repeated frontend
# requests do not hammer ERDDAP. Not a substitute for source-side subsetting.
# ---------------------------------------------------------------------------
_cache: dict[str, tuple[float, Any]] = {}
_cache_lock = threading.Lock()


def cache_get(key: str) -> Any | None:
    with _cache_lock:
        hit = _cache.get(key)
        if not hit:
            return None
        expires, value = hit
        if time.time() > expires:
            _cache.pop(key, None)
            return None
        return value


def cache_set(key: str, value: Any, ttl: float | None = None) -> None:
    with _cache_lock:
        _cache[key] = (time.time() + (ttl if ttl is not None else CACHE_TTL_SECONDS), value)
