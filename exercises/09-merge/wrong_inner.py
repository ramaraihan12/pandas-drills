# expect: rows
merged = orders.merge(customers, on="customer_id")
result = merged[["order_id", "customer_id", "name", "segment", "product"]].sort_values("order_id")
