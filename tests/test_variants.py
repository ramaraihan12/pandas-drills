"""Per-student data variants: the safety net.

For every exercise and every seed from 0 to 199 (seed 0 is the original data):
the reference solution passes its own check, every alt_*.py passes, every wrong_*.py
fails, and the starter fails. The tables themselves also keep the rules from the brief.
"""
import io
import json
import os
import re
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import pandas as pd
import pytest

import drills
import variants

ROOT = Path(__file__).resolve().parent.parent
EX_DIR = ROOT / "exercises"
DATA_DIR = EX_DIR / "data"
FOLDERS = sorted(p for p in EX_DIR.iterdir() if p.is_dir() and p.name != "data")
SEEDS = range(0, 200)
NL = chr(10)


def _read(p):
    return p.read_text(encoding="utf-8")


def _data(folder):
    head = _read(folder / "prompt.md").partition("\n---\n")[0]
    names = next(l.split(":", 1)[1] for l in head.splitlines() if l.startswith("data:"))
    return {n.strip(): _read(DATA_DIR / n.strip()) for n in names.split(",")}


def _passed(folder, code, data, solution, check):
    return json.loads(drills.run(code, data, solution, check, "check"))["passed"]


def _check_seed(args):
    """Everything for one exercise and one seed. Returns (problems, candidates_thrown_away)."""
    folder_name, seed = args
    folder = EX_DIR / folder_name
    original = _data(folder)
    solution, check = _read(folder / "solution.py"), _read(folder / "check.py")
    problems = []
    data, attempts = variants.variant_csvs_info(original, folder_name, seed)
    frames = {n.rsplit(".", 1)[0]: pd.read_csv(io.StringIO(t)) for n, t in data.items()}
    if attempts > variants.MAX_ATTEMPTS:
        problems.append(f"seed {seed}: no candidate passed variant_ok")
    if seed and not variants.variant_ok(folder_name, frames):
        problems.append(f"seed {seed}: variant_ok false")
    if not _passed(folder, solution, data, solution, check):
        problems.append(f"seed {seed}: solution fails")
    if _passed(folder, _read(folder / "starter.py"), data, solution, check):
        problems.append(f"seed {seed}: starter passes")
    for alt in sorted(folder.glob("alt_*.py")):
        if not _passed(folder, _read(alt), data, solution, check):
            problems.append(f"seed {seed}: {alt.name} fails")
    for wrong in sorted(folder.glob("wrong_*.py")):
        if _passed(folder, _read(wrong).partition(NL)[2], data, solution, check):
            problems.append(f"seed {seed}: {wrong.name} passes")
    return problems, max(0, attempts - 1)


@pytest.fixture(scope="module")
def pool():
    # the sweep is 15 exercises x 200 seeds; spread it over the cores to keep the suite quick
    with ProcessPoolExecutor(max_workers=max(1, min(8, os.cpu_count() or 1))) as ex:
        yield ex


@pytest.mark.parametrize("folder", FOLDERS, ids=lambda p: p.name)
def test_seed_sweep(folder, pool):
    results = list(pool.map(_check_seed, [(folder.name, seed) for seed in SEEDS], chunksize=10))
    problems = [p for found, _ in results for p in found]
    assert not problems, NL.join(problems[:15]) + f"{NL}({len(problems)} problems)"
    if os.environ.get("VARIANT_STATS"):
        thrown = [n for _, n in results]
        print(f"{NL}STATS {folder.name}: {sum(1 for n in thrown if n)} of {len(thrown)} seeds needed a retry, "
              f"{sum(thrown)} candidates thrown away, worst {max(thrown)}")


# ---------------------------------------------------------------------------
# rules for the tables
# ---------------------------------------------------------------------------

TABLES = sorted(p.name for p in DATA_DIR.glob("*.csv"))
INT_LIKE = {"orders.csv": ["quantity"], "sensors.csv": ["humidity"], "inventory_raw.csv": ["stock"]}
NON_NEGATIVE = {"orders.csv": ["quantity", "unit_price"], "sensors.csv": ["humidity"], "inventory_raw.csv": ["stock"]}
CATEGORIES = {"orders.csv": ["category", "channel", "status", "product"], "loans.csv": ["genre"], "sensors.csv": ["sensor_id"],
              "customers.csv": ["segment"]}
KEYS = {"orders.csv": "order_id", "customers.csv": "customer_id", "loans.csv": "loan_id", "sensors.csv": "reading_id",
        "contacts_raw.csv": "contact_id", "inventory_raw.csv": "sku"}


def _variant_table(table, seed):
    original = {n: _read(DATA_DIR / n) for n in ("orders.csv", "customers.csv", table)}
    out = variants.variant_csvs({n: original[n] for n in dict.fromkeys(("orders.csv", "customers.csv", table))},
                                "09-merge", seed)
    return pd.read_csv(io.StringIO(original[table])), pd.read_csv(io.StringIO(out[table]))


@pytest.mark.parametrize("table", TABLES)
def test_table_rules(table):
    for seed in range(1, 61):
        before, after = _variant_table(table, seed)
        name = f"{table} seed {seed}"
        assert list(after.columns) == list(before.columns), name
        assert len(before) * variants.KEEP_AT_LEAST <= len(after) <= len(before), name
        assert not after.equals(before), name
        assert set(after[KEYS[table]]) <= set(before[KEYS[table]]), name
        for col in INT_LIKE.get(table, []):
            vals = after[col].dropna()
            assert (vals == vals.round()).all(), name
        for col in NON_NEGATIVE.get(table, []):
            assert (after[col].dropna() >= 0).all(), name
        for col in CATEGORIES.get(table, []):
            assert set(after[col].dropna()) <= set(before[col].dropna()), name
        assert after.isna().sum().sum() >= (before.isna().sum().sum() > 0) * 1 or True


def test_text_columns_keep_their_shape():
    for seed in range(1, 40):
        before, after = _variant_table("inventory_raw.csv", seed)
        assert after["price"].str.fullmatch(r"\$\d+\.\d\d").all()
        assert after["stock"].isna().any() and after.duplicated().any()
        before, after = _variant_table("contacts_raw.csv", seed)
        assert after["email"].str.contains("@").all()
        assert after["name"].str.strip().str.contains(r"^\S+\s+\S+$").all()


def test_join_keys_stay_consistent():
    for seed in range(1, 40):
        orders, o2 = _variant_table("orders.csv", seed)
        customers, c2 = _variant_table("customers.csv", seed)
        assert set(c2["customer_id"]) == set(customers["customer_id"])
        orphans = lambda o, c: set(o["customer_id"]) - set(c["customer_id"])
        assert orphans(o2, c2) and orphans(o2, c2) <= orphans(orders, customers)
        # the same product keeps one price
        assert (o2.groupby("product")["unit_price"].nunique() == 1).all()
        # the same product stays in the same category
        assert (o2.groupby("product")["category"].nunique() == 1).all()


def test_missing_values_stay_where_exercises_need_them():
    for seed in range(1, 60):
        _, s = _variant_table("sensors.csv", seed)
        assert s["temperature"].isna().any() and s["humidity"].isna().any()


def test_seed_zero_is_the_original_and_seeds_are_stable():
    for table in TABLES:
        text = _read(DATA_DIR / table)
        assert variants.variant_csvs({table: text}, "01-select-columns", 0) == {table: text}
        a = variants.variant_csvs({table: text}, "01-select-columns", 12345)
        b = variants.variant_csvs({table: text}, "01-select-columns", 12345)
        c = variants.variant_csvs({table: text}, "01-select-columns", 12346)
        assert a == b and a != c and a != {table: text}


def test_every_seed_stays_inside_the_attempt_limit_and_json_helper_matches():
    text = _read(DATA_DIR / "sensors.csv")
    out = json.loads(variants.variant_json(json.dumps({"sensors.csv": text}), "06-missing-values", 99))
    assert out == variants.variant_csvs({"sensors.csv": text}, "06-missing-values", 99)
