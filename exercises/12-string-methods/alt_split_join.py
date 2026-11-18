out = contacts_raw[["contact_id"]].copy()
out["name"] = contacts_raw["name"].str.split().str.join(" ").str.title()
out["domain"] = contacts_raw["email"].str.strip().str.split("@").str[1].str.lower()
result = out
