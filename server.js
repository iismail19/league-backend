const express = require("express");
const axios = require("axios");
const cors = require("cors");
const NodeCache = require("node-cache");
const compression = require("compression");
const Bottleneck = require("bottleneck");
const helmet = require("helmet");
require("dotenv").config();

// Validate environment variables
if (!process.env.API_KEY) {
  console.error("❌ API_KEY is missing from environment variables.");
  process.exit(1);
}

const PORT = process.env.PORT || 5005;
const BASE_URL = "https://americas.api.riotgames.com";
const MATCH_LIST_URL = "/lol/match/v5/matches/by-puuid/";
const MATCH_URL = "/lol/match/v5/matches/";
const GET_ACCOUNT_BY_SUMMONER_NAME = "/riot/account/v1/accounts/by-riot-id/";
const API_KEY = `api_key=${process.env.API_KEY}`;

console.info("✅ Loaded API Key.");

// Setup cache and rate limiter
const cache = new NodeCache({ stdTTL: 600 }); // 10 minutes
const limiter = new Bottleneck({
  maxConcurrent: 20,
  minTime: 50,
});
const limitedRequest = (fn) => limiter.schedule(fn);

// Helper: async error handler
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Helper: build URLs
const getByRiotIdURL = ({ gameName, tagline }) =>
  `${BASE_URL}${GET_ACCOUNT_BY_SUMMONER_NAME}${encodeURIComponent(
    gameName
  )}/${tagline}?${API_KEY}`;

const getMatchesURL = (puuid, start = 0, count = 20) =>
  `${BASE_URL}${MATCH_LIST_URL}${puuid}/ids?start=${start}&count=${count}&${API_KEY}`;

const getMatchDataURL = (matchId) =>
  `${BASE_URL}${MATCH_URL}${matchId}?${API_KEY}`;

// Axios retry logic
axios.interceptors.response.use(null, async (error) => {
  const { config, response } = error;
  if (!config || !config.retry) return Promise.reject(error);

  config.retryCount = config.retryCount || 0;
  if (config.retryCount >= config.retry) return Promise.reject(error);

  config.retryCount += 1;

  if (response && response.status === 403) {
    console.error(
      `403 Forbidden for URL: ${config.url} (Attempt ${config.retryCount})`
    );
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
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(compression());
app.use(helmet()); // Security headers

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
      return res.json({
        puuid: puuidData.puuid,
        matchDataList,
        failedMatches: [],
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

    res.json({
      puuid: puuidData.puuid,
      matchDataList: successfulMatches,
      failedMatches,
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

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.stack);
  res
    .status(500)
    .json({ error: "An unexpected error occurred.", code: "INTERNAL_ERROR" });
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("Shutting down server...");
  process.exit();
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
