# expect: dict_key
codes = {"delivered": "D", "shipped": "S", "cancelled": "X"}
out = orders[["order_id"]].copy()
out["size_label"] = orders["quantity"].apply(lambda q: "bulk" if q >= 5 else "regular" if q >= 3 else "single")
out["status_code"] = orders["status"].apply(lambda s: codes[s])
result = out
