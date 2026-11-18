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


def test_chained_inplace_is_explained():
    code = 'orders["quantity"].replace(2, 0, inplace=True)\nresult = orders[["order_id", "product"]].head(2)\n'
    res = go(code)
    assert res["kind"] == "wrong_shape"
    assert res["notes"] and "Assign the result back" in res["notes"][0]


def test_inplace_hint_even_without_a_warning():
    res = go('orders.rename(columns={"product": "p"}, inplace=True)\nresult = orders\n')
    assert any("inplace=True" in n for n in res["notes"])


def test_no_notes_when_it_passes():
    assert go('result = orders[["order_id", "product"]]\n')["notes"] == []


def test_dict_key_error_is_not_called_a_column():
    res = go('codes = {"Pen": 1}\nresult = orders["product"].apply(lambda p: codes[p])\n')
    err = res["error"]
    assert err["dict_key"] == "Mug" and "missing" not in err


def test_key_close_to_a_column_keeps_the_column_hint():
    res = go('d = {}\nresult = d["produkt"]\n')
    assert res["error"]["suggestions"] == {"produkt": "product"}


def test_float_difference_is_shown_in_full():
    sol = "result = orders[['quantity']].astype(float)\n"
    res = go("result = orders[['quantity']].astype(float) + 0.00001\n", sol=sol)
    assert res["kind"] == "wrong_values"
    assert "2.00001" in res["message"] and "expected 2.0." in res["message"]


def test_scalar_close_but_not_equal_says_do_not_round():
    res = json.loads(drills.run("result = 3.00001\n", CSV, "result = 3.0\n", CHK, "check"))
    assert res["kind"] == "wrong_values" and "do not round" in res["message"]


def test_one_level_multiindex_series_is_accepted():
    sol = 'result = orders["product"].value_counts()\n'
    assert go('result = orders[["product"]].value_counts()\n', sol=sol)["passed"]


def test_student_cannot_replace_the_compare_helper():
    code = "import drills\ndrills.compare = lambda *a, **k: None\nresult = 1\n"
    assert not go(code)["passed"]
    assert not go("result = 2\n")["passed"]
