import pandas as pd

from drills import compare


def check(result, expected):
    # a column of datetime.date objects (from .dt.date) is accepted as dates
    if isinstance(result, pd.DataFrame) and "day" in result.columns:
        if pd.api.types.infer_dtype(result["day"], skipna=True) == "date":
            result = result.assign(day=pd.to_datetime(result["day"]))
    return compare(result, expected)
