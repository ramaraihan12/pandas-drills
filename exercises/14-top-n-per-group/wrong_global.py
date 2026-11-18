# expect: rows
df = orders.assign(total=orders["quantity"] * orders["unit_price"])
result = df.nlargest(2, "total")[["category", "order_id", "total"]]
