# expect: different values
result = sensors.dropna(subset=["temperature"])
result["humidity"] = result["humidity"].fillna(result["humidity"].median())
