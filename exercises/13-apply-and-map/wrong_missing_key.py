# expect: different values
codes = {"delivered": "D", "shipped": "S", "cancelled": "X"}
out = orders[["order_id"]].copy()
out["size_label"] = orders["quantity"].apply(lambda q: "bulk" if q >= 5 else "regular" if q >= 3 else "single")
out["status_code"] = orders["status"].map(codes)
result = out
