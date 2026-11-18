# expect: different values
df = orders.assign(total=orders["quantity"] * orders["unit_price"])
df = df.sort_values(["total", "order_id"])
top = df.groupby("category").head(2)[["category", "order_id", "total"]]
result = top.sort_values(["category", "total", "order_id"], ascending=[True, False, True]).reset_index(drop=True)
