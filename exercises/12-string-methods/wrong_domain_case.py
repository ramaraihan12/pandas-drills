# expect: different values
out = contacts_raw[["contact_id"]].copy()
out["name"] = contacts_raw["name"].str.strip().str.title()
out["domain"] = contacts_raw["email"].str.strip().str.split("@").str[1]
result = out
