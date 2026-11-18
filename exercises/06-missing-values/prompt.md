---
id: 06-missing-values
title: Deal with missing values
topic: missing values
difficulty: easy
data: sensors.csv
---

Some readings in `sensors` are missing (they show as `NaN`).

Do these two steps, in this order:

1. Fill the missing `humidity` values with the median of the `humidity` column.
2. Then drop every row where `temperature` is missing.

Return the cleaned table (all columns).
