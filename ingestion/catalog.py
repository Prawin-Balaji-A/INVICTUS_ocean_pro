"""Adapter registry (spec s3, s24). Real sources are registered here; adding a
new one is a single register() call — the API and frontend do not change when
one is. Registered now: the INCOIS Argo tabledap observation adapter and the
INCOIS griddap gridded-analysis adapter (Phase 4)."""
from __future__ import annotations

from adapters.base import DataSourceAdapter
from adapters.erddap_argo import ERDDAPArgoAdapter
from adapters.erddap_griddap import ERDDAPGriddapAdapter
from adapters.ifremer_argo import IFREMERArgoAdapter

_adapters: dict[str, DataSourceAdapter] = {}


def register(adapter: DataSourceAdapter) -> None:
    _adapters[adapter.id] = adapter


def get(adapter_id: str) -> DataSourceAdapter | None:
    return _adapters.get(adapter_id)


def all_adapters() -> list[DataSourceAdapter]:
    return list(_adapters.values())


# --- Real sources ------------------------------------------------------
register(ERDDAPArgoAdapter())          # INCOIS in-situ Argo observations (tabledap)
register(IFREMERArgoAdapter())         # Global Argo observations from IFREMER GDAC (tabledap)
register(ERDDAPGriddapAdapter())       # INCOIS gridded Argo analysis field (griddap)

