# expect: column names
out = orders[["order_id"]].copy()
out["size"] = orders["quantity"].apply(lambda q: "bulk" if q >= 5 else "regular" if q >= 3 else "single")
out["code"] = orders["status"].str[0].str.upper()
result = out
