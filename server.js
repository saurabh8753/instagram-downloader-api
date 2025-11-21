// ===============================
//   INSTAGRAM DOWNLOADER API 2025
//   Full Extractor + Fallback + Proxy
// ===============================

const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");

const app = express();
app.use(cors());

app.get("/", (req, res) => {
  res.send("Instagram Downloader API Running ✔ (2025 Updated)");
});

// Clean helper
const clean = (s) =>
  s.replace(/\\u0026/g, "&").replace(/\\\//g, "/");

// ===============================
//       MAIN EXTRACTOR API
// ===============================
app.get("/api", async (req, res) => {
  let ig = req.query.url;
  if (!ig) return res.json({ ok: false, error: "url missing" });

  try {
    const base = ig.split("?")[0];

    // -----------------------------------------------------
    // STEP 1: Try Instagram JSON API (new format 2025)
    // -----------------------------------------------------
    const jsonUrl = base + "?__a=1&__d=dis";

    let json = null;
    try {
      json = await fetch(jsonUrl, {
        headers: { "User-Agent": "Mozilla/5.0" }
      }).then((r) => r.json());
    } catch {}

    // JSON available?
    if (json?.items?.[0]) {
      const media = json.items[0];

      // VIDEO
      if (media.video_versions) {
        return res.json({
          ok: true,
          type: "video",
          items: [
            {
              is_video: true,
              thumbnail: media.image_versions2?.candidates?.[0]?.url,
              srcs: media.video_versions.map((v) => ({
                url: v.url,
                label: `${v.width}x${v.height}`,
              })),
            },
          ],
        });
      }

      // CAROUSEL
      if (media.carousel_media) {
        return res.json({
          ok: true,
          type: "carousel",
          items: media.carousel_media.map((item) => {
            if (item.video_versions) {
              return {
                is_video: true,
                thumbnail: item.image_versions2?.candidates?.[0]?.url,
                srcs: item.video_versions.map((v) => ({
                  url: v.url,
                  label: `${v.width}x${v.height}`,
                })),
              };
            } else {
              return {
                is_video: false,
                thumbnail: item.image_versions2?.candidates?.[0]?.url,
                srcs: [
                  {
                    url: item.image_versions2?.candidates?.[0]?.url,
                    label: "image",
                  },
                ],
              };
            }
          }),
        });
      }

      // IMAGE
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
                  label: "image",
                },
              ],
            },
          ],
        });
      }
    }

    // -----------------------------------------------------
    // STEP 2: Fetch the HTML
    // -----------------------------------------------------
    const html = await fetch(base, {
      headers: { "User-Agent": "Mozilla/5.0" },
    }).then((r) => r.text());

    // -----------------------------------------------------
    // STEP 3: Extract from embedded JSON (__additionalData)
    // -----------------------------------------------------
    const embedded = html.match(/window\.__additionalDataLoaded\('extra',(.*?)\);<\/script>/);

    if (embedded) {
      try {
        const data = JSON.parse(embedded[1]);

        const media = data?.graphql?.shortcode_media;

        if (media?.video_url) {
          return res.json({
            ok: true,
            type: "video",
            items: [
              {
                is_video: true,
                thumbnail: media.display_url,
                srcs: [
                  {
                    url: media.video_url,
                    label: "HD",
                  },
                ],
              },
            ],
          });
        }

        if (media?.display_url) {
          return res.json({
            ok: true,
            type: "image",
            items: [
              {
                is_video: false,
                thumbnail: media.display_url,
                srcs: [{ url: media.display_url, label: "image" }],
              },
            ],
          });
        }
      } catch {}
    }

    // -----------------------------------------------------
    // STEP 4: FINAL FALLBACK – Regex extract
    // -----------------------------------------------------
    const videoMatch = html.match(/"video_url":"([^"]+)"/);
    const imageMatch = html.match(/"display_url":"([^"]+)"/);

    if (videoMatch) {
      return res.json({
        ok: true,
        type: "video",
        items: [
          {
            is_video: true,
            thumbnail: imageMatch ? clean(imageMatch[1]) : null,
            srcs: [
              {
                url: clean(videoMatch[1]),
                label: "HD",
              },
            ],
          },
        ],
      });
    }

    // -----------------------------------------------------
    // NO MEDIA FOUND
    // -----------------------------------------------------
    return res.json({ ok: false, error: "failed to extract" });
  } catch (err) {
    return res.json({ ok: false, error: err.message });
  }
});

// ===============================
//          PROXY DOWNLOAD
// ===============================
app.get("/proxy", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.json({ ok: false, error: "proxy url missing" });

  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    res.setHeader(
      "Content-Type",
      r.headers.get("content-type") || "video/mp4"
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=instagram.mp4"
    );

    r.body.pipe(res);
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ===============================
//     SERVER (Render compatible)
// ===============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log("Server running on port", PORT)
);
