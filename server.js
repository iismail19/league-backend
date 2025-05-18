const express = require("express");
const axios = require("axios");
const cors = require("cors");
const NodeCache = require("node-cache");
const compression = require("compression");
const Bottleneck = require("bottleneck");
require("dotenv").config();

// Log API key for debugging
console.log("Loaded API Key:", process.env.API_KEY);

// Apply custom retry logic using axios interceptors since axios-retry did not work
axios.interceptors.response.use(null, async (error) => {
  const { config } = error;
  if (!config || !config.retry) return Promise.reject(error);

  config.retryCount = config.retryCount || 0;
  if (config.retryCount >= config.retry) return Promise.reject(error);

  config.retryCount += 1;
  console.log(`Retrying request... Attempt ${config.retryCount}`);
  await new Promise((resolve) =>
    setTimeout(resolve, config.retryDelay || 1000)
  );
  return axios(config);
});

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors()); // Solve CORS issues
app.use(compression()); // Compress responses for better performance

const PORT = process.env.PORT || 5005;

const BASE_URL = "https://americas.api.riotgames.com";
const MATCH_LIST_URL = "/lol/match/v5/matches/by-puuid/";
const MATCH_URL = "/lol/match/v5/matches/";
const GET_ACCOUNT_BY_SUMMONER_NAME = "/riot/account/v1/accounts/by-riot-id/";
const API_KEY = `api_key=${process.env.API_KEY}`;

const cache = new NodeCache({ stdTTL: 600 }); // Cache for 10 minutes

const limiter = new Bottleneck({
  maxConcurrent: 15, // Allow up to 15 concurrent requests
  minTime: 67, // At least 67ms between requests (15 per second)
});

const limitedRequest = (fn) => limiter.schedule(fn); // Wrap axios requests with Bottleneck

// Helper functions for constructing URLs
const getByRiotIdURL = ({ gameName, tagline }) =>
  `${BASE_URL}${GET_ACCOUNT_BY_SUMMONER_NAME}${encodeURIComponent(
    gameName
  )}/${tagline}?${API_KEY}`;

const getMatchesURL = (puuid, start = 0, count = 20) =>
  `${BASE_URL}${MATCH_LIST_URL}${puuid}/ids?start=${start}&count=${count}&${API_KEY}`;

const getMatchDataURL = (matchId) =>
  `${BASE_URL}${MATCH_URL}${matchId}?${API_KEY}`;

// Asynchronous middleware to handle repetitive async logic
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Get user PUUID by gameName and tagLine
const retriedMatchesCache = new Map();

app.post(
  "/",
  asyncHandler(async (req, res) => {
    const cacheKey = `puuid-${req.body.gameName}-${req.body.tagline}`;
    let puuidData = cache.get(cacheKey);

    // Reset retried matches cache for a new search
    retriedMatchesCache.clear();

    if (puuidData) {
      console.log(`Cache hit for PUUID data: ${cacheKey}`);
    } else {
      console.log(`Cache miss for PUUID data: ${cacheKey}`);
      const url = getByRiotIdURL(req.body);
      const response = await limitedRequest(
        () => axios.get(url, { retry: 3, retryDelay: 1000 }) // Custom retry logic
      );
      puuidData = response.data;
      cache.set(cacheKey, puuidData);
    }

    const matchesCacheKey = `matches-${puuidData.puuid}`;
    let matchDataList = cache.get(matchesCacheKey);

    if (matchDataList) {
      console.log(`Cache hit for match data: ${matchesCacheKey}`);
      // Always respond with the same structure
      res.json({
        puuid: puuidData.puuid,
        matchDataList,
        failedMatches: [], // No failed matches when serving from cache
      });
      return; // Prevent further execution
    } else {
      console.log(`Cache miss for match data: ${matchesCacheKey}`);
      const matchesURL = getMatchesURL(puuidData.puuid);
      const listOfMatches = await limitedRequest(
        () => axios.get(matchesURL, { retry: 3, retryDelay: 1000 }) // Custom retry logic
      );

      const matchCache = new Map();

      const failedMatches = [];
      matchDataList = await Promise.all(
        listOfMatches.data.map(async (matchId) => {
          try {
            return await limitedRequest(async () => {
              if (matchCache.has(matchId)) {
                console.log(`Cache hit for individual match data: ${matchId}`);
                return matchCache.get(matchId);
              }
              console.log(`Cache miss for individual match data: ${matchId}`);
              const matchDataURL = getMatchDataURL(matchId);
              console.log("Request URL:", matchDataURL);
              const matchData = await axios.get(matchDataURL, {
                retry: 3,
                retryDelay: 1000,
              }); // Custom retry logic
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

      // Filter out nulls (failed matches)
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
          }, 15000 * idx); // Stagger retries by 15 seconds per match
        });
      }

      res.json({
        puuid: puuidData.puuid,
        matchDataList: successfulMatches,
        failedMatches,
      });
    }
  })
);

// Request for match list
app.post(
  "/matches",
  asyncHandler(async (req, res) => {
    const url = getMatchesURL(req.body.puuid);
    const response = await limitedRequest(
      () => axios.get(url, { retry: 3, retryDelay: 1000 }) // Custom retry logic
    );
    res.json(response.data);
  })
);

// Endpoint for frontend to fetch retried match data
app.get("/retried-match/:matchId", (req, res) => {
  const match = retriedMatchesCache.get(req.params.matchId);
  if (match) {
    retriedMatchesCache.delete(req.params.matchId); // Remove after sending
    res.json({ match });
  } else {
    res.status(404).json({ match: null });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "An unexpected error occurred." });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
