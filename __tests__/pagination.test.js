const request = require('supertest');
const nock = require('nock');
const app = require('../server');

const BASE = 'https://americas.api.riotgames.com';

// Reset rate limit tracking before each test
beforeEach(() => {
  if (app.resetRateLimitTracking) {
    app.resetRateLimitTracking();
  }
});

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

// Helper to create mock match data
const createMockMatch = (matchId, puuid) => ({
  metadata: { matchId },
  info: {
    gameMode: 'CLASSIC',
    queueId: 420,
    participants: [
      {
        puuid,
        championName: 'Ahri',
        kills: 10,
        deaths: 2,
        assists: 8,
        teamId: 100,
        summonerId: 'test-summoner-id',
      },
    ],
    teams: [{ teamId: 100, win: true }],
  },
});

describe('POST / - Pagination', () => {
  describe('Basic pagination parameters', () => {
    test('should use default start=0, count=20 when not provided', async () => {
      const puuid = 'test-puuid-default';
      const matchIds = Array(20).fill(null).map((_, i) => `NA1_match_default_${i}`);

      // Mock PUUID lookup
      nock(BASE)
        .get(/\/riot\/account\/v1\/accounts\/by-riot-id\/.*/)
        .query(true)
        .reply(200, { puuid, gameName: 'TestPlayer', tagLine: 'NA1' });

      // Mock match list - verify default pagination params
      nock(BASE)
        .get(`/lol/match/v5/matches/by-puuid/${puuid}/ids`)
        .query(true)
        .reply(200, matchIds);

      // Mock individual match fetches
      matchIds.forEach((matchId) => {
        nock(BASE)
          .get(`/lol/match/v5/matches/${matchId}`)
          .query(true)
          .reply(200, createMockMatch(matchId, puuid));
      });

      const response = await request(app)
        .post('/')
        .send({ gameName: 'TestPlayerDefault', tagline: 'NA1' });

      expect(response.status).toBe(200);
      expect(response.body.puuid).toBe(puuid);
      expect(response.body.matchDataList).toHaveLength(20);
      expect(response.body.hasMore).toBe(true);
      expect(response.body.nextStartIndex).toBe(20);
      expect(response.body.totalLoaded).toBe(20);
    });

    test('should accept custom start and count parameters', async () => {
      const puuid = 'test-puuid-custom';
      const matchIds = Array(20).fill(null).map((_, i) => `NA1_match_custom_${i + 20}`);

      // Mock PUUID lookup
      nock(BASE)
        .get(/\/riot\/account\/v1\/accounts\/by-riot-id\/.*/)
        .query(true)
        .reply(200, { puuid, gameName: 'TestPlayerCustom', tagLine: 'NA1' });

      // Mock match list with pagination params
      nock(BASE)
        .get(`/lol/match/v5/matches/by-puuid/${puuid}/ids`)
        .query(true)
        .reply(200, matchIds);

      // Mock individual match fetches
      matchIds.forEach((matchId) => {
        nock(BASE)
          .get(`/lol/match/v5/matches/${matchId}`)
          .query(true)
          .reply(200, createMockMatch(matchId, puuid));
      });

      const response = await request(app)
        .post('/')
        .send({ gameName: 'TestPlayerCustom', tagline: 'NA1', start: 20, count: 20 });

      expect(response.status).toBe(200);
      expect(response.body.nextStartIndex).toBe(40);
      expect(response.body.totalLoaded).toBe(40);
      expect(response.body.hasMore).toBe(true);
    });

    test('should set hasMore=false when fewer matches returned than requested', async () => {
      const puuid = 'test-puuid-fewer';
      // Return only 5 matches (less than requested 20)
      const matchIds = Array(5).fill(null).map((_, i) => `NA1_match_fewer_${i + 80}`);

      // Mock PUUID lookup
      nock(BASE)
        .get(/\/riot\/account\/v1\/accounts\/by-riot-id\/.*/)
        .query(true)
        .reply(200, { puuid, gameName: 'TestPlayerFewer', tagLine: 'NA1' });

      // Mock match list
      nock(BASE)
        .get(`/lol/match/v5/matches/by-puuid/${puuid}/ids`)
        .query(true)
        .reply(200, matchIds);

      // Mock individual match fetches
      matchIds.forEach((matchId) => {
        nock(BASE)
          .get(`/lol/match/v5/matches/${matchId}`)
          .query(true)
          .reply(200, createMockMatch(matchId, puuid));
      });

      const response = await request(app)
        .post('/')
        .send({ gameName: 'TestPlayerFewer', tagline: 'NA1', start: 80, count: 20 });

      expect(response.status).toBe(200);
      expect(response.body.matchDataList).toHaveLength(5);
      expect(response.body.hasMore).toBe(false);
      expect(response.body.nextStartIndex).toBe(85);
      expect(response.body.totalLoaded).toBe(85);
    });

    test('should handle empty match list at end of pagination', async () => {
      const puuid = 'test-puuid-empty';

      // Mock PUUID lookup
      nock(BASE)
        .get(/\/riot\/account\/v1\/accounts\/by-riot-id\/.*/)
        .query(true)
        .reply(200, { puuid, gameName: 'TestPlayerEmpty', tagLine: 'NA1' });

      // Mock empty match list
      nock(BASE)
        .get(`/lol/match/v5/matches/by-puuid/${puuid}/ids`)
        .query(true)
        .reply(200, []);

      const response = await request(app)
        .post('/')
        .send({ gameName: 'TestPlayerEmpty', tagline: 'NA1', start: 100, count: 20 });

      expect(response.status).toBe(200);
      expect(response.body.matchDataList).toHaveLength(0);
      expect(response.body.hasMore).toBe(false);
      expect(response.body.nextStartIndex).toBe(100);
    });

    test('should validate and sanitize pagination parameters', async () => {
      const puuid = 'test-puuid-sanitize';
      const matchIds = ['NA1_match_sanitize'];

      // Mock PUUID lookup
      nock(BASE)
        .get(/\/riot\/account\/v1\/accounts\/by-riot-id\/.*/)
        .query(true)
        .reply(200, { puuid, gameName: 'TestPlayerSanitize', tagLine: 'NA1' });

      // Mock match list - negative start should be sanitized to 0
      nock(BASE)
        .get(`/lol/match/v5/matches/by-puuid/${puuid}/ids`)
        .query(true)
        .reply(200, matchIds);

      // Mock match fetch
      nock(BASE)
        .get(`/lol/match/v5/matches/${matchIds[0]}`)
        .query(true)
        .reply(200, createMockMatch(matchIds[0], puuid));

      const response = await request(app)
        .post('/')
        .send({ gameName: 'TestPlayerSanitize', tagline: 'NA1', start: -5, count: 10 });

      expect(response.status).toBe(200);
    });
  });

  describe('Response format includes pagination metadata', () => {
    test('should include all required pagination fields in response', async () => {
      const puuid = 'test-puuid-format';
      const matchIds = ['NA1_match_format'];

      // Mock PUUID lookup
      nock(BASE)
        .get(/\/riot\/account\/v1\/accounts\/by-riot-id\/.*/)
        .query(true)
        .reply(200, { puuid, gameName: 'TestPlayerFormat', tagLine: 'NA1' });

      // Mock match list
      nock(BASE)
        .get(`/lol/match/v5/matches/by-puuid/${puuid}/ids`)
        .query(true)
        .reply(200, matchIds);

      // Mock match fetch
      nock(BASE)
        .get(`/lol/match/v5/matches/${matchIds[0]}`)
        .query(true)
        .reply(200, createMockMatch(matchIds[0], puuid));

      const response = await request(app)
        .post('/')
        .send({ gameName: 'TestPlayerFormat', tagline: 'NA1' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('puuid');
      expect(response.body).toHaveProperty('matchDataList');
      expect(response.body).toHaveProperty('failedMatches');
      expect(response.body).toHaveProperty('hasMore');
      expect(response.body).toHaveProperty('nextStartIndex');
      expect(response.body).toHaveProperty('totalLoaded');
      expect(response.body).toHaveProperty('retryAfter');
    });

    test('retryAfter should be null when not approaching rate limit', async () => {
      const puuid = 'test-puuid-rate';
      const matchIds = ['NA1_match_rate'];

      // Mock PUUID lookup
      nock(BASE)
        .get(/\/riot\/account\/v1\/accounts\/by-riot-id\/.*/)
        .query(true)
        .reply(200, { puuid, gameName: 'TestPlayerRate', tagLine: 'NA1' });

      // Mock match list
      nock(BASE)
        .get(`/lol/match/v5/matches/by-puuid/${puuid}/ids`)
        .query(true)
        .reply(200, matchIds);

      // Mock match fetch
      nock(BASE)
        .get(`/lol/match/v5/matches/${matchIds[0]}`)
        .query(true)
        .reply(200, createMockMatch(matchIds[0], puuid));

      const response = await request(app)
        .post('/')
        .send({ gameName: 'TestPlayerRate', tagline: 'NA1' });

      expect(response.status).toBe(200);
      expect(response.body.retryAfter).toBeNull();
    });
  });

  describe('Error handling with pagination', () => {
    test('should return 404 when summoner not found', async () => {
      nock(BASE)
        .get(/\/riot\/account\/v1\/accounts\/by-riot-id\/.*/)
        .query(true)
        .reply(404);

      const response = await request(app)
        .post('/')
        .send({ gameName: 'NonExistent', tagline: 'NA1', start: 0, count: 20 });

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    test('should return 400 when missing required fields', async () => {
      const response = await request(app)
        .post('/')
        .send({ gameName: 'TestPlayer' }); // missing tagline

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('BAD_REQUEST');
    });
  });
});

describe('Retry logic with exponential backoff', () => {
  test('should retry on 429 responses', async () => {
    const puuid = 'test-puuid-retry429';
    const matchIds = ['NA1_match_retry429'];

    // Mock PUUID lookup
    nock(BASE)
      .get(/\/riot\/account\/v1\/accounts\/by-riot-id\/.*/)
      .query(true)
      .reply(200, { puuid, gameName: 'TestPlayerRetry', tagLine: 'NA1' });

    // First call returns 429, second succeeds - use 0 second retry to speed up test
    nock(BASE)
      .get(`/lol/match/v5/matches/by-puuid/${puuid}/ids`)
      .query(true)
      .reply(429, {}, { 'Retry-After': '0' });

    nock(BASE)
      .get(`/lol/match/v5/matches/by-puuid/${puuid}/ids`)
      .query(true)
      .reply(200, matchIds);

    // Mock match fetch
    nock(BASE)
      .get(`/lol/match/v5/matches/${matchIds[0]}`)
      .query(true)
      .reply(200, createMockMatch(matchIds[0], puuid));

    const response = await request(app)
      .post('/')
      .send({ gameName: 'TestPlayerRetry', tagline: 'NA1' });

    expect(response.status).toBe(200);
    expect(response.body.matchDataList).toHaveLength(1);
  }, 15000);
});

describe('Backwards compatibility', () => {
  test('should work without pagination params (default behavior)', async () => {
    const puuid = 'test-puuid-compat';
    const matchIds = Array(10).fill(null).map((_, i) => `NA1_compat_${i}`);

    // Mock PUUID lookup
    nock(BASE)
      .get(/\/riot\/account\/v1\/accounts\/by-riot-id\/.*/)
      .query(true)
      .reply(200, { puuid, gameName: 'TestPlayerCompat', tagLine: 'NA1' });

    // Mock match list
    nock(BASE)
      .get(`/lol/match/v5/matches/by-puuid/${puuid}/ids`)
      .query(true)
      .reply(200, matchIds);

    // Mock individual match fetches
    matchIds.forEach((matchId) => {
      nock(BASE)
        .get(`/lol/match/v5/matches/${matchId}`)
        .query(true)
        .reply(200, createMockMatch(matchId, puuid));
    });

    const response = await request(app)
      .post('/')
      .send({ gameName: 'TestPlayerCompat', tagline: 'NA1' });

    expect(response.status).toBe(200);
    expect(response.body.puuid).toBe(puuid);
    expect(response.body.matchDataList).toHaveLength(10);
    // New fields should exist but won't break old clients
    expect(response.body.hasMore).toBeDefined();
    expect(response.body.nextStartIndex).toBeDefined();
    expect(response.body.totalLoaded).toBeDefined();
  });
});
