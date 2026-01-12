const express = require("express");
const axios = require("axios");
const cors = require("cors");
const NodeCache = require("node-cache");
const compression = require("compression");
const Bottleneck = require("bottleneck");
const helmet = require("helmet");
require("dotenv").config();

// Validate environment variables (allow running in dev without API_KEY)
if (!process.env.API_KEY && process.env.NODE_ENV !== 'dev') {
  console.error("❌ API_KEY is missing from environment variables.");
  process.exit(1);
} else if (!process.env.API_KEY && process.env.NODE_ENV === 'dev') {
  console.warn("⚠️ Running in dev mode without API_KEY; endpoints will use mock data where available.");
}

const PORT = process.env.NODE_ENV === 'dev' ? 5005 : 3000;

const BASE_URL = "https://americas.api.riotgames.com"; // Routing server for Account and Match APIs
const MATCH_LIST_URL = "/lol/match/v5/matches/by-puuid/";
const MATCH_URL = "/lol/match/v5/matches/";
const GET_ACCOUNT_BY_SUMMONER_NAME = "/riot/account/v1/accounts/by-riot-id/";
const SUMMONER_BY_PUUID = "/lol/summoner/v4/summoners/by-puuid/";
const LEAGUE_BY_PUUID = "/lol/league/v4/entries/by-puuid/";
const CHAMPION_MASTERY_BY_PUUID = "/lol/champion-mastery/v4/champion-masteries/by-puuid/";
const API_KEY = `api_key=${process.env.API_KEY}`;

// Map taglines to regional servers for v4 APIs (Summoner, League, Champion Mastery)
const getRegionalServer = (tagline) => {
  const taglineUpper = tagline.toUpperCase();
  const regionMap = {
    'NA1': 'https://na1.api.riotgames.com',
    'NA': 'https://na1.api.riotgames.com',
    'EUW1': 'https://euw1.api.riotgames.com',
    'EUW': 'https://euw1.api.riotgames.com',
    'EUNE1': 'https://eun1.api.riotgames.com',
    'EUNE': 'https://eun1.api.riotgames.com',
    'KR': 'https://kr.api.riotgames.com',
    'BR1': 'https://br1.api.riotgames.com',
    'BR': 'https://br1.api.riotgames.com',
    'LAN1': 'https://la1.api.riotgames.com',
    'LAN': 'https://la1.api.riotgames.com',
    'LAS1': 'https://la2.api.riotgames.com',
    'LAS': 'https://la2.api.riotgames.com',
    'OC1': 'https://oc1.api.riotgames.com',
    'OCE': 'https://oc1.api.riotgames.com',
    'RU': 'https://ru.api.riotgames.com',
    'TR1': 'https://tr1.api.riotgames.com',
    'TR': 'https://tr1.api.riotgames.com',
    'JP1': 'https://jp1.api.riotgames.com',
    'JP': 'https://jp1.api.riotgames.com',
  };
  return regionMap[taglineUpper] || 'https://na1.api.riotgames.com'; // Default to NA
};

console.info("✅ Loaded API Key.");

// Setup cache and rate limiter
const cache = new NodeCache({ stdTTL: 600 }); // 10 minutes
const limiter = new Bottleneck({
  maxConcurrent: 20,
  minTime: 50,
});
const limitedRequest = (fn) => limiter.schedule(fn);

// Helper: async error handler - ensures CORS headers are preserved
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch((err) => {
    // Ensure CORS headers are set before passing to error handler
    if (!res.headersSent) {
      const origin = req.headers.origin;
      if (origin && (
        ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:5174'].includes(origin) ||
        origin.match(/^https:\/\/.*\.onrender\.com$/)
      )) {
        res.header("Access-Control-Allow-Origin", origin);
      } else {
        res.header("Access-Control-Allow-Origin", "*");
      }
      res.header("Access-Control-Allow-Credentials", "true");
    }
    next(err);
  });
};

// Create Express app (declare early so routes can be defined in any order)
const app = express();

// Helper: build URLs
const getByRiotIdURL = ({ gameName, tagline }) =>
  `${BASE_URL}${GET_ACCOUNT_BY_SUMMONER_NAME}${encodeURIComponent(
    gameName
  )}/${tagline}?${API_KEY}`;

const getSummonerByPUUIDURL = (puuid, tagline = 'NA1') => {
  const regionalServer = getRegionalServer(tagline);
  return `${regionalServer}${SUMMONER_BY_PUUID}${encodeURIComponent(puuid)}?${API_KEY}`;
};

const getLeagueEntriesByPuuidURL = (puuid, tagline = 'NA1') => {
  const regionalServer = getRegionalServer(tagline);
  return `${regionalServer}${LEAGUE_BY_PUUID}${encodeURIComponent(puuid)}?${API_KEY}`;
};

const getLeagueEntriesBySummonerIdURL = (encryptedSummonerId, tagline = 'NA1') => {
  const regionalServer = getRegionalServer(tagline);
  return `${regionalServer}/lol/league/v4/entries/by-summoner/${encodeURIComponent(encryptedSummonerId)}?${API_KEY}`;
};

const getChampionMasteryByPuuidURL = (puuid, tagline = 'NA1') => {
  const regionalServer = getRegionalServer(tagline);
  return `${regionalServer}${CHAMPION_MASTERY_BY_PUUID}${encodeURIComponent(puuid)}?${API_KEY}`;
};

const getMatchesURL = (puuid, start = 0, count = 20) =>
  `${BASE_URL}${MATCH_LIST_URL}${puuid}/ids?start=${start}&count=${count}&${API_KEY}`;

const getMatchDataURL = (matchId) =>
  `${BASE_URL}${MATCH_URL}${matchId}?${API_KEY}`;

const getMatchTimelineURL = (matchId) =>
  `${BASE_URL}${MATCH_URL}${matchId}/timeline?${API_KEY}`;

// GET /summoner/puuid/:puuid - fetch summoner by PUUID (cached)
// Optional query param: ?tagline=NA1 (to determine regional server)
app.get(
  "/summoner/puuid/:puuid",
  asyncHandler(async (req, res) => {
    const puuid = req.params.puuid;
    const tagline = req.query.tagline || 'NA1'; // Default to NA1
    const cacheKey = `summoner-puuid-${puuid}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    try {
      const response = await limitedRequest(() =>
        axios.get(getSummonerByPUUIDURL(puuid, tagline), { retry: 3, retryDelay: 1000 })
      );
      const data = response.data;
      cache.set(cacheKey, data, 24 * 60 * 60);
      res.json(data);
    } catch (err) {
      if (err.response && err.response.status === 404) {
        return res.status(404).json({ error: "Summoner not found", code: "NOT_FOUND" });
      }
      console.error(`Failed to fetch summoner by puuid ${puuid}:`, err.message);
      // Ensure CORS headers are set on error responses
      res.header("Access-Control-Allow-Origin", "*");
      res.status(500).json({ error: "Failed to fetch summoner", code: "SUMMONER_ERROR" });
    }
  })
);

// GET /summoner/:encryptedSummonerId/league - ranked entries (cached 10m)
// Optional query param: ?tagline=NA1 (to determine regional server)
// Also supports ?puuid=... to use by-puuid endpoint as fallback
app.get(
  "/summoner/:encryptedSummonerId/league",
  asyncHandler(async (req, res) => {
    const id = req.params.encryptedSummonerId;
    const tagline = req.query.tagline || 'NA1'; // Default to NA1
    const puuid = req.query.puuid; // Use puuid if provided (better API key access)
    
    // Cache key: prefer encryptedSummonerId, fallback to puuid
    const cacheKey = (id && id !== 'placeholder') ? `league-${id}-${tagline}` : (puuid ? `league-puuid-${puuid}-${tagline}` : null);
    if (cacheKey) {
      const cached = cache.get(cacheKey);
      if (cached) {
        return res.json(cached);
      }
    }

    try {
      // Try by-summoner endpoint first (standard League v4 endpoint)
      let url, response, data;
      if (id && id !== 'placeholder') {
        url = getLeagueEntriesBySummonerIdURL(id, tagline);
        console.log(`[LEAGUE] Fetching rank data using by-summoner endpoint for id: ${id}, tagline: ${tagline}`);
        console.log(`[LEAGUE] URL: ${url}`);
        
        try {
          response = await limitedRequest(() =>
            axios.get(url, { retry: 3, retryDelay: 1000 })
          );
          data = response.data;
          console.log(`[LEAGUE] Response status: ${response.status}`);
          console.log(`[LEAGUE] Response data:`, JSON.stringify(data, null, 2));
        } catch (summonerErr) {
          console.log(`[LEAGUE] By-summoner endpoint failed, falling back to by-puuid: ${summonerErr.message}`);
          // Fall through to by-puuid attempt
        }
      }
      
      // Fallback to by-puuid if by-summoner failed or not available
      if (!response && puuid) {
        url = getLeagueEntriesByPuuidURL(puuid, tagline);
        console.log(`[LEAGUE] Fetching rank data using by-puuid endpoint for puuid: ${puuid}, tagline: ${tagline}`);
        console.log(`[LEAGUE] URL: ${url}`);
        
        response = await limitedRequest(() =>
          axios.get(url, { retry: 3, retryDelay: 1000 })
        );
        data = response.data;
        console.log(`[LEAGUE] Response status: ${response.status}`);
        console.log(`[LEAGUE] Response data:`, JSON.stringify(data, null, 2));
      } else if (!puuid && (!id || id === 'placeholder')) {
        return res.status(400).json({ 
          error: "PUUID or encryptedSummonerId is required for league entries", 
          code: "MISSING_ID" 
        });
      }
      
      // Cache the result for 10 minutes
      if (cacheKey && data !== undefined) {
        cache.set(cacheKey, data, 10 * 60);
      }
      
      // Explicitly set CORS headers before sending response
      const origin = req.headers.origin;
      if (origin && (
        ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:5174'].includes(origin) ||
        origin.match(/^https:\/\/.*\.onrender\.com$/)
      )) {
        res.header("Access-Control-Allow-Origin", origin);
      } else {
        res.header("Access-Control-Allow-Origin", "*");
      }
      res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
      res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.header("Access-Control-Allow-Credentials", "true");
      
      res.json(data);
    } catch (err) {
      // Ensure CORS headers on error response (before sending response)
      const origin = req.headers.origin;
      if (origin && (
        ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:5174'].includes(origin) ||
        origin.match(/^https:\/\/.*\.onrender\.com$/)
      )) {
        res.header("Access-Control-Allow-Origin", origin);
      } else {
        res.header("Access-Control-Allow-Origin", "*");
      }
      res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
      res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.header("Access-Control-Allow-Credentials", "true");
      
      if (err.response && err.response.status === 404) {
        // No league entries -> return empty array
        return res.json([]);
      }
      
      // Handle 403 Forbidden - API key may not have permission for League v4
      if (err.response && err.response.status === 403) {
        console.error(`[LEAGUE] 403 Forbidden - API key may not have permission for League v4 endpoint`);
        console.error(`[LEAGUE] URL: ${getLeagueEntriesByPuuidURL(puuid, tagline)}`);
        console.error(`[LEAGUE] Response data:`, err.response.data);
        // Return empty array instead of error - rank data is optional
        return res.json([]);
      }
      
      console.error(`[LEAGUE] Failed to fetch league entries for ${id}:`, err.message);
      if (err.response) {
        console.error(`[LEAGUE] Riot API error: ${err.response.status} - ${err.response.statusText}`);
        console.error(`[LEAGUE] URL: ${getLeagueEntriesByPuuidURL(puuid, tagline)}`);
        console.error(`[LEAGUE] Response data:`, err.response.data);
        
        // Return more detailed error to frontend for debugging
        return res.status(err.response.status || 500).json({ 
          error: "Failed to fetch league entries", 
          code: "LEAGUE_ERROR",
          details: err.response.data,
          status: err.response.status,
          url: getLeagueEntriesByPuuidURL(puuid, tagline)
        });
      }
      res.status(500).json({ error: "Failed to fetch league entries", code: "LEAGUE_ERROR", message: err.message });
    }
  })
);

// GET /champion-mastery/:puuid - champion mastery list by PUUID (cached 1h)
// Optional query param: ?tagline=NA1 (to determine regional server)
app.get(
  "/champion-mastery/:puuid",
  asyncHandler(async (req, res) => {
    const puuid = req.params.puuid;
    const tagline = req.query.tagline || 'NA1'; // Default to NA1
    const cacheKey = `champion-mastery-puuid-${puuid}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    try {
      const response = await limitedRequest(() =>
        axios.get(getChampionMasteryByPuuidURL(puuid, tagline), { retry: 3, retryDelay: 1000 })
      );
      const data = response.data;
      cache.set(cacheKey, data, 60 * 60);
      res.json(data);
    } catch (err) {
      if (err.response && err.response.status === 404) {
        return res.status(404).json({ error: "Champion mastery not found", code: "NOT_FOUND" });
      }
      console.error(`Failed to fetch champion mastery for ${puuid}:`, err.message);
      res.status(500).json({ error: "Failed to fetch champion mastery", code: "MASTERY_ERROR" });
    }
  })
);

// Axios retry logic
axios.interceptors.response.use(null, async (error) => {
  const { config, response } = error;
  if (!config || !config.retry) return Promise.reject(error);

  config.retryCount = config.retryCount || 0;
  if (config.retryCount >= config.retry) return Promise.reject(error);

  config.retryCount += 1;

  // Don't retry for client errors except 429 (rate limit)
  if (response && response.status === 403) {
    console.error(
      `403 Forbidden for URL: ${config.url} (Attempt ${config.retryCount})`
    );
    return Promise.reject(error);
  }

  if (response && response.status && response.status >= 400 && response.status < 500 && response.status !== 429) {
    // Client error (4xx) other than 429 — do not retry
    return Promise.reject(error);
  }

  if (response && response.status === 429) {
    const retryAfter = response.headers["retry-after"]
      ? parseInt(response.headers["retry-after"], 10) * 1000
      : 5000;
    console.warn(
      `Rate limited (429). Backing off for ${retryAfter}ms (Attempt ${config.retryCount})`
    );
    await new Promise((resolve) => setTimeout(resolve, retryAfter));
  } else {
    await new Promise((resolve) =>
      setTimeout(resolve, config.retryDelay || 1000)
    );
  }

  return axios(config);
});

// Express app setup
// CORS must be first to handle preflight requests
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Allow localhost origins for development
    const localhostOrigins = ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:5174'];
    if (localhostOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // Allow Render frontend origins (pattern: https://*.onrender.com)
    if (origin.match(/^https:\/\/.*\.onrender\.com$/)) {
      return callback(null, true);
    }
    
    // Reject other origins
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(compression());
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
})); // Security headers

// Development mock: if running in dev without an API key, provide a simple mock response
if (process.env.NODE_ENV === 'dev' && !process.env.API_KEY) {
  app.post('/', (req, res) => {
    const { gameName, tagline } = req.body || {};
    const puuid = 'dev-puuid';
    const sampleMatch = {
      metadata: { matchId: 'MOCK-1' },
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
            lane: 'Mid',
            totalMinionsKilled: 150,
            riotIdGameName: gameName || 'DevPlayer',
          },
          {
            puuid: 'opponent-1',
            championName: 'Darius',
            kills: 2,
            deaths: 10,
            assists: 1,
            teamId: 200,
            lane: 'Top',
            totalMinionsKilled: 80,
            riotIdGameName: 'Opponent',
          },
        ],
        teams: [{ teamId: 100, win: true }, { teamId: 200, win: false }],
      },
    };

    return res.json({ puuid, matchDataList: [sampleMatch], failedMatches: [] });
  });
}

// In-memory cache for retried matches
const retriedMatchesCache = new Map();

// Validate request body middleware
function validateBody(requiredFields) {
  return (req, res, next) => {
    for (const field of requiredFields) {
      if (!req.body[field]) {
        return res
          .status(400)
          .json({ error: `Missing field: ${field}`, code: "BAD_REQUEST" });
      }
    }
    next();
  };
}

// POST / : Get user PUUID and matches
app.post(
  "/",
  validateBody(["gameName", "tagline"]),
  asyncHandler(async (req, res) => {
    const { gameName, tagline } = req.body;
    const cacheKey = `puuid-${gameName}-${tagline}`;
    let puuidData = cache.get(cacheKey);

    retriedMatchesCache.clear();

    if (!puuidData) {
      const url = getByRiotIdURL({ gameName, tagline });
      try {
        const response = await limitedRequest(() =>
          axios.get(url, { retry: 3, retryDelay: 1000 })
        );
        puuidData = response.data;
        cache.set(cacheKey, puuidData);
      } catch (err) {
        console.error("Failed to fetch PUUID:", err.message);
        return res
          .status(404)
          .json({ error: "Summoner not found.", code: "NOT_FOUND" });
      }
    }

    const matchesCacheKey = `matches-${puuidData.puuid}`;
    let matchDataList = cache.get(matchesCacheKey);

    if (matchDataList) {
      // Try to extract summonerId from cached match data
      let summonerId = null;
      if (matchDataList.length > 0) {
        const firstMatch = matchDataList[0];
        const playerParticipant = firstMatch?.info?.participants?.find(
          (p) => p.puuid === puuidData.puuid
        );
        if (playerParticipant?.summonerId) {
          summonerId = playerParticipant.summonerId;
        }
      }
      return res.json({
        puuid: puuidData.puuid,
        matchDataList,
        failedMatches: [],
        summonerId: summonerId,
      });
    }

    // Fetch match IDs
    let listOfMatches;
    try {
      const matchesURL = getMatchesURL(puuidData.puuid);
      const response = await limitedRequest(() =>
        axios.get(matchesURL, { retry: 3, retryDelay: 1000 })
      );
      listOfMatches = response.data;
    } catch (err) {
      console.error("Failed to fetch match list:", err.message);
      return res.status(500).json({
        error: "Failed to fetch match list.",
        code: "MATCH_LIST_ERROR",
      });
    }

    // Fetch match data
    const matchCache = new Map();
    const failedMatches = [];
    matchDataList = await Promise.all(
      listOfMatches.map(async (matchId) => {
        try {
          return await limitedRequest(async () => {
            if (matchCache.has(matchId)) return matchCache.get(matchId);
            const matchDataURL = getMatchDataURL(matchId);
            const matchData = await axios.get(matchDataURL, {
              retry: 3,
              retryDelay: 1000,
            });
            matchCache.set(matchId, matchData.data);
            return matchData.data;
          });
        } catch (err) {
          console.error(
            `Failed to fetch match data for matchId: ${matchId}`,
            err.message
          );
          failedMatches.push(matchId);
          return null;
        }
      })
    );

    const successfulMatches = matchDataList.filter(Boolean);
    cache.set(matchesCacheKey, successfulMatches);

    // Retry failed matches in the background
    if (failedMatches.length > 0) {
      failedMatches.forEach((matchId, idx) => {
        setTimeout(async () => {
          try {
            const matchDataURL = getMatchDataURL(matchId);
            const matchData = await limitedRequest(() =>
              axios.get(matchDataURL, { retry: 3, retryDelay: 1000 })
            );
            retriedMatchesCache.set(matchId, matchData.data);
          } catch (err) {
            // Still failed, do nothing
          }
        }, 100 * idx);
      });
    }

    // Try to get summoner data from first match if available (to avoid extra API call)
    let summonerData = null;
    if (successfulMatches.length > 0) {
      try {
        const firstMatch = successfulMatches[0];
        const playerParticipant = firstMatch?.info?.participants?.find(
          (p) => p.puuid === puuidData.puuid
        );
        // Match v5 participants might have summonerId field
        if (playerParticipant?.summonerId) {
          summonerData = { id: playerParticipant.summonerId };
        }
      } catch (err) {
        // Ignore - we'll fetch it separately if needed
      }
    }

    res.json({
      puuid: puuidData.puuid,
      matchDataList: successfulMatches,
      failedMatches,
      summonerId: summonerData?.id, // Include if we found it
    });
  })
);

// POST /matches : Get match list by PUUID
app.post(
  "/matches",
  validateBody(["puuid"]),
  asyncHandler(async (req, res) => {
    const url = getMatchesURL(req.body.puuid);
    try {
      const response = await limitedRequest(() =>
        axios.get(url, { retry: 3, retryDelay: 1000 })
      );
      res.json(response.data);
    } catch (err) {
      res
        .status(500)
        .json({ error: "Failed to fetch matches.", code: "MATCHES_ERROR" });
    }
  })
);

// GET /matches/:matchId - fetch a single match (cached)
app.get(
  "/matches/:matchId",
  asyncHandler(async (req, res) => {
    const { matchId } = req.params;
    const cacheKey = `match-${matchId}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    try {
      const response = await limitedRequest(() =>
        axios.get(getMatchDataURL(matchId), { retry: 3, retryDelay: 1000 })
      );
      const matchData = response.data;
      // Cache immutable match data for 24 hours
      cache.set(cacheKey, matchData, 24 * 60 * 60);
      res.json(matchData);
    } catch (err) {
      if (err.response && err.response.status === 404) {
        return res.status(404).json({ error: "Match not found", code: "NOT_FOUND" });
      }
      console.error(`Failed to fetch match ${matchId}:`, err.message);
      res.status(500).json({ error: "Failed to fetch match", code: "MATCH_ERROR" });
    }
  })
);

// GET /matches/:matchId/timeline - fetch match timeline (cached)
app.get(
  "/matches/:matchId/timeline",
  asyncHandler(async (req, res) => {
    const { matchId } = req.params;
    const cacheKey = `match-timeline-${matchId}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    try {
      const response = await limitedRequest(() =>
        axios.get(getMatchTimelineURL(matchId), { retry: 3, retryDelay: 1000 })
      );
      const timeline = response.data;
      cache.set(cacheKey, timeline, 24 * 60 * 60);
      res.json(timeline);
    } catch (err) {
      if (err.response && err.response.status === 404) {
        return res.status(404).json({ error: "Timeline not found", code: "NOT_FOUND" });
      }
      console.error(`Failed to fetch timeline for ${matchId}:`, err.message);
      res.status(500).json({ error: "Failed to fetch timeline", code: "TIMELINE_ERROR" });
    }
  })
);

// GET /player/:puuid/stats - aggregated stats (winrate, avg KDA, favorite champions)
app.get(
  "/player/:puuid/stats",
  asyncHandler(async (req, res) => {
    const puuid = req.params.puuid;
    const numMatches = Math.min(parseInt(req.query.numMatches, 10) || 20, 100);
    const cacheKey = `player-stats-${puuid}-${numMatches}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    try {
      const matchesResponse = await limitedRequest(() =>
        axios.get(getMatchesURL(puuid, 0, numMatches), { retry: 3, retryDelay: 1000 })
      );
      const matchIds = matchesResponse.data || [];

      const matchResults = await Promise.all(
        matchIds.map(async (matchId) => {
          try {
            let matchData = cache.get(`match-${matchId}`);
            if (!matchData) {
              const resp = await limitedRequest(() =>
                axios.get(getMatchDataURL(matchId), { retry: 3, retryDelay: 1000 })
              );
              matchData = resp.data;
              cache.set(`match-${matchId}`, matchData, 24 * 60 * 60);
            }
            return { matchId, matchData };
          } catch (err) {
            return { matchId, error: err };
          }
        })
      );

      const analysis = {
        puuid,
        matchesRequested: matchIds.length,
        matchesAnalyzed: 0,
        wins: 0,
        losses: 0,
        kills: 0,
        deaths: 0,
        assists: 0,
        championStats: {},
        failedMatches: [],
      };

      for (const r of matchResults) {
        if (r.error) {
          analysis.failedMatches.push(r.matchId);
          continue;
        }
        const matchData = r.matchData;
        const participant = matchData?.info?.participants?.find((p) => p.puuid === puuid);
        if (!participant) {
          analysis.failedMatches.push(r.matchId);
          continue;
        }

        analysis.matchesAnalyzed += 1;
        if (participant.win) analysis.wins += 1;
        else analysis.losses += 1;

        analysis.kills += participant.kills || 0;
        analysis.deaths += participant.deaths || 0;
        analysis.assists += participant.assists || 0;

        const champ = participant.championName || String(participant.championId || "unknown");
        if (!analysis.championStats[champ])
          analysis.championStats[champ] = { championName: champ, games: 0, wins: 0, kills: 0, deaths: 0, assists: 0 };
        const cs = analysis.championStats[champ];
        cs.games += 1;
        if (participant.win) cs.wins += 1;
        cs.kills += participant.kills || 0;
        cs.deaths += participant.deaths || 0;
        cs.assists += participant.assists || 0;
      }

      const analyzed = analysis.matchesAnalyzed || 0;
      const result = {
        puuid: analysis.puuid,
        matchesRequested: analysis.matchesRequested,
        matchesAnalyzed: analyzed,
        wins: analysis.wins,
        losses: analysis.losses,
        winRate: analyzed ? analysis.wins / analyzed : 0,
        avgKills: analyzed ? analysis.kills / analyzed : 0,
        avgDeaths: analyzed ? analysis.deaths / analyzed : 0,
        avgAssists: analyzed ? analysis.assists / analyzed : 0,
        topChampions: Object.values(analysis.championStats)
          .map((c) => ({ ...c, winRate: c.games ? c.wins / c.games : 0 }))
          .sort((a, b) => b.games - a.games)
          .slice(0, 5),
        failedMatches: analysis.failedMatches,
      };

      cache.set(cacheKey, result, 5 * 60); // cache 5 minutes
      res.json(result);
    } catch (err) {
      console.error("Failed to compute player stats:", err.message);
      res.status(500).json({ error: "Failed to compute player stats", code: "PLAYER_STATS_ERROR" });
    }
  })
);

// GET /retried-match/:matchId : Get retried match data
app.get("/retried-match/:matchId", (req, res) => {
  const match = retriedMatchesCache.get(req.params.matchId);
  if (match) {
    retriedMatchesCache.delete(req.params.matchId);
    res.json({ match });
  } else {
    res
      .status(404)
      .json({ match: null, error: "Match not found", code: "NOT_FOUND" });
  }
});

// GET /ping - ping the server
app.get("/ping", (req, res) => {
  res.json({ message: "Pong!" });
});

// GET /health - health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ 
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// GET /ready - readiness check endpoint
app.get("/ready", (req, res) => {
  // Check if server is ready to accept traffic
  // In production, you might want to check API key availability, database connections, etc.
  const isReady = process.env.API_KEY || process.env.NODE_ENV === 'dev';
  
  if (isReady) {
    res.status(200).json({ 
      status: "ready",
      timestamp: new Date().toISOString()
    });
  } else {
    res.status(503).json({ 
      status: "not ready",
      reason: "API key not configured",
      timestamp: new Date().toISOString()
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.stack);
  // Ensure CORS headers are set even on errors
  const origin = req.headers.origin;
  if (origin && (
    ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:5174'].includes(origin) ||
    origin.match(/^https:\/\/.*\.onrender\.com$/)
  )) {
    res.header("Access-Control-Allow-Origin", origin);
  } else {
    res.header("Access-Control-Allow-Origin", "*");
  }
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Credentials", "true");
  if (!res.headersSent) {
    res
      .status(500)
      .json({ error: "An unexpected error occurred.", code: "INTERNAL_ERROR" });
  }
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("Shutting down server...");
  process.exit();
});

// Start the server when executed directly
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
}

// Export app for testing
module.exports = app;
