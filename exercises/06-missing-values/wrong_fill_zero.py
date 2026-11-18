# expect: different values
sensors["humidity"] = sensors["humidity"].fillna(0)
result = sensors.dropna(subset=["temperature"])
