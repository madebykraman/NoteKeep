"use client";
import { useEffect, useRef, useState } from "react";
import { Camera, ChevronLeft, Download, FilePlus2, ImagePlus, Menu, Search, Trash2, X } from "lucide-react";

type Card={id:string;imageId?:string;text:string};
type Note={id:string;title:string;cards:Card[];updatedAt:number};
type ImageRecord={id:string;blob:Blob};
const DB="notekeep",VERSION=6;
const blank=():Note=>({id:crypto.randomUUID(),title:"Untitled note",cards:[{id:crypto.randomUUID(),text:""}],updatedAt:Date.now()});

function database(){return new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open(DB,VERSION);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains("notes"))d.createObjectStore("notes",{keyPath:"id"});if(!d.objectStoreNames.contains("images"))d.createObjectStore("images",{keyPath:"id"})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
function idb<T>(store:"notes"|"images",mode:IDBTransactionMode,fn:(s:IDBObjectStore)=>IDBRequest){return database().then(d=>new Promise<T>((resolve,reject)=>{const r=fn(d.transaction(store,mode).objectStore(store));r.onsuccess=()=>resolve(r.result as T);r.onerror=()=>reject(r.error)}))}
const getNotes=()=>idb<Note[]>("notes","readonly",s=>s.getAll());
const putNote=(n:Note)=>idb("notes","readwrite",s=>s.put(n));
const getImage=(id:string)=>idb<ImageRecord|undefined>("images","readonly",s=>s.get(id));
const putImage=(blob:Blob)=>{const id=crypto.randomUUID();return idb("images","readwrite",s=>s.put({id,blob} as ImageRecord)).then(()=>id)};
const del=(store:"notes"|"images",id:string)=>idb(store,"readwrite",s=>s.delete(id));

export default function Home(){
 const [notes,setNotes]=useState<Note[]>([]),[id,setId]=useState(""),[search,setSearch]=useState(""),[drawer,setDrawer]=useState(false),[ready,setReady]=useState(false),[actions,setActions]=useState<string|null>(null),[urls,setUrls]=useState<Record<string,string>>({}),[status,setStatus]=useState("Saved");
 const photos=useRef<HTMLInputElement>(null),camera=useRef<HTMLInputElement>(null),targetCard=useRef<string|null>(null),save=useRef<ReturnType<typeof setTimeout>|null>(null);
 const note=notes.find(n=>n.id===id)??notes[0];

 const normalize=(raw:any):Note=>{
  if(Array.isArray(raw.cards))return {...raw,cards:raw.cards};
  const imageIds=Array.isArray(raw.images)?raw.images:(Array.isArray(raw.imageIds)?raw.imageIds:[]);
  return {...raw,cards:imageIds.map((imageId:string)=>({id:crypto.randomUUID(),imageId,text:""})).concat([{id:crypto.randomUUID(),text:raw.body??""}])};
 };
 useEffect(()=>{(async()=>{let n=await getNotes();if(!n.length){const x=blank();await putNote(x);n=[x]}n=n.map(normalize).sort((a,b)=>b.updatedAt-a.updatedAt);setNotes(n);setId(n[0].id);setReady(true)})().catch(()=>{const x=blank();setNotes([x]);setId(x.id);setReady(true)})},[]);
 useEffect(()=>{let dead=false;const made:string[]=[];(async()=>{const ids=(note?.cards??[]).flatMap(c=>c.imageId?[c.imageId]:[]);const next:Record<string,string>={};for(const imageId of ids){const x=await getImage(imageId);if(x&&!dead){const u=URL.createObjectURL(x.blob);next[imageId]=u;made.push(u)}}if(!dead)setUrls(next)})().catch(()=>{});return()=>{dead=true;made.forEach(URL.revokeObjectURL)}},[note?.id,note?.cards]);
 useEffect(()=>()=>{if(save.current)clearTimeout(save.current)},[]);

 const update=(patch:Partial<Note>)=>{if(!note)return;const n={...note,...patch,updatedAt:Date.now()};setNotes(v=>v.map(x=>x.id===note.id?n:x));setStatus("Saving");if(save.current)clearTimeout(save.current);save.current=setTimeout(()=>void putNote(n).then(()=>setStatus("Saved")).catch(()=>setStatus("Not saved")),250)};
 const updateCard=(cardId:string,text:string)=>update({cards:note.cards.map(c=>c.id===cardId?{...c,text}:c)});
 const addCard=()=>{const c:Card={id:crypto.randomUUID(),text:""};update({cards:[...note.cards,c]});setTimeout(()=>document.getElementById("card-"+c.id)?.scrollIntoView({behavior:"smooth",block:"center"}),30)};
 const attach=async(files:File[])=>{if(!note||!targetCard.current)return;const f=files.find(x=>x.type.startsWith("image/"));if(!f)return;const imageId=await putImage(f);const card=note.cards.find(c=>c.id===targetCard.current);if(!card)return; if(card.imageId)await del("images",card.imageId);update({cards:note.cards.map(c=>c.id===card.id?{...c,imageId}:c)});setActions(null)};
 const choose=(cardId:string,kind:"camera"|"photos")=>{targetCard.current=cardId;setActions(null);(kind==="camera"?camera:photos).current?.click()};
 const removeImage=async(cardId:string)=>{const card=note.cards.find(c=>c.id===cardId);if(!card?.imageId)return;await del("images",card.imageId);update({cards:note.cards.map(c=>c.id===cardId?{...c,imageId:undefined}:c)})};
 const deleteCard=async(cardId:string)=>{const card=note.cards.find(c=>c.id===cardId);if(!card)return;if(card.imageId)await del("images",card.imageId);const cards=note.cards.filter(c=>c.id!==cardId);update({cards:cards.length?cards:[{id:crypto.randomUUID(),text:""}]})};
 const deleteNote=async()=>{if(!note||!confirm("Delete this note?"))return;for(const c of note.cards)if(c.imageId)await del("images",c.imageId);await del("notes",note.id);const left=notes.filter(x=>x.id!==note.id);if(left.length){setNotes(left);setId(left[0].id)}else{const x=blank();await putNote(x);setNotes([x]);setId(x.id)}};
 const clear=async()=>{if(!note||!confirm("Clear this note?"))return;for(const c of note.cards)if(c.imageId)await del("images",c.imageId);update({cards:[{id:crypto.randomUUID(),text:""}]})};

 const exportCard=async(card:Card)=>{if(!card.imageId||!urls[card.imageId])return;const img=new Image();img.src=urls[card.imageId];await new Promise<void>(r=>{img.onload=()=>r();img.onerror=()=>r()});if(!img.width)return;const w=1600,p=72,text=card.text||"";const lines=text.split("\n");const h=Math.max(900,img.height*Math.min((w-p*2)/img.width,1)+260+lines.length*42);const c=document.createElement("canvas");c.width=w;c.height=h;const ctx=c.getContext("2d")!;ctx.fillStyle="#ffffff";ctx.fillRect(0,0,w,h);const s=Math.min((w-p*2)/img.width,(h-260-lines.length*42)/img.height,1);const iw=img.width*s,ih=img.height*s;ctx.drawImage(img,p,p,iw,ih);ctx.fillStyle="#171717";ctx.font="500 34px Geist, sans-serif";let y=p+ih+76;for(const line of lines){ctx.fillText(line,p,y);y+=42}const a=document.createElement("a");a.download="notekeep-card-"+Date.now()+".png";a.href=c.toDataURL("image/png");a.click()};
 const exportText=async(card:Card)=>{const w=1600,p=96,lines=card.text.split("\n"),h=Math.max(700,180+lines.length*58);const c=document.createElement("canvas");c.width=w;c.height=h;const ctx=c.getContext("2d")!;ctx.fillStyle="#fff";ctx.fillRect(0,0,w,h);ctx.fillStyle="#171717";ctx.font="500 42px Geist, sans-serif";let y=130;for(const line of lines){ctx.fillText(line,p,y);y+=58}const a=document.createElement("a");a.download="notekeep-text-"+Date.now()+".png";a.href=c.toDataURL("image/png");a.click()};

 if(!ready||!note)return <main className="loading">NoteKeep</main>;
 const filtered=notes.filter(n=>(n.title+" "+n.cards.map(c=>c.text).join(" ")).toLowerCase().includes(search.toLowerCase()));
 return <main className="app">
  <aside className={"drawer "+(drawer?"open":"")}><div className="drawer-head"><div><small>NoteKeep</small><h1>Notes</h1></div><button onClick={()=>setDrawer(false)}><ChevronLeft size={19}/></button></div><button className="create" onClick={()=>{const x=blank();void putNote(x);setNotes(v=>[x,...v]);setId(x.id);setDrawer(false)}}><FilePlus2 size={18}/> New note</button><label className="search"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search notes"/></label><div className="note-list">{filtered.map(n=><button className={"note-row "+(n.id===note.id?"selected":"")} key={n.id} onClick={()=>{setId(n.id);setDrawer(false)}}><b>{n.title||"Untitled note"}</b><small>{n.cards.map(c=>c.text).join(" ")||"No text yet"}</small></button>)}</div></aside>
  {drawer&&<button className="scrim" onClick={()=>setDrawer(false)} aria-label="Close notes"/>}
  <section className="main">
   <header className="topbar"><button className="top-icon" onClick={()=>setDrawer(true)}><Menu size={21}/></button><span>NoteKeep</span><div className="top-actions"><button className="top-icon" onClick={()=>void addCard()} aria-label="New card"><FilePlus2 size={19}/></button><button className="top-icon danger" onClick={()=>void deleteNote()} aria-label="Delete note"><Trash2 size={19}/></button></div></header>
   <div className="canvas">
    <div className="note-head"><input value={note.title} onChange={e=>update({title:e.target.value})} placeholder="Untitled note"/><div><span>{note.cards.length} {note.cards.length===1?"card":"cards"}</span><span>{status}</span></div></div>
    <div className="cards">{note.cards.map((card,i)=><article className={"memo-card "+(!card.imageId?"text-only":"")} id={"card-"+card.id} key={card.id}>
      <div className="card-media">{card.imageId&&urls[card.imageId]?<><img src={urls[card.imageId]} alt=""/><button className="remove-image" onClick={()=>void removeImage(card.id)} aria-label="Remove image"><X size={15}/></button></>:<button className="media-empty" onClick={()=>setActions(card.id)}><ImagePlus size={20}/><span>Add image</span><small>Camera or Photos</small></button>}</div>
      <div className="card-copy"><textarea value={card.text} onChange={e=>updateCard(card.id,e.target.value)} placeholder={card.imageId?"Write a note about this image…":i===0?"Write a note…":"Add text or attach an image…"} autoCapitalize="sentences" autoCorrect="on" spellCheck/><div className="card-actions">{card.imageId&&<button onClick={()=>void exportCard(card)}><Download size={15}/> PNG card</button>}<button onClick={()=>void exportText(card)} disabled={!card.text.trim()}><Download size={15}/> Text PNG</button><button className="delete-card" onClick={()=>void deleteCard(card.id)}><Trash2 size={15}/></button></div></div>
    </article>)}</div>
    <button className="add-card" onClick={addCard}><FilePlus2 size={18}/> Add another card</button>
    <button className="clear-note" onClick={clear}>Clear note</button>
   </div>
  </section>
  <input ref={photos} className="file-input" type="file" accept="image/*" multiple onChange={e=>{if(e.target.files)void attach(Array.from(e.target.files));e.target.value=""}}/>
  <input ref={camera} className="file-input" type="file" accept="image/*" capture="environment" onChange={e=>{if(e.target.files)void attach(Array.from(e.target.files));e.target.value=""}}/>
  {actions&&<div className="sheet-backdrop" onClick={()=>setActions(null)}><div className="action-sheet" onClick={e=>e.stopPropagation()}><div className="grabber"/><h2>Add image</h2><button onClick={()=>choose(actions,"camera")}><Camera size={21}/><span><b>Camera</b><small>Take a photo</small></span></button><button onClick={()=>choose(actions,"photos")}><ImagePlus size={21}/><span><b>Photos</b><small>Choose from library</small></span></button><button className="cancel" onClick={()=>setActions(null)}>Cancel</button></div></div>}
 </main>;
}