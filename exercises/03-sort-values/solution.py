top = orders.sort_values(["unit_price", "order_id"], ascending=[False, True])
result = top[["order_id", "product", "unit_price"]].head(5)
