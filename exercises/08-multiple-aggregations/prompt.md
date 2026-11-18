---
id: 08-multiple-aggregations
title: Several numbers at once
topic: groupby + agg
difficulty: medium
data: orders.csv
---

For each sales `channel`, calculate in one go:

- `n_orders`: how many orders (count of `order_id`)
- `units`: the total `quantity`
- `max_price`: the highest `unit_price`

Return a table with the columns in this order: `channel`, `n_orders`, `units`, `max_price`. Row order does not matter.
