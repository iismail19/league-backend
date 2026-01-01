const request = require('supertest');
const nock = require('nock');
const app = require('../server');

const BASE = 'https://americas.api.riotgames.com';

beforeAll(() => {
  // Prevent tests from making real external requests
  nock.disableNetConnect();
  nock.enableNetConnect('127.0.0.1');
});

afterAll(() => {
  nock.enableNetConnect();
});

afterEach(() => {
  nock.cleanAll();
});

describe('Endpoints (mocked Riot API)', () => {
  test('GET /summoner/name/:summonerName', async () => {
    const name = 'TestSummoner';
    const mock = { id: 'encId', puuid: 'test-puuid', name };

    nock(BASE).get(`/lol/summoner/v4/summoners/by-name/${encodeURIComponent(name)}`).query(true).reply(200, mock);

    const res = await request(app).get(`/summoner/name/${name}`);
    expect(res.status).toBe(200);
    expect(res.body.puuid).toBe('test-puuid');
  });

  test('GET /summoner/puuid/:puuid', async () => {
    const puuid = 'test-puuid';
    const mock = { id: 'encId', puuid, name: 'TestSummoner' };

    nock(BASE).get(`/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(puuid)}`).query(true).reply(200, mock);

    const res = await request(app).get(`/summoner/puuid/${puuid}`);
    expect(res.status).toBe(200);
    expect(res.body.puuid).toBe(puuid);
  });

  test('GET /matches/:matchId and timeline', async () => {
    const matchId = 'match-1';
    const matchObj = {
      metadata: { matchId },
      info: { participants: [{ puuid: 'test-puuid', win: true, kills: 5, deaths: 2, assists: 7, championName: 'Yasuo' }] }
    };
    const timeline = { info: { frames: [] } };

    nock(BASE).get(`/lol/match/v5/matches/${matchId}`).query(true).reply(200, matchObj);
    nock(BASE).get(`/lol/match/v5/matches/${matchId}/timeline`).query(true).reply(200, timeline);

    const r1 = await request(app).get(`/matches/${matchId}`);
    expect(r1.status).toBe(200);
    expect(r1.body.metadata.matchId).toBe(matchId);

    const r2 = await request(app).get(`/matches/${matchId}/timeline`);
    expect(r2.status).toBe(200);
    expect(Array.isArray(r2.body.info.frames)).toBe(true);
  });

  test('GET /summoner/:id/league and /champion-mastery/:id', async () => {
    const id = 'encId';
    const league = [{ queueType: 'RANKED_SOLO_5x5', tier: 'GOLD', rank: 'IV' }];
    const mastery = [{ championId: 157, championLevel: 7, championPoints: 12345 }];

    nock(BASE).get(`/lol/league/v4/entries/by-summoner/${id}`).query(true).reply(200, league);
    nock(BASE).get(`/lol/champion-mastery/v4/champion-masteries/by-summoner/${id}`).query(true).reply(200, mastery);

    const r1 = await request(app).get(`/summoner/${id}/league`);
    expect(r1.status).toBe(200);
    expect(Array.isArray(r1.body)).toBe(true);

    const r2 = await request(app).get(`/champion-mastery/${id}`);
    expect(r2.status).toBe(200);
    expect(Array.isArray(r2.body)).toBe(true);
  });

  test('GET /player/:puuid/stats aggregates matches', async () => {
    const puuid = 'test-puuid';
    const matchId = 'match-1';
    const matches = [matchId];
    const matchObj = {
      metadata: { matchId },
      info: { participants: [{ puuid, win: true, kills: 5, deaths: 2, assists: 7, championName: 'Yasuo' }] }
    };

    nock(BASE).get(`/lol/match/v5/matches/by-puuid/${puuid}/ids`).query(true).reply(200, matches);
    nock(BASE).get(`/lol/match/v5/matches/${matchId}`).query(true).reply(200, matchObj);

    const res = await request(app).get(`/player/${puuid}/stats?numMatches=1`);
    expect(res.status).toBe(200);
    expect(res.body.matchesAnalyzed).toBe(1);
    expect(res.body.wins).toBe(1);
    expect(res.body.avgKills).toBe(5);
  });
});
