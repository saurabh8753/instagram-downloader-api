const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");

const app = express();
app.use(cors());

app.get("/", (req, res) => {
  res.send("Instagram API Running");
});

// ========== EXTRACT API ==========
app.get("/api", async (req, res) => {
  const link = req.query.url;

  if (!link) return res.json({ ok: false, error: "url missing" });

  try {
    const html = await fetch(link, {
      headers: { "User-Agent": "Mozilla/5.0" }
    }).then(r => r.text());

    const clean = (s) =>
      s.replace(/\\u0026/g, "&").replace(/\\\//g, "/");

    const video = html.match(/"video_url":"([^"]+)"/);
    const image = html.match(/"display_url":"([^"]+)"/);

    if (video) {
      return res.json({
        ok: true,
        type: "video",
        items: [
          {
            is_video: true,
            thumbnail: image ? clean(image[1]) : null,
            srcs: [{ url: clean(video[1]), label: "HD" }]
          }
        ]
      });
    }

    if (image) {
      return res.json({
        ok: true,
        type: "image",
        items: [
          {
            is_video: false,
            thumbnail: clean(image[1]),
            srcs: [{ url: clean(image[1]), label: "image" }]
          }
        ]
      });
    }

    res.json({ ok: false, error: "failed to extract" });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ========== PROXY ==========
app.get("/proxy", async (req, res) => {
  const video = req.query.url;
  if (!video) return res.json({ ok: false, error: "proxy url missing" });

  try {
    const response = await fetch(video, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=instagram.mp4"
    );

    response.body.pipe(res);
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

app.listen(3000, () => console.log("Server running on port 3000"));
