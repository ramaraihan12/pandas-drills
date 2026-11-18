# expect: holds
df = inventory_raw.drop_duplicates().copy()
df["item"] = df["item"].str.strip().str.title()
df["stock"] = df["stock"].fillna(0).astype(int)
df["restocked"] = pd.to_datetime(df["restocked"])
result = df.sort_values("sku").reset_index(drop=True)
