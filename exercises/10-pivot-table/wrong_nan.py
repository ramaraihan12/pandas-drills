# expect: you have nan
result = orders.pivot_table(index="category", columns="channel", values="quantity", aggfunc="sum")
