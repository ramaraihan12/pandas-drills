---
id: 14-top-n-per-group
title: Top 2 in every group
topic: top-N per group
difficulty: medium
data: orders.csv
---

For each `category`, find the 2 orders with the highest total, where total is `quantity * unit_price`.

- Rank the orders by total, highest first. If two totals are equal, the lower `order_id` ranks first.
- Return the columns `category`, `order_id`, `total`, in this order.
- Sort the final table by `category` (A to Z), then by `total` (highest first, ties: lower `order_id` first).
