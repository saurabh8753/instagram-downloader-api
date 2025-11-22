const express = require("express");
const fetch = require("node-fetch");
const app = express();

app.get("/", (req, res) => {
  res.send("Instagram Downloader API Running");
});

app.get("/api", async (req, res) => {
  const url = req.query.url;
  if (!url) {
    return res.json({ ok: false, error: "No URL provided" });
  }

  console.log("User Requested URL:", url);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept": "text/html",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.instagram.com/"
      }
    });

    console.log("Fetch Status:", response.status);

    if (!response.ok) {
      console.log("Instagram Fetch Failed:", response.statusText);
      return res.json({ ok: false, error: "Instagram blocked response" });
    }

    const html = await response.text();
    console.log("HTML Length:", html.length);

    // try extracting video URL
    const regex = /"video_url":"(.*?)"/;
    const match = html.match(regex);

    if (match) {
      const video_url = match[1].replace(/\\u0026/g, "&");
      console.log("Extracted Video URL:", video_url);
      return res.json({ ok: true, url: video_url });
    }

    console.log("Regex failed: Could not extract");
    return res.json({ ok: false, error: "Failed to extract video" });

  } catch (err) {
    console.log("EXCEPTION ERROR:", err.message);
    return res.json({ ok: false, error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Server running on port", PORT));
