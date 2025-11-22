// Robust Instagram extractor (lots of fallbacks) - Node 18 ready
const express = require("express");
const fetch = require("node-fetch");
const app = express();

app.get("/", (req, res) => res.send("Instagram Extractor Running"));

function cleanStr(s) {
  if (!s) return s;
  return s.replace(/\\u0026/g, "&").replace(/\\\//g, "/");
}

function tryGetVideoFromMediaObj(media) {
  if (!media) return null;
  // known places
  const candidates = [];

  // video_versions array
  if (Array.isArray(media.video_versions)) {
    media.video_versions.forEach(v => {
      if (v.url) candidates.push({ url: cleanStr(v.url), label: `${v.width || 'sd'}x${v.height || ''}`.replace('x','x') });
    });
  }

  // common single fields
  const keys = ['playback_url','playbackUrl','playable_url','video_url','fallback_url','contentUrl','secure_url','src','file_url'];
  for (const k of keys) {
    if (media[k]) candidates.push({ url: cleanStr(media[k]), label: 'HD' });
  }

  // image_versions2.candidates used for thumbnails / sometimes urls
  if (media.image_versions2 && Array.isArray(media.image_versions2.candidates)) {
    media.image_versions2.candidates.forEach(c => {
      if (c.url) candidates.push({ url: cleanStr(c.url), label: 'thumb' });
    });
  }

  // edge_sidecar_to_children edges
  if (media.edge_sidecar_to_children && Array.isArray(media.edge_sidecar_to_children.edges)) {
    media.edge_sidecar_to_children.edges.forEach(edge => {
      const node = edge.node || edge;
      const res = tryGetVideoFromMediaObj(node);
      if (res) {
        // flatten: return first child's urls if parent none
        candidates.push(...res);
      }
    });
  }

  // remove dupes & invalid
  const uniq = [];
  for (const c of candidates) {
    if (!c || !c.url) continue;
    if (!uniq.find(u => u.url === c.url)) uniq.push(c);
  }
  return uniq.length ? uniq : null;
}

async function fetchText(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": "https://www.instagram.com/"
    },
    // keep defaults for node-fetch v2
  });
  return { status: r.status, text: await r.text(), headers: r.headers };
}

function safeJSONParse(str) {
  try {
    return JSON.parse(str);
  } catch (e) {
    // try to fix common quoting issues: find first { and last }
    const first = str.indexOf('{');
    const last = str.lastIndexOf('}');
    if (first !== -1 && last !== -1) {
      try {
        return JSON.parse(str.slice(first, last + 1));
      } catch (e2) { return null; }
    }
    return null;
  }
}

app.get("/api", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.json({ ok: false, error: "url missing" });

  console.log("REQUEST URL:", url);

  try {
    // 1) Try JSON API endpoint (new)
    const base = url.split("?")[0];
    const tryUrls = [
      base + "?__a=1&__d=dis",
      base + "?__a=1",
      base,
      base.replace("www.instagram.com","i.instagram.com"),
      base.replace("www.instagram.com","m.instagram.com")
    ];

    // try each
    for (const u of tryUrls) {
      try {
        console.log("Trying fetch:", u);
        const { status, text } = await fetchText(u);
        console.log("Fetch status:", status, "Length:", text.length);
        // try parse as JSON directly
        let j = null;
        try {
          j = JSON.parse(text);
        } catch(e) { j = null; }

        // 1.a direct JSON with items
        if (j && (j.items || j.graphql || j.media || j.media || j?.data)) {
          console.log("Direct JSON found from:", u);
          // typical shapes: items[], graphql.shortcode_media, data[0], media
          let media = j.items ? j.items[0] : null;
          if (!media && j.graphql?.shortcode_media) media = j.graphql.shortcode_media;
          if (!media && j.data) {
            if (Array.isArray(j.data)) media = j.data[0];
            else media = j.data;
          }
          if (!media && j.media) media = j.media;
          const srcs = tryGetVideoFromMediaObj(media);
          if (srcs) {
            return res.json({ ok:true, type: srcs.length>1?"carousel":"video", items: [{ is_video:true, thumbnail: media?.display_url || media?.image_versions2?.candidates?.[0]?.url || null, srcs }] });
          }
        }

        // 1.b if not JSON, fallthrough and parse HTML below
        // parse HTML text for scripts / embedded JSON
        const html = text;

        // 2) Try __NEXT_DATA__ script tag
        const nextMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
        if (nextMatch && nextMatch[1]) {
          const parsed = safeJSONParse(nextMatch[1]);
          if (parsed) {
            console.log("__NEXT_DATA__ parsed");
            // Many shapes - try find shortcode_media or post
            let media = parsed?.props?.pageProps?.post || parsed?.props?.pageProps?.graphql?.shortcode_media || parsed?.props?.initialProps || null;
            if (!media) {
              // try deep search
              function findMedia(o) {
                if (!o || typeof o !== 'object') return null;
                if (o.shortcode_media || o.video_versions || o.video_url || o.image_versions2) return o;
                for (const k of Object.keys(o)) {
                  const found = findMedia(o[k]);
                  if (found) return found;
                }
                return null;
              }
              media = findMedia(parsed);
            }
            const srcs = tryGetVideoFromMediaObj(media);
            if (srcs) {
              return res.json({ ok:true, type:(media.edge_sidecar_to_children? "carousel":"video"), items:[{ is_video: !!(media.is_video||media.video_url||media.video_versions), thumbnail: media?.display_url || null, srcs }]});
            }
          }
        }

        // 3) Try application/ld+json
        const ldMatches = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/ig)];
        for (const m of ldMatches) {
          const parsed = safeJSONParse(m[1]);
          if (parsed) {
            // ld+json may have contentUrl
            const urlCandidates = [];
            if (parsed.contentUrl) urlCandidates.push(parsed.contentUrl);
            if (parsed.video && parsed.video.contentUrl) urlCandidates.push(parsed.video.contentUrl);
            if (urlCandidates.length) {
              const srcs = urlCandidates.filter(Boolean).map(u=>({url:cleanStr(u), label:"auto"}));
              return res.json({ ok:true, type:"video", items:[{ is_video:true, thumbnail: parsed.thumbnailUrl||null, srcs }]});
            }
          }
        }

        // 4) Try window.__additionalDataLoaded(...) pattern
        // pattern contains two args: path and a JSON object - we need the JSON
        const addMatch = html.match(/window\.__additionalDataLoaded\((["']?).*?,(.*)\)\s*;/s);
        if (addMatch && addMatch[2]) {
          let raw = addMatch[2].trim();
          // remove trailing ); if any
          if (raw.endsWith(")")) raw = raw.slice(0, -1);
          const parsed = safeJSONParse(raw);
          if (parsed) {
            console.log("__additionalDataLoaded parsed");
            let media = parsed?.graphql?.shortcode_media || parsed?.item || parsed;
            const srcs = tryGetVideoFromMediaObj(media);
            if (srcs) {
              return res.json({ ok:true, type: media?.carousel_media ? "carousel" : "video", items:[{ is_video:true, thumbnail: media?.display_url||null, srcs }]});
            }
          }
        }

        // 5) Try window._sharedData or window.__initialDataLoaded or window._sharedData
        const sharedMatch = html.match(/window\._sharedData\s*=\s*(\{[\s\S]*?\});/);
        if (sharedMatch && sharedMatch[1]) {
          const parsed = safeJSONParse(sharedMatch[1]);
          if (parsed) {
            console.log("window._sharedData parsed");
            const media = parsed?.entry_data?.PostPage?.[0]?.graphql?.shortcode_media || parsed?.entry_data?.ProfilePage?.[0]?.graphql?.user?.edge_owner_to_timeline_media?.edges?.[0]?.node;
            const srcs = tryGetVideoFromMediaObj(media);
            if (srcs) return res.json({ ok:true, type:"video", items:[{ is_video:true, thumbnail: media?.display_url||null, srcs }]});
          }
        }

        // 6) Generic regex fallbacks - many keys
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
            console.log("Regex matched:", rx, "->", found && found.slice(0,60)+"...");
            break;
          }
        }
        if (found) {
          return res.json({ ok:true, type:"video", items:[{ is_video:true, thumbnail:null, srcs:[{url:found,label:"auto"}]}]});
        }

        // continue to next tryUrl
      } catch (e) {
        console.log("fetch error for url", u, e.message);
      }
    } // end for tryUrls

    // If all fails, return HTML length so we know we fetched
    return res.json({ ok:false, error:"failed all extract methods" });

  } catch (err) {
    console.log("UNCAUGHT ERROR:", err);
    return res.json({ ok:false, error: err.message });
  }
});

app.get("/proxy", async (req, res) => {
  const v = req.query.url;
  if (!v) return res.json({ ok:false, error:"proxy url missing" });
  try {
    const r = await fetch(v, { headers: { "User-Agent":"Mozilla/5.0", "Referer":"https://www.instagram.com/" }});
    res.setHeader("Content-Type", r.headers.get("content-type") || "application/octet-stream");
    res.setHeader("Content-Disposition","attachment; filename=video.mp4");
    r.body.pipe(res);
  } catch (e) {
    console.log("proxy error:", e.message);
    return res.json({ ok:false, error: e.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, ()=> console.log("Server running on port", PORT));
