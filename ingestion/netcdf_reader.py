"""NetCDF / CF-Conventions reader foundation (spec: NetCDF, CF, OPeNDAP/THREDDS).

Decodes REAL NetCDF produced by a source into plain Python numbers — it never
fabricates values. Built directly on **netCDF4 + numpy**, deliberately NOT on
xarray: xarray eagerly imports pandas, whose compiled extension DLLs are blocked
by this machine's Windows Application Control policy. netCDF4 is the lower-level,
CF-aware reader and is the appropriate foundation here in any case.

Two byte-sources feed one decode path:

  * ``grid_from_bytes(raw, variable)`` — an in-memory NetCDF file, e.g. a server-
    side-subsetted ERDDAP griddap ``.nc`` download. This is the path exercised on
    real INCOIS data in Phase 4.
  * ``grid_from_url(url, variable)`` — an OPeNDAP/DODS endpoint or remote ``.nc``.
    This is the reader FOUNDATION for THREDDS / HYCOM / Copernicus in a later
    phase; the server does the subsetting via the DAP constraint expression that
    the caller bakes into ``url``. netCDF4 opens DAP URLs transparently.

Missing / fill values are returned as ``None`` (CF ``_FillValue`` / ``missing_value``
are applied by netCDF4's mask; ``NaN`` is treated as missing too) — never as a
sentinel number. CF ``scale_factor`` / ``add_offset`` are applied by netCDF4 so
values come back in physical units.

Imports of netCDF4 / numpy are deferred to call time so the FastAPI app still
boots — and the ERDDAP *tabledap* Argo path keeps working — even if a native
dependency is unavailable in some environment. In that case a decode raises
:class:`NetCDFUnavailable`, which the API surfaces as an explicit error (never a
fabricated grid).
"""
from __future__ import annotations


class NetCDFUnavailable(RuntimeError):
    """Raised when the NetCDF stack (netCDF4 / numpy) cannot be imported or a
    NetCDF payload cannot be opened. Callers map this to an explicit API error;
    it is NEVER swallowed and replaced with synthetic data."""


def _imports():
    """Import netCDF4 + numpy lazily, turning any failure into NetCDFUnavailable
    with the underlying cause preserved."""
    try:
        import netCDF4  # noqa: WPS433 (deferred on purpose)
        import numpy as np  # noqa: WPS433
        return netCDF4, np
    except Exception as exc:  # ImportError, or a blocked native DLL, etc.
        raise NetCDFUnavailable(f"NetCDF stack unavailable: {exc}") from exc


# ---------------------------------------------------------------------------
# CF axis classification
# ---------------------------------------------------------------------------
def classify_axes(ds) -> dict:
    """Identify the time / depth / latitude / longitude coordinate variables of
    an open NetCDF dataset from CF attributes (``standard_name``, ``units``,
    ``axis``, ``positive``), falling back to common coordinate names.

    Returns ``{"time":name|None, "depth":name|None, "latitude":name|None,
    "longitude":name|None}``.
    """
    roles = {"time": None, "depth": None, "latitude": None, "longitude": None}
    for name, var in ds.variables.items():
        sn = str(getattr(var, "standard_name", "") or "").lower()
        units = str(getattr(var, "units", "") or "").lower()
        axis = str(getattr(var, "axis", "") or "").upper()
        positive = str(getattr(var, "positive", "") or "").lower()
        n = name.lower()

        if roles["latitude"] is None and (
            sn == "latitude" or axis == "Y"
            or units.startswith("degrees_nor") or units.startswith("degree_nor")
            or n in ("latitude", "lat", "yax", "y")
        ):
            roles["latitude"] = name
            continue
        if roles["longitude"] is None and (
            sn == "longitude" or axis == "X"
            or units.startswith("degrees_eas") or units.startswith("degree_eas")
            or n in ("longitude", "lon", "xax", "x")
        ):
            roles["longitude"] = name
            continue
        if roles["time"] is None and (
            sn == "time" or axis == "T" or "since" in units
            or n in ("time", "taxis", "t")
        ):
            roles["time"] = name
            continue
        if roles["depth"] is None and (
            axis == "Z" or sn in ("depth", "sea_water_pressure")
            or positive in ("down", "up")
            or units in ("m", "meter", "meters", "metre", "metres",
                         "db", "dbar", "decibar")
            or n in ("depth", "zax", "lev", "z", "zlev", "deptht")
        ):
            roles["depth"] = name
            continue
    return roles


def _grid_to_lists(grid, np) -> list:
    """Convert a 2-D masked array (lat, lon) to ``list[list[float | None]]``,
    mapping masked cells and NaN to ``None`` (never a fill sentinel)."""
    grid = np.ma.atleast_2d(grid)
    mask = np.ma.getmaskarray(grid)
    data = np.ma.getdata(grid).astype("float64", copy=False)
    out: list[list] = []
    for i in range(data.shape[0]):
        row: list = []
        di = data[i]
        mi = mask[i]
        for j in range(data.shape[1]):
            v = di[j]
            if mi[j] or v != v:  # masked or NaN
                row.append(None)
            else:
                row.append(float(v))
        out.append(row)
    return out


def _volume_to_lists(vol, np) -> list:
    """Convert a 3-D masked array (depth, lat, lon) to
    ``list[list[list[float | None]]]``, mapping masked cells and NaN to ``None``
    (never a fill sentinel, never zero). This is the depth-resolved sibling of
    :func:`_grid_to_lists`; the two share identical missing-value semantics so a
    volume plane and a single depth slice treat absent data the same way."""
    data = np.ma.getdata(vol).astype("float64", copy=False)
    mask = np.ma.getmaskarray(vol)
    nz, ny, nx = data.shape
    out: list = []
    for k in range(nz):
        dk = data[k]
        mk = mask[k]
        plane: list = []
        for i in range(ny):
            di = dk[i]
            mi = mk[i]
            row: list = []
            for j in range(nx):
                v = di[j]
                if mi[j] or v != v:  # masked or NaN
                    row.append(None)
                else:
                    row.append(float(v))
            plane.append(row)
        out.append(plane)
    return out


def _time_iso(ds, name, np, netCDF4) -> str | None:
    """Decode the (single, pinned) time coordinate to an ISO-8601 UTC string
    using CF ``units`` / ``calendar`` via netCDF4.num2date."""
    if not name or name not in ds.variables:
        return None
    tv = ds.variables[name]
    vals = np.atleast_1d(tv[:])
    if len(vals) == 0:
        return None
    units = getattr(tv, "units", None)
    if not units:
        return None
    try:
        dt = netCDF4.num2date(
            vals[0], units, calendar=getattr(tv, "calendar", "standard")
        )
        iso = dt.isoformat()
        return iso if iso.endswith("Z") else iso + "Z"
    except Exception:
        return None


def extract_grid(ds, variable: str) -> dict:
    """Normalize one variable of an open NetCDF dataset into a canonical grid.

    The dataset is expected to be pinned to a single time and single depth (as
    the griddap subset query does); any non lat/lon axis is reduced by taking
    its first index. Returns a dict with the 2-D ``values[lat][lon]`` plus the
    real coordinate arrays, CF units/standard_name/long_name and the fill value.
    """
    netCDF4, np = _imports()

    if variable not in ds.variables:
        raise KeyError(
            f"Variable '{variable}' not in dataset (have: "
            f"{list(ds.variables.keys())})"
        )

    var = ds.variables[variable]
    var.set_auto_maskandscale(True)  # apply CF _FillValue / scale_factor / add_offset

    roles = classify_axes(ds)
    lat_name, lon_name = roles["latitude"], roles["longitude"]
    if not lat_name or not lon_name:
        raise ValueError("Could not identify latitude/longitude axes (CF metadata)")

    dims = list(var.dimensions)
    if lat_name not in dims or lon_name not in dims:
        raise ValueError(
            f"Variable '{variable}' is not gridded on lat/lon (dims={dims})"
        )

    arr = var[:]  # masked array in physical units
    # Reduce every non lat/lon dimension by its first index (single pinned slice).
    take = [slice(None) if d in (lat_name, lon_name) else 0 for d in dims]
    grid = arr[tuple(take)]
    # Ensure (lat, lon) ordering regardless of the file's dim order.
    if dims.index(lat_name) > dims.index(lon_name):
        grid = grid.T

    latitude = [float(x) for x in np.atleast_1d(ds.variables[lat_name][:])]
    longitude = [float(x) for x in np.atleast_1d(ds.variables[lon_name][:])]
    values = _grid_to_lists(grid, np)

    depth_val = None
    if roles["depth"] and roles["depth"] in ds.variables:
        dv = np.atleast_1d(ds.variables[roles["depth"]][:])
        if len(dv):
            depth_val = float(dv[0])

    fill = getattr(var, "_FillValue", None)
    if fill is None:
        fill = getattr(var, "missing_value", None)

    return {
        "variable": variable,
        "units": _attr_str(var, "units"),
        "standard_name": _attr_str(var, "standard_name"),
        "long_name": _attr_str(var, "long_name"),
        "fillValue": (float(fill) if fill is not None else None),
        "time": _time_iso(ds, roles["time"], np, netCDF4),
        "depth": depth_val,
        "depthUnits": _attr_str(ds.variables[roles["depth"]], "units") if roles["depth"] else None,
        "latitude": latitude,
        "longitude": longitude,
        "values": values,
        "dimensions": {
            "time": 1,
            "depth": 1,
            "latitude": len(latitude),
            "longitude": len(longitude),
        },
        "axes": {k: v for k, v in roles.items()},
    }


def _attr_str(var, attr) -> str | None:
    v = getattr(var, attr, None)
    return str(v) if v is not None else None


def extract_volume(ds, variable: str) -> dict:
    """Normalize one variable of an open NetCDF dataset into a depth-RESOLVED
    volume — the sibling of :func:`extract_grid` that KEEPS the depth axis.

    The dataset is expected to be pinned to a single time (as the griddap subset
    query does) but to span a real range of depth levels. Every axis other than
    depth / latitude / longitude is reduced by taking its first index; the depth
    axis is preserved in full. Returns a dict with the 3-D
    ``values[depth][lat][lon]`` plus the REAL ``depths`` array and the same
    coordinate / CF metadata ``extract_grid`` returns.

    No value is fabricated: masked / NaN / fill cells become ``None`` (never
    zero), and no depth level is invented — the ``depths`` array is exactly the
    file's depth coordinate. A variable with no depth axis cannot yield a volume
    and raises ``ValueError`` (surfaced by the API as an explicit 400, never a
    fabricated third dimension).
    """
    netCDF4, np = _imports()

    if variable not in ds.variables:
        raise KeyError(
            f"Variable '{variable}' not in dataset (have: "
            f"{list(ds.variables.keys())})"
        )

    var = ds.variables[variable]
    var.set_auto_maskandscale(True)  # apply CF _FillValue / scale_factor / add_offset

    roles = classify_axes(ds)
    lat_name, lon_name, depth_name = (
        roles["latitude"], roles["longitude"], roles["depth"],
    )
    if not lat_name or not lon_name:
        raise ValueError("Could not identify latitude/longitude axes (CF metadata)")
    if not depth_name:
        raise ValueError(
            f"Variable '{variable}' has no identifiable depth axis; a 3-D volume "
            "requires a real depth coordinate (CF metadata)"
        )

    dims = list(var.dimensions)
    keep = (lat_name, lon_name, depth_name)
    for req in (lat_name, lon_name, depth_name):
        if req not in dims:
            raise ValueError(
                f"Variable '{variable}' is not gridded on depth/lat/lon "
                f"(dims={dims})"
            )

    arr = var[:]  # masked array in physical units
    # Keep depth/lat/lon in full; reduce every other axis (e.g. time) to index 0.
    take = [slice(None) if d in keep else 0 for d in dims]
    vol = arr[tuple(take)]
    # Reorder the kept axes to the canonical (depth, lat, lon) regardless of the
    # file's on-disk dimension order.
    kept = [d for d in dims if d in keep]
    perm = [kept.index(depth_name), kept.index(lat_name), kept.index(lon_name)]
    vol = np.transpose(vol, perm)

    depths = [float(x) for x in np.atleast_1d(ds.variables[depth_name][:])]
    latitude = [float(x) for x in np.atleast_1d(ds.variables[lat_name][:])]
    longitude = [float(x) for x in np.atleast_1d(ds.variables[lon_name][:])]
    values = _volume_to_lists(vol, np)

    fill = getattr(var, "_FillValue", None)
    if fill is None:
        fill = getattr(var, "missing_value", None)

    return {
        "variable": variable,
        "units": _attr_str(var, "units"),
        "standard_name": _attr_str(var, "standard_name"),
        "long_name": _attr_str(var, "long_name"),
        "fillValue": (float(fill) if fill is not None else None),
        "time": _time_iso(ds, roles["time"], np, netCDF4),
        "depths": depths,
        "depthUnits": _attr_str(ds.variables[depth_name], "units"),
        "latitude": latitude,
        "longitude": longitude,
        "values": values,
        "dimensions": {
            "time": 1,
            "depth": len(depths),
            "latitude": len(latitude),
            "longitude": len(longitude),
        },
        "axes": {k: v for k, v in roles.items()},
    }


# ---------------------------------------------------------------------------
# Byte-source / URL-source entry points
# ---------------------------------------------------------------------------
def grid_from_bytes(raw: bytes, variable: str) -> dict:
    """Open an in-memory NetCDF payload and extract ``variable`` as a grid."""
    netCDF4, _ = _imports()
    try:
        ds = netCDF4.Dataset("inmemory.nc", mode="r", memory=raw)
    except Exception as exc:
        raise NetCDFUnavailable(f"Could not open NetCDF payload: {exc}") from exc
    try:
        return extract_grid(ds, variable)
    finally:
        try:
            ds.close()
        except Exception:
            pass


def volume_from_bytes(raw: bytes, variable: str) -> dict:
    """Open an in-memory NetCDF payload and extract ``variable`` as a depth-
    resolved volume (the sibling of :func:`grid_from_bytes`)."""
    netCDF4, _ = _imports()
    try:
        ds = netCDF4.Dataset("inmemory.nc", mode="r", memory=raw)
    except Exception as exc:
        raise NetCDFUnavailable(f"Could not open NetCDF payload: {exc}") from exc
    try:
        return extract_volume(ds, variable)
    finally:
        try:
            ds.close()
        except Exception:
            pass


def grid_from_url(url: str, variable: str) -> dict:
    """Open an OPeNDAP/DODS endpoint (or remote .nc) and extract ``variable``.

    Foundation for THREDDS / HYCOM / Copernicus in a later phase — the server
    performs the subsetting via the DAP constraint expression baked into ``url``.
    """
    netCDF4, _ = _imports()
    try:
        ds = netCDF4.Dataset(url, mode="r")
    except Exception as exc:
        raise NetCDFUnavailable(f"Could not open NetCDF/OPeNDAP source: {exc}") from exc
    try:
        return extract_grid(ds, variable)
    finally:
        try:
            ds.close()
        except Exception:
            pass
