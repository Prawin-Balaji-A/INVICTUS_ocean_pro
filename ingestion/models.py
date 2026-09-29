"""Canonical ocean-data model (spec s4).

These shapes are the ONLY thing the REST API and the frontend understand. Every
source adapter normalizes its native format into these — so the frontend never
needs to know whether the bytes came from ERDDAP, OPeNDAP, NetCDF or ASCII.

Nothing here invents values. Missing measurements are represented as null, not
placeholders.
"""
from __future__ import annotations

from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Dataset catalog / metadata (spec s23, s24)
# ---------------------------------------------------------------------------
class VariableMeta(BaseModel):
    name: str
    long_name: str | None = None
    units: str | None = None
    standard_name: str | None = None


class SpatialRange(BaseModel):
    latMin: float | None = None
    latMax: float | None = None
    lonMin: float | None = None
    lonMax: float | None = None


class DatasetMeta(BaseModel):
    datasetId: str
    name: str
    source: str                       # e.g. "INCOIS"
    kind: str                         # "observation" | "model"
    fmt: str                          # "ERDDAP tabledap" | "ERDDAP griddap" | ...
    description: str | None = None
    variables: list[VariableMeta] = []
    timeRange: list[str] | None = None            # [startISO, endISO]
    spatialRange: SpatialRange | None = None
    depthRange: list[float] | None = None         # [min, max] meters
    status: str = "online"            # "online" | "unreachable"
    sourceUrl: str = ""


# ---------------------------------------------------------------------------
# In-situ observations (spec s4, s17-20)
# ---------------------------------------------------------------------------
class ProfileLevel(BaseModel):
    """One measured level of a profile. `depth` is in metres. For Argo the
    vertical coordinate is pressure (decibar); depth is the standard
    depth-approx-pressure relation and is labelled as such in metadata — it is
    a documented approximation, not a fabricated value."""
    depth: float | None = None
    pressure: float | None = None
    values: dict[str, float | None] = {}   # {"TEMP": 12.3, "PSAL": 35.1, ...}
    qc: dict[str, str | None] = {}          # {"TEMP": "1", "PSAL": "1", ...}


class Observation(BaseModel):
    platformId: str
    platformType: str | None = None
    source: str = ""
    latitude: float | None = None
    longitude: float | None = None
    time: str | None = None                 # ISO8601 UTC
    variables: list[str] = []               # variables present in `profile`
    units: dict[str, str | None] = {}
    metadata: dict = {}
    quality: dict | None = None
    profile: list[ProfileLevel] | None = None
    sourceUrl: str | None = None


# ---------------------------------------------------------------------------
# Gridded model field (spec s4, s8-12) — implemented by the griddap adapter
# in a later phase; defined here so the schema is one source of truth.
# ---------------------------------------------------------------------------
class ModelField(BaseModel):
    datasetId: str
    source: str = ""
    variable: str = ""
    units: str | None = None
    time: str | None = None
    depth: float | None = None
    longitude: list[float] = []
    latitude: list[float] = []
    values: list[list[float | None]] = []   # values[latIndex][lonIndex]
    dimensions: dict = {}
    metadata: dict = {}
    quality: str | None = None
    sourceUrl: str | None = None


# ---------------------------------------------------------------------------
# Depth-resolved model volume (Phase 8) — the 3-D sibling of ModelField, used
# to build a real isosurface through the water column. Same source, same CF
# decode; the ONLY difference is the depth axis is kept in full instead of a
# single pinned slice. `values` is depth-major: values[depthIndex][latIndex]
# [lonIndex]; `depths` are the REAL model depth levels (metres). Missing cells
# stay null (never zero, never interpolated) exactly as in ModelField.
# ---------------------------------------------------------------------------
class ModelVolume(BaseModel):
    datasetId: str
    source: str = ""
    variable: str = ""
    units: str | None = None
    time: str | None = None
    depths: list[float] = []                        # real model depth levels (m)
    depthUnits: str | None = None
    longitude: list[float] = []
    latitude: list[float] = []
    values: list[list[list[float | None]]] = []     # values[depth][lat][lon]
    dimensions: dict = {}
    metadata: dict = {}
    quality: str | None = None
    sourceUrl: str | None = None
