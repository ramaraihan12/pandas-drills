# expect: column names
sensors["timestamp"] = pd.to_datetime(sensors["timestamp"])
result = sensors.resample("D", on="timestamp")["temperature"].mean().reset_index()
