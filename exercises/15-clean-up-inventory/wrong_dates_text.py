# expect: holds
df = inventory_raw.drop_duplicates().copy()
df["item"] = df["item"].str.strip().str.title()
df["price"] = df["price"].str.replace("$", "", regex=False).astype(float)
df["stock"] = df["stock"].fillna(0).astype(int)
result = df.sort_values("sku").reset_index(drop=True)
