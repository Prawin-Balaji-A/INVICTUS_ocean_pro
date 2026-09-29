"""Central configuration for the ocean-data ingestion service.

Nothing here fabricates data. All endpoints are real, publicly accessible
INCOIS ERDDAP resources verified reachable during Phase 0
(observations: tabledap; gridded model: griddap). The architecture is kept
source-agnostic so a Copernicus adapter can be registered later without
changing the REST API or the frontend.
"""
from __future__ import annotations

import os

# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------
HOST = os.environ.get("INGEST_HOST", "127.0.0.1")
PORT = int(os.environ.get("INGEST_PORT", "8000"))

# HTTP client behaviour
HTTP_TIMEOUT = float(os.environ.get("INGEST_HTTP_TIMEOUT", "45"))
CACHE_TTL_SECONDS = float(os.environ.get("INGEST_CACHE_TTL", "300"))  # 5 min

# ---------------------------------------------------------------------------
# Real data sources (INCOIS ERDDAP)
# ---------------------------------------------------------------------------
INCOIS_ERDDAP_BASE = os.environ.get(
    "INCOIS_ERDDAP_BASE", "https://erddap.incois.gov.in/erddap"
)

# Observation source: INDIAN ARGO Floats (tabledap, cdm_data_type=Point).
ARGO_DATASET_ID = "Indian_ARGO_Floats"

# Gridded model source: INCOIS Argo 10-day Variational Analysis (griddap).
# 4D (time, ZAX depth 5-2000 m, latitude, longitude); TEMP (degs), SAL (PSU).
ARGO_VAM_DATASET_ID = "incois_argo_10d_VAM"

# Default Indian-EEZ-ish region used only when a request omits a bounding box.
# Configurable; the renderer works globally or regionally (spec s22).
DEFAULT_BBOX = {
    "latMin": -10.0,
    "latMax": 30.0,
    "lonMin": 40.0,
    "lonMax": 100.0,
}
