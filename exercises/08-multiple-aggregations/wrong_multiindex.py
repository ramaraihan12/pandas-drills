# expect: column names
result = orders.groupby("channel").agg({"order_id": "count", "quantity": "sum", "unit_price": "max"}).reset_index()
