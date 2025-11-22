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

    const html = await response.text();
    console.log("HTML Length:", html.length);

    // ========== FALLBACK 1 | playbackUrl ==========
    let match =
      html.match(/"playbackUrl":"(.*?)"/) ||
      html.match(/"video_versions":\[\{"url":"(.*?)"/);

    // ========== FALLBACK 2 | fallback_url ==========
    if (!match) match = html.match(/"fallback_url":"(.*?)"/);

    // ========== FALLBACK 3 | src":" ==========
    if (!match) match = html.match(/"src":"(.*?\.mp4)"/);

    if (match) {
      const video_url = match[1].replace(/\\u0026/g, "&");
      console.log("Extracted:", video_url);
      return res.json({ ok: true, url: video_url });
    }

    console.log("❌ All Regex Failed");
    return res.json({ ok: false, error: "Cannot extract. IG format changed." });

  } catch (err) {
    console.log("EXCEPTION ERROR:", err.message);
    return res.json({ ok: false, error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Server running on port", PORT));
