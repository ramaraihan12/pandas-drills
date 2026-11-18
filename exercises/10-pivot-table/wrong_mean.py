# expect: different
result = orders.pivot_table(index="category", columns="channel", values="quantity", fill_value=0)
