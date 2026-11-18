# expect: different
result = orders.sort_values("unit_price", ascending=False, kind="stable")[["order_id", "product", "unit_price"]].tail(5)
