result = pd.crosstab(orders["category"], orders["channel"], values=orders["quantity"], aggfunc="sum").fillna(0)
