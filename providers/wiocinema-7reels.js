/* SPDX-License-Identifier: GPL-3.0-only
 * WioCinema 7Reels Provider (verified HLS sources)
 * Copyright (c) 2026 Wiojelt.
 */
"use strict";

var DECRYPT = "https://enc-dec.app/api";
var VIDFAST = "https://vidfast.vc";
var VIDCORE = "https://vidcore.io";
var VIXSRC = "https://vixsrc.to";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

function parseJson(text) { try { return JSON.parse(text); } catch (_) { return null; } }
function postJson(url, payload, headers) {
  var h = Object.assign({}, headers || {});
  if (payload != null) h["Content-Type"] = "application/json";
  return fetch(url, { method: "POST", headers: h, body: payload == null ? undefined : JSON.stringify(payload) })
    .then(function (r) { return r.ok ? r.text() : ""; }).catch(function () { return ""; });
}
function getText(url, headers) {
  return fetch(url, { headers: headers || {} }).then(function (r) { return r.ok ? r.text() : ""; }).catch(function () { return ""; });
}

function verifiedHls(row) {
  if (!row || !/^https?:\/\//i.test(row.url)) return Promise.resolve(null);
  return fetch(row.url, { headers: Object.assign({ Range: "bytes=0-65535" }, row.headers || {}) })
    .then(function (response) {
      if (!response.ok || Number(response.headers.get("content-length") || 0) > 262144) return null;
      return response.text();
    }).then(function (body) {
      if (!body || !/^\s*#EXTM3U\b/.test(body)) return null;
      var lines = body.split(/\r?\n/).map(function (line) { return line.trim(); });
      if (!lines.some(function (line, i) {
        return /^(?:#EXT-X-STREAM-INF:|#EXTINF:)/.test(line) && lines[i + 1] && !lines[i + 1].startsWith("#");
      })) return null;
      var height = 0;
      lines.forEach(function (line, i) {
        if (!line.startsWith("#EXT-X-STREAM-INF:") || !lines[i + 1] || lines[i + 1].startsWith("#")) return;
        var resolution = /RESOLUTION\s*=\s*\d+x(\d+)/i.exec(line);
        if (resolution) height = Math.max(height, Number(resolution[1]));
      });
      return Object.assign({}, row, {
        title: row.title + (height ? " • " + height + "p" : ""),
        quality: height || null
      });
    }).catch(function () { return null; });
}

function buildSubtitles(tmdbId, isTv, season, episode, extraTracks) {
  var idStr = encodeURIComponent(String(tmdbId));
  var query = isTv ? "&s=" + encodeURIComponent(String(season)) + "&e=" + encodeURIComponent(String(episode)) : "";
  var list = [];
  if (Array.isArray(extraTracks)) {
    extraTracks.forEach(function (tr, i) {
      if (tr && tr.file) {
        list.push({
          id: "7reels-emb-" + i,
          url: tr.file,
          language: (tr.label || "").toLowerCase().slice(0, 2) || "en",
          name: tr.label || "Subtitle " + (i + 1)
        });
      }
    });
  }
  var defaults = [
    { id: "7reels-sub-tr", url: "https://sub.vyper.top/vtt?tmdb=" + idStr + "&lang=tr" + query, language: "tr", name: "Turkish" },
    { id: "7reels-sub-en", url: "https://sub.vyper.top/vtt?tmdb=" + idStr + "&lang=en" + query, language: "en", name: "English" },
    { id: "7reels-sub-es", url: "https://sub.vyper.top/vtt?tmdb=" + idStr + "&lang=es" + query, language: "es", name: "Spanish" },
    { id: "7reels-sub-de", url: "https://sub.vyper.top/vtt?tmdb=" + idStr + "&lang=de" + query, language: "de", name: "German" }
  ];
  defaults.forEach(function (d) {
    if (!list.some(function (x) { return x.language === d.language; })) {
      list.push(d);
    }
  });
  return list;
}

function resolveVidFast(tmdbId, mediaType, season, episode) {
  var isTv = mediaType === "tv" && season != null && episode != null;
  var page = isTv
    ? VIDFAST + "/tv/" + encodeURIComponent(String(tmdbId)) + "/" + encodeURIComponent(String(season)) + "/" + encodeURIComponent(String(episode)) + "/"
    : VIDFAST + "/movie/" + encodeURIComponent(String(tmdbId)) + "/";
  var h = { "User-Agent": UA, "Referer": VIDFAST + "/", "X-Requested-With": "XMLHttpRequest", "Accept": "*/*" };

  return getText(page, { "User-Agent": UA, "Referer": VIDFAST + "/", "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" }).then(function (body) {
    var m = /\\\"(?:en|token)\\\":\\\"(.*?)\\\"/.exec(body) || /[\"](?:en|token)[\"]\s*:\s*[\"]([^\"]+)[\"]/.exec(body);
    if (!m) return [];
    return getText(DECRYPT + "/enc-vidfast?text=" + encodeURIComponent(m[1]) + "&stage=1", h)
      .then(parseJson)
      .then(function (enc) {
        if (!enc || enc.status !== 200 || !enc.result) return null;
        var r1 = enc.result;
        if (r1.stage1) {
          var h1 = Object.assign({}, h, r1.token ? { "X-CSRF-Token": r1.token } : {});
          return postJson(r1.stage1, null, h1)
            .then(function (p1) {
              if (!p1) return null;
              return getText(DECRYPT + "/enc-vidfast?text=" + encodeURIComponent(p1) + "&stage=2", h)
                .then(parseJson)
                .then(function (s2) { return s2 && s2.status === 200 && s2.result ? s2.result : null; });
            });
        }
        return r1;
      })
      .then(function (res) {
        if (!res || !res.servers || !res.stream) return [];
        var reqHeaders = Object.assign({}, h, res.token ? { "X-Csrf-Token": res.token } : {});
        return postJson(res.servers, null, reqHeaders)
          .then(function (txt) { return txt ? postJson(DECRYPT + "/dec-vidfast", { text: txt }) : ""; })
          .then(parseJson)
          .then(function (serversPayload) {
            var servers = serversPayload && serversPayload.result;
            if (!Array.isArray(servers)) return [];
            return Promise.all(servers.map(function (s) {
              if (!s || !s.data) return Promise.resolve(null);
              var baseStream = res.stream.endsWith("/") ? res.stream.slice(0, -1) : res.stream;
              return postJson(baseStream + "/" + s.data, null, reqHeaders)
                .then(function (enc) { return enc ? postJson(DECRYPT + "/dec-vidfast", { text: enc }) : ""; })
                .then(parseJson)
                .then(function (dec) {
                  var data = dec && dec.result;
                  if (!data || !data.url) return null;
                  var subs = buildSubtitles(tmdbId, isTv, season, episode, data.tracks);
                  return {
                    name: "WioCinema • 7Reels",
                    title: "7Reels • " + (s.name || "VidFast") + " [Multi-Sub]",
                    url: data.url,
                    provider: "wiocinema-7reels",
                    format: "m3u8",
                    headers: { "User-Agent": UA, "Referer": VIDFAST + "/" },
                    subtitles: subs
                  };
                }).catch(function () { return null; });
            })).then(function (list) { return list.filter(Boolean); });
          });
      });
  }).catch(function () { return []; });
}

function resolveVidCore(tmdbId, mediaType, season, episode) {
  var isTv = mediaType === "tv" && season != null && episode != null;
  var page = isTv
    ? VIDCORE + "/tv/" + encodeURIComponent(String(tmdbId)) + "/" + encodeURIComponent(String(season)) + "/" + encodeURIComponent(String(episode))
    : VIDCORE + "/movie/" + encodeURIComponent(String(tmdbId));
  var h = { "User-Agent": UA, "Referer": VIDCORE + "/", "X-Requested-With": "XMLHttpRequest", "Accept": "*/*" };

  return getText(page, { "User-Agent": UA, "Referer": VIDCORE + "/", "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" }).then(function (body) {
    var m = /\\\"(?:en|token)\\\":\\\"(.*?)\\\"/.exec(body) || /[\"](?:en|token)[\"]\s*:\s*[\"]([^\"]+)[\"]/.exec(body);
    if (!m) return [];
    return getText(DECRYPT + "/enc-vidcore?text=" + encodeURIComponent(m[1]) + "&stage=1", h)
      .then(parseJson)
      .then(function (enc) {
        if (!enc || enc.status !== 200 || !enc.result) return null;
        var r1 = enc.result;
        if (r1.stage1) {
          var h1 = Object.assign({}, h, r1.token ? { "X-CSRF-Token": r1.token } : {});
          return postJson(r1.stage1, null, h1)
            .then(function (p1) {
              if (!p1) return null;
              return getText(DECRYPT + "/enc-vidcore?text=" + encodeURIComponent(p1) + "&stage=2", h)
                .then(parseJson)
                .then(function (s2) { return s2 && s2.status === 200 && s2.result ? s2.result : null; });
            });
        }
        return r1;
      })
      .then(function (res) {
        if (!res || !res.servers || !res.stream) return [];
        var reqHeaders = Object.assign({}, h, res.token ? { "X-Csrf-Token": res.token } : {});
        return postJson(res.servers, null, reqHeaders)
          .then(function (txt) { return txt ? postJson(DECRYPT + "/dec-vidcore", { text: txt }) : ""; })
          .then(parseJson)
          .then(function (serversPayload) {
            var servers = serversPayload && serversPayload.result;
            if (!Array.isArray(servers)) return [];
            return Promise.all(servers.map(function (s) {
              if (!s || !s.data) return Promise.resolve(null);
              var baseStream = res.stream.endsWith("/") ? res.stream.slice(0, -1) : res.stream;
              return postJson(baseStream + "/" + s.data, null, reqHeaders)
                .then(function (enc) { return enc ? postJson(DECRYPT + "/dec-vidcore", { text: enc }) : ""; })
                .then(parseJson)
                .then(function (dec) {
                  var data = dec && dec.result;
                  if (!data || !data.url) return null;
                  var subs = buildSubtitles(tmdbId, isTv, season, episode, data.tracks);
                  return {
                    name: "WioCinema • 7Reels",
                    title: "7Reels • VidCore (" + (s.name || "Server") + ") [Multi-Sub]",
                    url: data.url,
                    provider: "wiocinema-7reels",
                    format: "m3u8",
                    headers: { "User-Agent": UA, "Referer": VIDCORE + "/" },
                    subtitles: subs
                  };
                }).catch(function () { return null; });
            })).then(function (list) { return list.filter(Boolean); });
          });
      });
  }).catch(function () { return []; });
}

function resolveVix(tmdbId, mediaType, season, episode) {
  var isTv = mediaType === "tv" && season != null && episode != null;
  var path = isTv
    ? VIXSRC + "/api/tv/" + encodeURIComponent(String(tmdbId)) + "/" + encodeURIComponent(String(season)) + "/" + encodeURIComponent(String(episode))
    : VIXSRC + "/api/movie/" + encodeURIComponent(String(tmdbId));
  var h = { "User-Agent": UA, "Referer": VIXSRC + "/", "Accept": "application/json" };

  return getText(path, h)
    .then(parseJson)
    .then(function (payload) {
      if (!payload || !payload.src) return [];
      var pageUrl = /^https?:/i.test(payload.src) ? payload.src : VIXSRC + payload.src;
      return getText(pageUrl, h);
    })
    .then(function (html) {
      if (!html) return [];
      var s = /(?:url|file)\s*:\s*['"]([^'"]+)['"]/.exec(html);
      var t = /['"]?token['"]?\s*:\s*['"]([^'"]+)['"]/.exec(html);
      var e = /['"]?expires['"]?\s*:\s*['"]([^'"]+)['"]/.exec(html);
      if (!s || !t || !e) return [];
      var url = s[1] + (s[1].indexOf("?") >= 0 ? "&" : "?") + "token=" + encodeURIComponent(t[1]) + "&expires=" + encodeURIComponent(e[1]) + "&h=1";
      var subs = buildSubtitles(tmdbId, isTv, season, episode, []);
      return [{
        name: "WioCinema • 7Reels",
        title: "7Reels • VixDirect [Multi-Sub]",
        url: url,
        provider: "wiocinema-7reels",
        format: "m3u8",
        headers: { "User-Agent": UA, "Referer": VIXSRC + "/" },
        subtitles: subs
      }];
    }).catch(function () { return []; });
}

function getStreams(tmdbId, mediaType, season, episode) {
  if (tmdbId == null) return Promise.resolve([]);
  return Promise.all([
    resolveVidFast(tmdbId, mediaType, season, episode),
    resolveVidCore(tmdbId, mediaType, season, episode),
    resolveVix(tmdbId, mediaType, season, episode)
  ]).then(function (results) {
    var out = [], seen = {};
    results.forEach(function (list) {
      list.forEach(function (item) {
        if (item && item.url && !seen[item.url]) {
          seen[item.url] = true;
          out.push(item);
        }
      });
    });

    return Promise.all(out.map(verifiedHls)).then(function (rows) { return rows.filter(Boolean); });
  }).catch(function (error) {
    console.error("[WioCinema 7Reels] " + (error && error.message ? error.message : String(error)));
    return [];
  });
}

module.exports = { getStreams: getStreams };
