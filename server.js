const express = require("express");
const axios = require("axios");
const cors = require("cors");
require("dotenv").config();

// get values from env
console.log(process.env.API_KEY);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Use CORS middleware - solve cors issues blocking react from making requests to server
app.use(cors());

const PORT = process.env.PORT || 5005;

const BASE_URL = "https://americas.api.riotgames.com";
const MATCH_LIST_URL = "/lol/match/v5/matches/by-puuid/";
const MATCH_URL = "/lol/match/v5/matches/";
const GET_ACCOUNT_BY_SUMMONER_NAME = "/riot/account/v1/accounts/by-riot-id/";
const API_KEY = "api_key=" + process.env.API_KEY;

function getByRiotIdURL(body) {
  const urlFriendlyGameName = encodeURIComponent(body.gameName);
  const tagline = body.tagline;
  const url =
    BASE_URL +
    GET_ACCOUNT_BY_SUMMONER_NAME +
    urlFriendlyGameName +
    "/" +
    tagline +
    "?" +
    API_KEY;
  return url;
}

function getMatchesURL(body) {
  const url =
    BASE_URL + MATCH_LIST_URL + body + "/" + "ids?start=0&count=20&" + API_KEY;
  return url;
}

//https://americas.api.riotgames.com/lol/match/v5/matches/NA1_5180785472?api_key=
function getMatchDataURL(matchId) {
  const url = BASE_URL + MATCH_URL + matchId + "?" + API_KEY;
  return url;
}

// Get user puuid by gameName and tagLine
app.post("/", async (req, res) => {
  try {
    // console.log(req.body);
    // get puuid
    const url = getByRiotIdURL(req.body);
    const response = await axios.get(url);
    console.log(response.data);

    //get matches
    const matchesURL = getMatchesURL(response.data.puuid);
    const listOfMatches = await axios.get(matchesURL);
    console.log(listOfMatches.data);

    // get data for each mathch add add that to a map with match_id and retreived data
    // todo remove
    let matchDataList = [];
    for (let i = 0; i < listOfMatches.data.length; i++) {
      const matchId = listOfMatches.data[i];
      const matchDataURL = getMatchDataURL(matchId);
      const matchData = await axios.get(matchDataURL);
      console.log(matchData.data);
      matchDataList.push(matchData.data);
    }

    const matchResponse = {
      puuid: response.data.puuid,
      matchDataList: matchDataList,
    };

    res.json(matchResponse); // Send the response to the client
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error:
        "Error fetching puuid by gameName and tagLine via by-riot-id api call",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

// Request for match list

app.post("/matches", async (req, res) => {
  try {
    console.log(req.body.puuid);
    const url = getMatchesURL(req.body.puuid);
    const response = await axios.get(url);
    console.log(response.data); // Print to the console
    res.json(response.data); // Send the response to the client
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error:
        "Error fetching puuid by gameName and tagLine via by-riot-id api call",
    });
  }
});

// Get all matches from a single request
