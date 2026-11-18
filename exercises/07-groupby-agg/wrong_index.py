# expect: reset_index
result = orders.groupby("category")[["quantity"]].mean()
