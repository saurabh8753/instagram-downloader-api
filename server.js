// server.js
// Instagram extractor using sessionid cookie (server-side only)
// Node 18 + node-fetch v2 compatible

const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");

const app = express();
app.use(cors());

// Read sessionid from env
const SESSIONID = process.env.INSTAGRAM_SESSIONID || process.env.SESSIONID;
if (!SESSIONID) {
  console.warn("WARNING: INSTAGRAM_SESSIONID not set. Set env var before production.");
}

// Helpers
function cleanStr(s) {
  if (!s) return s;
  return s.replace(/\\u0026/g, "&").replace(/\\\//g, "/");
}
function safeJSONParse(s) {
  try { return JSON.parse(s); }
  catch (e) {
    const first = s.indexOf("{");
    const last = s.lastIndexOf("}");
    if (first !== -1 && last !== -1) {
      try { return JSON.parse(s.slice(first, last + 1)); }
      catch (e2) { return null; }
    }
    return null;
  }
}

// Try common places in a media object for video URLs
function tryGetVideoFromMediaObj(media) {
  if (!media) return null;
  const candidates = [];

  // arrays
  if (Array.isArray(media.video_versions)) {
    media.video_versions.forEach(v => {
      if (v.url) candidates.push({ url: cleanStr(v.url), label: `${v.width||'sd'}x${v.height||''}` });
    });
  }

  // common single fields
  const keys = ['playback_url','playbackUrl','playable_url','video_url','fallback_url','contentUrl','secure_url','src','file_url','video_url_hd'];
  for (const k of keys) {
    if (media[k]) candidates.push({ url: cleanStr(media[k]), label: 'auto' });
  }

  // ld+json style
  if (media.contentUrl) candidates.push({ url: cleanStr(media.contentUrl), label: 'auto' });

  // edge sidecar (carousel)
  if (media.edge_sidecar_to_children && Array.isArray(media.edge_sidecar_to_children.edges)) {
    media.edge_sidecar_to_children.edges.forEach(edge => {
      const node = edge.node || edge;
      const res = tryGetVideoFromMediaObj(node);
      if (res) candidates.push(...res);
    });
  }

  // image_versions2 candidates sometimes hold urls
  if (media.image_versions2 && Array.isArray(media.image_versions2.candidates)) {
    media.image_versions2.candidates.forEach(c => {
      if (c.url) candidates.push({ url: cleanStr(c.url), label: 'thumb' });
    });
  }

  // dedupe & filter
  const uniq = [];
  for (const c of candidates) {
    if (!c || !c.url) continue;
    if (!uniq.find(u => u.url === c.url)) uniq.push(c);
  }
  return uniq.length ? uniq : null;
}

// Fetch helper uses session cookie when available
async function fetchTextWithSession(url) {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.instagram.com/"
  };
  if (SESSIONID) {
    headers["Cookie"] = `sessionid=${SESSIONID};`;
  }
  const r = await fetch(url, { headers });
  const text = await r.text();
  return { status: r.status, headers: r.headers, text };
}

// Main extract API
app.get("/api", async (req, res) => {
  const rawUrl = req.query.url;
  if (!rawUrl) return res.json({ ok: false, error: "url missing" });

  // clean url (strip query tracking)
  const base = rawUrl.split("?")[0];
  console.log("REQUEST:", base);

  try {
    // Try list of candidate endpoints
    const candidates = [
      base + "?__a=1&__d=dis",
      base + "?__a=1",
      base,
      base.replace("www.instagram.com", "i.instagram.com"),
      base.replace("www.instagram.com", "m.instagram.com")
    ];

    for (const u of candidates) {
      try {
        console.log("Fetching:", u);
        const { status, text } = await fetchTextWithSession(u);
        console.log("Status:", status, "Length:", text?.length || 0);

        // Try direct JSON parse
        let j = null;
        try { j = JSON.parse(text); } catch(e) { j = null; }

        if (j) {
          // find media in known shapes
          let media = null;
          if (Array.isArray(j.items) && j.items.length) media = j.items[0];
          if (!media && j.graphql?.shortcode_media) media = j.graphql.shortcode_media;
          if (!media && j.data) media = Array.isArray(j.data) ? j.data[0] : j.data;
          if (!media && j.media) media = j.media;
          if (!media) {
            // deep search for an object that looks like media
            function findMedia(o) {
              if (!o || typeof o !== "object") return null;
              if (o.video_versions || o.video_url || o.display_url || o.image_versions2) return o;
              for (const k in o) {
                try {
                  const f = findMedia(o[k]);
                  if (f) return f;
                } catch(_) {}
              }
              return null;
            }
            media = findMedia(j);
          }

          if (media) {
            const srcs = tryGetVideoFromMediaObj(media);
            if (srcs) {
              console.log("Media found via JSON at", u);
              return res.json({
                ok: true,
                type: srcs.length>1 ? "carousel" : "video",
                items: [{
                  is_video: !!(media.is_video || media.video_versions || media.video_url),
                  thumbnail: media.display_url || media.image_versions2?.candidates?.[0]?.url || null,
                  srcs
                }]
              });
            }
          }
        }

        // parse HTML fallback
        const html = text || "";
        // 1) __NEXT_DATA__ or script id="__NEXT_DATA__"
        const nextMatch = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
        if (nextMatch && nextMatch[1]) {
          const parsed = safeJSONParse(nextMatch[1]);
          if (parsed) {
            console.log("__NEXT_DATA__ parsed");
            // deep-search media
            function find(o) {
              if (!o || typeof o !== "object") return null;
              if (o.shortcode_media || o.video_versions || o.video_url || o.image_versions2) return o;
              for (const k in o) {
                try {
                  const f = find(o[k]);
                  if (f) return f;
                } catch(_) {}
              }
              return null;
            }
            const media = find(parsed);
            const srcs = tryGetVideoFromMediaObj(media);
            if (srcs) {
              return res.json({ ok: true, type:"video", items:[{ is_video:true, thumbnail: media?.display_url||null, srcs }]});
            }
          }
        }

        // 2) window.__additionalDataLoaded(...) pattern
        const addMatch = html.match(/window\.__additionalDataLoaded\((["']?).*?,(.*)\)\s*;/s);
        if (addMatch && addMatch[2]) {
          let raw = addMatch[2].trim();
          if (raw.endsWith(")")) raw = raw.slice(0, -1);
          const parsed = safeJSONParse(raw);
          if (parsed) {
            console.log("__additionalDataLoaded parsed");
            const media = parsed?.graphql?.shortcode_media || parsed?.item || parsed;
            const srcs = tryGetVideoFromMediaObj(media);
            if (srcs) {
              return res.json({ ok:true, type: media?.edge_sidecar_to_children ? "carousel":"video", items:[{ is_video:true, thumbnail: media?.display_url||null, srcs }]});
            }
          }
        }

        // 3) window._sharedData pattern
        const sharedMatch = html.match(/window\._sharedData\s*=\s*(\{[\s\S]*?\});/);
        if (sharedMatch && sharedMatch[1]) {
          const parsed = safeJSONParse(sharedMatch[1]);
          if (parsed) {
            console.log("_sharedData parsed");
            const media = parsed?.entry_data?.PostPage?.[0]?.graphql?.shortcode_media || parsed?.entry_data?.ProfilePage?.[0]?.graphql?.user?.edge_owner_to_timeline_media?.edges?.[0]?.node;
            const srcs = tryGetVideoFromMediaObj(media);
            if (srcs) return res.json({ ok:true, type:"video", items:[{ is_video:true, thumbnail: media?.display_url||null, srcs }]});
          }
        }

        // 4) application/ld+json
        const ldMatches = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/ig)];
        for (const m of ldMatches) {
          const parsed = safeJSONParse(m[1]);
          if (parsed) {
            const urlCandidates = [];
            if (parsed.contentUrl) urlCandidates.push(parsed.contentUrl);
            if (parsed.video && parsed.video.contentUrl) urlCandidates.push(parsed.video.contentUrl);
            if (urlCandidates.length) {
              const srcs = urlCandidates.filter(Boolean).map(u=>({url:cleanStr(u), label:"auto"}));
              return res.json({ ok:true, type:"video", items:[{ is_video:true, thumbnail: parsed.thumbnailUrl||null, srcs }]});
            }
          }
        }

        // 5) generic regex fallbacks (many keys)
        const regexes = [
          /"playbackUrl":"(.*?)"/g,
          /"playable_url":"(.*?)"/g,
          /"video_url":"(.*?)"/g,
          /"fallback_url":"(.*?)"/g,
          /"src":"(.*?\.mp4.*?)"/g,
          /"contentUrl":"(.*?)"/g,
          /"secure_url":"(.*?)"/g
        ];
        let found = null;
        for (const rx of regexes) {
          const m = rx.exec(html);
          if (m && m[1]) {
            found = cleanStr(m[1]);
            console.log("Regex matched:", rx.toString());
            break;
          }
        }
        if (found) {
          return res.json({ ok:true, type:"video", items:[{ is_video:true, thumbnail:null, srcs:[{url:found,label:"auto"}]}]});
        }

        // continue to next candidate URL
      } catch (e) {
        console.log("Fetch attempt error:", e.message);
      }
    } // end for candidates

    console.log("All extract attempts failed for:", base);
    return res.json({ ok:false, error:"failed all extract methods" });

  } catch (err) {
    console.log("UNCAUGHT ERROR:", err && err.message ? err.message : err);
    return res.json({ ok:false, error: err && err.message ? err.message : String(err) });
  }
});

// Proxy (download) route
app.get("/proxy", async (req, res) => {
  const video = req.query.url;
  if (!video) return res.json({ ok:false, error:"proxy url missing" });
  try {
    const headers = {
      "User-Agent":"Mozilla/5.0",
      "Referer":"https://www.instagram.com/"
    };
    if (SESSIONID) headers["Cookie"] = `sessionid=${SESSIONID};`;
    const r = await fetch(video, { headers });
    res.setHeader("Content-Type", r.headers.get("content-type") || "application/octet-stream");
    res.setHeader("Content-Disposition", "attachment; filename=instagram.mp4");
    r.body.pipe(res);
  } catch (e) {
    console.log("proxy error:", e.message);
    return res.json({ ok:false, error: e.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, ()=>console.log("Server running on port", PORT));
