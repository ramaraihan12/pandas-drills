# expect: not wanted: sensor
sensors["timestamp"] = pd.to_datetime(sensors["timestamp"])
result = sensors.groupby([sensors["timestamp"].dt.normalize(), "sensor_id"])["temperature"].mean().reset_index()
result.columns = ["day", "sensor", "avg_temp"]
