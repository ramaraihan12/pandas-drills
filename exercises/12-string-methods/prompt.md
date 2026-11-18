---
id: 12-string-methods
title: Clean up text
topic: string methods
difficulty: medium
data: contacts_raw.csv
---

The `contacts_raw` table has messy text: extra spaces and odd capital letters.

Return a table with three columns, in this order:

- `contact_id` unchanged
- `name`: spaces at both ends removed, and each word starting with a capital letter (`"  alice JOHNSON"` becomes `"Alice Johnson"`)
- `domain`: the part of the `email` after the `@`, in lower case, with no spaces (`" Alice.Johnson@Example.COM "` becomes `"example.com"`)
