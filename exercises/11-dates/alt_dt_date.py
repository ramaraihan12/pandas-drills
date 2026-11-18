sensors["timestamp"] = pd.to_datetime(sensors["timestamp"])
result = sensors.groupby(sensors["timestamp"].dt.date)["temperature"].mean().reset_index()
result.columns = ["day", "avg_temp"]
