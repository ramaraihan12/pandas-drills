"""Unit tests for the feedback cases in grader/drills.py."""
import json

import drills

CSV = {"orders.csv": "order_id,product,quantity\n1,Pen,2\n2,Mug,3\n3,Tent,1\n"}
SOL = 'result = orders[["order_id", "product"]]\n'
CHK = "from drills import compare\n\n\ndef check(result, expected):\n    return compare(result, expected)\n"


def go(code, mode="check", sol=SOL):
    return json.loads(drills.run(code, CSV, sol, CHK, mode))


def test_syntax_error_has_line_number():
    res = go("x = 1\nresult = orders[[\n")
    assert res["kind"] == "syntax"
    assert res["error"]["line"] in (2, 3)


def test_missing_result():
    assert go("x = 1\n")["kind"] == "no_result"


def test_keyerror_lists_columns_and_closest():
    res = go('result = orders[["order_id", "produkt"]]\n')
    assert res["kind"] == "exception"
    err = res["error"]
    assert err["suggestions"] == {"produkt": "product"}
    assert err["columns"]["orders"] == ["order_id", "product", "quantity"]
    assert err["line"] == 1


def test_keyerror_single_column_and_case():
    res = go('result = orders["Product"]\n')
    assert res["error"]["suggestions"] == {"Product": "product"}


def test_wrong_type_series_vs_frame():
    res = go('result = orders["product"]\n')
    assert res["kind"] == "wrong_type" and "Series" in res["message"]


def test_wrong_type_scalar():
    res = go("result = 3\n")
    assert res["kind"] == "wrong_type"


def test_wrong_shape():
    res = go('result = orders[["order_id", "product"]].head(2)\n')
    assert res["kind"] == "wrong_shape" and "3 rows" in res["message"]


def test_wrong_columns_order():
    res = go('result = orders[["product", "order_id"]]\n')
    assert res["kind"] == "wrong_columns" and "order" in res["message"]


def test_wrong_values_shows_first_row():
    res = go('result = orders[["order_id", "product"]].assign(product=["Pen", "Cup", "Tent"])\n')
    assert res["kind"] == "wrong_values"
    assert "row 1" in res["message"] and "'Cup'" in res["message"]


def test_dtype_mismatch():
    sol = 'result = orders[["order_id", "quantity"]]\n'
    res = go('result = orders[["order_id", "quantity"]].astype(float)\n', sol=sol)
    assert res["kind"] == "wrong_dtype"


def test_print_output_is_kept():
    res = go('print("hello")\nresult = orders[["order_id", "product"]]\n')
    assert res["stdout"].strip() == "hello" and res["passed"]


def test_run_mode_gives_preview_without_grading():
    res = go('result = orders\n', mode="run")
    assert res["kind"] == "ran" and "3 rows" in res["preview"]


def test_runtime_error_reports_line():
    res = go("a = 1\nb = a / 0\nresult = b\n")
    assert res["error"]["type"] == "ZeroDivisionError" and res["error"]["line"] == 2


def test_index_hint_for_groupby():
    sol = 'result = orders.groupby("product", as_index=False)["quantity"].sum()\n'
    res = go('result = orders.groupby("product")[["quantity"]].sum()\n', sol=sol)
    assert res["kind"] == "wrong_columns" and "reset_index" in res["message"]


def test_namespace_is_fresh_each_run():
    go('orders.drop(columns=["product"], inplace=True)\nresult = orders\n')
    assert go('result = orders[["order_id", "product"]]\n')["passed"]
