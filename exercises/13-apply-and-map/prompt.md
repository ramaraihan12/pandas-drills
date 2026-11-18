---
id: 13-apply-and-map
title: apply and map
topic: apply / map
difficulty: medium
data: orders.csv
---

Add two labels to every order:

- `size_label`: use a small function with `apply`. `quantity` of 5 or more is `"bulk"`, 3 or 4 is `"regular"`, anything less is `"single"`.
- `status_code`: use `map` with a dictionary: `delivered` to `"D"`, `shipped` to `"S"`, `cancelled` to `"X"`, `returned` to `"R"`.

Return a table with the columns in this order: `order_id`, `size_label`, `status_code`.
