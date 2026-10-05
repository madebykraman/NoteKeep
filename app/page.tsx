"use client";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, ClipboardEvent } from "react";
import { Camera, ChevronLeft, Download, FilePlus2, ImagePlus, Menu, Search, Trash2, X } from "lucide-react";

type Note={id:string;title:string;body:string;images:string[];updatedAt:number};
type ImageRecord={id:string;blob:Blob};
const DB="notekeep",VERSION=4;
const blank=():Note=>({id:crypto.randomUUID(),title:"Untitled note",body:"",images:[],updatedAt:Date.now()});

function database(){return new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open(DB,VERSION);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains("notes"))d.createObjectStore("notes",{keyPath:"id"});if(!d.objectStoreNames.contains("images"))d.createObjectStore("images",{keyPath:"id"})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
function idb<T>(store:"notes"|"images",mode:IDBTransactionMode,fn:(s:IDBObjectStore)=>IDBRequest){return database().then(d=>new Promise<T>((resolve,reject)=>{const r=fn(d.transaction(store,mode).objectStore(store));r.onsuccess=()=>resolve(r.result as T);r.onerror=()=>reject(r.error)}))}
const getNotes=()=>idb<Note[]>("notes","readonly",s=>s.getAll());
const putNote=(n:Note)=>idb("notes","readwrite",s=>s.put(n));
const getImage=(id:string)=>idb<ImageRecord|undefined>("images","readonly",s=>s.get(id));
const putImage=(blob:Blob)=>{const id=crypto.randomUUID();return idb("images","readwrite",s=>s.put({id,blob} as ImageRecord)).then(()=>id)};
const deleteItem=(store:"notes"|"images",id:string)=>idb("notes"===store?"notes":"images","readwrite",s=>s.delete(id));

export default function Home(){
 const [notes,setNotes]=useState<Note[]>([]),[id,setId]=useState(""),[search,setSearch]=useState(""),[drawer,setDrawer]=useState(false),[actions,setActions]=useState(false),[review,setReview]=useState(false),[selected,setSelected]=useState(0),[urls,setUrls]=useState<Record<string,string>>({}),[status,setStatus]=useState("Saved"),[ready,setReady]=useState(false);
 const save=useRef<ReturnType<typeof setTimeout>|null>(null),photos=useRef<HTMLInputElement>(null),camera=useRef<HTMLInputElement>(null);
 const note=notes.find(n=>n.id===id)??notes[0];

 useEffect(()=>{(async()=>{let n=await getNotes();if(!n.length){const x=blank();await putNote(x);n=[x]}n=n.map(x=>({...x,images:Array.isArray(x.images)?x.images:[]})).sort((a,b)=>b.updatedAt-a.updatedAt);setNotes(n);setId(n[0].id);setReady(true)})().catch(()=>setReady(true))},[]);
 useEffect(()=>{let dead=false;const made:string[]=[];(async()=>{const next:Record<string,string>={};for(const imageId of note?.images??[]){const item=await getImage(imageId);if(item&&!dead){const u=URL.createObjectURL(item.blob);next[imageId]=u;made.push(u)}}if(!dead)setUrls(next)})().catch(()=>{});return()=>{dead=true;made.forEach(URL.revokeObjectURL)}},[note?.id,note?.images]);
 useEffect(()=>()=>{if(save.current)clearTimeout(save.current)},[]);

 const update=(patch:Partial<Note>)=>{if(!note)return;const n={...note,...patch,updatedAt:Date.now()};setNotes(v=>v.map(x=>x.id===note.id?n:x));setStatus("Saving");if(save.current)clearTimeout(save.current);save.current=setTimeout(()=>void putNote(n).then(()=>setStatus("Saved")).catch(()=>setStatus("Not saved")),300)};
 const create=async()=>{const n=blank();await putNote(n);setNotes(v=>[n,...v]);setId(n.id);setSelected(0);setDrawer(false)};
 const deleteNote=async()=>{if(!note)return;if(!window.confirm("Delete this note?"))return;for(const imageId of note.images)await deleteItem("images",imageId);await deleteItem("notes",note.id);const left=notes.filter(x=>x.id!==note.id);if(left.length){setNotes(left);setId(left[0].id);setSelected(0)}else await create()};
 const add=async(files:File[])=>{if(!note)return;const valid=files.filter(x=>x.type.startsWith("image/"));if(!valid.length)return;const ids:string[]=[];for(const file of valid)ids.push(await putImage(file));update({images:[...note.images,...ids]});setSelected(note.images.length);setActions(false)};
 const removeImage=async(imageId:string)=>{if(!note)return;await deleteItem("images",imageId);const next=note.images.filter(x=>x!==imageId);update({images:next});setSelected(Math.min(selected,Math.max(0,next.length-1)))};
 const clear=()=>{if(note&&window.confirm("Clear this note?"))update({body:"",images:[]})};
 const paste=(e:ClipboardEvent<HTMLTextAreaElement>)=>{const item=Array.from(e.clipboardData.items).find(x=>x.type.startsWith("image/"));if(item){e.preventDefault();const f=item.getAsFile();if(f)void add([f])}};
 const exportPNG=async()=>{if(!note)return;const w=1200,p=72;const imgs:HTMLImageElement[]=[];for(const imageId of note.images){const src=urls[imageId];if(!src)continue;const image=new Image();image.src=src;await new Promise<void>(r=>{image.onload=()=>r();image.onerror=()=>r()});if(image.width)imgs.push(image)}let h=220+note.body.split("\n").length*36;for(const image of imgs){const s=Math.min((w-p*2)/image.width,650/image.height,1);h+=image.height*s+32}const c=document.createElement("canvas");c.width=w;c.height=h;const ctx=c.getContext("2d")!;ctx.fillStyle="#f7f7f4";ctx.fillRect(0,0,w,h);ctx.fillStyle="#171717";ctx.font="600 50px Geist, sans-serif";ctx.fillText(note.title||"Untitled note",p,90);ctx.font="400 25px Geist, sans-serif";let y=135;for(const line of note.body.split("\n")){ctx.fillText(line,p,y);y+=36}y+=24;for(const image of imgs){const s=Math.min((w-p*2)/image.width,650/image.height,1),iw=image.width*s,ih=image.height*s;ctx.drawImage(image,p,y,iw,ih);y+=ih+32}const a=document.createElement("a");a.download="notekeep-"+Date.now()+".png";a.href=c.toDataURL("image/png");a.click()};

 if(!ready)return <main className="loading">NoteKeep</main>;
 const current=note?.images[selected]?urls[note.images[selected]]:undefined;
 const filtered=notes.filter(x=>(x.title+" "+x.body).toLowerCase().includes(search.toLowerCase()));
 return <main className="app">
  <aside className={"drawer "+(drawer?"open":"")}><div className="drawer-head"><div><small>NoteKeep</small><h1>Notes</h1></div><button onClick={()=>setDrawer(false)}><ChevronLeft size={19}/></button></div><button className="create" onClick={()=>void create()}><FilePlus2 size={18}/> New note</button><label className="search"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search notes"/></label><div className="note-list">{filtered.map(n=><button className={"note-row "+(n.id===note?.id?"selected":"")} key={n.id} onClick={()=>{setId(n.id);setSelected(0);setDrawer(false)}}><b>{n.title||"Untitled note"}</b><small>{n.body||"No text yet"}</small></button>)}</div></aside>
  {drawer&&<button className="scrim" onClick={()=>setDrawer(false)} aria-label="Close notes"/>}
  <section className="main">
   <header className="topbar"><button className="top-icon" onClick={()=>setDrawer(true)} aria-label="Notes"><Menu size={21}/></button><span>{note.title||"Untitled note"}</span><div className="top-actions"><button className="top-icon" onClick={()=>setReview(true)} aria-label="Review note">Review</button><button className="top-icon" onClick={()=>setActions(true)} aria-label="Add photo"><ImagePlus size={19}/></button><button className="top-icon" onClick={()=>void deleteNote()} aria-label="Delete note"><Trash2 size={19}/></button></div></header>
   <div className="canvas"><input className="heading" value={note.title} onChange={e=>update({title:e.target.value})} placeholder="Untitled note"/>
    <div className="note-grid">
     <section className="media"><div className={"media-stage "+(!current?"empty":"")}>{current?<div className="image-frame"><img src={current} alt="Part of this note"/><button className="image-clear" onClick={()=>void removeImage(note.images[selected])} aria-label="Remove image"><X size={15}/></button></div>:<button className="empty-action" onClick={()=>setActions(true)}><ImagePlus size={22}/><strong>Add photo</strong><span>Camera or Photos</span></button>}</div>{note.images.length>0&&<div className="media-strip">{note.images.map((imageId,i)=><div className="thumb-wrap" key={imageId}><button className={"thumb "+(i===selected?"active":"")} onClick={()=>setSelected(i)}>{urls[imageId]?<img src={urls[imageId]} alt=""/>:<span/>}</button><button className="thumb-delete" onClick={()=>void removeImage(imageId)} aria-label="Remove image"><X size={11}/></button></div>)}<button className="add-thumb" onClick={()=>setActions(true)} aria-label="Add another photo"><ImagePlus size={17}/></button></div>}</section>
     <section className="writing"><textarea value={note.body} onChange={e=>update({body:e.target.value})} onPaste={paste} placeholder="Write your note…" autoCapitalize="sentences" autoCorrect="on" spellCheck/><div className="writing-bar"><button onClick={()=>setActions(true)}><ImagePlus size={16}/> Photo</button><div><button className="clear" onClick={clear}>Clear</button><span>{status}</span></div></div></section>
    </div>
   </div>
  </section>
  <input ref={photos} hidden type="file" accept="image/*" multiple onChange={e=>{if(e.target.files)void add(Array.from(e.target.files));e.target.value=""}}/>
  <input ref={camera} hidden type="file" accept="image/*" capture="environment" onChange={e=>{if(e.target.files)void add(Array.from(e.target.files));e.target.value=""}}/>
  {actions&&<div className="sheet-backdrop" onClick={()=>setActions(false)}><div className="action-sheet" onClick={e=>e.stopPropagation()}><div className="grabber"/><h2>Add to note</h2><button onClick={()=>camera.current?.click()}><Camera size={21}/><span><b>Camera</b><small>Open camera</small></span></button><button onClick={()=>photos.current?.click()}><ImagePlus size={21}/><span><b>Photos</b><small>Choose from library</small></span></button><button className="cancel" onClick={()=>setActions(false)}>Cancel</button></div></div>}
  {review&&<div className="sheet-backdrop" onClick={()=>setReview(false)}><div className="review" onClick={e=>e.stopPropagation()}><div className="review-head"><div><small>Review</small><h2>{note.title||"Untitled note"}</h2></div><button onClick={()=>setReview(false)}><X size={20}/></button></div><div className="review-content">{note.body&&<p>{note.body}</p>}{note.images.map(imageId=>urls[imageId]&&<img key={imageId} src={urls[imageId]} alt=""/>)}</div><div className="review-actions"><button className="primary" onClick={()=>void exportPNG()}><Download size={17}/> PNG</button><button onClick={()=>setReview(false)}>Done</button></div></div></div>}
 </main>;
}