# expect: holds text
sensors["day"] = sensors["timestamp"].str[:10]
result = sensors.groupby("day", as_index=False).agg(avg_temp=("temperature", "mean"))
