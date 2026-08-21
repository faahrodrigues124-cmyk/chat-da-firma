export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/youtube-search") {
      const q = (url.searchParams.get("q") || "").trim();
      const headers = {
        "content-type": "application/json; charset=UTF-8",
        "cache-control": "public, max-age=30"
      };

      if (!q) {
        return new Response(JSON.stringify({ items: [] }), { headers });
      }

      const key = env.YOUTUBE_API_KEY;
      if (!key) {
        return new Response(JSON.stringify({
          error: "YOUTUBE_API_KEY não configurada no Cloudflare. Adicione-a em Settings > Variables and Secrets."
        }), { status: 500, headers });
      }

      const params = new URLSearchParams({
        part: "snippet",
        q,
        type: "video",
        maxResults: "15",
        videoEmbeddable: "true",
        videoSyndicated: "true",
        key
      });

      try {
        const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
        const data = await response.json();

        if (!response.ok) {
          return new Response(JSON.stringify({
            error: data?.error?.message || `YouTube API HTTP ${response.status}`
          }), { status: response.status, headers });
        }

        const items = (data.items || [])
          .filter(item => item?.id?.videoId)
          .map(item => ({
            videoId: item.id.videoId,
            title: item.snippet?.title || "Sem título",
            channelTitle: item.snippet?.channelTitle || "YouTube",
            thumbnail: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || ""
          }));

        return new Response(JSON.stringify({ items }), { status: 200, headers });
      } catch (error) {
        return new Response(JSON.stringify({
          error: `Falha ao consultar o YouTube: ${error?.message || error}`
        }), { status: 502, headers });
      }
    }

    return env.ASSETS.fetch(request);
  }
};
