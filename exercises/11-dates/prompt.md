---
id: 11-dates
title: Work with dates
topic: dates
difficulty: medium
data: sensors.csv
---

The `timestamp` column in `sensors` is plain text. Turn it into real dates and times, then find the **average temperature per calendar day** (across both sensors; missing temperatures are skipped).

Return a table with two columns: `day` (a date, at midnight) and `avg_temp`. One row per day, oldest first.
