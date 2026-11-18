---
id: 09-merge
title: Join two tables
topic: merge
difficulty: medium
data: orders.csv, customers.csv
---

`orders` has a `customer_id`; `customers` says who each customer is. A few orders belong to customers that are not in the `customers` table.

Join them so that **every order is kept**, even when the customer is unknown (those get `NaN` for the customer columns).

Return these columns in this order: `order_id`, `customer_id`, `name`, `segment`, `product`. Sort by `order_id`.
