// CONSTANTS for Riot API
const BASE_URL = "https://americas.api.riotgames.com/";
const GET_ACCOUNT_BY_SUMMONER_NAME = "/riot/account/v1/accounts/by-riot-id/";
const API_KEY = "api_key=RGAPI-bfc88fc3-057d-45ef-b513-a16440632a36";

export function getByRiotIdURL(body) {
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
