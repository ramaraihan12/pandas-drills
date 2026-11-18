sensors["timestamp"] = pd.to_datetime(sensors["timestamp"])
daily = sensors.groupby(sensors["timestamp"].dt.normalize())["temperature"].mean()
result = daily.reset_index()
result.columns = ["day", "avg_temp"]
