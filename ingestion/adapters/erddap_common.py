"""Shared ERDDAP helpers: parse the tabledap/griddap `.json` table format and
the dataset `info` document. No data is invented here — this only decodes what
the real ERDDAP server returns.
"""
from __future__ import annotations

import json
from urllib.parse import quote

from http_client import get_text


def table_json(url: str) -> dict:
    """Fetch an ERDDAP `.json` response and return its `table` object:
    {columnNames: [...], columnTypes: [...], columnUnits: [...], rows: [[...]]}.
    """
    text = get_text(url)
    doc = json.loads(text)
    return doc["table"]


def rows_as_dicts(table: dict) -> list[dict]:
    cols = table["columnNames"]
    return [dict(zip(cols, row)) for row in table["rows"]]


def dataset_info(base: str, dataset_id: str) -> dict:
    """Fetch `/info/<id>/index.json` and return a structured view:

        {
          "variables": [{"name","type","rowType"}, ...],   # variable + dimension
          "attrs": {var_name: {attr_name: value, ...}, ..., "NC_GLOBAL": {...}},
        }
    """
    url = f"{base}/info/{quote(dataset_id)}/index.json"
    table = table_json(url)
    cols = table["columnNames"]
    i_rt = cols.index("Row Type")
    i_vn = cols.index("Variable Name")
    i_an = cols.index("Attribute Name")
    i_dt = cols.index("Data Type")
    i_vv = cols.index("Value")

    variables: list[dict] = []
    attrs: dict[str, dict] = {}
    for row in table["rows"]:
        rt = row[i_rt]
        vn = row[i_vn]
        if rt in ("variable", "dimension"):
            variables.append({"name": vn, "type": row[i_dt], "rowType": rt})
        elif rt == "attribute":
            attrs.setdefault(vn, {})[row[i_an]] = row[i_vv]
    return {"variables": variables, "attrs": attrs, "sourceUrl": url}


def parse_actual_range(value) -> list | None:
    """ERDDAP `actual_range` arrives as a string like "5.0, 2000.0" or a list."""
    if value is None:
        return None
    if isinstance(value, (list, tuple)):
        return list(value)
    try:
        return [float(x.strip()) for x in str(value).split(",")]
    except (ValueError, AttributeError):
        return None
