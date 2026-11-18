# pandas drills

I teach at a vocational school, and every time I want my students to practise pandas I hit the same wall: they need Python installed, or a server that runs their code, or a paid platform that checks it. School PCs are locked down, and nobody wants to pay for a grader. So I built a site where the exercises run and check themselves inside the browser, with nothing to install and nothing running on a server.

**Live demo:** https://ramaraihan.is-a.dev/pandas-drills/ (no login; the first visit downloads about 14 MB, see the numbers below)

> The checks run in your browser, so this is practice, not an exam. Anyone who opens the developer tools can see the answers, and the grading code is not protected from the student's own code.

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

## Classes

Solo practice needs no server. For my own students I also wanted to see who is stuck, so there is an optional class mode. A teacher makes a class at `#/new-class` and gets two links: one for students and a private one for the teacher. A student opens the student link, picks a nickname and works as usual; from then on every **Check** sends the code and whether it passed to the class. The teacher link opens a table of students against exercises, and a click on a cell shows that student's attempts with their code.

The class features are switched on once the API is deployed. Until then (and on today's live build) none of the class pages or links appear and the site behaves exactly as before. The API is a small Cloudflare Worker with a D1 database in [`api/`](api/README.md).

**What is stored:** the class name, each student's nickname, and for every Check the exercise, whether it passed, the kind of result, the code and the time. The teacher key and the student tokens are stored only as SHA-256 hashes. **What is not stored:** no email, no IP address, no user agent, no full names, no accounts. The Worker has logging switched off and never writes request bodies or headers anywhere.

**Retention:** a class and everything in it is deleted 180 days after it was created, or at once when the teacher presses Delete class. There is no cron job: expired classes are cleaned up whenever someone creates a new class, and an expired class already looks gone because lookups ignore it.

**Limits** (to stay on the free plans and keep abuse small): 50 new classes a day across the whole site, 60 students per class, 120 Checks per student per hour, 8 KB of code per Check and 16 KB per request. A teacher link can't be recovered, because only its hash is kept.

**What this does not do:** a student can still fake a Check, because the grading runs in their browser (see the trade-offs below). The class view is a record of practice, not proof for an exam. If the network drops, a Check is kept in the browser and sent later; grading itself never waits for the network.

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
(cd api && npm ci && npm test)   # the class API, run inside the Workers runtime with a local D1
```

The class end-to-end test (`e2e/classes.mjs`, also local only) needs the API running next to a build made with `VITE_API_URL=http://localhost:8787`; the steps are in [`api/README.md`](api/README.md).

CI runs pytest, vitest, `tsc --noEmit` and `vite build` on every push, plus the API typecheck and tests as a separate job. The Playwright test needs a browser download, so I run it locally and not in CI.

## Roadmap

1. Classes: a teacher makes a class, students join with a link and a nickname (built, waiting for the API to be deployed).
2. A fuller teacher view: a heatmap of who is stuck on which exercise.
3. More exercises, and a few harder ones.

## License

MIT, see [LICENSE](LICENSE).
