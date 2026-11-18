"""Regenerates the small synthetic CSV files in exercises/data/.

Everything here is made up. Run it from the repo root: python scripts/make_data.py
The output is deterministic (fixed seed), so the committed CSVs match.
"""
import csv
import random
from datetime import date, datetime, timedelta
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "exercises" / "data"
rng = random.Random(2025)


def write(name, header, rows):
    with open(OUT / name, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(header)
        w.writerows(rows)


NAMES = [
    "Alex Rivera", "Sam Okafor", "Priya Nair", "Jonas Weber", "Mina Park",
    "Lucas Silva", "Amara Diallo", "Noah Fischer", "Chloe Martin", "Yusuf Demir",
    "Hana Sato", "Mateo Ruiz", "Ines Costa", "Omar Haddad", "Elena Petrova",
    "Tariq Aziz", "Sofia Rossi", "Kofi Mensah", "Linh Tran", "Ben Cooper",
]
segments = ["consumer", "business", "student"]
customers = []
for i, n in enumerate(NAMES, start=1):
    signup = date(2024, 1, 1) + timedelta(days=rng.randint(0, 400))
    customers.append([f"C{i:03d}", n, segments[i % 3], signup.isoformat()])
write("customers.csv", ["customer_id", "name", "segment", "signup_date"], customers)

CATALOG = [
    ("Notebook", "stationery", 3.5), ("Pen set", "stationery", 4.2),
    ("Planner", "stationery", 14.0), ("Backpack", "bags", 35.0),
    ("Desk lamp", "home", 22.5), ("Mug", "home", 8.0),
    ("Headphones", "electronics", 59.0), ("USB cable", "electronics", 7.5),
    ("Water bottle", "outdoor", 12.0), ("Tent", "outdoor", 89.0),
]
statuses = ["delivered"] * 6 + ["shipped"] * 2 + ["cancelled", "returned"]
orders = []
for i in range(60):
    product, cat, price = rng.choice(CATALOG)
    channels = ["web", "app", "store"]
    if cat == "bags":
        channels = ["web", "store"]  # no app sales: gives a gap in the pivot exercise
    if cat == "outdoor":
        channels = ["web", "app"]  # no store sales
    cust = f"C{rng.randint(1, 20):03d}" if i % 20 != 7 else "C099"  # 3 unknown customers
    day = date(2025, 1, 1) + timedelta(days=rng.randint(0, 89))
    orders.append([
        1001 + i, cust, product, cat, rng.randint(1, 6), price,
        rng.choice(channels), rng.choice(statuses), day.isoformat(),
    ])
write("orders.csv", ["order_id", "customer_id", "product", "category", "quantity",
                     "unit_price", "channel", "status", "order_date"], orders)

GENRES = {"fiction": 24, "children": 18, "science": 14, "history": 10, "comics": 8, "cooking": 6}
titles = {
    "fiction": ["The Long Harbour", "Paper Moons", "A Quiet Engine", "Winter Orchard"],
    "children": ["Bo and the Kite", "The Tiny Dragon", "Mouse in Boots"],
    "science": ["How Rivers Think", "Atoms at Home", "The Salt Book"],
    "history": ["Roads of Salt", "The Clockmakers"],
    "comics": ["Night Shift Cats", "Robot Detective"],
    "cooking": ["One Pot Meals", "Bread for Beginners"],
}
genre_list = [g for g, n in GENRES.items() for _ in range(n)]
rng.shuffle(genre_list)
loans = []
for i, g in enumerate(genre_list):
    out = date(2025, 2, 1) + timedelta(days=rng.randint(0, 59))
    due = out + timedelta(days=14)
    returned = "" if rng.random() < 0.1 else (out + timedelta(days=rng.randint(3, 20))).isoformat()
    loans.append([5001 + i, f"M{rng.randint(1, 25):03d}", rng.choice(titles[g]), g,
                  out.isoformat(), due.isoformat(), returned])
write("loans.csv", ["loan_id", "member_id", "title", "genre", "loaned_on", "due_on", "returned_on"], loans)

sensors = []
start = datetime(2025, 3, 1, 0, 0, 0)
rid = 1
for step in range(48):
    ts = start + timedelta(hours=6 * step)
    for sensor in ("S1", "S2"):
        base = 14 + (3 if sensor == "S2" else 0) + 6 * (1 if 2 <= (step % 4) <= 3 else 0)
        temp = "" if rng.random() < 0.06 else f"{base + rng.uniform(-2, 2):.1f}"
        hum = "" if rng.random() < 0.09 else str(rng.randint(35, 80))
        sensors.append([rid, sensor, ts.strftime("%Y-%m-%d %H:%M:%S"), temp, hum])
        rid += 1
# three humidity readings are raised so that the median changes once the gaps are filled
# (exercise 06 needs the order of its two steps to matter)
for row in sensors:
    if row[0] in (53, 62, 73):
        row[4] = {53: "82", 62: "86", 73: "90"}[row[0]]
write("sensors.csv", ["reading_id", "sensor_id", "timestamp", "temperature", "humidity"], sensors)

contacts = [
    [1, "  alice JOHNSON", " Alice.Johnson@Example.COM "],
    [2, "BOB smith", "bob@Mail.Test"],
    [3, "carla mendes ", "C.Mendes@Studio.Example"],
    [4, "dmitri Ivanov", " dmitri@Example.com"],
    [5, "  EVA lindqvist  ", "EVA@NORTH.example"],
    [6, "farid khan", "farid.khan@Mail.Test "],
    [7, "grace OKAFOR", "grace@Studio.Example"],
    [8, "henrik Dahl ", " henrik.dahl@North.Example"],
    [9, "IRIS chen", "iris@Example.COM"],
    [10, " jamal Brown", "JAMAL@mail.test"],
]
write("contacts_raw.csv", ["contact_id", "name", "email"], contacts)

inventory = [
    ["A100", "  desk LAMP ", "$22.50", "14", "2025-02-03"],
    ["A101", "usb CABLE", "$7.50", "", "2025-01-20"],
    ["A102", "WATER bottle", "$12.00", "40", "2025-02-11"],
    ["A101", "usb CABLE", "$7.50", "", "2025-01-20"],
    ["A103", "  tent", "$89.00", "3", "2025-03-01"],
    ["A104", "Pen SET ", "$4.20", "120", "2025-02-27"],
    ["A105", "planner", "$14.00", "", "2025-01-08"],
    ["A100", "  desk LAMP ", "$22.50", "14", "2025-02-03"],
    ["A106", "BACKPACK", "$35.00", "8", "2025-02-18"],
    ["A107", "mug ", "$8.00", "55", "2025-03-05"],
    ["A108", "notebook", "$3.50", "200", "2025-02-14"],
    ["A109", " HEADphones", "$59.00", "", "2025-03-09"],
]
write("inventory_raw.csv", ["sku", "item", "price", "stock", "restocked"], inventory)
print("done")
