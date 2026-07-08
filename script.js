const GITHUB_USERNAME="jxst-nic";
const GITHUB_REPO="jxst-nic.github.io";
const MUSIC_FOLDER="music";
const BACKGROUND_VIDEO_FOLDER="background_videos";
const START_VOLUME=0.05;
const VOLUME_STEP=0.05;
const PLAY_IN_ORDER=false;
const RANDOMIZE_BACKGROUND_VIDEOS=true;
const TRACK_FADE_MS=1200;
const AUTO_NEXT_FADE_SECONDS=2.4;
const LOAD_COVERS_FROM_INTERNET=true;
const ITUNES_COVER_COUNTRY="DE";
const ITUNES_COVER_TIMEOUT=7000;

const navToggle=document.getElementById("nav-toggle");
const siteNav=document.getElementById("site-nav");
navToggle?.addEventListener("click",()=>{const open=siteNav.classList.toggle("open");navToggle.setAttribute("aria-expanded",String(open));});
const backgroundVideo=document.querySelector(".background-video");
const fallbackBackgroundVideoSrc=backgroundVideo?.querySelector("source")?.getAttribute("src")||backgroundVideo?.getAttribute("src")||"";

const audioEl=new Audio();
audioEl.preload="auto";
audioEl.crossOrigin="anonymous";
audioEl.volume=START_VOLUME;
let playlist=[],currentIndex=-1,order=[],tagsCache=new Map(),tagsLoading=new Set(),onlineCoverLoading=new Set();
let backgroundVideos=[],backgroundOrder=[],backgroundOrderPos=0,backgroundErrorSkips=0,isSwitchingTrack=false,autoNextTriggered=false,volumeFadeFrame=0;
let audioCtx,analyser,sourceNode,dataArray;
const titleEl=document.getElementById("track-title");
const metaEl=document.getElementById("track-meta");
const playBtn=document.getElementById("music-play");
const nextBtn=document.getElementById("music-next");
const prevBtn=document.getElementById("music-prev");
const volume=document.getElementById("music-volume");
const progressInput=document.getElementById("music-progress");
const currentTimeEl=document.getElementById("music-current");
const durationEl=document.getElementById("music-duration");
const canvas=document.getElementById("music-visualizer");
const coverEl=document.getElementById("track-cover");
const coverFallback=document.getElementById("track-cover-fallback");
const ctx=canvas?.getContext("2d");
if(volume){volume.step=String(VOLUME_STEP);volume.value=String(START_VOLUME);}

function isLocalPreview(){return ["localhost","127.0.0.1",""] .includes(location.hostname)}
function cleanFileName(src){return decodeURIComponent(src.split("/").pop()).replace(/\.[^/.]+$/," ").replace(/[_]+/g," ").replace(/\s+/g," ").trim()}
function parseName(src){const n=cleanFileName(src);const p=n.split(/\s[-–—]\s/);if(p.length>=2)return{artist:p[0].trim(),title:p.slice(1).join(" - ").trim()};return{artist:"Unknown artist",title:n}}
async function loadFromGitHub(){const r=await fetch(`https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/contents/${MUSIC_FOLDER}`,{headers:{Accept:"application/vnd.github+json"}});if(!r.ok)throw new Error("GitHub API unavailable");const files=await r.json();return files.filter(f=>f.type==="file"&&/\.mp3$/i.test(f.name)).sort((a,b)=>a.name.localeCompare(b.name)).map(f=>({src:`${MUSIC_FOLDER}/${encodeURIComponent(f.name)}`}))}
async function loadFromJson(){
  const r=await fetch(`${MUSIC_FOLDER}/playlist.json`,{cache:"no-store"});
  if(!r.ok)throw new Error("playlist.json unavailable");
  const d=await r.json();
  return d.map(x=>{
    const src=typeof x==="string"?x:x.src;
    const parts=src.split('/');
    const encodedParts=parts.map((p,i)=>i===parts.length-1?encodeURIComponent(p):p);
    return typeof x==="string"?{src:encodedParts.join('/')}:{...x,src:encodedParts.join('/')};
  });
}
async function loadFromFlask(){
  const r=await fetch("/api/music",{cache:"no-store"});
  if(!r.ok)throw new Error("Flask music API unavailable");
  const d=await r.json();
  return (d.tracks||[]).map(x=>{
    const src=typeof x==="string"?x:x.src;
    const parts=src.split('/');
    const encodedParts=parts.map((p,i)=>i===parts.length-1?encodeURIComponent(p):p);
    return typeof x==="string"?{src:encodedParts.join('/')}:{...x,src:encodedParts.join('/')};
  });
}
function encodePathLastSegment(src){
  const parts=String(src).split("/");
  return parts.map((part,index)=>{
    if(index!==parts.length-1)return part;
    try{return encodeURIComponent(decodeURIComponent(part))}
    catch{return encodeURIComponent(part)}
  }).join("/");
}
function isBackgroundVideoFile(src){return /\.(mp4|webm|ogg|ogv|mov|m4v)$/i.test(String(src).split("?")[0])}
function normalizeBackgroundVideoItem(item){
  const src=typeof item==="string"?item:item.src;
  if(!src||!isBackgroundVideoFile(src))return null;
  const encodedSrc=encodePathLastSegment(src);
  return typeof item==="string"?{src:encodedSrc,name:encodedSrc.split("/").pop()}:{...item,src:encodedSrc};
}
async function loadBackgroundVideosFromFlask(){
  const r=await fetch("/api/background-videos",{cache:"no-store"});
  if(!r.ok)throw new Error("Flask background video API unavailable");
  const d=await r.json();
  return (d.videos||[]).map(normalizeBackgroundVideoItem).filter(Boolean);
}
async function loadBackgroundVideosFromGitHub(){
  const r=await fetch(`https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/contents/${BACKGROUND_VIDEO_FOLDER}`,{headers:{Accept:"application/vnd.github+json"}});
  if(!r.ok)throw new Error("GitHub background video folder unavailable");
  const files=await r.json();
  return files.filter(f=>f.type==="file"&&isBackgroundVideoFile(f.name)).sort((a,b)=>a.name.localeCompare(b.name)).map(f=>({src:`${BACKGROUND_VIDEO_FOLDER}/${encodeURIComponent(f.name)}`,name:f.name}));
}
async function loadBackgroundVideosFromJson(){
  const r=await fetch(`${BACKGROUND_VIDEO_FOLDER}/playlist.json`,{cache:"no-store"});
  if(!r.ok)throw new Error("background video playlist unavailable");
  const d=await r.json();
  return d.map(normalizeBackgroundVideoItem).filter(Boolean);
}
async function loadBackgroundVideosFromScript(){
  if(Array.isArray(window.NIC_BACKGROUND_VIDEOS))return window.NIC_BACKGROUND_VIDEOS.map(normalizeBackgroundVideoItem).filter(Boolean);
  await new Promise((resolve,reject)=>{
    const existing=document.querySelector(`script[src="${BACKGROUND_VIDEO_FOLDER}/playlist.js"]`);
    if(existing){existing.addEventListener("load",resolve,{once:true});existing.addEventListener("error",reject,{once:true});return}
    const script=document.createElement("script");
    script.src=`${BACKGROUND_VIDEO_FOLDER}/playlist.js`;
    script.onload=resolve;
    script.onerror=reject;
    document.head.appendChild(script);
  });
  return (window.NIC_BACKGROUND_VIDEOS||[]).map(normalizeBackgroundVideoItem).filter(Boolean);
}
async function loadBackgroundVideos(){
  const loaders=isLocalPreview()
    ?[loadBackgroundVideosFromFlask,loadBackgroundVideosFromJson,loadBackgroundVideosFromScript]
    :[loadBackgroundVideosFromGitHub,loadBackgroundVideosFromJson,loadBackgroundVideosFromScript];
  for(const loader of loaders){
    try{
      const videos=await loader();
      if(videos.length)return videos;
    }catch(err){
      console.warn("Background video loader failed:",err);
    }
  }
  return [];
}
function buildBackgroundOrder(){
  backgroundOrder=backgroundVideos.map((_,i)=>i);
  if(RANDOMIZE_BACKGROUND_VIDEOS){
    for(let i=backgroundOrder.length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1));
      [backgroundOrder[i],backgroundOrder[j]]=[backgroundOrder[j],backgroundOrder[i]];
    }
  }
  backgroundOrderPos=0;
}
function nextBackgroundVideoIndex(){
  if(!backgroundOrder.length||backgroundOrderPos>=backgroundOrder.length)buildBackgroundOrder();
  return backgroundOrder[backgroundOrderPos++]??0;
}
function playBackgroundVideo(index=nextBackgroundVideoIndex()){
  const item=backgroundVideos[index];
  if(!backgroundVideo||!item)return;
  backgroundVideo.dataset.fallback="false";
  backgroundVideo.classList.remove("is-active");
  backgroundVideo.muted=true;
  backgroundVideo.defaultMuted=true;
  backgroundVideo.autoplay=true;
  backgroundVideo.playsInline=true;
  if(backgroundVideos.length===1)backgroundVideo.loop=true;
  else{backgroundVideo.loop=false;backgroundVideo.removeAttribute("loop");}
  backgroundVideo.querySelectorAll("source").forEach(source=>source.remove());
  backgroundVideo.src=item.src;
  backgroundVideo.load();
  backgroundVideo.play().then(()=>{
    backgroundErrorSkips=0;
    document.body.classList.add("has-background-video");
    backgroundVideo.classList.add("is-active");
  }).catch(err=>{
    console.warn("Background video play failed:",item.src,err);
  });
}
function restoreFallbackBackgroundVideo(){
  if(!backgroundVideo||!fallbackBackgroundVideoSrc)return;
  document.body.classList.remove("has-background-video");
  backgroundVideo.classList.remove("is-active");
  backgroundVideo.dataset.fallback="true";
  backgroundVideo.loop=true;
  backgroundVideo.src=fallbackBackgroundVideoSrc;
  backgroundVideo.load();
  backgroundVideo.play().catch(()=>{});
}
function handleBackgroundVideoError(){
  if(backgroundVideo?.dataset.fallback==="true")return;
  if(!backgroundVideos.length)return;
  backgroundErrorSkips++;
  console.warn("Background video failed, trying next one:",backgroundVideo?.currentSrc||backgroundVideo?.src);
  if(backgroundErrorSkips<backgroundVideos.length)playBackgroundVideo();
  else restoreFallbackBackgroundVideo();
}
function ensureBackgroundVideoPlaying(){
  if(!backgroundVideo||!backgroundVideo.src)return;
  if(backgroundVideo.paused)backgroundVideo.play().catch(()=>{});
}
async function initBackgroundVideos(){
  if(!backgroundVideo)return;
  backgroundVideos=await loadBackgroundVideos();
  if(!backgroundVideos.length)return;
  document.body.classList.add("has-background-video");
  buildBackgroundOrder();
  backgroundVideo.addEventListener("ended",()=>playBackgroundVideo());
  backgroundVideo.addEventListener("error",handleBackgroundVideoError);
  playBackgroundVideo();
}
async function initPlaylist(){try{playlist=isLocalPreview()?await loadFromFlask():await loadFromGitHub()}catch{try{playlist=await loadFromJson()}catch{playlist=[]}}if(!playlist.length){if(titleEl)titleEl.textContent="No music found";if(metaEl)metaEl.textContent=isLocalPreview()?"Add MP3 files to the music folder":"Add MP3 files to the music folder";return}buildOrder();playlist.forEach((_,i)=>readTags(i));currentIndex=order[0]??0;loadTrack(currentIndex);tryQuietAutoplay();}
function buildOrder(){order=playlist.map((_,i)=>i);if(!PLAY_IN_ORDER){for(let i=order.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[order[i],order[j]]=[order[j],order[i]]}}}
function pictureToDataUrl(picture){
  if(!picture||!picture.data||!picture.format)return"";
  return bytesToDataUrl(picture.data,picture.format);
}
function bytesToDataUrl(bytes,mime){
  const chunkSize=8192;
  let binary="";
  for(let i=0;i<bytes.length;i+=chunkSize){
    binary+=String.fromCharCode(...bytes.slice(i,i+chunkSize));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}
function readSynchsafe(bytes,o){return((bytes[o]&127)<<21)|((bytes[o+1]&127)<<14)|((bytes[o+2]&127)<<7)|(bytes[o+3]&127)}
function readUint32(bytes,o){return((bytes[o]<<24)|(bytes[o+1]<<16)|(bytes[o+2]<<8)|bytes[o+3])>>>0}
function readUint24(bytes,o){return(bytes[o]<<16)|(bytes[o+1]<<8)|bytes[o+2]}
function decodeText(bytes,encoding=0){
  const labels=["iso-8859-1","utf-16","utf-16be","utf-8"];
  try{
    return new TextDecoder(labels[encoding]||"utf-8").decode(bytes).replace(/^\uFEFF/,"").replace(/\0+$/g,"").trim();
  }catch{
    return String.fromCharCode(...bytes).replace(/\0+$/g,"").trim();
  }
}
function decodeTextFrame(data){return data?.length?decodeText(data.slice(1),data[0]):""}
function findImageStart(data){
  for(let i=0;i<data.length-4;i++){
    if(data[i]===255&&data[i+1]===216&&data[i+2]===255)return{offset:i,mime:"image/jpeg"};
    if(data[i]===137&&data[i+1]===80&&data[i+2]===78&&data[i+3]===71)return{offset:i,mime:"image/png"};
    if(data[i]===71&&data[i+1]===73&&data[i+2]===70)return{offset:i,mime:"image/gif"};
  }
  return null;
}
function extractId3Tags(buffer){
  const bytes=new Uint8Array(buffer);
  if(bytes.length<10||String.fromCharCode(bytes[0],bytes[1],bytes[2])!=="ID3")return{};
  const major=bytes[3];
  let offset=10;
  const tagEnd=Math.min(bytes.length,10+readSynchsafe(bytes,6));
  const tags={};
  if(bytes[5]&64){
    const extSize=major===4?readSynchsafe(bytes,offset):readUint32(bytes,offset);
    offset+=major===4?extSize:extSize+4;
  }
  while(offset<tagEnd){
    const frameStart=offset;
    let id="",size=0,headerSize=10;
    if(major===2){
      if(offset+6>tagEnd)break;
      id=String.fromCharCode(bytes[offset],bytes[offset+1],bytes[offset+2]);
      if(!id.trim()||bytes[offset]===0)break;
      size=readUint24(bytes,offset+3);
      headerSize=6;
    }else{
      if(offset+10>tagEnd)break;
      id=String.fromCharCode(bytes[offset],bytes[offset+1],bytes[offset+2],bytes[offset+3]);
      if(!id.trim()||bytes[offset]===0)break;
      size=major===4?readSynchsafe(bytes,offset+4):readUint32(bytes,offset+4);
    }
    offset+=headerSize;
    if(size<=0||offset+size>tagEnd)break;
    const frame=bytes.slice(offset,offset+size);
    if(id==="TIT2"||id==="TT2")tags.title=decodeTextFrame(frame);
    if(id==="TPE1"||id==="TP1")tags.artist=decodeTextFrame(frame);
    if(id==="APIC"||id==="PIC"){
      const image=findImageStart(frame);
      if(image)tags.cover=bytesToDataUrl(frame.slice(image.offset),image.mime);
    }
    offset=frameStart+headerSize+size;
    if(tags.title&&tags.artist&&tags.cover)break;
  }
  return tags;
}
function readAudioTags(buffer,fallback,track){
  const local=extractId3Tags(buffer);
  if(local.cover||!window.jsmediatags)return Promise.resolve(local);
  return new Promise(resolve=>{
    try{
      window.jsmediatags.read(buffer,{
        onSuccess:t=>{
          const cover=t.tags&&t.tags.picture?pictureToDataUrl(t.tags.picture):"";
          resolve({title:(t.tags&&t.tags.title)||local.title,artist:(t.tags&&t.tags.artist)||local.artist,cover:cover||local.cover});
        },
        onError:()=>resolve(local)
      });
    }catch{
      resolve(local);
    }
  });
}
function stripSearchNoise(value=""){
  return String(value)
    .replace(/\([^)]*(lyrics?|official|audio|video|visualizer|remaster(ed)?)[^)]*\)/ig," ")
    .replace(/\[[^\]]*(lyrics?|official|audio|video|visualizer|remaster(ed)?)[^\]]*\]/ig," ")
    .replace(/[#_]+/g," ")
    .replace(/\s+/g," ")
    .trim();
}
function normalizeCompare(value=""){
  return stripSearchNoise(value).toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
}
function wordOverlap(a,b){
  const aa=new Set(normalizeCompare(a).split(" ").filter(w=>w.length>1));
  const bb=new Set(normalizeCompare(b).split(" ").filter(w=>w.length>1));
  if(!aa.size||!bb.size)return 0;
  let matches=0;
  aa.forEach(w=>{if(bb.has(w))matches++});
  return matches/Math.max(aa.size,bb.size);
}
function jsonp(url,callbackParam="callback",timeout=ITUNES_COVER_TIMEOUT){
  if(!document.head)return Promise.reject(new Error("No document head"));
  return new Promise((resolve,reject)=>{
    const callbackName=`__nicCover_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script=document.createElement("script");
    const timer=setTimeout(()=>cleanup(()=>reject(new Error("Cover search timed out"))),timeout);
    function cleanup(done){
      clearTimeout(timer);
      delete window[callbackName];
      script.remove();
      done?.();
    }
    window[callbackName]=data=>cleanup(()=>resolve(data));
    script.onerror=()=>cleanup(()=>reject(new Error("Cover search failed")));
    script.src=`${url}${url.includes("?")?"&":"?"}${callbackParam}=${encodeURIComponent(callbackName)}`;
    document.head.appendChild(script);
  });
}
function upgradeArtworkUrl(url=""){
  return String(url)
    .replace(/\/\d+x\d+bb\.(jpg|jpeg|png|webp)(\?.*)?$/i,"/600x600bb.$1$2")
    .replace(/\/\d+x\d+(-\d+)?\.(jpg|jpeg|png|webp)(\?.*)?$/i,"/600x600$1.$2$3");
}
function scoreArtworkResult(result,wantedArtist,wantedTitle){
  let score=0;
  const artist=result.artistName||"";
  const title=result.trackName||result.collectionName||"";
  if(result.kind==="song")score+=2;
  if(normalizeCompare(artist)===normalizeCompare(wantedArtist))score+=8;
  if(normalizeCompare(title)===normalizeCompare(wantedTitle))score+=10;
  score+=wordOverlap(artist,wantedArtist)*5;
  score+=wordOverlap(title,wantedTitle)*7;
  return score;
}
async function searchInternetCover(term,wantedArtist,wantedTitle){
  const query=new URLSearchParams({term,media:"music",entity:"song",limit:"8",country:ITUNES_COVER_COUNTRY});
  const data=await jsonp(`https://itunes.apple.com/search?${query.toString()}`);
  const results=(data.results||[]).filter(result=>result.artworkUrl100||result.artworkUrl60);
  if(!results.length)return"";
  results.sort((a,b)=>scoreArtworkResult(b,wantedArtist,wantedTitle)-scoreArtworkResult(a,wantedArtist,wantedTitle));
  const best=results[0];
  return upgradeArtworkUrl(best.artworkUrl100||best.artworkUrl60||"");
}
function onlineCoverTerms(track,meta){
  const fileMeta=parseName(track.src);
  const fileArtist=stripSearchNoise(fileMeta.artist);
  const fileTitle=stripSearchNoise(fileMeta.title);
  const metaArtist=stripSearchNoise(meta.artist);
  const metaTitle=stripSearchNoise(meta.title);
  return [...new Set([
    fileArtist&&fileTitle&&fileArtist!=="Unknown artist"?`${fileArtist} ${fileTitle}`:"",
    metaArtist&&metaTitle?`${metaArtist} ${metaTitle}`:"",
    stripSearchNoise(cleanFileName(track.src))
  ].filter(Boolean))];
}
function loadOnlineCover(i){
  if(!LOAD_COVERS_FROM_INTERNET)return;
  const track=playlist[i];
  if(!track||onlineCoverLoading.has(i))return;
  const cached=tagsCache.get(i)||parseName(track.src);
  if(cached.cover||cached.onlineCoverTried)return;
  const meta=getTrackMeta(i);
  const fileMeta=parseName(track.src);
  const wantedArtist=stripSearchNoise(fileMeta.artist!=="Unknown artist"?fileMeta.artist:meta.artist);
  const wantedTitle=stripSearchNoise(fileMeta.title||meta.title);
  const terms=onlineCoverTerms(track,meta);
  if(!terms.length)return;
  tagsCache.set(i,{...cached,onlineCoverTried:true});
  onlineCoverLoading.add(i);
  (async()=>{
    let cover="";
    for(const term of terms){
      cover=await searchInternetCover(term,wantedArtist,wantedTitle).catch(()=>"");
      if(cover)break;
    }
    const current=tagsCache.get(i)||cached;
    if(cover){
      tagsCache.set(i,{...current,cover,onlineCover:true,onlineCoverTried:true});
      if(i===currentIndex)updateUi();
    }
  })().finally(()=>onlineCoverLoading.delete(i));
}
function readTags(i){
  const track=playlist[i];
  if(!track||tagsCache.get(i)?.loaded||tagsLoading.has(i))return;
  const fallback=parseName(track.src);
  tagsCache.set(i,{...fallback,cover:track.cover||"",loaded:false});
  tagsLoading.add(i);
  fetch(track.src,{cache:"no-store"})
    .then(r=>{
      if(!r.ok)throw new Error("Track fetch failed");
      return r.arrayBuffer();
    })
    .then(buffer=>readAudioTags(buffer,fallback,track))
    .then(tags=>{
      const current=tagsCache.get(i)||{};
      tagsCache.set(i,{title:tags.title||fallback.title,artist:tags.artist||fallback.artist,cover:tags.cover||current.cover||track.cover||"",loaded:true,onlineCoverTried:current.onlineCoverTried||false,onlineCover:current.onlineCover||false});
      if(i===currentIndex)updateUi();
    })
    .catch(err=>{
      console.warn("Fetch failed:",err);
      const current=tagsCache.get(i)||{};
      tagsCache.set(i,{...fallback,cover:current.cover||track.cover||"",loaded:true,onlineCoverTried:current.onlineCoverTried||false,onlineCover:current.onlineCover||false});
      if(i===currentIndex)updateUi();
    })
    .finally(()=>tagsLoading.delete(i));
}
function setupAudio(){
  if(audioCtx||!canvas)return;
  try{
    audioCtx=new (window.AudioContext||window.webkitAudioContext)();
    sourceNode=audioCtx.createMediaElementSource(audioEl);
    analyser=audioCtx.createAnalyser();
    analyser.fftSize=128;
    dataArray=new Uint8Array(analyser.frequencyBinCount);
    sourceNode.connect(analyser);
    analyser.connect(audioCtx.destination);
  }catch{
    audioCtx=null;
    analyser=null;
  }
}
function resizeCanvas(){if(!canvas)return;canvas.width=canvas.clientWidth;canvas.height=canvas.clientHeight}
function draw(){requestAnimationFrame(draw);if(!analyser||!ctx||!canvas)return;analyser.getByteFrequencyData(dataArray);ctx.clearRect(0,0,canvas.width,canvas.height);const w=canvas.width/dataArray.length;for(let i=0;i<dataArray.length;i++){const v=dataArray[i]/255;ctx.fillStyle="rgba(255,255,255,.9)";ctx.fillRect(i*w,canvas.height-v*canvas.height,w*.68,v*canvas.height)}}
function getTrackMeta(i=currentIndex){const track=playlist[i];if(!track)return{title:"No track",artist:""};const cached=tagsCache.get(i);const f=parseName(track.src);return{title:track.title||cached?.title||f.title,artist:track.artist||cached?.artist||f.artist}}
function formatTime(seconds){if(!isFinite(seconds))return"0:00";const m=Math.floor(seconds/60);const s=Math.floor(seconds%60);return`${m}:${String(s).padStart(2,"0")}`}
function baseVolume(){return Number(volume?.value||START_VOLUME)}
function fadeAudioVolume(target,duration=TRACK_FADE_MS){
  cancelAnimationFrame(volumeFadeFrame);
  const start=audioEl.volume;
  if(duration<=0){audioEl.volume=target;return Promise.resolve()}
  return new Promise(resolve=>{
    const started=performance.now();
    const step=now=>{
      const progress=Math.min(1,(now-started)/duration);
      audioEl.volume=start+(target-start)*progress;
      if(progress<1)volumeFadeFrame=requestAnimationFrame(step);
      else{audioEl.volume=target;resolve();}
    };
    volumeFadeFrame=requestAnimationFrame(step);
  });
}
function updateProgress(){if(!audioEl.duration)return;const percent=(audioEl.currentTime/audioEl.duration)*100;if(progressInput)progressInput.value=String(percent);if(currentTimeEl)currentTimeEl.textContent=formatTime(audioEl.currentTime);if(durationEl)durationEl.textContent=formatTime(audioEl.duration)}
function handleAutoNextFade(){
  if(!audioEl.duration||!isFinite(audioEl.duration)||audioEl.paused||isSwitchingTrack)return;
  const remaining=audioEl.duration-audioEl.currentTime;
  if(autoNextTriggered&&remaining>AUTO_NEXT_FADE_SECONDS+1)autoNextTriggered=false;
  if(autoNextTriggered||audioEl.duration<=AUTO_NEXT_FADE_SECONDS+1)return;
  if(remaining<=AUTO_NEXT_FADE_SECONDS){
    autoNextTriggered=true;
    next(true);
  }
}
function updateUi(){
  const meta=getTrackMeta();
  if(titleEl)titleEl.textContent=meta.title;
  if(metaEl)metaEl.textContent=meta.artist||"Background track";
  const cached=tagsCache.get(currentIndex);
  const cover=cached?.cover||playlist[currentIndex]?.cover||"";
  if(coverEl){
    if(cover){coverEl.src=cover;coverEl.classList.add("loaded");coverFallback?.classList.add("hidden");}
    else{coverEl.removeAttribute("src");coverEl.classList.remove("loaded");coverFallback?.classList.remove("hidden");loadOnlineCover(currentIndex);}
  }
  if(playBtn)playBtn.textContent=audioEl.paused?"▶":"❚❚";
}
function loadTrack(i){
  if(!playlist[i])return;
  currentIndex=i;
  autoNextTriggered=false;
  readTags(i);
  audioEl.src=playlist[i].src;
  audioEl.load();
  audioEl.volume=baseVolume();
  updateUi();
}
async function switchTrack(i,{play=true,fade=false}={}){
  if(!playlist[i]||isSwitchingTrack)return;
  isSwitchingTrack=true;
  const shouldPlay=play||!audioEl.paused;
  const targetVolume=baseVolume();
  try{
    if(fade&&shouldPlay&&!audioEl.paused)await fadeAudioVolume(0);
    loadTrack(i);
    audioEl.volume=fade?0:targetVolume;
    if(shouldPlay){
      setupAudio();
      if(audioCtx?.state==="suspended")audioCtx.resume().catch(()=>{});
      await audioEl.play().catch((err)=>{console.warn("Playback failed:",err);});
      if(fade)await fadeAudioVolume(targetVolume);
    }
  }finally{
    isSwitchingTrack=false;
    autoNextTriggered=false;
    updateUi();
  }
}
function playCurrent(){
  if(currentIndex<0&&playlist.length)loadTrack(order[0]??0);
  setupAudio();
  if(audioCtx?.state==="suspended")audioCtx.resume().catch(()=>{});
  audioEl.volume=baseVolume();
  audioEl.play().then(updateUi).catch((err)=>{console.warn("Playback failed:",err);updateUi();});
}
function tryQuietAutoplay(){
  playCurrent();
  const unlock=()=>{
    if(audioEl.paused)playCurrent();
    document.removeEventListener("pointerdown",unlock);
    document.removeEventListener("keydown",unlock);
    document.removeEventListener("touchstart",unlock);
  };
  document.addEventListener("pointerdown",unlock,{once:true});
  document.addEventListener("keydown",unlock,{once:true});
  document.addEventListener("touchstart",unlock,{once:true});
}
function next(fade=false){if(!order.length)return;fade=fade===true;const pos=order.indexOf(currentIndex);switchTrack(order[(pos+1)%order.length]??order[0],{play:true,fade})}
function prev(fade=false){if(!order.length)return;fade=fade===true;const pos=order.indexOf(currentIndex);switchTrack(order[(pos-1+order.length)%order.length]??order[0],{play:true,fade})}
function toggle(){if(audioEl.paused)playCurrent();else{audioEl.pause();updateUi()}}
volume?.addEventListener("input",()=>{audioEl.volume=Number(volume.value)});
progressInput?.addEventListener("input",(e)=>{if(audioEl.duration){audioEl.currentTime=(Number(e.target.value)/100)*audioEl.duration}});
playBtn?.addEventListener("click",toggle);nextBtn?.addEventListener("click",next);prevBtn?.addEventListener("click",prev);
audioEl.addEventListener("ended",()=>next(true));audioEl.addEventListener("play",updateUi);audioEl.addEventListener("pause",updateUi);
audioEl.addEventListener("timeupdate",()=>{updateProgress();handleAutoNextFade();});audioEl.addEventListener("loadedmetadata",updateProgress);

async function loadJsonCards(listId, type){const el=document.getElementById(listId);if(!el)return;const source=el.dataset.source;try{const r=await fetch(source,{cache:"no-store"});if(!r.ok)throw new Error("load failed");const items=await r.json();el.innerHTML=items.map((item,index)=> type==="projects"?`<article class="project-card"><div class="project-number">${String(index+1).padStart(2,"0")}</div><div><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.description)}</p><div class="tags">${(item.tags||[]).map(t=>`<span>${escapeHtml(t)}</span>`).join("")}</div></div></article>`:`<article class="card"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p><div class="tags">${(item.tags||[]).map(t=>`<span>${escapeHtml(t)}</span>`).join("")}</div></article>`).join("");}catch{el.innerHTML='<article class="card"><h3>Could not load content</h3><p>Check the JSON file path and syntax.</p></article>';}}
function escapeHtml(str=""){return String(str).replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#039;",'"':"&quot;"}[c]))}

let contactConfigPromise=null;
function ensureContactConfig(){
  if(window.NIC_CONTACT)return Promise.resolve();
  if(contactConfigPromise)return contactConfigPromise;
  contactConfigPromise=new Promise(resolve=>{
    const existing=document.querySelector('script[src="contact-config.js"]');
    if(existing){
      existing.addEventListener("load",resolve,{once:true});
      existing.addEventListener("error",resolve,{once:true});
      setTimeout(resolve,0);
      return;
    }
    const script=document.createElement("script");
    script.src="contact-config.js";
    script.onload=resolve;
    script.onerror=resolve;
    document.head.appendChild(script);
  });
  return contactConfigPromise;
}
function bindContactForm(){
  const contactForm=document.getElementById("contact-form");
  const contactStatus=document.getElementById("contact-status");
  if(!contactForm||contactForm.dataset.bound)return;
  contactForm.dataset.bound="true";
  ensureContactConfig();
  contactForm.addEventListener("submit",async(event)=>{
    event.preventDefault();
    await ensureContactConfig();
    const name=document.getElementById("contact-name")?.value.trim();
    const message=document.getElementById("contact-message")?.value.trim();
    const files=[...(document.getElementById("contact-files")?.files||[])];
    if(!name||!message){if(contactStatus)contactStatus.textContent="Please enter a name and a message.";return}
    if(contactStatus)contactStatus.textContent="Sending...";
    try{
      const ok=await sendContact({name,message,files});
      if(ok){contactForm.reset();if(contactStatus)contactStatus.textContent=isLocalPreview()?"Message saved locally in Flask. Open /admin to view it.":"Message sent."}
      else throw new Error("not configured");
    }catch{
      saveLocalContact({name,message,files});
      if(contactStatus)contactStatus.textContent="Saved as local test. Add your endpoint in contact-config.js to receive online messages.";
    }
  });
}
async function sendContact({name,message,files}){const cfg=window.NIC_CONTACT||{};if(isLocalPreview()){const data=new FormData();data.append("name",name);data.append("message",message);files.forEach(file=>data.append("files",file,file.name));const r=await fetch("/api/contact",{method:"POST",body:data});return r.ok}if(cfg.endpoint){const data=new FormData();data.append("name",name);data.append("message",message);files.forEach(file=>data.append("files",file,file.name));const r=await fetch(cfg.endpoint,{method:"POST",body:data});return r.ok}if(cfg.discordWebhook){const data=new FormData();const content=`**New nicbytes message**\\n**Name:** ${name}\\n**Message:** ${message}`;data.append("payload_json",JSON.stringify({content}));files.slice(0,8).forEach(file=>data.append("files[]",file,file.name));const r=await fetch(cfg.discordWebhook,{method:"POST",body:data});return r.ok}return false}
function saveLocalContact({name,message,files}){const key="nicbytes-local-contact-tests";let items=[];try{items=JSON.parse(localStorage.getItem(key)||"[]")}catch{}items.push({name,message,files:files.map(f=>({name:f.name,size:f.size,type:f.type})),createdAt:new Date().toISOString()});localStorage.setItem(key,JSON.stringify(items,null,2))}

function initPageFeatures(){
  loadJsonCards("projects-list","projects");
  loadJsonCards("ideas-list","ideas");
  bindContactForm();
  ensureBackgroundVideoPlaying();
}
const INTERNAL_PAGES=new Set(["index.html","projects.html","ideas.html","about.html","contact.html"]);
let isPageNavigating=false;
function pageNameFromUrl(url){
  const u=url instanceof URL?url:new URL(url,location.href);
  return (u.pathname.split("/").pop()||"index.html").toLowerCase();
}
function isInternalPageUrl(url){
  const u=url instanceof URL?url:new URL(url,location.href);
  return u.origin===location.origin&&INTERNAL_PAGES.has(pageNameFromUrl(u));
}
function updateActiveNav(url){
  const target=pageNameFromUrl(url);
  document.querySelectorAll("#site-nav a[href]").forEach(link=>{
    const linkPage=pageNameFromUrl(new URL(link.getAttribute("href"),location.href));
    link.classList.toggle("active",linkPage===target);
  });
  siteNav?.classList.remove("open");
  navToggle?.setAttribute("aria-expanded","false");
}
function updateMetaDescription(nextDocument){
  const nextDescription=nextDocument.querySelector('meta[name="description"]')?.getAttribute("content");
  const currentDescription=document.querySelector('meta[name="description"]');
  if(nextDescription&&currentDescription)currentDescription.setAttribute("content",nextDescription);
}
async function navigateToPage(url,{push=true}={}){
  const nextUrl=url instanceof URL?url:new URL(url,location.href);
  if(isPageNavigating)return;
  isPageNavigating=true;
  try{
    const response=await fetch(nextUrl.href,{cache:"no-store"});
    if(!response.ok)throw new Error("Page load failed");
    const html=await response.text();
    const nextDocument=new DOMParser().parseFromString(html,"text/html");
    const nextMain=nextDocument.querySelector("main");
    const currentMain=document.querySelector("main");
    if(!nextMain||!currentMain)throw new Error("Page content missing");
    currentMain.replaceWith(nextMain);
    document.title=nextDocument.title||document.title;
    updateMetaDescription(nextDocument);
    updateActiveNav(nextUrl);
    if(push)history.pushState({page:pageNameFromUrl(nextUrl)},"",nextUrl.href);
    initPageFeatures();
    window.scrollTo({top:0,left:0,behavior:"auto"});
  }catch(err){
    console.warn("Navigation fallback:",err);
    location.href=nextUrl.href;
  }finally{
    isPageNavigating=false;
  }
}
function setupInternalNavigation(){
  history.replaceState({page:pageNameFromUrl(location.href)},"",location.href);
  updateActiveNav(location.href);
  document.addEventListener("click",event=>{
    const link=event.target.closest?.("a[href]");
    if(!link||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    if(link.target&&link.target!=="_self")return;
    if(link.hasAttribute("download"))return;
    const nextUrl=new URL(link.getAttribute("href"),location.href);
    if(!isInternalPageUrl(nextUrl))return;
    if(nextUrl.hash&&pageNameFromUrl(nextUrl)===pageNameFromUrl(location.href))return;
    event.preventDefault();
    navigateToPage(nextUrl);
  });
  window.addEventListener("popstate",()=>navigateToPage(location.href,{push:false}));
}
window.addEventListener("resize",resizeCanvas);
window.addEventListener("pageshow",ensureBackgroundVideoPlaying);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)ensureBackgroundVideoPlaying();});
resizeCanvas();draw();initBackgroundVideos();initPlaylist();initPageFeatures();setupInternalNavigation();
