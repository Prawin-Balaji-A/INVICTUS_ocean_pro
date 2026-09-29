"""INCOIS ERDDAP Argo adapter (spec s17, s25, s28).

Source: https://erddap.incois.gov.in/erddap/tabledap/Indian_ARGO_Floats
  - list_observations(): latest position per float (server-side orderByMax),
    optionally constrained by bounding box + time window.
  - get_profile(): one float's most recent cycle, depth-ordered levels with
    TEMP/PSAL (raw + adjusted) and per-variable QC flags.

Every value returned is read from ERDDAP. Missing measurements stay null.
The vertical coordinate is pressure (decibar); depth is reported as
depth-approx-pressure and labelled as such (a documented oceanographic
approximation, not a fabricated depth).
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

from adapters.base import DataSourceAdapter
from adapters.erddap_common import parse_actual_range, table_json, dataset_info
from config import ARGO_DATASET_ID, DEFAULT_BBOX, INCOIS_ERDDAP_BASE
from http_client import cache_get, cache_set, SourceUnavailable, UpstreamUnavailable503
from models import DatasetMeta, Observation, ProfileLevel, SpatialRange, VariableMeta

# Science variables we surface for plotting/profiles (present in this dataset).
_PROFILE_VARS = ["TEMP", "PSAL"]

_CACHE_DIR = Path(__file__).resolve().parent.parent / ".cache"


def _q(query: str) -> str:
    """Encode ERDDAP query characters that must be percent-encoded while
    leaving ERDDAP's structural syntax (commas, parens, =, &) intact."""
    return (
        query.replace('"', "%22")
        .replace(">", "%3E")
        .replace("<", "%3C")
        .replace(" ", "%20")
    )


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_iso(s: str) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def _is_empty_result(exc: SourceUnavailable) -> bool:
    """True when ERDDAP reported a VALID query that simply matched zero rows."""
    if getattr(exc, "status", None) != 404:
        return False
    d = (exc.detail or "").lower()
    return "no matching results" in d or "nrows = 0" in d


class ERDDAPArgoAdapter(DataSourceAdapter):
    kind = "observation"

    def __init__(self, adapter_id: str = "incois_argo_floats",
                 dataset: str = ARGO_DATASET_ID,
                 base: str = INCOIS_ERDDAP_BASE):
        self.id = adapter_id
        self.dataset = dataset
        self.base = base

    @classmethod
    def canonical_metadata(cls, adapter_id: str = "incois_argo_floats",
                           dataset: str = ARGO_DATASET_ID,
                           base: str = INCOIS_ERDDAP_BASE) -> DatasetMeta:
        """Known canonical schema for Indian_ARGO_Floats per INCOIS documentation."""
        variables = [
            VariableMeta(name="PLATFORM_NUMBER", long_name="Float identifier", units=None, standard_name=None),
            VariableMeta(name="latitude", long_name="Latitude", units="degrees_north", standard_name="latitude"),
            VariableMeta(name="longitude", long_name="Longitude", units="degrees_east", standard_name="longitude"),
            VariableMeta(name="time", long_name="Time", units="UTC", standard_name="time"),
            VariableMeta(name="PRES", long_name="Sea Water Pressure", units="decibar", standard_name="sea_water_pressure"),
            VariableMeta(name="TEMP", long_name="Sea Water Temperature", units="degree_Celsius", standard_name="sea_water_temperature"),
            VariableMeta(name="PSAL", long_name="Sea Water Practical Salinity", units="PSU", standard_name="sea_water_practical_salinity"),
            VariableMeta(name="PLATFORM_TYPE", long_name="Platform Type", units=None, standard_name=None),
            VariableMeta(name="CYCLE_NUMBER", long_name="Cycle Number", units=None, standard_name=None),
            VariableMeta(name="PRES_QC", long_name="Quality Flag for PRES", units=None, standard_name=None),
            VariableMeta(name="TEMP_QC", long_name="Quality Flag for TEMP", units=None, standard_name=None),
            VariableMeta(name="PSAL_QC", long_name="Quality Flag for PSAL", units=None, standard_name=None),
            VariableMeta(name="PRES_ADJUSTED", long_name="Adjusted Sea Water Pressure", units="decibar", standard_name="sea_water_pressure"),
            VariableMeta(name="TEMP_ADJUSTED", long_name="Adjusted Sea Water Temperature", units="degree_Celsius", standard_name="sea_water_temperature"),
            VariableMeta(name="PSAL_ADJUSTED", long_name="Adjusted Sea Water Practical Salinity", units="PSU", standard_name="sea_water_practical_salinity"),
        ]
        return DatasetMeta(
            datasetId=adapter_id,
            name="INDIAN ARGO Floats",
            source="INCOIS",
            kind="observation",
            fmt="ERDDAP tabledap",
            description="Indian Argo floats data providing real in-situ temperature and salinity profiles across the Indian Ocean.",
            variables=variables,
            timeRange=["2002-10-24T00:00:00Z", "2025-05-01T00:00:00Z"],
            spatialRange=SpatialRange(latMin=-70.0, latMax=30.0, lonMin=20.0, lonMax=140.0),
            depthRange=[0.0, 2000.0],
            status="online",
            sourceUrl=f"{base}/tabledap/{quote(dataset)}.html",
        )

    def _disk_cache_path(self) -> Path:
        return _CACHE_DIR / f"{self.dataset}_meta.json"

    def _load_disk_cache(self) -> DatasetMeta | None:
        try:
            p = self._disk_cache_path()
            if p.exists():
                with open(p, "r", encoding="utf-8") as f:
                    data = json.load(f)
                return DatasetMeta(**data)
        except Exception:
            return None
        return None

    def _save_disk_cache(self, meta: DatasetMeta) -> None:
        try:
            _CACHE_DIR.mkdir(parents=True, exist_ok=True)
            p = self._disk_cache_path()
            with open(p, "w", encoding="utf-8") as f:
                json.dump(meta.dict(), f, indent=2)
        except Exception:
            pass

    # ------------------------------------------------------------------
    def _tabledap(self, query: str) -> dict:
        url = f"{self.base}/tabledap/{quote(self.dataset)}.json?{_q(query)}"
        print(f"[ARGO]\nobservation request:\n{url}")
        delays = [1.0, 2.0, 4.0]
        max_retries = 3
        for attempt in range(max_retries + 1):
            t0 = time.time()
            try:
                table = table_json(url)
                elapsed_ms = (time.time() - t0) * 1000
                print(f"[ARGO]\nupstream status:\n200")
                print(f"[ARGO]\nresponse time:\n{elapsed_ms:.1f}ms")
                return table
            except SourceUnavailable as exc:
                elapsed_ms = (time.time() - t0) * 1000
                status = getattr(exc, "status", None)
                print(f"[ARGO]\nupstream status:\n{status or 'ERROR'}")
                print(f"[ARGO]\nresponse time:\n{elapsed_ms:.1f}ms")
                if _is_empty_result(exc):
                    raise
                if status == 503 and attempt < max_retries:
                    delay = delays[attempt]
                    print(f"[ARGO]\nretry:\nattempt {attempt + 1}/{max_retries} (waiting {delay:.0f}s)...")
                    time.sleep(delay)
                    continue
                if status == 503:
                    raise UpstreamUnavailable503(
                        dataset=self.dataset,
                        source="INCOIS ERDDAP",
                        url=url
                    ) from exc
                raise

    def _tabledap_url(self, query: str) -> str:
        return f"{self.base}/tabledap/{quote(self.dataset)}.json?{_q(query)}"

    # ------------------------------------------------------------------
    def metadata(self) -> DatasetMeta:
        # 1. Try cached metadata first (memory, then disk)
        cache_key = f"meta:{self.id}"
        cached = cache_get(cache_key)
        if cached:
            return cached

        disk_cached = self._load_disk_cache()
        if disk_cached:
            cache_set(cache_key, disk_cached, ttl=86400)
            return disk_cached

        # If metadata endpoint returned 503 recently, don't spam it repeatedly
        neg_cache_key = f"meta_fail:{self.id}"
        if cache_get(neg_cache_key):
            canonical = self.canonical_metadata(self.id, self.dataset, self.base)
            cache_set(cache_key, canonical, ttl=300)
            return canonical

        # 2. Request ERDDAP metadata
        url = f"{self.base}/info/{quote(self.dataset)}/index.json"
        print(f"[ARGO]\nmetadata request:\n{url}")
        t0 = time.time()
        try:
            info = dataset_info(self.base, self.dataset)
            elapsed_ms = (time.time() - t0) * 1000
            print(f"[ARGO]\nupstream status:\n200")
            print(f"[ARGO]\nresponse time:\n{elapsed_ms:.1f}ms")

            attrs = info["attrs"]
            g = attrs.get("NC_GLOBAL", {})

            variables: list[VariableMeta] = []
            for v in info["variables"]:
                a = attrs.get(v["name"], {})
                variables.append(VariableMeta(
                    name=v["name"],
                    long_name=a.get("long_name"),
                    units=a.get("units"),
                    standard_name=a.get("standard_name"),
                ))

            def _f(x):
                try:
                    return float(x)
                except (TypeError, ValueError):
                    return None

            spatial = SpatialRange(
                latMin=_f(g.get("geospatial_lat_min")),
                latMax=_f(g.get("geospatial_lat_max")),
                lonMin=_f(g.get("geospatial_lon_min")),
                lonMax=_f(g.get("geospatial_lon_max")),
            )
            pres_range = parse_actual_range(attrs.get("PRES", {}).get("actual_range"))

            meta = DatasetMeta(
                datasetId=self.id,
                name=g.get("title") or "INDIAN ARGO Floats",
                source=g.get("institution") or "INCOIS",
                kind="observation",
                fmt="ERDDAP tabledap",
                description=g.get("summary"),
                variables=variables,
                timeRange=[t for t in [g.get("time_coverage_start"), g.get("time_coverage_end")] if t] or None,
                spatialRange=spatial,
                depthRange=pres_range,  # decibar approx meters
                status="online",
                sourceUrl=f"{self.base}/info/{quote(self.dataset)}/index.html",
            )
            # 3. Cache successful metadata
            cache_set(cache_key, meta, ttl=86400)
            self._save_disk_cache(meta)
            return meta
        except SourceUnavailable as exc:
            elapsed_ms = (time.time() - t0) * 1000
            status = getattr(exc, "status", None) or 503
            print(f"[ARGO]\nupstream status:\n{status}")
            print(f"[ARGO]\nresponse time:\n{elapsed_ms:.1f}ms")
            # Do NOT fail the entire Argo observation request if metadata endpoint returns 503.
            # Cache failure for 300s so we do not request metadata repeatedly after HTTP 503.
            cache_set(neg_cache_key, True, ttl=300)
            canonical = self.canonical_metadata(self.id, self.dataset, self.base)
            cache_set(cache_key, canonical, ttl=300)
            return canonical

    # ------------------------------------------------------------------
    def _default_time_start(self, days: int = 45) -> str:
        """Recent window ending at the dataset's latest coverage time without querying /info."""
        end = None
        cached = cache_get(f"meta:{self.id}") or self._load_disk_cache()
        if cached and cached.timeRange and len(cached.timeRange) == 2:
            end = _parse_iso(cached.timeRange[1])
        if end is None:
            end = datetime.now(timezone.utc)
        return _iso(end - timedelta(days=days))

    def list_observations(self, bbox=None, time_start=None, time_end=None, limit=None):
        b = bbox or DEFAULT_BBOX
        start = time_start or self._default_time_start()
        constraints = [
            "PLATFORM_NUMBER,latitude,longitude,time,PLATFORM_TYPE",
            f"time>={start}",
        ]
        if time_end:
            constraints.append(f"time<={time_end}")
        constraints += [
            f"latitude>={b['latMin']}", f"latitude<={b['latMax']}",
            f"longitude>={b['lonMin']}", f"longitude<={b['lonMax']}",
            'orderByMax("PLATFORM_NUMBER,time")',
        ]
        query = "&".join(constraints)
        try:
            table = self._tabledap(query)
        except SourceUnavailable as exc:
            # A valid region/time window that contains no floats is an empty
            # result, not an error — return [] so the API responds 200 count 0.
            if _is_empty_result(exc):
                return []
            raise
        cols = table["columnNames"]
        units = dict(zip(cols, table.get("columnUnits", [None] * len(cols))))

        out: list[Observation] = []
        for row in table["rows"]:
            r = dict(zip(cols, row))
            out.append(Observation(
                platformId=str(r.get("PLATFORM_NUMBER")),
                platformType=r.get("PLATFORM_TYPE") or "Argo float",
                source="INCOIS",
                latitude=r.get("latitude"),
                longitude=r.get("longitude"),
                time=r.get("time"),
                variables=list(_PROFILE_VARS),
                units={"latitude": units.get("latitude"), "longitude": units.get("longitude")},
                sourceUrl=self._tabledap_url(query),
            ))
        if limit:
            out = out[:limit]
        return out

    # ------------------------------------------------------------------
    def get_profile(self, platform_id: str, cycle: int | None = None) -> Observation:
        # 1) latest cycle + position for this float (unless a cycle is given).
        latest = {}
        if cycle is None:
            # PLATFORM_NUMBER must be among the result variables for orderByMax.
            q1 = (f'PLATFORM_NUMBER,time,CYCLE_NUMBER,latitude,longitude,PLATFORM_TYPE,DIRECTION'
                  f'&PLATFORM_NUMBER="{platform_id}"'
                  f'&orderByMax("PLATFORM_NUMBER,time")')
            t1 = self._tabledap(q1)
            if not t1["rows"]:
                raise KeyError(f"No profiles found for platform {platform_id}")
            latest = dict(zip(t1["columnNames"], t1["rows"][0]))
            cycle = int(latest["CYCLE_NUMBER"])

        # 2) that cycle's depth-ordered levels.
        q2 = ("PRES,PRES_ADJUSTED,TEMP,TEMP_ADJUSTED,PSAL,PSAL_ADJUSTED,"
              "PRES_QC,TEMP_QC,PSAL_QC,time,latitude,longitude"
              f'&PLATFORM_NUMBER="{platform_id}"'
              f"&CYCLE_NUMBER={cycle}"
              '&orderBy("PRES")')
        t2 = self._tabledap(q2)
        cols = t2["columnNames"]
        units = dict(zip(cols, t2.get("columnUnits", [None] * len(cols))))

        levels: list[ProfileLevel] = []
        obs_time = latest.get("time")
        obs_lat = latest.get("latitude")
        obs_lon = latest.get("longitude")
        for row in t2["rows"]:
            r = dict(zip(cols, row))
            if obs_time is None:
                obs_time, obs_lat, obs_lon = r.get("time"), r.get("latitude"), r.get("longitude")
            pres = r.get("PRES")
            pres_adj = r.get("PRES_ADJUSTED")
            depth_source = pres if pres is not None else pres_adj  # decibar ~ meters
            levels.append(ProfileLevel(
                depth=depth_source,
                pressure=pres,
                values={
                    "TEMP": r.get("TEMP"),
                    "TEMP_ADJUSTED": r.get("TEMP_ADJUSTED"),
                    "PSAL": r.get("PSAL"),
                    "PSAL_ADJUSTED": r.get("PSAL_ADJUSTED"),
                    "PRES_ADJUSTED": pres_adj,
                },
                qc={
                    "TEMP": _qc(r.get("TEMP_QC")),
                    "PSAL": _qc(r.get("PSAL_QC")),
                    "PRES": _qc(r.get("PRES_QC")),
                },
            ))

        return Observation(
            platformId=str(platform_id),
            platformType=latest.get("PLATFORM_TYPE") or "Argo float",
            source="INCOIS",
            latitude=obs_lat,
            longitude=obs_lon,
            time=obs_time,
            variables=list(_PROFILE_VARS),
            units={
                "TEMP": units.get("TEMP") or "degree_Celsius",
                "PSAL": units.get("PSAL") or "PSU",
                "PRES": units.get("PRES") or "decibar",
                "depth": "m (approx = PRES decibar)",
            },
            metadata={
                "cycle": cycle,
                "direction": latest.get("DIRECTION"),
                "nLevels": len(levels),
                "depthNote": "depth approximated from PRES (decibar); ~1% of depth in the upper ocean",
            },
            profile=levels,
            sourceUrl=self._tabledap_url(q2),
        )


def _qc(v) -> str | None:
    """Normalize an ERDDAP QC char/int to a string flag, preserving it as-is."""
    if v is None or v == "":
        return None
    return str(v).strip()
