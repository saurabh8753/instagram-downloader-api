import fetch from "node-fetch";

export async function fetchHTML(url) {
  return fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "text/html"
    }
  }).then(res => res.text());
}
