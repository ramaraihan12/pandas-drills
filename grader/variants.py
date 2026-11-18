"""Per-student data variants for class mode.

The same file runs in the Pyodide worker and in the pytest suite. A student's seed
(a stable hash of class code and nickname, made in the browser) turns the original
tables into a slightly different copy: a few rows dropped, rows shuffled, numbers
nudged within realistic bounds. Seed 0 means "no variant" and returns the data as is.

Everything is rule-based and deterministic: the same seed always gives the same data.
Each exercise can have a variant_ok() check for the facts its answer relies on (for
example "the median changes when the rows are dropped"). A seed that fails it moves on
to the next candidate, up to MAX_ATTEMPTS, then falls back to the original data.
"""
import io
import json
import random
import re

import numpy as np
import pandas as pd

MAX_ATTEMPTS = 40
KEEP_AT_LEAST = 0.85


# ---------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------

def _rng(seed, attempt, name):
    return random.Random(f"pandas-drills:{seed}:{attempt}:{name}")


def _shift_dates(series, days, fmt):
    """Shift a text date column by a per-row number of days; blanks stay blank."""
    parsed = pd.to_datetime(series, errors="coerce")
    shifted = parsed + pd.to_timedelta(list(days), unit="D")
    out = shifted.dt.strftime(fmt)
    return out.where(parsed.notna(), series)


def _shuffled(df, rng):
    order = list(range(len(df)))
    rng.shuffle(order)
    return df.iloc[order].reset_index(drop=True)


def _drop_rows(df, rng, protected, keep_sets=()):
    """Drop a few rows (never more than 15%), never a protected row, and never the last
    row of any category in keep_sets."""
    n = len(df)
    most = int(n * (1 - KEEP_AT_LEAST))
    least = max(1, n // 20)
    if most < 1:
        return df
    candidates = [i for i in range(n) if i not in protected]
    for _ in range(25):
        k = rng.randint(min(least, most), most)
        drop = set(rng.sample(candidates, min(k, len(candidates))))
        kept = df.drop(index=list(drop))
        if all(set(kept[c].dropna()) == set(df[c].dropna()) for c in keep_sets):
            return kept.reset_index(drop=True)
    return df


def _swap_values(df, col, rng, pairs):
    """Swap the values of a few pairs of rows, so the counts per value stay the same."""
    n = len(df)
    if n < 4:
        return df
    vals = df[col].tolist()
    idx = rng.sample(range(n), min(2 * pairs, n - n % 2))
    for a, b in zip(idx[::2], idx[1::2]):
        vals[a], vals[b] = vals[b], vals[a]
    df = df.copy()
    df[col] = vals
    return df


# ---------------------------------------------------------------------------
# one function per table
# ---------------------------------------------------------------------------

def _orders(df, rng, frames):
    df = df.copy()
    protected = set()
    customers = frames.get("customers")
    if customers is not None:
        known = set(customers["customer_id"])
        protected = {i for i, c in enumerate(df["customer_id"]) if c not in known}
    df = _swap_values(df, "status", rng, max(2, len(df) // 12))
    df = _swap_values(df, "channel", rng, max(2, len(df) // 12))
    top = int(df["quantity"].max())
    q = df["quantity"].tolist()
    q = [min(top, max(1, v + rng.choice((-1, 1)))) if rng.random() < 0.35 else v for v in q]
    df["quantity"] = np.array(q, dtype=df["quantity"].dtype)
    # one new price per product, so the same product keeps the same price everywhere
    factor = {p: 1 + rng.uniform(-0.12, 0.12) for p in sorted(df["product"].unique())}
    new_price = {}
    for p, f in factor.items():
        old = float(df.loc[df["product"] == p, "unit_price"].iloc[0])
        new_price[p] = max(0.5, round(old * f * 2) / 2 if old >= 10 else round(old * f, 1))
    df["unit_price"] = df["product"].map(new_price).astype(float)
    df["order_date"] = _shift_dates(df["order_date"], [rng.randint(-4, 4) for _ in range(len(df))], "%Y-%m-%d")
    df = _drop_rows(df, rng, protected, keep_sets=("category", "channel", "status", "product"))
    return _shuffled(df, rng)


def _customers(df, rng, frames):
    df = df.copy()
    df["signup_date"] = _shift_dates(df["signup_date"], [rng.randint(-14, 14) for _ in range(len(df))], "%Y-%m-%d")
    df = _swap_values(df, "segment", rng, 3)
    return _shuffled(df, rng)  # every customer stays: orders refer to them


def _sensors(df, rng, frames):
    df = df.copy()
    temp = df["temperature"].tolist()
    hum = df["humidity"].tolist()
    for i in range(len(df)):
        if not pd.isna(temp[i]):
            temp[i] = round(temp[i] + rng.uniform(-1.5, 1.5), 1)
        if not pd.isna(hum[i]):
            hum[i] = float(min(99, max(15, round(hum[i]) + rng.randint(-6, 6))))
    # a couple of extra gaps, so the missing values are not in the same places for everyone
    for _ in range(rng.randint(0, 2)):
        hum[rng.randrange(len(df))] = float("nan")
    if rng.random() < 0.5:
        temp[rng.randrange(len(df))] = float("nan")
    df["temperature"] = temp
    df["humidity"] = hum
    df = _drop_rows(df, rng, set(), keep_sets=("sensor_id",))
    return _shuffled(df, rng)


def _loans(df, rng, frames):
    df = df.copy()
    n = len(df)
    move = [rng.randint(-3, 3) for _ in range(n)]
    jitter = [rng.randint(-2, 2) for _ in range(n)]
    df["loaned_on"] = _shift_dates(df["loaned_on"], move, "%Y-%m-%d")
    df["due_on"] = _shift_dates(df["due_on"], move, "%Y-%m-%d")
    df["returned_on"] = _shift_dates(df["returned_on"], [m + j for m, j in zip(move, jitter)], "%Y-%m-%d")
    members = sorted(df["member_id"].unique())
    df["member_id"] = [rng.choice(members) if rng.random() < 0.2 else m for m in df["member_id"]]
    df = _drop_rows(df, rng, set(), keep_sets=("genre",))
    return _shuffled(df, rng)


FIRST = ["Ana", "Bram", "Chen", "Dara", "Emil", "Fiona", "Gus", "Hira", "Ivo", "Jun", "Kira", "Leon", "Mara",
         "Nico", "Oona", "Pavel", "Quinn", "Rosa", "Sven", "Tala", "Uma", "Viktor", "Wen", "Xavi", "Yara", "Zane"]
LAST = ["Abara", "Berg", "Castillo", "Duarte", "Eriksen", "Fofana", "Garcia", "Hoang", "Ito", "Jansen",
        "Kowal", "Lindgren", "Moreau", "Novak", "Ortega", "Pereira", "Quist", "Reyes", "Sato", "Tanaka",
        "Usman", "Varga", "Wong", "Yilmaz", "Zielinski"]


def _style(token, how):
    if how == "upper":
        return token.upper()
    if how == "lower":
        return token.lower()
    return token.capitalize()


def _how(token):
    if token.isupper():
        return "upper"
    if token.islower():
        return "lower"
    return "title"


def _contacts(df, rng, frames):
    df = df.copy()
    firsts = rng.sample(FIRST, len(df))
    lasts = rng.sample(LAST, len(df))
    names, emails = [], []
    for (name, email), first, last in zip(zip(df["name"], df["email"]), firsts, lasts):
        nm = re.match(r"^(\s*)(\S+)(\s+)(\S+)(\s*)$", name)
        em = re.match(r"^(\s*)([^@\s]+)@(\S+?)(\s*)$", email)
        if not nm or not em:
            names.append(name)
            emails.append(email)
            continue
        lead, f_old, mid, l_old, trail = nm.groups()
        names.append(lead + _style(first, _how(f_old)) + mid + _style(last, _how(l_old)) + trail)
        elead, local, domain, etrail = em.groups()
        if "." not in local:
            fresh = first.lower()
        elif len(local.split(".")[0]) == 1:
            fresh = first[0].lower() + "." + last.lower()
        else:
            fresh = first.lower() + "." + last.lower()
        how = _how(local)
        fresh = fresh.upper() if how == "upper" else fresh if how == "lower" else ".".join(p.capitalize() for p in fresh.split("."))
        emails.append(elead + fresh + "@" + domain + etrail)
    df["name"] = names
    df["email"] = emails
    df = _drop_rows(df, rng, set())
    return _shuffled(df, rng)


def _inventory(df, rng, frames):
    df = df.copy()
    skus = sorted(df["sku"].unique())
    price, stock, day = {}, {}, {}
    for s in skus:
        row = df[df["sku"] == s].iloc[0]
        old = float(str(row["price"]).replace("$", ""))
        price[s] = "${:.2f}".format(max(0.5, round(old * (1 + rng.uniform(-0.12, 0.12)) * 2) / 2))
        stock[s] = row["stock"] if pd.isna(row["stock"]) else float(max(0, round(row["stock"] * (1 + rng.uniform(-0.25, 0.25)))))
        day[s] = rng.randint(-3, 3)
    df["price"] = df["sku"].map(price)
    df["stock"] = df["sku"].map(stock).astype(float)
    df["restocked"] = _shift_dates(df["restocked"], [day[s] for s in df["sku"]], "%Y-%m-%d")
    # the exact duplicate rows are part of the exercise: only a row that appears once may go
    protected = {i for i, d in enumerate(df.duplicated(keep=False)) if d}
    df = _drop_rows(df, rng, protected)
    return _shuffled(df, rng)


BUILDERS = {
    "orders": _orders,
    "customers": _customers,
    "sensors": _sensors,
    "loans": _loans,
    "contacts_raw": _contacts,
    "inventory_raw": _inventory,
}


# ---------------------------------------------------------------------------
# what each exercise needs to stay true (checked on every candidate)
# ---------------------------------------------------------------------------

def _total_ties(orders):
    """True when, in some category, the 2nd and 3rd highest totals are equal (a tie at the cut)."""
    total = (orders["quantity"] * orders["unit_price"]).round(6)
    for _, g in orders.assign(total=total).groupby("category"):
        t = sorted(g["total"], reverse=True)
        if len(t) > 2 and t[1] == t[2]:
            return True
    return False


def _ok_orders_basic(f):
    q = f["orders"]["quantity"]
    return (q >= 5).any() and ((q >= 3) & (q < 5)).any() and (q < 3).any()


def _ok_02(f):
    o = f["orders"]
    d = o[o["status"] == "delivered"]
    return _ok_orders_basic(f) and (d["quantity"] == 3).any() and ((d["quantity"] >= 3).sum() > 3)



def _ok_05(f):
    counts = f["loans"]["genre"].value_counts()
    return counts.nunique() == len(counts)  # no ties, so the order is the same for everyone


def _ok_06(f):
    s = f["sensors"]
    has_temp = s["temperature"].notna()
    if not (~has_temp).any() or not (s["humidity"].isna() & has_temp).any():
        return False
    return s["humidity"].median() != s.loc[has_temp, "humidity"].median()


def _ok_09(f):
    return (~f["orders"]["customer_id"].isin(f["customers"]["customer_id"])).any()


def _ok_10(f):
    pivot = f["orders"].pivot_table(index="category", columns="channel", values="quantity", aggfunc="sum")
    return bool(pivot.isna().any().any())  # some combination never happened, so fill_value matters


def _ok_11(f):
    s = f["sensors"]
    day = pd.to_datetime(s["timestamp"]).dt.normalize()
    return bool(s["temperature"].notna().groupby(day).any().all())


def _ok_12(f):
    c = f["contacts_raw"]
    name, email = c["name"], c["email"]
    return bool(
        (name.str.strip().str.title() != name.str.strip()).any()
        and (name != name.str.strip()).any()
        and (email != email.str.strip()).any()
        and email.str.strip().str.split("@").str[1].str.contains("[A-Z]").any()
    )


def _ok_13(f):
    o = f["orders"]
    q = o["quantity"]
    return bool(_ok_orders_basic(f) and set(o["status"]) >= {"delivered", "shipped", "cancelled", "returned"})


def _ok_14(f):
    return not _total_ties(f["orders"])


def _ok_15(f):
    i = f["inventory_raw"]
    return bool(i["stock"].isna().any() and i.duplicated().any())


VARIANT_OK = {
    "02-filter-rows": _ok_02,
    "05-value-counts": _ok_05,
    "06-missing-values": _ok_06,
    "09-merge": _ok_09,
    "10-pivot-table": _ok_10,
    "11-dates": _ok_11,
    "12-string-methods": _ok_12,
    "13-apply-and-map": _ok_13,
    "14-top-n-per-group": _ok_14,
    "15-clean-up-inventory": _ok_15,
}


def _repair_14(f):
    """Ties at the cut are common with so few prices, so nudge the quantity of the order
    at rank 3 (one step) until the 2nd and 3rd totals differ."""
    o = f["orders"].copy()
    for cat in sorted(o["category"].unique()):
        for _ in range(6):
            g = o[o["category"] == cat]
            total = (g["quantity"] * g["unit_price"]).round(6)
            ranked = g.assign(total=total).sort_values(["total", "order_id"], ascending=[False, True])
            if len(ranked) < 3 or ranked["total"].iloc[1] != ranked["total"].iloc[2]:
                break
            row = ranked.index[2]
            q = int(o.at[row, "quantity"])
            o.at[row, "quantity"] = q - 1 if q > 1 else q + 1
    return {**f, "orders": o}


REPAIR = {"14-top-n-per-group": _repair_14}


def variant_ok(exercise_id, frames):
    check = VARIANT_OK.get(exercise_id)
    return True if check is None else bool(check(frames))


# ---------------------------------------------------------------------------
# public API
# ---------------------------------------------------------------------------

def make_variant_info(frames, exercise_id, seed):
    """Returns (variant_frames, attempts). attempts is 0 for seed 0, and MAX_ATTEMPTS + 1
    when no candidate passed variant_ok() and the original data was returned."""
    seed = int(seed)
    if seed == 0:
        return {k: v.copy() for k, v in frames.items()}, 0
    for attempt in range(MAX_ATTEMPTS):
        cand = {}
        for name, df in frames.items():
            build = BUILDERS.get(name)
            cand[name] = build(df, _rng(seed, attempt, name), frames) if build else df.copy()
        if exercise_id in REPAIR:
            cand = REPAIR[exercise_id](cand)
        if variant_ok(exercise_id, cand):
            return cand, attempt + 1
    return {k: v.copy() for k, v in frames.items()}, MAX_ATTEMPTS + 1


def make_variant(frames, exercise_id, seed):
    """frames: {"orders": DataFrame, ...} -> the same tables as a variant for this seed."""
    return make_variant_info(frames, exercise_id, seed)[0]


# ---------------------------------------------------------------------------
# text in, text out (what the page and the worker pass around)
# ---------------------------------------------------------------------------

def _int_like_columns(text):
    raw = pd.read_csv(io.StringIO(text), dtype=str, keep_default_na=False)
    cols = []
    for c in raw.columns:
        vals = [v for v in raw[c] if v != ""]
        if vals and all(re.fullmatch(r"-?\d+", v) for v in vals):
            cols.append(c)
    return cols


def variant_csvs(data, exercise_id, seed):
    """data: {"orders.csv": "<csv text>"} -> the same names with the variant's csv text."""
    return variant_csvs_info(data, exercise_id, seed)[0]


def variant_csvs_info(data, exercise_id, seed):
    """Like variant_csvs, and also says how many candidates it took (see make_variant_info)."""
    if int(seed) == 0:
        return dict(data), 0
    frames, int_cols, stems = {}, {}, {}
    for name, text in data.items():
        stem = name.rsplit("/", 1)[-1].rsplit(".", 1)[0]
        stems[stem] = name
        frames[stem] = pd.read_csv(io.StringIO(text))
        int_cols[stem] = _int_like_columns(text)
    out, attempts = make_variant_info(frames, exercise_id, seed)
    result = {}
    for stem, df in out.items():
        df = df.copy()
        for c in int_cols[stem]:
            df[c] = df[c].round().astype("Int64")
        result[stems[stem]] = df.to_csv(index=False, lineterminator="\n")
    return result, attempts


def variant_json(data_json, exercise_id, seed):
    return json.dumps(variant_csvs(json.loads(data_json), exercise_id, seed))
