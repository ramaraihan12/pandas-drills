result = orders.pivot_table(index="category", columns="channel", values="quantity", aggfunc="sum").fillna(0)
