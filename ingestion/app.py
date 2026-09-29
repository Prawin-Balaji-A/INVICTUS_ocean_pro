"""FastAPI ocean-data ingestion service (spec s27).

Exposes the canonical REST API the frontend consumes. The frontend never sees
the original source format. Unreachable sources return an explicit error
(HTTP 502) — never fabricated data (spec s33, s40).

Run (from the ingestion/ directory):
    .venv/Scripts/uvicorn app:app --host 127.0.0.1 --port 8000
"""
from __future__ import annotations

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import catalog
from config import PORT
from http_client import SourceUnavailable, UpstreamUnavailable503
from models import DatasetMeta, ModelField, ModelVolume
from netcdf_reader import NetCDFUnavailable

app = FastAPI(title="Ocean Pro Ingestion", version="0.1.0")

@app.exception_handler(UpstreamUnavailable503)
def upstream_unavailable_handler(request, exc: UpstreamUnavailable503):
    return JSONResponse(
        status_code=503,
        content={
            "status": "upstream_unavailable",
            "source": exc.source,
            "httpStatus": 503,
            "dataset": exc.dataset,
        },
    )


# Dev CORS: the Vite proxy normally fronts this, but allow direct access too.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok", "sources": [a.id for a in catalog.all_adapters()]}


@app.get("/api/datasets", response_model=list[DatasetMeta])
def list_datasets():
    out: list[DatasetMeta] = []
    for a in catalog.all_adapters():
        try:
            out.append(a.metadata())
        except SourceUnavailable as exc:
            # Surface the source as unreachable rather than dropping it silently.
            out.append(DatasetMeta(
                datasetId=a.id, name=a.id, source="", kind=a.kind, fmt="",
                status="unreachable", sourceUrl=exc.url,
                description=f"Source unreachable: {exc.detail}",
            ))
    return out


def _adapter_or_404(dataset_id: str):
    a = catalog.get(dataset_id)
    if a is None:
        raise HTTPException(status_code=404, detail=f"Unknown dataset '{dataset_id}'")
    return a


@app.get("/api/datasets/{dataset_id}", response_model=DatasetMeta)
def get_dataset(dataset_id: str):
    a = _adapter_or_404(dataset_id)
    try:
        return a.metadata()
    except SourceUnavailable as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@app.get("/api/datasets/{dataset_id}/variables")
def get_variables(dataset_id: str):
    a = _adapter_or_404(dataset_id)
    try:
        return a.metadata().variables
    except SourceUnavailable as exc:
        raise HTTPException(status_code=502, detail=str(exc))


def _bbox(latMin, latMax, lonMin, lonMax):
    vals = [latMin, latMax, lonMin, lonMax]
    if all(v is None for v in vals):
        return None
    # Partial boxes fall back to the adapter default for the missing edges.
    from config import DEFAULT_BBOX
    d = DEFAULT_BBOX
    return {
        "latMin": latMin if latMin is not None else d["latMin"],
        "latMax": latMax if latMax is not None else d["latMax"],
        "lonMin": lonMin if lonMin is not None else d["lonMin"],
        "lonMax": lonMax if lonMax is not None else d["lonMax"],
    }


@app.get("/api/observations")
def observations(
    dataset: str = Query(..., description="dataset/adapter id"),
    latMin: float | None = None,
    latMax: float | None = None,
    lonMin: float | None = None,
    lonMax: float | None = None,
    start: str | None = None,
    end: str | None = None,
    limit: int | None = Query(None, ge=1, le=5000),
):
    a = _adapter_or_404(dataset)
    try:
        obs = a.list_observations(bbox=_bbox(latMin, latMax, lonMin, lonMax),
                                  time_start=start, time_end=end, limit=limit)
    except UpstreamUnavailable503:
        raise
    except SourceUnavailable as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except NotImplementedError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"dataset": dataset, "count": len(obs), "observations": obs}


@app.get("/api/observations/{platform_id}/profile")
def profile(platform_id: str, dataset: str = Query(...), cycle: int | None = None):
    a = _adapter_or_404(dataset)
    try:
        return a.get_profile(platform_id, cycle=cycle)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except UpstreamUnavailable503:
        raise
    except SourceUnavailable as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except NotImplementedError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ---------------------------------------------------------------------------
# Gridded model/analysis fields (spec s8-12, s28). Server-side subset by
# variable + single time + single depth + bounding box; the full grid is never
# shipped. Unreachable source / undecodable NetCDF -> explicit 502, never faked.
# ---------------------------------------------------------------------------
@app.get("/api/model/axes")
def model_axes(dataset: str = Query(..., description="dataset/adapter id")):
    a = _adapter_or_404(dataset)
    try:
        return {"dataset": dataset, "times": a.times(),
                "depths": a.depths(), "depthUnits": "m"}
    except UpstreamUnavailable503:
        raise
    except SourceUnavailable as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except NotImplementedError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/model/field", response_model=ModelField)
def model_field(
    dataset: str = Query(..., description="dataset/adapter id"),
    variable: str = Query(..., description="e.g. TEMP or SAL"),
    time: str | None = Query(None, description="ISO time; default = latest"),
    depth: float | None = Query(None, description="metres; default = shallowest level"),
    latMin: float | None = None,
    latMax: float | None = None,
    lonMin: float | None = None,
    lonMax: float | None = None,
    stride: int | None = Query(None, ge=1, le=100),
):
    a = _adapter_or_404(dataset)
    try:
        return a.field_slice(
            variable=variable, time=time, depth=depth,
            bbox=_bbox(latMin, latMax, lonMin, lonMax), stride=stride,
        )
    except (ValueError, KeyError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except NotImplementedError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except NetCDFUnavailable as exc:
        raise HTTPException(status_code=502, detail=f"NetCDF decode failed: {exc}")
    except UpstreamUnavailable503:
        raise
    except SourceUnavailable as exc:
        raise HTTPException(status_code=502, detail=str(exc))


# ---------------------------------------------------------------------------
# Depth-resolved model VOLUME (Phase 8). Same source and server-side subsetting
# as /api/model/field, but keeps the full real depth axis (optionally limited to
# [depthMin, depthMax]) so the frontend can extract a real 3-D isosurface. The
# full global grid is never shipped; undecodable NetCDF / unreachable source ->
# explicit 502, never a fabricated volume.
# ---------------------------------------------------------------------------
@app.get("/api/model/volume", response_model=ModelVolume)
def model_volume(
    dataset: str = Query(..., description="dataset/adapter id"),
    variable: str = Query(..., description="e.g. TEMP or SAL"),
    time: str | None = Query(None, description="ISO time; default = latest"),
    depthMin: float | None = Query(None, description="metres; default = shallowest level"),
    depthMax: float | None = Query(None, description="metres; default = deepest level"),
    latMin: float | None = None,
    latMax: float | None = None,
    lonMin: float | None = None,
    lonMax: float | None = None,
    stride: int | None = Query(None, ge=1, le=100),
):
    a = _adapter_or_404(dataset)
    try:
        return a.field_volume(
            variable=variable, time=time,
            bbox=_bbox(latMin, latMax, lonMin, lonMax), stride=stride,
            depth_min=depthMin, depth_max=depthMax,
        )
    except (ValueError, KeyError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except NotImplementedError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except NetCDFUnavailable as exc:
        raise HTTPException(status_code=502, detail=f"NetCDF decode failed: {exc}")
    except UpstreamUnavailable503:
        raise
    except SourceUnavailable as exc:
        raise HTTPException(status_code=502, detail=str(exc))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=PORT)
