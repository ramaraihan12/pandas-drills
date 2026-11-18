# pandas drills

I teach at a vocational school, and every time I want my students to practise pandas I hit the same wall: they need Python installed, or a server that runs their code, or a paid platform that checks it. School PCs are locked down, and nobody wants to pay for a grader. So I built a site where the exercises run and check themselves inside the browser, with nothing to install and nothing running on a server.

**Live demo:** https://ramaraihan.is-a.dev/pandas-drills/ (no login; the first visit downloads about 14 MB, see the numbers below)

> The checks run in your browser, so this is practice, not an exam. Anyone who opens the developer tools can see the answers.

## What it does

- 15 small pandas exercises, easy to medium: selecting columns, filtering, sorting, new columns, `value_counts`, missing values, `groupby` and `agg`, several aggregations, `merge`, `pivot_table`, dates, string methods, `apply`/`map`, top-N per group, and a small cleaning task from start to finish.
- You write Python in a CodeMirror editor, press **Run** to see your `result`, or **Check** to compare it with the reference answer.
- Progress and your code are saved in `localStorage`, so a refresh or a closed laptop does not lose anything.
- It works on a phone (stacked layout, 360 px wide) and on a school PC, in light and dark mode, and with the keyboard only.
- After the first visit it works offline: a service worker keeps the app and the pinned Python files.

## How the grading works

Python runs in a Web Worker with [Pyodide](https://pyodide.org) (pinned to `314.0.8`, which ships Python 3.14.2 and pandas 3.0.2, loaded from jsDelivr). Only `pandas` and its dependencies are loaded.

1. The student's code runs in a fresh namespace. The CSV files of the exercise are already loaded as DataFrames (`orders.csv` becomes `orders`), freshly for every run, so nothing a student does to one run leaks into the next.
2. The student leaves the answer in a variable called `result`.
3. The reference `solution.py` runs on the same data, and the exercise's `check.py` compares the two with helpers in `grader/drills.py`. They are built on the ideas of `pandas.testing`, but they return short messages instead of tracebacks.

The feedback is plain rules, in this order of cases:

- a syntax error says which line;
- a missing `result`, or the wrong type (a Series where a table was needed, a single number, an array);
- a `KeyError` or `AttributeError` on a column lists the real column names and the closest match ("Did you mean 'product'?");
- the wrong columns or order, and a column that slipped into the index after a `groupby`;
- the wrong number of rows;
- different values, showing the first row that differs next to the expected one;
- right values but the wrong dtype (for example float where a whole number was asked for);
- rows that are all there but in a different order;
- a run that takes more than 10 seconds is stopped: the worker is terminated and a new one starts;
- whatever the student `print`s is shown in the output panel.

The same `drills.py` file runs in the browser and in the pytest suite, with the same pandas version, so what the tests check is what students get.

## Trade-offs, honestly

- **Browser grading can be faked.** The solution and the check ship to the browser. A student who wants to cheat can read them, or hard-code the answer. That is fine for practice, and it is why the page says so. An exam would need a server doing the grading, which is exactly what the later milestones add for the class view.
- **The first load is big.** Python, numpy and pandas are about 14 MB over the wire. After that, it comes from the cache.
- **No LLM hints, on purpose.** Some of the people using this will be under 18. A model could say something odd, would need an API key and money, and would send student code to a third party. The messages here are rules I can read, test and predict, and they are the same for everyone. They are less clever, but I can promise what they say.
- **Wrong answers are matched on the first difference.** The feedback shows one problem at a time, not a full diff.

## Numbers I measured

Measured with headless Chromium on my own machine and a fast connection, cold cache, against the built site (`npm run build`, then `npm run e2e`):

| | |
|---|---|
| First load, over the wire | about 14.0 MB (Python 3.4 MB wasm, stdlib 2.5 MB, numpy 2.9 MB, pandas 4.1 MB, the rest is small; the app itself is about 0.18 MB) |
| First load, until Python and pandas are ready | 5.1 s |
| Second visit, until ready | 4.5 s, nothing downloaded (starting Python and importing pandas is the rest) |
| Offline, after one visit | works, the same exercise is graded |
| Runaway loop | stopped after 10.5 s, Python restarted, next run graded |

I ran the same test against the live site: 5.1 s first load, 4.2 s second load, 4.0 s offline, and exercise 1 solved there. A school connection will be slower on the first visit. The second visit does not depend on the network.

## Adding an exercise

Make a folder `exercises/NN-slug/` with `prompt.md` (front matter and the task), `starter.py`, `solution.py`, `check.py`, and at least two `wrong_*.py` for the tests. The build packs the folders into one JSON bundle, so there is no app code to touch. The details are in [`exercises/README.md`](exercises/README.md).

## Running it

```
npm ci
npm run bundle      # exercises/ -> src/generated/bundle.json
npm run build       # bundle + vite build
npm run preview     # serve dist/ at /pandas-drills/
```

Tests:

```
pip install -r requirements-dev.txt
pytest              # every solution passes, wrong answers fail with the right message
npm test            # vitest: bundle builder, feedback text, markdown, storage
npm run typecheck
npm run e2e         # local only: Playwright solves exercise 1, checks the hints, the time limit and offline
```

CI runs pytest, vitest, `tsc --noEmit` and `vite build` on every push. The Playwright test needs a browser download, so I run it locally and not in CI.

## Roadmap

1. A class link: a teacher makes a class, students open one link.
2. A teacher view: a heatmap of who is stuck on which exercise.
3. An API for that (Cloudflare Workers and D1), still free.
4. More exercises, and a few harder ones.

## License

MIT, see [LICENSE](LICENSE).
