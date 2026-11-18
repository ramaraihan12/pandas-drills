---
id: 15-clean-up-inventory
title: Clean a messy table
topic: end-to-end cleaning
difficulty: medium
data: inventory_raw.csv
---

`inventory_raw` came from a spreadsheet and is a mess. Clean it so that:

- `item`: spaces at both ends removed, each word starting with a capital letter
- `price`: a real number (the text looks like `"$22.50"`)
- `stock`: missing values become `0`, and the column holds whole numbers (int)
- `restocked`: a real date, not text
- duplicate rows are removed (keep the first one)
- the table is sorted by `sku` and numbered 0, 1, 2 ... again

Return all five columns: `sku`, `item`, `price`, `stock`, `restocked`.
