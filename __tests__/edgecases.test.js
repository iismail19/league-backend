const request = require('supertest');
const nock = require('nock');
const app = require('../server');

const BASE = 'https://americas.api.riotgames.com';

beforeAll(() => {
  nock.disableNetConnect();
  nock.enableNetConnect('127.0.0.1');
});

afterAll(() => {
  nock.enableNetConnect();
});

afterEach(() => {
  nock.cleanAll();
});

describe('Edge cases & retry behavior', () => {
  test('retries on 429 and succeeds', async () => {
    const matchId = 'match-retry';
    const matchObj = {
      metadata: { matchId },
      info: { participants: [] }
    };

    // First reply 429 then 200. Use retry-after: 0 to keep test fast.
    nock(BASE)
      .get(`/lol/match/v5/matches/${matchId}`)
      .query(true)
      .reply(429, 'rate limited', { 'retry-after': '0' })
      .get(`/lol/match/v5/matches/${matchId}`)
      .query(true)
      .reply(200, matchObj);

    const res = await request(app).get(`/matches/${matchId}`);
    expect(res.status).toBe(200);
    expect(res.body.metadata.matchId).toBe(matchId);
  });

  test('returns 500 when retries exhausted on 429', async () => {
    const matchId = 'match-retry-fail';

    // Reply 429 three times (exhaust retries)
    nock(BASE)
      .get(`/lol/match/v5/matches/${matchId}`)
      .query(true)
      .times(4)
      .reply(429, 'rate limited', { 'retry-after': '0' });

    const res = await request(app).get(`/matches/${matchId}`);
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('MATCH_ERROR');
  });

  test('player stats handles partial failures (404 match)', async () => {
    const puuid = 'puuid-edge';
    const good = 'match-good';
    const bad = 'match-bad';
    const matches = [good, bad];

    const matchObj = {
      metadata: { matchId: good },
      info: { participants: [{ puuid, win: true, kills: 3, deaths: 1, assists: 2, championName: 'Lux' }] }
    };

    nock(BASE)
      .get(`/lol/match/v5/matches/by-puuid/${puuid}/ids`)
      .query(true)
      .reply(200, matches);

    nock(BASE).get(`/lol/match/v5/matches/${good}`).query(true).reply(200, matchObj);
    nock(BASE).get(`/lol/match/v5/matches/${bad}`).query(true).reply(404);

    const res = await request(app).get(`/player/${puuid}/stats?numMatches=2`);
    expect(res.status).toBe(200);
    expect(res.body.matchesRequested).toBe(2);
    expect(res.body.matchesAnalyzed).toBe(1);
    expect(res.body.failedMatches).toContain(bad);
    expect(res.body.wins).toBe(1);
    expect(res.body.avgKills).toBe(3);
  });

  test('league endpoint returns empty array on 404', async () => {
    const id = 'no-league';
    nock(BASE).get(`/lol/league/v4/entries/by-summoner/${id}`).query(true).reply(404);

    // debug: ensure mock registered
    console.log('pendingMocks (league):', nock.pendingMocks());

    const res = await request(app).get(`/summoner/${id}/league`);
    console.log('after request pendingMocks (league):', nock.pendingMocks());
    console.log('isDone:', nock.isDone());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(0);
  });

  test('summoner by name returns 404 when not found', async () => {
    const name = 'doesnotexist';
    nock(BASE).get(`/lol/summoner/v4/summoners/by-name/${encodeURIComponent(name)}`).query(true).reply(404);

    const res = await request(app).get(`/summoner/name/${name}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});
