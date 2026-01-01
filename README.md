# League Backend ⚔️

A small Express backend that queries Riot APIs and exposes useful endpoints for summoner/match data.

---

## Quick start ✅

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a `.env` file with your Riot API key (already created locally for you):

   ```env
   API_KEY=RGAPI-81ff667c-05cb-454a-a7d2-eb5ceb3a6101
   ```

   **Important:** `.env` is ignored by git. Do not commit your API key.

3. Start development server:

   ```bash
   npm run dev
   ```

---

## Endpoints added 🔧

- `POST /` - lookup PUUID by Riot ID and return recent matches
- `POST /matches` - get match IDs by PUUID
- `GET /matches/:matchId` - fetch single match (cached 24h)
- `GET /matches/:matchId/timeline` - fetch match timeline (cached 24h)
- `GET /summoner/name/:summonerName` - summoner v4 (cached 24h)
- `GET /summoner/puuid/:puuid` - summoner v4 by puuid (cached 24h)
- `GET /summoner/:encryptedSummonerId/league` - ranked entries (cached 10m)
- `GET /champion-mastery/:encryptedSummonerId` - champion mastery (cached 1h)
- `GET /player/:puuid/stats?numMatches=20` - aggregated player stats (cached 5m)
- `GET /retried-match/:matchId` - fetch background-retried match data

---

## Tests & safety (very important) 🛡️

This project includes an isolated test suite that *does not* hit Riot's live APIs. Tests use `nock` to mock Riot endpoints and `supertest` to exercise your Express app. This ensures your **personal** API key and rate limits are never used during test runs.

Run tests:

```bash
npm test
```

Notes:
- Tests run with `nock.disableNetConnect()` so they cannot make real network requests (except to localhost). This prevents accidental quota usage.
- If you want to add integration tests that call Riot directly, keep these in a separate folder and add explicit safeguards (small request counts, long delays between calls, and separate test-only API key). Do not run such tests in regular CI unless you have sufficient quota.

Riot personal key limits (keep in mind for any live tests):
- 20 requests every 1 second
- 100 requests every 2 minutes

When running any live tests, throttle requests and keep `numMatches` small (e.g., 1–5) to avoid hitting the caps.

---

## Example: run a single endpoint locally

Fetch a single match (after starting the server):

```bash
curl http://localhost:5005/matches/<matchId>
```

---

## How tests are structured ✅

- `__tests__/endpoints.test.js` contains unit tests that:
  - Mock Riot API responses for each endpoint using `nock`.
  - Validate success and basic aggregation behavior (e.g., `/player/:puuid/stats`).

If you want, I can add more tests (edge cases, rate-limit retry behavior, 429 handling) or a small `integration` folder with *manual* tests designed to be run by you only.

---

