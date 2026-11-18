# Adding an exercise

Each exercise is one folder, `exercises/NN-slug/`. The build turns all folders into one JSON bundle (`npm run bundle`), so adding an exercise never needs a change in the app code.

```
exercises/
  data/                 small synthetic CSV files (made up, not real people or places)
  16-my-exercise/
    prompt.md           front matter + the task in plain English
    starter.py          what the student sees in the editor
    solution.py         the reference answer, leaves its answer in `result`
    check.py            the hidden check
    wrong_*.py          plausible wrong answers used by the tests (not shipped)
```

## prompt.md

```
---
id: 16-my-exercise
title: Short title
topic: groupby
difficulty: easy        # easy or medium
data: orders.csv        # comma separated, files in exercises/data/
---

The task, in plain English. Say exactly which columns, which order and which names the answer needs.
```

The `id` must equal the folder name. Every CSV listed in `data` is loaded for the student as a DataFrame named after the file (`orders.csv` becomes `orders`), freshly for every run.

## solution.py and starter.py

The student's code must leave the answer in a variable called `result`. The reference solution works the same way, on the same fresh data. `starter.py` has to run without errors but should not solve the task.

## check.py

Define `check(result, expected)`. Return `None` when the answer is right, or a `Problem` with a friendly message. Most of the time you only call the helper:

```python
from drills import compare

def check(result, expected):
    return compare(result, expected, sort_by=["category"])
```

`compare` looks at the type of `expected` (DataFrame, Series or a single value) and reports, in this order: wrong type, wrong column names or order, wrong number of rows, wrong data types (when the kinds differ clearly), different values (it shows the first different row) and finally int/float mismatches. Options:

- `sort_by=[...]` row order is not part of the task, so sort both tables by these columns first.
- `check_index=True` the row labels are part of the answer (pivot tables, `value_counts`). Add `ignore_order=True` if their order does not matter.
- `check_dtype=False` accept int where float is expected, and the other way round.

The helpers are in `grader/drills.py`. Feedback is rule based; please do not add anything that calls an online service.

## wrong_*.py

At least two plausible wrong answers per exercise. The first line says which text the friendly message has to contain:

```python
# expect: different values
result = orders[orders["quantity"] > 3]
```

For answers that crash (a `KeyError`, say) the text is matched against the structured error details instead. Then run the tests:

```
pip install -r requirements-dev.txt
pytest
npm run bundle && npm test
```

Keep the data small, generic and not tied to one country. If two rows can tie when sorted, say in the prompt how to break the tie.
