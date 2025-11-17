import { fetchHTML } from "./_helpers.js";

export default async function handler(req, res) {
  try {
    const url = req.query.url;
    if (!url) return res.json({ ok: false, error: "url missing" });

    const html = await fetchHTML(url);

    const m = html.match(/"video_url":"([^"]+)"/);

    if (!m) return res.json({ ok: false, error: "Could not parse video" });

    return res.json({
      ok: true,
      type: "video",
      items: [
        {
          is_video: true,
          thumbnail: null,
          srcs: [{ url: m[1], label: "video" }]
        }
      ]
    });

  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
              }
