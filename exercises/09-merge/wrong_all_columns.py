# expect: column names
result = orders.merge(customers, on="customer_id", how="left")
