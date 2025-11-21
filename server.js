// =========================
//  INSTAGRAM API (2025 FIX)
// =========================

const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");

const app = express();
app.use(cors());

// Home route (test)
app.get("/", (req, res) => {
  res.send("Instagram Downloader API Running ✔");
});

// ===============================
//     LATEST INSTAGRAM API (2025)
// ===============================
app.get("/api", async (req, res) => {
  let ig = req.query.url;
  if (!ig) return res.json({ ok: false, error: "url missing" });

  try {
    // Remove tracking params and force JSON API
    const cleanUrl = ig.split("?")[0] + "?__a=1&__d=dis";

    // Fetch API JSON
    const json = await fetch(cleanUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json"
      }
    }).then(r => r.json()).catch(() => null);

    if (!json || !json.items || !json.items[0]) {
      return res.json({ ok: false, error: "failed to extract" });
    }

    const media = json.items[0];

    // =============== VIDEO ===============
    if (media.video_versions && media.video_versions.length > 0) {
      return res.json({
        ok: true,
        type: "video",
        items: [
          {
            is_video: true,
            thumbnail:
              media.image_versions2?.candidates?.[0]?.url || null,
            srcs: media.video_versions.map(v => ({
              url: v.url,
              label: `${v.width}x${v.height}`
            }))
          }
        ]
      });
    }

    // =============== CAROUSEL (multiple) ===============
    if (media.carousel_media) {
      return res.json({
        ok: true,
        type: "carousel",
        items: media.carousel_media.map(item => {
          if (item.video_versions) {
            return {
              is_video: true,
              thumbnail:
                item.image_versions2?.candidates?.[0]?.url || null,
              srcs: item.video_versions.map(v => ({
                url: v.url,
                label: `${v.width}x${v.height}`
              }))
            };
          } else {
            return {
              is_video: false,
              thumbnail:
                item.image_versions2?.candidates?.[0]?.url || null,
              srcs: [
                {
                  url: item.image_versions2?.candidates?.[0]?.url,
                  label: "image"
                }
              ]
            };
          }
        })
      });
    }

    // =============== IMAGE ===============
    if (media.image_versions2?.candidates?.[0]?.url) {
      return res.json({
        ok: true,
        type: "image",
        items: [
          {
            is_video: false,
            thumbnail: media.image_versions2.candidates[0].url,
            srcs: [
              {
                url: media.image_versions2.candidates[0].url,
                label: "image"
              }
            ]
          }
        ]
      });
    }

    return res.json({
      ok: false,
      error: "media not found"
    });

  } catch (err) {
    return res.json({ ok: false, error: err.message });
  }
});

// ===============================
//        PROXY DOWNLOAD
// ===============================
app.get("/proxy", async (req, res) => {
  const video = req.query.url;
  if (!video) return res.json({ ok: false, error: "proxy url missing" });

  try {
    const response = await fetch(video, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    res.setHeader("Content-Type", response.headers.get("content-type") || "video/mp4");
    res.setHeader("Content-Disposition", "attachment; filename=download.mp4");

    response.body.pipe(res);
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ============================
// START SERVER (Render ready)
// ============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port", PORT));
