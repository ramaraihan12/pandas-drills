def size_of(q):
    if q >= 5:
        return "bulk"
    if q >= 3:
        return "regular"
    return "single"


codes = {"delivered": "D", "shipped": "S", "cancelled": "X", "returned": "R"}
out = orders[["order_id"]].copy()
out["size_label"] = orders["quantity"].apply(size_of)
out["status_code"] = orders["status"].map(codes)
result = out
