result = orders.groupby(["category", "channel"])["quantity"].sum().unstack().fillna(0)
