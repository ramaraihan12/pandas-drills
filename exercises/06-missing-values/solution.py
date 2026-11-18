sensors["humidity"] = sensors["humidity"].fillna(sensors["humidity"].median())
result = sensors.dropna(subset=["temperature"])
