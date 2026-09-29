"""IFREMER ERDDAP Global Argo adapter.

Source: https://erddap.ifremer.fr/erddap/tabledap/ArgoFloats
  - Integrates Global Argo observations from the international Argo GDAC
    (Global Data Assembly Centre) at IFREMER.
  - list_observations(): latest position per float, constrained by bounding box + time window.
  - get_profile(): one float's most recent cycle, depth-ordered levels with
    TEMP/PSAL (raw + adjusted) and per-variable QC flags.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from urllib.parse import quote

from adapters.base import DataSourceAdapter
from adapters.erddap_common import table_json
from config import DEFAULT_BBOX
from http_client import cache_get, cache_set, SourceUnavailable
from models import DatasetMeta, Observation, ProfileLevel, SpatialRange, VariableMeta

IFREMER_ERDDAP_BASE = "https://erddap.ifremer.fr/erddap"
IFREMER_ARGO_DATASET = "ArgoFloats"

_PROFILE_VARS = ["TEMP", "PSAL"]


def _q(query: str) -> str:
    return (
        query.replace('"', "%22")
        .replace(">", "%3E")
        .replace("<", "%3C")
        .replace(" ", "%20")
    )


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _qc(v) -> str | None:
    if v is None or v == "":
        return None
    return str(v)


def _is_empty_result(exc: SourceUnavailable) -> bool:
    if getattr(exc, "status", None) != 404:
        return False
    d = (exc.detail or "").lower()
    return "no matching results" in d or "nrows = 0" in d


class IFREMERArgoAdapter(DataSourceAdapter):
    kind = "observation"

    def __init__(self, adapter_id: str = "ifremer_argo_floats",
                 dataset: str = IFREMER_ARGO_DATASET,
                 base: str = IFREMER_ERDDAP_BASE):
        self.id = adapter_id
        self.dataset = dataset
        self.base = base

    @classmethod
    def canonical_metadata(cls, adapter_id: str = "ifremer_argo_floats",
                           dataset: str = IFREMER_ARGO_DATASET,
                           base: str = IFREMER_ERDDAP_BASE) -> DatasetMeta:
        variables = [
            VariableMeta(name="platform_number", long_name="Float identifier", units=None, standard_name=None),
            VariableMeta(name="latitude", long_name="Latitude", units="degrees_north", standard_name="latitude"),
            VariableMeta(name="longitude", long_name="Longitude", units="degrees_east", standard_name="longitude"),
            VariableMeta(name="time", long_name="Time", units="UTC", standard_name="time"),
            VariableMeta(name="pres", long_name="Sea Water Pressure", units="decibar", standard_name="sea_water_pressure"),
            VariableMeta(name="temp", long_name="Sea Water Temperature", units="degree_Celsius", standard_name="sea_water_temperature"),
            VariableMeta(name="psal", long_name="Sea Water Practical Salinity", units="PSU", standard_name="sea_water_practical_salinity"),
            VariableMeta(name="platform_type", long_name="Platform Type", units=None, standard_name=None),
            VariableMeta(name="cycle_number", long_name="Cycle Number", units=None, standard_name=None),
            VariableMeta(name="pres_qc", long_name="Quality Flag for PRES", units=None, standard_name=None),
            VariableMeta(name="temp_qc", long_name="Quality Flag for TEMP", units=None, standard_name=None),
            VariableMeta(name="psal_qc", long_name="Quality Flag for PSAL", units=None, standard_name=None),
            VariableMeta(name="pres_adjusted", long_name="Adjusted Sea Water Pressure", units="decibar", standard_name="sea_water_pressure"),
            VariableMeta(name="temp_adjusted", long_name="Adjusted Sea Water Temperature", units="degree_Celsius", standard_name="sea_water_temperature"),
            VariableMeta(name="psal_adjusted", long_name="Adjusted Sea Water Practical Salinity", units="PSU", standard_name="sea_water_practical_salinity"),
        ]
        return DatasetMeta(
            datasetId=adapter_id,
            name="Global ARGO Floats (IFREMER GDAC)",
            source="IFREMER GDAC",
            kind="observation",
            fmt="ERDDAP tabledap",
            description="Global Argo float measurements from the international Argo Global Data Assembly Centre (GDAC) hosted at IFREMER.",
            variables=variables,
            timeRange=["1997-07-28T00:00:00Z", "2026-12-31T23:59:59Z"],
            spatialRange=SpatialRange(latMin=-90.0, latMax=90.0, lonMin=-180.0, lonMax=180.0),
            depthRange=[0.0, 2000.0],
            status="online",
            sourceUrl=f"{base}/tabledap/{quote(dataset)}.html",
        )

    def _tabledap(self, query: str) -> dict:
        url = f"{self.base}/tabledap/{quote(self.dataset)}.json?{_q(query)}"
        return table_json(url)

    def _tabledap_url(self, query: str) -> str:
        return f"{self.base}/tabledap/{quote(self.dataset)}.json?{_q(query)}"

    def metadata(self) -> DatasetMeta:
        cache_key = f"meta:{self.id}"
        cached = cache_get(cache_key)
        if cached:
            return cached
        canonical = self.canonical_metadata(self.id, self.dataset, self.base)
        cache_set(cache_key, canonical, ttl=86400)
        return canonical

    def _default_time_start(self, days: int = 120) -> str:
        now = datetime.now(timezone.utc)
        return _iso(now - timedelta(days=days))

    def list_observations(self, bbox=None, time_start=None, time_end=None, limit=None):
        b = bbox or DEFAULT_BBOX
        start = time_start or self._default_time_start()
        constraints = [
            "platform_number,latitude,longitude,time,platform_type",
            f"time>={start}",
        ]
        if time_end:
            constraints.append(f"time<={time_end}")
        constraints += [
            f"latitude>={b['latMin']}", f"latitude<={b['latMax']}",
            f"longitude>={b['lonMin']}", f"longitude<={b['lonMax']}",
            "distinct()",
        ]
        query = "&".join(constraints)
        try:
            table = self._tabledap(query)
        except SourceUnavailable as exc:
            if _is_empty_result(exc):
                return []
            raise

        cols = table["columnNames"]
        units = dict(zip(cols, table.get("columnUnits", [None] * len(cols))))

        # Group by platform to return the latest single position per platform
        latest_by_platform: dict[str, dict] = {}
        for row in table["rows"]:
            r = dict(zip(cols, row))
            pid = str(r.get("platform_number"))
            prev = latest_by_platform.get(pid)
            if prev is None or (r.get("time") or "") > (prev.get("time") or ""):
                latest_by_platform[pid] = r

        out: list[Observation] = []
        for pid, r in latest_by_platform.items():
            out.append(Observation(
                platformId=pid,
                platformType=r.get("platform_type") or "Argo float",
                source="IFREMER GDAC",
                latitude=r.get("latitude"),
                longitude=r.get("longitude"),
                time=r.get("time"),
                variables=list(_PROFILE_VARS),
                units={"latitude": units.get("latitude") or "degrees_north",
                       "longitude": units.get("longitude") or "degrees_east"},
                sourceUrl=self._tabledap_url(query),
            ))

        # Sort by time descending (newest floats first)
        out.sort(key=lambda o: o.time or "", reverse=True)
        if limit:
            out = out[:limit]
        return out

    def get_profile(self, platform_id: str, cycle: int | None = None) -> Observation:
        latest = {}
        if cycle is None:
            q1 = (f'cycle_number,time,latitude,longitude,platform_type'
                  f'&platform_number="{platform_id}"'
                  f'&orderByMax("cycle_number")')
            t1 = self._tabledap(q1)
            if not t1["rows"]:
                raise KeyError(f"No profiles found for platform {platform_id}")
            latest = dict(zip(t1["columnNames"], t1["rows"][0]))
            cycle = int(latest["cycle_number"])

        q2 = ("pres,pres_adjusted,temp,temp_adjusted,psal,psal_adjusted,"
              "pres_qc,temp_qc,psal_qc,time,latitude,longitude"
              f'&platform_number="{platform_id}"'
              f"&cycle_number={cycle}"
              '&orderBy("pres")')
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
            pres = r.get("pres")
            pres_adj = r.get("pres_adjusted")
            depth_source = pres if pres is not None else pres_adj

            levels.append(ProfileLevel(
                depth=depth_source,
                pressure=pres,
                values={
                    "TEMP": r.get("temp"),
                    "TEMP_ADJUSTED": r.get("temp_adjusted"),
                    "PSAL": r.get("psal"),
                    "PSAL_ADJUSTED": r.get("psal_adjusted"),
                    "PRES_ADJUSTED": pres_adj,
                },
                qc={
                    "TEMP": _qc(r.get("temp_qc")),
                    "PSAL": _qc(r.get("psal_qc")),
                    "PRES": _qc(r.get("pres_qc")),
                },
            ))

        return Observation(
            platformId=str(platform_id),
            platformType=latest.get("platform_type") or "Argo float",
            source="IFREMER GDAC",
            latitude=obs_lat,
            longitude=obs_lon,
            time=obs_time,
            variables=list(_PROFILE_VARS),
            units={
                "TEMP": units.get("temp") or "degree_Celsius",
                "PSAL": units.get("psal") or "PSU",
                "PRES": units.get("pres") or "decibar",
                "depth": "m (approx = PRES decibar)",
            },
            metadata={
                "cycle": cycle,
                "nLevels": len(levels),
                "depthNote": "depth approximated from PRES (decibar); ~1% of depth in the upper ocean",
            },
            profile=levels,
            sourceUrl=self._tabledap_url(q2),
        )
