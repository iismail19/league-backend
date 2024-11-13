const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Use CORS middleware - solve cors issues blocking react from making requests to server
app.use(cors());

const PORT = process.env.PORT || 5005;

const BASE_URL = "https://americas.api.riotgames.com";
const MATCH_LIST_URL = "/lol/match/v5/matches/by-puuid/";
const GET_ACCOUNT_BY_SUMMONER_NAME = "/riot/account/v1/accounts/by-riot-id/";
const API_KEY = "api_key=RGAPI-94ca1028-1ba5-4803-9306-0ec567a98252";

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

// https://americas.api.riotgames.com/lol/match/v5/matches/by-puuid/hsyDuYWkD_BwUgbT7gh6LpTDod0HkcrnfUGMf6-skt1nT2w1OChFnnQvZzSpRHw8JWPl2xIsobFsLg/ids?start=0&count=20&api_key=RGAPI-bfc88fc3-057d-45ef-b513-a16440632a36
function getMatchesURL(body) {
  const url =
    BASE_URL + MATCH_LIST_URL + body + "/" + "ids?start=0&count=20&" + API_KEY;
  return url;
}

// Get user puuid by gameName and tagLine
app.post("/", async (req, res) => {
  try {
    console.log(req.body);
    const url = getByRiotIdURL(req.body);
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

// Request for specific match id

//
