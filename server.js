const express = require("express");
const axios = require("axios");
const cors = require("cors");
require("dotenv").config();

// Log API key for debugging
console.log(process.env.API_KEY);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors()); // Solve CORS issues

const PORT = process.env.PORT || 5005;

const BASE_URL = "https://americas.api.riotgames.com";
const MATCH_LIST_URL = "/lol/match/v5/matches/by-puuid/";
const MATCH_URL = "/lol/match/v5/matches/";
const GET_ACCOUNT_BY_SUMMONER_NAME = "/riot/account/v1/accounts/by-riot-id/";
const API_KEY = `api_key=${process.env.API_KEY}`;

// Helper functions for constructing URLs
const getByRiotIdURL = ({ gameName, tagline }) =>
  `${BASE_URL}${GET_ACCOUNT_BY_SUMMONER_NAME}${encodeURIComponent(
    gameName
  )}/${tagline}?${API_KEY}`;

const getMatchesURL = (puuid) =>
  `${BASE_URL}${MATCH_LIST_URL}${puuid}/ids?start=0&count=20&${API_KEY}`;

const getMatchDataURL = (matchId) =>
  `${BASE_URL}${MATCH_URL}${matchId}?${API_KEY}`;

// Get user PUUID by gameName and tagLine
app.post("/", async (req, res) => {
  try {
    const url = getByRiotIdURL(req.body);
    const response = await axios.get(url);

    const matchesURL = getMatchesURL(response.data.puuid);
    const listOfMatches = await axios.get(matchesURL);

    const matchDataList = await Promise.all(
      listOfMatches.data.map(async (matchId) => {
        const matchDataURL = getMatchDataURL(matchId);
        const matchData = await axios.get(matchDataURL);
        return matchData.data;
      })
    );

    res.json({
      puuid: response.data.puuid,
      matchDataList,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Error fetching data via Riot API",
    });
  }
});

// Request for match list
app.post("/matches", async (req, res) => {
  try {
    const url = getMatchesURL(req.body.puuid);
    const response = await axios.get(url);
    res.json(response.data);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Error fetching match list via Riot API",
    });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
