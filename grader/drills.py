"""Grading helpers for pandas-drills.

The same file runs in two places: inside Pyodide (in the browser worker) and in
plain CPython (the pytest suite). It has two jobs:

1. run(): execute the student's code in a fresh namespace and report what happened.
2. compare(): the helpers that exercise check.py files call to compare `result`
   with the reference answer. They are built on pandas.testing ideas but return
   short, friendly messages instead of tracebacks.

Rule-based only. There is no model and no network call anywhere in here.
"""
import difflib
import io
import json
import re
import traceback
import warnings
from collections import namedtuple
from contextlib import redirect_stderr, redirect_stdout

import numpy as np
import pandas as pd

Problem = namedtuple("Problem", "kind message")

STUDENT_FILE = "<your code>"
MAX_STDOUT = 6000
MAX_PREVIEW_ROWS = 15


# ---------------------------------------------------------------------------
# small formatting helpers
# ---------------------------------------------------------------------------

def _fmt(value):
    """Short, readable text for one cell."""
    try:
        if value is None or (not isinstance(value, str) and pd.isna(value)):
            return "NaN"
    except (TypeError, ValueError):
        pass
    if isinstance(value, (float, np.floating)):
        return repr(round(float(value), 4))
    if isinstance(value, str):
        return repr(value)
    if isinstance(value, pd.Timestamp):
        return str(value)
    if isinstance(value, np.generic):
        return repr(value.item())
    return repr(value)


def _names(items, limit=12):
    items = [str(i) for i in items]
    shown = ", ".join(items[:limit])
    return shown + (f", ... ({len(items)} in total)" if len(items) > limit else "")


def _describe_type(x):
    if isinstance(x, pd.DataFrame):
        return "a DataFrame (a table)"
    if isinstance(x, pd.Series):
        return "a Series (a single column)"
    if isinstance(x, (np.ndarray, pd.api.extensions.ExtensionArray, pd.Index)):
        return "an array of values (without labels)"
    if isinstance(x, (list, tuple, set, dict)):
        return f"a {type(x).__name__}"
    if x is None:
        return "None"
    return f"a single value ({type(x).__name__})"


def _row_text(frame, pos, limit=8):
    row = frame.iloc[pos]
    parts = [f"{c}={_fmt(row[c])}" for c in list(frame.columns)[:limit]]
    if len(frame.columns) > limit:
        parts.append("...")
    return ", ".join(parts)


def _is_default_index(index):
    return isinstance(index, pd.RangeIndex) or (
        index.nlevels == 1 and index.names == [None] and index.equals(pd.RangeIndex(len(index)))
    )


# ---------------------------------------------------------------------------
# dtype families: int64 vs float64 matters, str vs object-of-strings does not
# ---------------------------------------------------------------------------

def dtype_family(series):
    dt = series.dtype
    if pd.api.types.is_bool_dtype(dt):
        return "bool"
    if pd.api.types.is_integer_dtype(dt):
        return "int"
    if pd.api.types.is_float_dtype(dt):
        return "float"
    if pd.api.types.is_datetime64_any_dtype(dt):
        return "datetime"
    if pd.api.types.is_timedelta64_dtype(dt):
        return "timedelta"
    if isinstance(dt, pd.CategoricalDtype):
        return "category"
    if pd.api.types.is_string_dtype(dt):
        if dt == object:
            kind = pd.api.types.infer_dtype(series, skipna=True)
            if kind in ("string", "empty"):
                return "string"
            return "object"
        return "string"
    return "object"


def _dtype_label(series):
    fam = dtype_family(series)
    if fam == "string":
        return "text (str)"
    return str(series.dtype)


_NUMERIC = {"int", "float", "bool"}


def _values_equal(a, b, rtol):
    """Element-wise equality that treats NaN == NaN and allows float tolerance."""
    a = pd.Series(a).reset_index(drop=True)
    b = pd.Series(b).reset_index(drop=True)
    both_na = a.isna().to_numpy() & b.isna().to_numpy()
    fa, fb = dtype_family(a), dtype_family(b)
    if fa in _NUMERIC and fb in _NUMERIC:
        x = a.astype("float64").to_numpy()
        y = b.astype("float64").to_numpy()
        with np.errstate(invalid="ignore"):
            close = np.isclose(x, y, rtol=rtol, atol=1e-9, equal_nan=True)
        return close | both_na
    eq = np.zeros(len(a), dtype=bool)
    for i, (x, y) in enumerate(zip(a.tolist(), b.tolist())):
        try:
            eq[i] = bool(x == y)
        except Exception:
            eq[i] = False
    return eq | both_na


# ---------------------------------------------------------------------------
# compare helpers (used by every check.py)
# ---------------------------------------------------------------------------

def compare(result, expected, **options):
    """Pick the right comparison for the type of the expected answer."""
    if isinstance(expected, pd.DataFrame):
        return compare_frame(result, expected, **options)
    if isinstance(expected, pd.Series):
        return compare_series(result, expected, **options)
    return compare_scalar(result, expected, **options)


def compare_scalar(result, expected, rtol=1e-6):
    if isinstance(result, (pd.DataFrame, pd.Series, np.ndarray, list, tuple, dict, set)) or result is None:
        extra = ""
        if isinstance(result, pd.Series) and len(result) == 1:
            extra = " It has one element: try `.iloc[0]` or `.item()` to get the plain value."
        elif isinstance(result, pd.Series):
            extra = " A reduction such as `.sum()`, `.mean()` or `.max()` gives one value."
        return Problem("wrong_type", f"I expected a single value, but `result` is {_describe_type(result)}.{extra}")
    try:
        same = bool(np.isclose(float(result), float(expected), rtol=rtol, atol=1e-9)) \
            if isinstance(expected, (int, float, np.number)) and not isinstance(expected, bool) \
            else bool(result == expected)
    except (TypeError, ValueError):
        same = False
    if not same:
        return Problem("wrong_values", f"The value is not right: you have {_fmt(result)} but I expected something different. "
                                       "Re-read the task and check which rows or columns are used.")
    return None


def _type_problem(result, expected_kind, hint_series_to_frame=True):
    msg = f"I expected `result` to be {expected_kind}, but it is {_describe_type(result)}."
    if expected_kind.startswith("a DataFrame"):
        if isinstance(result, pd.Series):
            msg += " Selecting with single brackets (`df['a']`) gives a Series; double brackets (`df[['a']]`) or `reset_index()` give a table."
        elif isinstance(result, (list, np.ndarray)):
            msg += " Try to keep the data as a DataFrame instead of turning it into a list or array."
    else:
        if isinstance(result, pd.DataFrame):
            msg += " It looks like you returned a table; the task wants one column of values (a Series)."
        elif isinstance(result, (int, float, np.number)):
            msg += " You have collapsed everything to one number; the task wants one value per label."
        elif isinstance(result, (list, np.ndarray, pd.api.extensions.ExtensionArray, pd.Index)):
            msg += " An array or list drops the labels; stay with the pandas Series."
    return Problem("wrong_type", msg)


def _first_bad(eq):
    bad = np.flatnonzero(~eq)
    return int(bad[0]) if len(bad) else None


def compare_frame(result, expected, sort_by=None, check_index=False, ignore_order=False,
                  check_dtype=True, rtol=1e-6):
    """Compare two DataFrames and say in plain words what is different.

    sort_by       sort both by these columns first (row order is not part of the task)
    check_index   the index labels are part of the answer (for example a pivot table)
    ignore_order  with check_index: ignore the order of the index labels
    """
    if not isinstance(result, pd.DataFrame):
        return _type_problem(result, "a DataFrame (a table)")

    exp_cols, res_cols = list(expected.columns), list(result.columns)

    # a column that slipped into the index (groupby without reset_index)
    if not check_index and not _is_default_index(result.index):
        names = [n for n in result.index.names if n is not None]
        lost = [c for c in exp_cols if c not in res_cols and c in names]
        if lost:
            return Problem("wrong_columns",
                           f"The column(s) {_names(lost)} are in the index, not in the columns. "
                           "Use `reset_index()` (or `as_index=False` in groupby) to turn them back into columns.")

    if res_cols != exp_cols:
        if sorted(map(str, res_cols)) == sorted(map(str, exp_cols)):
            return Problem("wrong_columns",
                           f"You have the right columns but in a different order. I expected: {_names(exp_cols)}. "
                           f"You have: {_names(res_cols)}.")
        missing = [c for c in exp_cols if c not in res_cols]
        extra = [c for c in res_cols if c not in exp_cols]
        parts = []
        if missing:
            parts.append(f"missing: {_names(missing)}")
        if extra:
            parts.append(f"not wanted: {_names(extra)}")
        close = ""
        if missing and extra:
            pairs = []
            for m in missing:
                hit = difflib.get_close_matches(m, [str(e) for e in extra], n=1, cutoff=0.6)
                if hit:
                    pairs.append(f"'{hit[0]}' should be '{m}'")
            if pairs:
                close = " Maybe a name needs fixing: " + "; ".join(pairs) + "."
        return Problem("wrong_columns",
                       f"The column names are not what I expected ({'; '.join(parts)}). "
                       f"Expected: {_names(exp_cols)}. You have: {_names(res_cols)}.{close}")

    a, b = result.copy(), expected.copy()
    if check_index:
        ia, ib = list(a.index), list(b.index)
        if len(ia) != len(ib) or set(map(str, ia)) != set(map(str, ib)):
            miss = [x for x in ib if str(x) not in set(map(str, ia))]
            extra = [x for x in ia if str(x) not in set(map(str, ib))]
            return Problem("wrong_index",
                           f"The row labels (the index) are different. Expected: {_names(ib)}. You have: {_names(ia)}."
                           + (f" Missing: {_names(miss)}." if miss else "")
                           + (f" Not wanted: {_names(extra)}." if extra else ""))
        if ignore_order:
            a, b = a.sort_index(), b.sort_index()
        elif ia != ib:
            return Problem("wrong_order",
                           f"The row labels are right but in a different order. Expected: {_names(ib)}. You have: {_names(ia)}.")
    labels_a = list(a.index) if check_index else None
    a = a.reset_index(drop=True)
    b = b.reset_index(drop=True)

    if sort_by:
        try:
            a = a.sort_values(sort_by, kind="stable").reset_index(drop=True)
            b = b.sort_values(sort_by, kind="stable").reset_index(drop=True)
        except Exception:
            pass

    if len(a) != len(b):
        more = "too many" if len(a) > len(b) else "too few"
        return Problem("wrong_shape",
                       f"Your table has {len(a)} rows and {len(a.columns)} columns, but I expected {len(b)} rows and "
                       f"{len(b.columns)} columns. You have {more} rows: check your filter, join or head().")

    # dtype first when the kinds are clearly different (text vs dates, for example)
    for c in exp_cols:
        fa, fb = dtype_family(a[c]), dtype_family(b[c])
        if fa != fb and not (fa in _NUMERIC and fb in _NUMERIC):
            return Problem("wrong_dtype",
                           f"Column '{c}' holds {_dtype_label(a[c])} but I expected {_dtype_label(b[c])}. "
                           "Convert it first (for example with `pd.to_datetime`, `astype` or `.str` methods).")

    bad_rows = np.zeros(len(a), dtype=bool)
    first_col = {}
    for c in exp_cols:
        eq = _values_equal(a[c], b[c], rtol)
        bad_rows |= ~eq
        pos = _first_bad(eq)
        if pos is not None:
            first_col[pos] = first_col.get(pos, c)
    if bad_rows.any():
        # same rows, different order?
        if not sort_by:
            try:
                key = list(exp_cols)
                sa = a.astype(object).sort_values(key, kind="stable").reset_index(drop=True)
                sb = b.astype(object).sort_values(key, kind="stable").reset_index(drop=True)
                if all(_values_equal(sa[c], sb[c], rtol).all() for c in exp_cols):
                    first = int(np.flatnonzero(bad_rows)[0])
                    return Problem("wrong_order",
                                   "All the right rows are there, but in a different order. Check how you sort "
                                   f"(first row that is out of place: row {first}).")
            except Exception:
                pass
        pos = int(np.flatnonzero(bad_rows)[0])
        col = first_col[pos]
        label = f" (index label {labels_a[pos]})" if labels_a is not None else ""
        return Problem("wrong_values",
                       f"The shape and column names are right, but {int(bad_rows.sum())} of {len(a)} rows have different values. "
                       f"First difference: row {pos}{label}, column '{col}': you have {_fmt(a[col].iloc[pos])}, "
                       f"I expected {_fmt(b[col].iloc[pos])}.\n"
                       f"Your row:     {_row_text(a, pos)}\nExpected row: {_row_text(b, pos)}")

    if check_dtype:
        for c in exp_cols:
            if dtype_family(a[c]) != dtype_family(b[c]):
                return Problem("wrong_dtype",
                               f"The values are right, but column '{c}' has type {_dtype_label(a[c])} and I expected "
                               f"{_dtype_label(b[c])}. Try `.astype(...)` (for example `.astype(int)`).")
    return None


def compare_series(result, expected, check_index=True, ignore_order=False, check_dtype=True, rtol=1e-6):
    if not isinstance(result, pd.Series):
        return _type_problem(result, "a Series (a single column of values)")
    a, b = result, expected
    if len(a) != len(b):
        return Problem("wrong_shape", f"Your Series has {len(a)} values but I expected {len(b)}.")
    if check_index:
        ia, ib = list(a.index), list(b.index)
        if set(map(str, ia)) != set(map(str, ib)):
            miss = [x for x in ib if str(x) not in set(map(str, ia))]
            extra = [x for x in ia if str(x) not in set(map(str, ib))]
            return Problem("wrong_index",
                           f"The labels (index) are different. Expected: {_names(ib)}. You have: {_names(ia)}."
                           + (f" Missing: {_names(miss)}." if miss else "")
                           + (f" Not wanted: {_names(extra)}." if extra else ""))
        if ignore_order:
            a, b = a.sort_index(), b.sort_index()
            ia, ib = list(a.index), list(b.index)
        elif list(map(str, ia)) != list(map(str, ib)):
            return Problem("wrong_order",
                           f"The labels are right but in a different order. Expected: {_names(ib)}. You have: {_names(ia)}.")
    fa, fb = dtype_family(a), dtype_family(b)
    if fa != fb and not (fa in _NUMERIC and fb in _NUMERIC):
        return Problem("wrong_dtype", f"The values are {_dtype_label(a)} but I expected {_dtype_label(b)}.")
    eq = _values_equal(a, b, rtol)
    pos = _first_bad(eq)
    if pos is not None:
        label = a.index[pos]
        return Problem("wrong_values",
                       f"{int((~eq).sum())} of {len(a)} values differ. First difference: label {_fmt(label)} (position {pos}): "
                       f"you have {_fmt(a.iloc[pos])}, I expected {_fmt(b.iloc[pos])}.")
    if check_dtype and fa != fb:
        return Problem("wrong_dtype", f"The values are right, but their type is {_dtype_label(a)} and I expected {_dtype_label(b)}.")
    return None


# ---------------------------------------------------------------------------
# running student code
# ---------------------------------------------------------------------------

def load_inputs(data):
    """data: {"orders.csv": "<csv text>"} -> {"orders": DataFrame}"""
    frames = {}
    for name, text in data.items():
        stem = name.rsplit("/", 1)[-1].rsplit(".", 1)[0]
        frames[stem] = pd.read_csv(io.StringIO(text))
    return frames


def _fresh_namespace(data):
    ns = {"__name__": "__student__", "pd": pd, "np": np}
    ns.update(load_inputs(data))
    return ns


def _all_columns(ns, data_names):
    """Columns of the input tables first, then any other DataFrame the student built."""
    found = {}
    for name in data_names:
        if isinstance(ns.get(name), pd.DataFrame):
            found[name] = [str(c) for c in ns[name].columns]
    for name, val in ns.items():
        if name.startswith("_") or name in found:
            continue
        if isinstance(val, pd.DataFrame):
            found[name] = [str(c) for c in val.columns]
    return found


def _missing_keys(exc):
    arg = exc.args[0] if exc.args else ""
    if isinstance(arg, tuple):
        return [str(a) for a in arg], True
    arg = str(arg)
    m = re.match(r"^\[(.*)\] (?:not in index|not found in axis)", arg, re.S)
    if m:
        return [a or b for a, b in re.findall(r"'([^']*)'|\"([^\"]*)\"", m.group(1))], False
    return [arg], False


def _closest(key, candidates):
    low = {c.lower(): c for c in candidates}
    if key.lower() in low:
        return low[key.lower()]
    hit = difflib.get_close_matches(key, candidates, n=1, cutoff=0.5)
    return hit[0] if hit else None


def _error_info(exc, code, ns, data_names):
    lines = code.splitlines()
    line_no, line_text = None, ""
    for fr in traceback.extract_tb(exc.__traceback__):
        if fr.filename == STUDENT_FILE:
            line_no = fr.lineno
    if line_no and 0 < line_no <= len(lines):
        line_text = lines[line_no - 1].strip()
    info = {"type": type(exc).__name__, "line": line_no, "code_line": line_text,
            "text": str(exc.args[0]) if (exc.args and isinstance(exc, KeyError)) else str(exc)}
    cols = _all_columns(ns, data_names)
    all_cols = [c for cs in cols.values() for c in cs]
    if isinstance(exc, KeyError):
        keys, was_tuple = _missing_keys(exc)
        info["columns"] = cols
        if was_tuple and keys and all(k in all_cols for k in keys):
            info["tuple_hint"] = True
        else:
            info["missing"] = keys
            info["suggestions"] = {k: s for k in keys if (s := _closest(k, all_cols))}
    elif isinstance(exc, AttributeError):
        m = re.search(r"has no attribute '([^']+)'", str(exc))
        if m and re.search(r"DataFrame|Series", str(exc)):
            info["columns"] = cols
            info["missing"] = [m.group(1)]
            info["suggestions"] = {m.group(1): s} if (s := _closest(m.group(1), all_cols)) else {}
    return info


def _preview(obj):
    if isinstance(obj, pd.DataFrame):
        head = obj.head(MAX_PREVIEW_ROWS).to_string(max_cols=12)
        return f"DataFrame: {len(obj)} rows x {len(obj.columns)} columns\n{head}" + \
               ("\n..." if len(obj) > MAX_PREVIEW_ROWS else "")
    if isinstance(obj, pd.Series):
        head = obj.head(MAX_PREVIEW_ROWS).to_string()
        return f"Series: {len(obj)} values, dtype {obj.dtype}\n{head}" + ("\n..." if len(obj) > MAX_PREVIEW_ROWS else "")
    text = repr(obj)
    return f"{type(obj).__name__}: {text[:500]}"


def _execute(code, data):
    """Run code in a fresh namespace. Returns (namespace, stdout, error_or_None, compiled_ok)."""
    ns = _fresh_namespace(data)
    buf = io.StringIO()
    compiled = compile(code, STUDENT_FILE, "exec")
    err = None
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            with redirect_stdout(buf), redirect_stderr(io.StringIO()):
                exec(compiled, ns)
        except BaseException as exc:  # noqa: BLE001 - student code can raise anything
            err = exc
    out = buf.getvalue()
    if len(out) > MAX_STDOUT:
        out = out[:MAX_STDOUT] + "\n... (output cut)"
    return ns, out, err


def run(code, data, solution="", check_src="", mode="check"):
    """Run the student's code and (in check mode) grade it. Returns a JSON string."""
    out = {"passed": False, "kind": "ok", "message": "", "stdout": "", "preview": None, "error": None}
    data_names = [n.rsplit("/", 1)[-1].rsplit(".", 1)[0] for n in data]

    try:
        compile(code, STUDENT_FILE, "exec")
    except SyntaxError as exc:
        out["kind"] = "syntax"
        out["error"] = {"type": "SyntaxError", "line": exc.lineno, "text": exc.msg,
                        "code_line": (exc.text or "").strip(), "offset": exc.offset}
        return json.dumps(out, default=str)

    ns, stdout, err = _execute(code, data)
    out["stdout"] = stdout
    if err is not None:
        out["kind"] = "exception"
        out["error"] = _error_info(err, code, ns, data_names)
        return json.dumps(out, default=str)

    if "result" not in ns:
        out["kind"] = "no_result"
        return json.dumps(out, default=str)
    result = ns["result"]
    out["preview"] = _preview(result)
    if mode != "check":
        out["kind"] = "ran"
        return json.dumps(out, default=str)

    # reference answer, computed on the same data
    try:
        ref_ns, _, ref_err = _execute(solution, data)
        if ref_err is not None or "result" not in ref_ns:
            raise RuntimeError("reference solution failed")
        expected = ref_ns["result"]
        check_ns = {"__name__": "check"}
        exec(compile(check_src, "check.py", "exec"), check_ns)
        problem = check_ns["check"](result, expected)
    except Exception as exc:  # noqa: BLE001
        out["kind"] = "checker_error"
        out["message"] = ("The checker had a problem on its side, not in your code. "
                          f"({type(exc).__name__}) Please tell your teacher.")
        return json.dumps(out, default=str)

    if problem is None:
        out["passed"] = True
        out["kind"] = "passed"
    else:
        out["kind"] = problem.kind
        out["message"] = problem.message
    return json.dumps(out, default=str)
