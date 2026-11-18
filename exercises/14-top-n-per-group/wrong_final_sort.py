# expect: different order
df = orders.assign(total=orders["quantity"] * orders["unit_price"])
df = df.sort_values(["total", "order_id"], ascending=[False, True])
result = df.groupby("category").head(2)[["category", "order_id", "total"]].reset_index(drop=True)
