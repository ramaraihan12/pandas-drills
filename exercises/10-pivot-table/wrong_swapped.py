# expect: column names
result = orders.pivot_table(index="channel", columns="category", values="quantity", aggfunc="sum", fill_value=0)
