"""DataSourceAdapter — the pluggable ingestion seam (spec s3, s7, s37).

Adding a new real source (Glider, CTD, BGC, Copernicus, THREDDS, ASCII) means
implementing one subclass and registering it in the catalog. The REST API,
normalization contract and frontend never change. Adapters MUST return real,
source-derived values or raise http_client.SourceUnavailable — never fabricate.
"""
from __future__ import annotations

from abc import ABC, abstractmethod

from models import DatasetMeta, ModelField, ModelVolume, Observation


class DataSourceAdapter(ABC):
    #: stable id used in URLs, e.g. "incois_argo_floats"
    id: str = ""
    #: "observation" | "model"
    kind: str = ""

    @abstractmethod
    def metadata(self) -> DatasetMeta:
        """Return catalog metadata, read from the source (not hardcoded where
        the source can supply it)."""
        raise NotImplementedError

    # --- observation adapters -------------------------------------------
    def list_observations(
        self,
        bbox: dict | None = None,
        time_start: str | None = None,
        time_end: str | None = None,
        limit: int | None = None,
    ) -> list[Observation]:
        """Return platform markers (positions + timestamps) with server-side
        subsetting. Profiles are fetched separately via get_profile."""
        raise NotImplementedError(f"{self.id} does not support observations")

    def get_profile(self, platform_id: str, cycle: int | None = None) -> Observation:
        """Return one platform's depth profile (real measured levels + QC)."""
        raise NotImplementedError(f"{self.id} does not support profiles")

    # --- model adapters -------------------------------------------------
    def times(self) -> list[str]:
        raise NotImplementedError(f"{self.id} does not expose a time axis")

    def depths(self) -> list[float]:
        raise NotImplementedError(f"{self.id} does not expose a depth axis")

    def field_slice(
        self,
        variable: str,
        time: str | None = None,
        depth: float | None = None,
        bbox: dict | None = None,
        stride: int | None = None,
    ) -> ModelField:
        raise NotImplementedError(f"{self.id} does not support model fields")

    def field_volume(
        self,
        variable: str,
        time: str | None = None,
        bbox: dict | None = None,
        stride: int | None = None,
        depth_min: float | None = None,
        depth_max: float | None = None,
    ) -> ModelVolume:
        """Return a depth-RESOLVED volume (values[depth][lat][lon]) for one time.
        The 3-D sibling of :meth:`field_slice`; grid adapters override it. Like
        every adapter method it MUST return real, source-derived values or raise
        — never a fabricated third dimension."""
        raise NotImplementedError(f"{self.id} does not support model volumes")
