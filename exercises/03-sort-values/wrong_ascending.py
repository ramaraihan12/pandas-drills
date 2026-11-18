# expect: different values
result = orders.sort_values(["unit_price", "order_id"])[["order_id", "product", "unit_price"]].head(5)
