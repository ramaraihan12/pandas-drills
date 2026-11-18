# pandas drills API

The class backend for [pandas drills](../README.md): a Cloudflare Worker (plain TypeScript, no framework) with a D1 database. It stays inside the free plans. Logs and observability are off in `wrangler.toml`, and the code never logs request bodies, headers or IPs.

## Endpoints

| Method and path | Who | What |
| --- | --- | --- |
| `POST /classes` `{name, turnstileToken}` | anyone, after a Turnstile check | makes a class, returns `{code, teacherKey, expiresAt}` |
| `GET /classes/:code` | anyone | `{name, expiresAt}` for the join page |
| `POST /classes/:code/join` `{nickname}` | anyone | returns `{studentToken, nickname}` |
| `POST /submissions` `{exerciseId, passed, kind, code}` | student token | records a Check, answers 204 |
| `GET /classes/:code/report` | teacher key | per student and exercise: attempts, passed, first pass, last kind; per exercise totals |
| `GET /classes/:code/submissions?student=&exercise=` | teacher key | that student's last 20 attempts with code |
| `POST /classes/:code/joining` `{open}` | teacher key | closes or reopens joining (a closed class answers 403 to new students) |
| `DELETE /classes/:code/students/:id` | teacher key | removes one student and their submissions |
| `DELETE /classes/:code` | teacher key | deletes the class and everything in it |

Class creation is the only call with a bot check. The Worker verifies `turnstileToken` with Cloudflare Turnstile (`siteverify`, 4 second timeout) before it writes anything or counts the class against the daily limit. It sends only the secret and the token, never the visitor's IP, and never logs the token. A failed check answers 403; with no `TURNSTILE_SECRET` configured it answers 503 "Class creation is not configured" (it fails closed). When `DEV_ORIGINS` is set (local development) the check is skipped. Joining and sending Checks have no bot check, so students never see it.

POST bodies must be `application/json` (415 otherwise). A request with an `Origin` header that is not allowed gets 403. The report reads only `student_exercise`, one summary row per student and exercise that is updated in the same batch as each submission.

Secrets go in `Authorization: Bearer ...`. The exercise ids come from the `exercises/` folder (`npm run ids` writes `src/generated/exercise-ids.json`) and the result kinds from `../src/lib/kinds.ts`, so nothing is listed twice.

## Local development

```
cd api
npm ci
npm test                 # runs the API inside the Workers runtime with a local D1 and the migrations applied
npm run migrate:local    # creates the local database in .wrangler/state
npm run dev              # http://localhost:8787 (copy .dev.vars.example to .dev.vars first: it lists the localhost origins)
```

To try the whole thing in a browser, build the site with the API address and run the local end-to-end test from the repo root:

```
VITE_API_URL=http://localhost:8787 npm run build
node e2e/classes.mjs     # starts vite preview, creates a class, joins as two students, opens the teacher link
```

## Deploying (needs a Cloudflare account, free plan)

```
cd api
npx wrangler login
npx wrangler d1 create pandas-drills          # copy the printed database_id into wrangler.toml
npx wrangler d1 migrations apply pandas-drills --remote
npx wrangler secret put TURNSTILE_SECRET       # the secret key of a Turnstile widget (free); without it no class can be created
npx wrangler deploy                            # prints https://pandas-drills-api.<account>.workers.dev
```

The widget's public site key goes in a repository variable that the Pages build passes to the site as `VITE_TURNSTILE_SITEKEY`:

```
gh variable set TURNSTILE_SITEKEY --repo ramaraihan12/pandas-drills --body "<site key>"
```

Then set the repository variable that switches the class pages on, and re-run the Pages workflow:

```
gh variable set API_URL --repo ramaraihan12/pandas-drills --body "https://pandas-drills-api.<account>.workers.dev"
gh workflow run pages.yml --repo ramaraihan12/pandas-drills
```

CORS allows only `https://ramaraihan.is-a.dev`. The local dev ports are allowed only when the `DEV_ORIGINS` variable is set (in `.dev.vars` and in the test config, never in `wrangler.toml`); change `PROD_ORIGINS` in `src/index.ts` if the site moves.

## Cleanup and free-plan budget

`wrangler.toml` has one cron trigger, `17 3 * * *`. Its `scheduled()` handler deletes expired classes (students, submissions, summary rows) in batches of 50, at most 10 batches a run, and old daily counters. The same cleanup also runs, 20 classes at a time, on class creation, join and report. After a deletion D1 keeps a 7-day recovery window (Time Travel). A submission writes at most 8 rows (measured in the tests), so the site-wide cap of 6,250 recorded submissions a day uses at most half of the 100,000 daily row writes on the free plan.
