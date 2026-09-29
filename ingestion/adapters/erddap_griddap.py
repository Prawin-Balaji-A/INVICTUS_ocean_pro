"""INCOIS ERDDAP *griddap* adapter — gridded field ingestion (Phase 4).

Source: https://erddap.incois.gov.in/erddap/griddap/incois_argo_10d_VAM

SCIENTIFIC LABELLING — read this before reusing the adapter elsewhere.
The dataset's own metadata titles it "INCOIS ARGO 10 day data Variational
Analysis Methodology". It is a gridded OBJECTIVE / VARIATIONAL ANALYSIS of Argo
observations — an ANALYSIS field, **not** a free-running numerical ocean model —
and it carries TEMP and SAL only (no current vectors). Phase 4 uses it purely to
validate the gridded ingestion + server-side subsetting + NetCDF/CF decode +
canonical ModelField pipeline. The numerical-model + current-vector requirement
is fulfilled in a later phase by a verified model source (Copernicus / HYCOM).
Nothing here is described as a numerical model, and no value is fabricated.

SERVER-SIDE SUBSETTING (spec s8-12, s28). Every field_slice() pins a single
time and a single depth and a lat/lon window directly in the ERDDAP griddap
query, so the server returns ONLY the requested subset as a NetCDF file — the
full global grid is never transferred to this service or the browser. The bytes
are decoded with netcdf_reader (netCDF4 + numpy). Missing values stay null.
"""
from __future__ import annotations

import json
import time
from urllib.parse import quote

from adapters.base import DataSourceAdapter
from adapters.erddap_common import dataset_info, parse_actual_range
from config import ARGO_VAM_DATASET_ID, DEFAULT_BBOX, INCOIS_ERDDAP_BASE
from http_client import (
    cache_get, cache_set, get_bytes, get_text,
    SourceUnavailable, UpstreamUnavailable503,
)
from models import DatasetMeta, ModelField, ModelVolume, SpatialRange, VariableMeta
from netcdf_reader import grid_from_bytes, volume_from_bytes


def _f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def _fmt(x) -> str:
    """Format a coordinate for an ERDDAP griddap value selector — plain decimal,
    never scientific notation (all our lat/lon/depth magnitudes are small)."""
    return "%g" % float(x)


class ERDDAPGriddapAdapter(DataSourceAdapter):
    # Routed under the API's gridded-field pillar. The human-facing labels
    # (name/description/metadata) make clear this is an ANALYSIS field, not a
    # numerical ocean model (see the module docstring).
    kind = "model"

    def __init__(self, adapter_id: str = "incois_argo_vam",
                 dataset: str = ARGO_VAM_DATASET_ID,
                 base: str = INCOIS_ERDDAP_BASE):
        self.id = adapter_id
        self.dataset = dataset
        self.base = base

    # ------------------------------------------------------------------
    def _griddap_url(self, ext: str, query: str) -> str:
        return f"{self.base}/griddap/{quote(self.dataset)}.{ext}?{query}"

    def _with_503_retry(self, fetch, *args):
        """Run a griddap fetch (dataset_info / get_text / get_bytes) with the
        SAME 503 retry/backoff + clean-503 mapping as the Argo tabledap path
        (see erddap_argo._tabledap). An INCOIS outage therefore surfaces as a
        clean UpstreamUnavailable503 -> API 503 {"status":"upstream_unavailable"}
        instead of the raw Apache HTML page leaking through a 502. Retries a 503
        at most 3 times (waiting 1s, 2s, 4s); any non-503 error is re-raised
        as-is (a 4xx bad query / NetCDF issue is a real error, not an outage)."""
        delays = [1.0, 2.0, 4.0]
        max_retries = 3
        for attempt in range(max_retries + 1):
            t0 = time.time()
            try:
                return fetch(*args)
            except SourceUnavailable as exc:
                status = getattr(exc, "status", None)
                elapsed_ms = (time.time() - t0) * 1000
                print(f"[VAM]\nupstream status:\n{status or 'ERROR'}")
                print(f"[VAM]\nresponse time:\n{elapsed_ms:.1f}ms")
                if status == 503 and attempt < max_retries:
                    delay = delays[attempt]
                    print(f"[VAM]\nretry:\nattempt {attempt + 1}/{max_retries} (waiting {delay:.0f}s)...")
                    time.sleep(delay)
                    continue
                if status == 503:
                    raise UpstreamUnavailable503(
                        dataset=self.dataset, source="INCOIS ERDDAP",
                        url=getattr(exc, "url", ""),
                    ) from exc
                raise

    def _info(self) -> dict:
        key = f"gridinfo:{self.id}"
        cached = cache_get(key)
        if cached:
            return cached
        info = self._with_503_retry(dataset_info, self.base, self.dataset)
        cache_set(key, info)
        return info

    def _axes(self) -> dict:
        """Discover the real time/depth/lat/lon dimension names from the dataset
        info document (CF axis/units), so nothing is hardcoded where the source
        tells us. Falls back to this dataset's known names."""
        info = self._info()
        roles = {"time": None, "depth": None, "latitude": None, "longitude": None}
        for v in info["variables"]:
            if v["rowType"] != "dimension":
                continue
            a = info["attrs"].get(v["name"], {})
            axis = str(a.get("axis", "") or "").upper()
            units = str(a.get("units", "") or "").lower()
            sn = str(a.get("standard_name", "") or "").lower()
            n = v["name"].lower()
            if not roles["time"] and (axis == "T" or sn == "time" or "since" in units
                                      or n in ("time", "taxis")):
                roles["time"] = v["name"]
            elif not roles["depth"] and (axis == "Z"
                                         or units in ("meters", "m", "dbar", "decibar", "metres")
                                         or n in ("zax", "depth", "lev", "z")):
                roles["depth"] = v["name"]
            elif not roles["latitude"] and (axis == "Y" or sn == "latitude"
                                            or units.startswith("degrees_nor")):
                roles["latitude"] = v["name"]
            elif not roles["longitude"] and (axis == "X" or sn == "longitude"
                                             or units.startswith("degrees_eas")):
                roles["longitude"] = v["name"]
        roles["time"] = roles["time"] or "time"
        roles["depth"] = roles["depth"] or "ZAX"
        roles["latitude"] = roles["latitude"] or "latitude"
        roles["longitude"] = roles["longitude"] or "longitude"
        return roles

    def _data_vars(self) -> list[str]:
        return [v["name"] for v in self._info()["variables"] if v["rowType"] == "variable"]

    # ------------------------------------------------------------------
    def metadata(self) -> DatasetMeta:
        key = f"meta:{self.id}"
        cached = cache_get(key)
        if cached:
            return cached

        info = self._info()
        attrs = info["attrs"]
        g = attrs.get("NC_GLOBAL", {})

        variables: list[VariableMeta] = []
        for v in info["variables"]:
            if v["rowType"] != "variable":
                continue
            a = attrs.get(v["name"], {})
            variables.append(VariableMeta(
                name=v["name"],
                long_name=a.get("long_name"),
                units=a.get("units"),
                standard_name=a.get("standard_name"),
            ))

        spatial = SpatialRange(
            latMin=_f(g.get("geospatial_lat_min")),
            latMax=_f(g.get("geospatial_lat_max")),
            lonMin=_f(g.get("geospatial_lon_min")),
            lonMax=_f(g.get("geospatial_lon_max")),
        )
        zname = self._axes()["depth"]
        zrange = parse_actual_range(attrs.get(zname, {}).get("actual_range"))

        title = g.get("title") or self.dataset
        var_names = ", ".join(v.name for v in variables) or "gridded fields"
        desc = (
            f"{g.get('summary') or title}. "
            f"Gridded OBJECTIVE/VARIATIONAL ANALYSIS of Argo observations "
            f"(source title: '{title}') — a gridded ANALYSIS field, NOT a "
            f"free-running numerical ocean model. Variables: {var_names} "
            f"(temperature & salinity only; contains no current vectors). Used in "
            f"Phase 4 to validate the gridded ingestion + server-side subsetting "
            f"+ NetCDF/CF decode pipeline."
        )

        meta = DatasetMeta(
            datasetId=self.id,
            name=title,
            source=g.get("institution") or "INCOIS",
            kind="model",
            fmt="ERDDAP griddap (NetCDF subset)",
            description=desc,
            variables=variables,
            timeRange=[t for t in [g.get("time_coverage_start"),
                                   g.get("time_coverage_end")] if t] or None,
            spatialRange=spatial,
            depthRange=zrange,
            status="online",
            sourceUrl=f"{self.base}/griddap/{quote(self.dataset)}.graph",
        )
        cache_set(key, meta)
        return meta

    # ------------------------------------------------------------------
    def times(self) -> list[str]:
        """Real time axis (ISO-8601 strings), read from the source. Cached."""
        key = f"times:{self.id}"
        cached = cache_get(key)
        if cached is not None:
            return cached
        doc = json.loads(self._with_503_retry(get_text, self._griddap_url("json", self._axes()["time"])))
        out = [str(r[0]) for r in doc["table"]["rows"]]
        cache_set(key, out)
        return out

    def depths(self) -> list[float]:
        """Real depth axis (metres), read from the source. Cached."""
        key = f"depths:{self.id}"
        cached = cache_get(key)
        if cached is not None:
            return cached
        doc = json.loads(self._with_503_retry(get_text, self._griddap_url("json", self._axes()["depth"])))
        out = [float(r[0]) for r in doc["table"]["rows"]]
        cache_set(key, out)
        return out

    # ------------------------------------------------------------------
    def field_slice(self, variable, time=None, depth=None, bbox=None, stride=None) -> ModelField:
        variable = (variable or "").strip()
        allowed = self._data_vars()
        if variable not in allowed:
            raise ValueError(
                f"Unknown variable '{variable}' for dataset '{self.id}'. "
                f"Available: {allowed}"
            )

        # Spatial window, clamped to the dataset's real coverage.
        sp = self.metadata().spatialRange
        b = bbox or DEFAULT_BBOX
        latMin, latMax = _f(b["latMin"]), _f(b["latMax"])
        lonMin, lonMax = _f(b["lonMin"]), _f(b["lonMax"])
        if sp:
            if sp.latMin is not None:
                latMin = max(latMin, sp.latMin)
            if sp.latMax is not None:
                latMax = min(latMax, sp.latMax)
            if sp.lonMin is not None:
                lonMin = max(lonMin, sp.lonMin)
            if sp.lonMax is not None:
                lonMax = min(lonMax, sp.lonMax)
        if latMin > latMax or lonMin > lonMax:
            raise ValueError(
                "Requested bounding box is outside the dataset coverage "
                f"(lat {sp.latMin}..{sp.latMax}, lon {sp.lonMin}..{sp.lonMax})"
            )

        # Time: default to the latest available step (ERDDAP 'last').
        tsel = "last" if not time else str(time)
        # Depth: default to the shallowest real level.
        dsel = float(depth) if depth is not None else self.depths()[0]

        # Optional server-side spatial stride to cap payload size.
        if stride and int(stride) > 1:
            s = int(stride)
            lat_q = f"({_fmt(latMin)}):{s}:({_fmt(latMax)})"
            lon_q = f"({_fmt(lonMin)}):{s}:({_fmt(lonMax)})"
        else:
            s = 1
            lat_q = f"({_fmt(latMin)}):({_fmt(latMax)})"
            lon_q = f"({_fmt(lonMin)}):({_fmt(lonMax)})"

        # griddap subset: VAR[(time)][(depth)][(latMin):(latMax)][(lonMin):(lonMax)]
        q = f"{variable}[({tsel})][({_fmt(dsel)})][{lat_q}][{lon_q}]"
        url = self._griddap_url("nc", q)

        cache_key = f"field:{url}"
        cached = cache_get(cache_key)
        if cached:
            return cached

        raw = self._with_503_retry(get_bytes, url)  # 503 -> UpstreamUnavailable503 (clean); other -> API 502
        grid = grid_from_bytes(raw, variable)  # NetCDFUnavailable -> API 502

        mf = ModelField(
            datasetId=self.id,
            source=self.metadata().source,
            variable=variable,
            units=grid["units"],
            time=grid["time"],
            depth=grid["depth"],
            longitude=grid["longitude"],
            latitude=grid["latitude"],
            values=grid["values"],
            dimensions=grid["dimensions"],
            metadata={
                "standard_name": grid["standard_name"],
                "long_name": grid["long_name"],
                "fillValue": grid["fillValue"],
                "depthUnits": grid["depthUnits"],
                "productType": "objective/variational analysis (gridded)",
                "isNumericalModel": False,
                "note": ("Gridded ANALYSIS of Argo observations (INCOIS VAM); NOT a "
                         "numerical ocean model. TEMP/SAL only — no currents. "
                         "Phase 4 pipeline validation."),
                "requestedBBox": {"latMin": latMin, "latMax": latMax,
                                  "lonMin": lonMin, "lonMax": lonMax},
                "stride": s,
                "subsetQuery": q,
                "bytesTransferred": len(raw),
                "format": "NetCDF (netCDF4) subset via ERDDAP griddap",
            },
            quality="analysis",
            sourceUrl=url,
        )
        cache_set(cache_key, mf)
        return mf

    # ------------------------------------------------------------------
    def field_volume(self, variable, time=None, bbox=None, stride=None,
                     depth_min=None, depth_max=None) -> ModelVolume:
        """Depth-RESOLVED sibling of :meth:`field_slice` (Phase 8).

        Pins one time and a lat/lon window exactly as field_slice does, but keeps
        the FULL real depth axis (optionally limited to a [depth_min, depth_max]
        window) via a griddap depth-RANGE selector, so the server returns a real
        3-D subset as one NetCDF file. Decoded with volume_from_bytes keeping the
        depth dimension. No depth level is invented; missing cells stay null; the
        vertical axis is never decimated (stride applies to lat/lon only).
        """
        variable = (variable or "").strip()
        allowed = self._data_vars()
        if variable not in allowed:
            raise ValueError(
                f"Unknown variable '{variable}' for dataset '{self.id}'. "
                f"Available: {allowed}"
            )

        # Spatial window, clamped to the dataset's real coverage (same as field_slice).
        sp = self.metadata().spatialRange
        b = bbox or DEFAULT_BBOX
        latMin, latMax = _f(b["latMin"]), _f(b["latMax"])
        lonMin, lonMax = _f(b["lonMin"]), _f(b["lonMax"])
        if sp:
            if sp.latMin is not None:
                latMin = max(latMin, sp.latMin)
            if sp.latMax is not None:
                latMax = min(latMax, sp.latMax)
            if sp.lonMin is not None:
                lonMin = max(lonMin, sp.lonMin)
            if sp.lonMax is not None:
                lonMax = min(lonMax, sp.lonMax)
        if latMin > latMax or lonMin > lonMax:
            raise ValueError(
                "Requested bounding box is outside the dataset coverage "
                f"(lat {sp.latMin}..{sp.latMax}, lon {sp.lonMin}..{sp.lonMax})"
            )

        # Depth: span the FULL real depth axis, optionally limited to a window.
        # Endpoints are clamped to real levels and ordered to match the axis's
        # stored order (ascending/descending) so the griddap selector is valid.
        depths = self.depths()
        if not depths:
            raise ValueError(f"Dataset '{self.id}' exposes no depth axis")
        zlo_real, zhi_real = min(depths), max(depths)
        dmin = zlo_real if depth_min is None else max(zlo_real, _f(depth_min))
        dmax = zhi_real if depth_max is None else min(zhi_real, _f(depth_max))
        if dmin is None or dmax is None or dmin > dmax:
            raise ValueError(
                f"Invalid depth window [{depth_min}, {depth_max}] for real range "
                f"{zlo_real}..{zhi_real} m"
            )
        ascending = depths[0] <= depths[-1]
        d_a, d_b = (dmin, dmax) if ascending else (dmax, dmin)
        depth_q = f"({_fmt(d_a)}):({_fmt(d_b)})"

        # Time: default to the latest available step (ERDDAP 'last').
        tsel = "last" if not time else str(time)

        # Optional server-side spatial stride on lat/lon ONLY — every real depth
        # level is kept (the vertical axis is never decimated).
        if stride and int(stride) > 1:
            s = int(stride)
            lat_q = f"({_fmt(latMin)}):{s}:({_fmt(latMax)})"
            lon_q = f"({_fmt(lonMin)}):{s}:({_fmt(lonMax)})"
        else:
            s = 1
            lat_q = f"({_fmt(latMin)}):({_fmt(latMax)})"
            lon_q = f"({_fmt(lonMin)}):({_fmt(lonMax)})"

        # griddap subset: VAR[(time)][(dLo):(dHi)][(latMin):(latMax)][(lonMin):(lonMax)]
        q = f"{variable}[({tsel})][{depth_q}][{lat_q}][{lon_q}]"
        url = self._griddap_url("nc", q)

        cache_key = f"volume:{url}"
        cached = cache_get(cache_key)
        if cached:
            return cached

        raw = self._with_503_retry(get_bytes, url)  # 503 -> UpstreamUnavailable503 (clean); other -> API 502
        vol = volume_from_bytes(raw, variable)   # NetCDFUnavailable -> API 502

        mv = ModelVolume(
            datasetId=self.id,
            source=self.metadata().source,
            variable=variable,
            units=vol["units"],
            time=vol["time"],
            depths=vol["depths"],
            depthUnits=vol["depthUnits"],
            longitude=vol["longitude"],
            latitude=vol["latitude"],
            values=vol["values"],
            dimensions=vol["dimensions"],
            metadata={
                "standard_name": vol["standard_name"],
                "long_name": vol["long_name"],
                "fillValue": vol["fillValue"],
                "productType": "objective/variational analysis (gridded)",
                "isNumericalModel": False,
                "note": ("Gridded ANALYSIS of Argo observations (INCOIS VAM); NOT a "
                         "numerical ocean model. TEMP/SAL only — no currents. "
                         "Depth-resolved volume for Phase 8 isosurfaces."),
                "requestedBBox": {"latMin": latMin, "latMax": latMax,
                                  "lonMin": lonMin, "lonMax": lonMax},
                "requestedDepthRange": {"min": dmin, "max": dmax},
                "stride": s,
                "subsetQuery": q,
                "bytesTransferred": len(raw),
                "format": "NetCDF (netCDF4) subset via ERDDAP griddap",
            },
            quality="analysis",
            sourceUrl=url,
        )
        cache_set(cache_key, mv)
        return mv
