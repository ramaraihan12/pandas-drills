# expect: column names
result = orders.groupby("category", as_index=False).agg(avg=("quantity", "mean"))
