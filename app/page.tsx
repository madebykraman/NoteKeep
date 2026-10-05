"use client";

import { ChangeEvent, ClipboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { FilePlus2, ImagePlus, MoreHorizontal, Search, Trash2, X, Download, Share2 } from "lucide-react";

type Note={id:string;title:string;body:string;imageIds:string[];updatedAt:number};
type StoredImage={id:string;blob:Blob};
const DB="notekeep",VERSION=2,NOTES="notes",IMAGES="images";
const starter:Note={id:"welcome",title:"Welcome to NoteKeep",body:"Paste an image, add context, and keep the thought with it.\n\nThis space is intentionally simple.",imageIds:[],updatedAt:Date.now()};

function openDB():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const req=indexedDB.open(DB,VERSION);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(NOTES))db.createObjectStore(NOTES,{keyPath:"id"});if(!db.objectStoreNames.contains(IMAGES))db.createObjectStore(IMAGES,{keyPath:"id"})};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
function tx<T>(store:string,mode:IDBTransactionMode,run:(s:IDBObjectStore)=>IDBRequest):Promise<T>{return openDB().then(db=>new Promise((resolve,reject)=>{const req=run(db.transaction(store,mode).objectStore(store));req.onsuccess=()=>resolve(req.result as T);req.onerror=()=>reject(req.error)}))}
const getNotes=()=>tx<Note[]>("notes","readonly",s=>s.getAll());
const putNote=(n:Note)=>tx("notes","readwrite",s=>s.put(n));
const putImage=(blob:Blob)=>{const id=crypto.randomUUID();return tx("images","readwrite",s=>s.put({id,blob} as StoredImage)).then(()=>id)};
const getImage=(id:string)=>tx<StoredImage|undefined>("images","readonly",s=>s.get(id)).then(x=>x?.blob);
const deleteImage=(id:string)=>tx("images","readwrite",s=>s.delete(id));
async function deleteNote(n:Note){for(const id of n.imageIds)await deleteImage(id);await tx("notes","readwrite",s=>s.delete(n.id))}
const migrate=(n:any):Note=>({...n,imageIds:Array.isArray(n.imageIds)?n.imageIds:(n.imageId?[n.imageId]:[])} as Note);

function dateLabel(ts:number){const d=new Date(ts),now=new Date();return d.toDateString()===now.toDateString()?"Today":d.toLocaleDateString(undefined,{month:"short",day:"numeric"})}

export default function Home(){
 const [notes,setNotes]=useState<Note[]>([]),[activeId,setActiveId]=useState(""),[query,setQuery]=useState(""),[urls,setUrls]=useState<Record<string,string>>({}),[selectedImage,setSelectedImage]=useState(0),[ready,setReady]=useState(false),[review,setReview]=useState(false);
 const fileRef=useRef<HTMLInputElement>(null), active=notes.find(n=>n.id===activeId)??notes[0];
 useEffect(()=>{(async()=>{try{let list=(await getNotes()).map(migrate);if(!list.length){await putNote(starter);list=[starter]}list.sort((a,b)=>b.updatedAt-a.updatedAt);setNotes(list);setActiveId(list[0].id)}catch{setNotes([starter]);setActiveId(starter.id)}finally{setReady(true)}})()},[]);
 useEffect(()=>{let dead=false;const created:string[]=[];(async()=>{const next:Record<string,string>={};for(const id of active?.imageIds??[]){const b=await getImage(id);if(b&&!dead){const u=URL.createObjectURL(b);next[id]=u;created.push(u)}}if(!dead)setUrls(next)})().catch(()=>{});return()=>{dead=true;created.forEach(URL.revokeObjectURL)}},[active?.id,active?.imageIds]);
 const filtered=useMemo(()=>{const q=query.trim().toLowerCase();return q?notes.filter(n=>(n.title+" "+n.body).toLowerCase().includes(q)):notes},[notes,query]);
 const save=async(p:Partial<Note>)=>{if(!active)return;const next:Note={...active,...p,updatedAt:Date.now()};setNotes(xs=>xs.map(n=>n.id===active.id?next:n));await putNote(next)};
 const createNote=async()=>{const n:Note={id:crypto.randomUUID(),title:"Untitled note",body:"",imageIds:[],updatedAt:Date.now()};await putNote(n);setNotes(xs=>[n,...xs]);setActiveId(n.id);setSelectedImage(0)};
 const remove=async()=>{if(!active)return;await deleteNote(active);const xs=notes.filter(n=>n.id!==active.id);if(!xs.length){await createNote();return}setNotes(xs);setActiveId(xs[0].id);setSelectedImage(0)};
 const addImages=async(files:File[])=>{if(!active)return;const ids=[];for(const f of files)if(f.type.startsWith("image/"))ids.push(await putImage(f));if(ids.length)await save({imageIds:[...active.imageIds,...ids]})};
 const onFile=(e:ChangeEvent<HTMLInputElement>)=>{const fs=[...Array.from(e.target.files??[])];if(fs.length)void addImages(fs);e.target.value=""};
 const onPaste=(e:ClipboardEvent<HTMLElement>)=>{const item=[...e.clipboardData.items].find(i=>i.type.startsWith("image/"));if(item){e.preventDefault();const f=item.getAsFile();if(f)void addImages([f])}};
 const removeImage=async(id:string)=>{await deleteImage(id);const ids=active.imageIds.filter(x=>x!==id);await save({imageIds:ids});setSelectedImage(Math.max(0,Math.min(selectedImage,ids.length-1)))};
 const exportPNG=async()=>{if(!active)return;const w=1200,pad=70,title=active.title||"Untitled note",lines=active.body.split("\n");let y=pad+70;const imgs=active.imageIds.map(id=>urls[id]).filter(Boolean);const h=Math.max(y+lines.length*34+80,500)+imgs.reduce((s)=>s+220,0);const c=document.createElement("canvas");c.width=w;c.height=h;const ctx=c.getContext("2d");if(!ctx)return;ctx.fillStyle="#f7f7f4";ctx.fillRect(0,0,w,h);ctx.fillStyle="#171717";ctx.font="600 48px Geist, sans-serif";ctx.fillText(title,pad,pad+48);ctx.font="400 22px Geist, sans-serif";ctx.fillStyle="#333";for(const line of lines){ctx.fillText(line,pad,y);y+=34}for(const src of imgs){const img=new Image();img.src=src;await new Promise(r=>{img.onload=()=>r(true);img.onerror=()=>r(false)});const maxW=w-pad*2,maxH=500,scale=Math.min(maxW/img.width,maxH/img.height,1),iw=img.width*scale,ih=img.height*scale;ctx.fillStyle="#ededeb";ctx.fillRect(pad,y,iw+20,ih+20);ctx.drawImage(img,pad+10,y+10,iw,ih);y+=ih+40}const a=document.createElement("a");a.download=(title||"note").replace(/[^a-z0-9]+/gi,"-").toLowerCase()+".png";a.href=c.toDataURL("image/png");a.click()};
 const share=async()=>{if(!active)return;const text=[active.title,active.body].filter(Boolean).join("\n\n");if(navigator.share)await navigator.share({title:active.title,text}).catch(()=>{});else await navigator.clipboard?.writeText(text)};
 useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="n"){e.preventDefault();void createNote()}};window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey)},[activeId]);
 if(!ready)return <main className="loading">NoteKeep</main>;
 const currentId=active?.imageIds[selectedImage]; const currentUrl=currentId?urls[currentId]:undefined;
 return <main className="app" onPaste={onPaste}>
  <aside className="sidebar"><div className="brand">NoteKeep</div><button className="new" onClick={()=>void createNote()}><FilePlus2 size={17}/> New note</button><label className="search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search notes"/></label><div className="label">Notes</div><div className="list">{filtered.map(n=><button key={n.id} className={"item "+(n.id===active.id?"active":"")} onClick={()=>{setActiveId(n.id);setSelectedImage(0)}}><b>{n.title||"Untitled note"}</b><span>{dateLabel(n.updatedAt)} · {n.body.replace(/\n/g," ").slice(0,42)||"Empty note"}</span></button>)}</div></aside>
  <section className="workspace">
   <header><div className="crumb">{active.title||"Untitled note"}</div><div className="actions">{<button aria-label="Review" onClick={()=>setReview(true)}><Share2 size={18}/></button>}{active.imageIds.length>0&&<button aria-label="Remove image" onClick={()=>{const id=active.imageIds[selectedImage];if(id)void removeImage(id)}}><X size={18}/></button>}<button aria-label="Delete note" onClick={()=>void remove()}><Trash2 size={18}/></button><button aria-label="More"><MoreHorizontal size={18}/></button></div></header>
   <div className="editor">
    <input className="title" value={active.title} onChange={e=>void save({title:e.target.value})} placeholder="Untitled note"/>
    <div className="grid">
     <div className={"visual "+(!currentUrl?"empty":"")}>{currentUrl?<div className={"image "+(/\.(png|jpg|jpeg|webp)$/i.test(currentUrl)?"":"")}><img src={currentUrl} alt="Attached reference"/></div>:<button className="drop" onClick={()=>fileRef.current?.click()}><ImagePlus size={23}/><b>Add an image</b><span>Tap to choose photos or use the camera</span></button>}</div>
     {active.imageIds.length>1&&<div className="filmstrip">{active.imageIds.map((id,i)=><div className={"thumb "+(i===selectedImage?"selected":"")} key={id}><button onClick={()=>setSelectedImage(i)}>{urls[id]?<img src={urls[id]} alt=""/>:<span/>}</button><button className="thumb-remove" onClick={()=>void removeImage(id)} aria-label="Remove image"><X size={12}/></button></div>)}</div>}
     <div className="write"><textarea value={active.body} onChange={e=>void save({body:e.target.value})} placeholder="Write your note…" autoCapitalize="sentences" autoCorrect="on" spellCheck/><div className="footer"><button onClick={()=>fileRef.current?.click()}><ImagePlus size={16}/> Add image</button><div className="footer-right"><button onClick={()=>void exportPNG()}><Download size={16}/> PNG</button><button onClick={()=>setReview(true)}>Review</button><span>Saved locally</span></div></div></div>
    </div>
   </div>
   <input ref={fileRef} hidden type="file" accept="image/*" capture="environment" multiple onChange={onFile}/>
  </section>
  {review&&<div className="review-backdrop" onClick={()=>setReview(false)}><article className="review" onClick={e=>e.stopPropagation()}><div className="review-head"><div><span>Review</span><h2>{active.title||"Untitled note"}</h2></div><button onClick={()=>setReview(false)}><X size={19}/></button></div><div className="review-body">{active.body&&<p>{active.body}</p>}{active.imageIds.map((id,i)=>urls[id]&&<img key={id} src={urls[id]} alt={"Reference "+(i+1)}/>)}</div><div className="review-actions"><button onClick={()=>void exportPNG()}><Download size={17}/> Export PNG</button><button onClick={()=>void share()}><Share2 size={17}/> Share</button></div></article></div>}
 </main>;
}