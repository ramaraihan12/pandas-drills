# expect: rows
result = orders[(orders["status"] == "delivered") & (orders["quantity"] > 3)]
