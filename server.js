const express = require("express");
const fetch = require("node-fetch");
const app = express();

app.get("/", (req, res) => {
  res.send("Instagram API Running ✔️");
});

app.get("/api", async (req, res) => {
  try {
    const ig = req.query.url;
    if (!ig) return res.json({ ok: false, error: "No URL provided" });

    console.log("User Requested:", ig);

    const html = await fetch(ig, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept": "text/html",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.instagram.com"
      }
    }).then(r => r.text());

    console.log("HTML Length:", html.length);

    // 1) Extract window.__additionalDataLoaded JSON
    let jsonMatch = html.match(
      /window\.__additionalDataLoaded\((.*?)\);/
    );

    if (jsonMatch) {
      let raw = jsonMatch[1]
        .split(",")        // ["\"/reel/...\"", "{...json...}"]
        .slice(1)          // keep only json
        .join(",")         
        .trim();

      if (raw.endsWith(")")) raw = raw.slice(0, -1);

      let json = JSON.parse(raw);
      let video = json?.graphql?.shortcode_media?.video_url;

      if (video) {
        console.log("Extracted video:", video);
        return res.json({ ok: true, url: video });
      }
    }

    // 2) OLD fallback
    const fallback = html.match(/"video_url":"(.*?)"/);
    if (fallback) {
      const url = fallback[1].replace(/\\u0026/g, "&");
      return res.json({ ok: true, url });
    }

    console.log("❌ Failed all extract methods.");
    return res.json({ ok: false, error: "Failed to extract video." });

  } catch (err) {
    console.log("ERROR:", err.message);
    return res.json({ ok: false, error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Server running on", PORT));
