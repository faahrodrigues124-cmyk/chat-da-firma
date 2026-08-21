export default async (request) => {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  if (!q) return new Response(JSON.stringify({items:[]}), {headers:{'content-type':'application/json'}});
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return new Response(JSON.stringify({error:'YOUTUBE_API_KEY não configurada no Netlify'}), {status:500,headers:{'content-type':'application/json'}});
  const params = new URLSearchParams({
    part:'snippet', q, type:'video', maxResults:'15',
    videoEmbeddable:'true', videoSyndicated:'true', key
  });
  const r = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
  const data = await r.json();
  if (!r.ok) return new Response(JSON.stringify({error:data?.error?.message || 'YouTube API error'}), {status:r.status,headers:{'content-type':'application/json'}});
  const items=(data.items||[]).filter(x=>x.id?.videoId).map(x=>({
    videoId:x.id.videoId,title:x.snippet.title,channelTitle:x.snippet.channelTitle,
    thumbnail:x.snippet.thumbnails?.medium?.url||x.snippet.thumbnails?.default?.url
  }));
  return new Response(JSON.stringify({items}), {headers:{'content-type':'application/json','cache-control':'public,max-age=30'}});
};
