# expect: different values
result = orders.groupby("channel", as_index=False).agg(n_orders=("order_id", "count"), units=("quantity", "sum"), max_price=("unit_price", "min"))
