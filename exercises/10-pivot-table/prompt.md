---
id: 10-pivot-table
title: Make a pivot table
topic: pivot_table
difficulty: medium
data: orders.csv
---

Build a pivot table of the total `quantity` sold:

- one row per `category`
- one column per `channel`
- combinations that never happened should show `0`, not `NaN`
- the row labels and the column labels in alphabetical order, as `pivot_table` gives them

Keep the pivot table as it comes (the category names stay as the row labels).
