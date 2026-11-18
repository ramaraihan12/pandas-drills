# expect: rows
result = orders.sort_values(["unit_price", "order_id"], ascending=[False, True])[["order_id", "product", "unit_price"]]
