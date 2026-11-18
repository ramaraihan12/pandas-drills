# expect: different values
result = orders.groupby("category", as_index=False).agg(avg_quantity=("quantity", "sum"))
