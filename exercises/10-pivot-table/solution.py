result = orders.pivot_table(index="category", columns="channel", values="quantity", aggfunc="sum", fill_value=0)
