import fetch from "node-fetch";

export default async function handler(req, res) {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).send("URL missing");

    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    res.setHeader("Content-Type", response.headers.get("content-type"));
    response.body.pipe(res);

  } catch (err) {
    res.send("Proxy error: " + err.message);
  }
}
