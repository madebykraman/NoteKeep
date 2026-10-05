"use client";

import { ChangeEvent, ClipboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { FilePlus2, ImagePlus, MoreHorizontal, Search, Trash2, X } from "lucide-react";

type Note = { id:string; title:string; body:string; imageId?:string; updatedAt:number };
type StoredImage = { id:string; blob:Blob };

const DB="notekeep", VERSION=1, NOTES="notes", IMAGES="images";
const starter:Note={id:"welcome",title:"Welcome to NoteKeep",body:"Paste an image, add context, and keep the thought with it.\n\nThis space is intentionally simple.",updatedAt:Date.now()};

function openDB():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const req=indexedDB.open(DB,VERSION);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(NOTES))db.createObjectStore(NOTES,{keyPath:"id"});if(!db.objectStoreNames.contains(IMAGES))db.createObjectStore(IMAGES,{keyPath:"id"})};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function getNotes():Promise<Note[]>{const db=await openDB();return new Promise((resolve,reject)=>{const req=db.transaction(NOTES,"readonly").objectStore(NOTES).getAll();req.onsuccess=()=>resolve(req.result as Note[]);req.onerror=()=>reject(req.error)})}
async function putNote(note:Note){const db=await openDB();return new Promise<void>((resolve,reject)=>{const req=db.transaction(NOTES,"readwrite").objectStore(NOTES).put(note);req.onsuccess=()=>resolve();req.onerror=()=>reject(req.error)})}
async function putImage(blob:Blob){const id=crypto.randomUUID(),db=await openDB();return new Promise<string>((resolve,reject)=>{const req=db.transaction(IMAGES,"readwrite").objectStore(IMAGES).put({id,blob} as StoredImage);req.onsuccess=()=>resolve(id);req.onerror=()=>reject(req.error)})}
async function getImage(id:string){const db=await openDB();return new Promise<Blob|undefined>((resolve,reject)=>{const req=db.transaction(IMAGES,"readonly").objectStore(IMAGES).get(id);req.onsuccess=()=>resolve((req.result as StoredImage|undefined)?.blob);req.onerror=()=>reject(req.error)})}
async function removeNote(note:Note){const db=await openDB();return new Promise<void>((resolve)=>{const tx=db.transaction([NOTES,IMAGES],"readwrite");tx.objectStore(NOTES).delete(note.id);if(note.imageId)tx.objectStore(IMAGES).delete(note.imageId);tx.oncomplete=()=>resolve()})}
async function removeImage(id:string){const db=await openDB();return new Promise<void>((resolve)=>{const tx=db.transaction(IMAGES,"readwrite");tx.objectStore(IMAGES).delete(id);tx.oncomplete=()=>resolve()})}

export default function Home(){
 const [notes,setNotes]=useState<Note[]>([]),[activeId,setActiveId]=useState(""),[query,setQuery]=useState(""),[imageUrl,setImageUrl]=useState<string>(),[ready,setReady]=useState(false);
 const fileRef=useRef<HTMLInputElement>(null);
 const active=notes.find(n=>n.id===activeId)??notes[0];

 useEffect(()=>{(async()=>{try{let list=await getNotes();if(!list.length){await putNote(starter);list=[starter]}list.sort((a,b)=>b.updatedAt-a.updatedAt);setNotes(list);setActiveId(list[0].id)}catch{setNotes([starter]);setActiveId(starter.id)}finally{setReady(true)}})()},[]);
 useEffect(()=>{let disposed=false;(async()=>{if(!active?.imageId){setImageUrl(undefined);return}const blob=await getImage(active.imageId);if(disposed)return;if(!blob){setImageUrl(undefined);return}const url=URL.createObjectURL(blob);setImageUrl(url)})().catch(()=>setImageUrl(undefined));return()=>{disposed=true;if(imageUrl)URL.revokeObjectURL(imageUrl)}},[active?.imageId]);
 const filtered=useMemo(()=>{const q=query.trim().toLowerCase();return q?notes.filter(n=>(n.title+" "+n.body).toLowerCase().includes(q)):notes},[notes,query]);
 const save=async(p:Partial<Note>)=>{if(!active)return;const next={...active,...p,updatedAt:Date.now()};setNotes(list=>list.map(n=>n.id===active.id?next:n));await putNote(next)};
 const createNote=async()=>{const note:Note={id:crypto.randomUUID(),title:"Untitled note",body:"",updatedAt:Date.now()};await putNote(note);setNotes(list=>[note,...list]);setActiveId(note.id);setQuery("")};
 const deleteActive=async()=>{if(!active)return;await removeNote(active);const next=notes.filter(n=>n.id!==active.id);if(!next.length){await createNote();return}setNotes(next);setActiveId(next[0].id)};
 const addImage=async(file:File)=>{if(!active||!file.type.startsWith("image/"))return;const old=active.imageId;const id=await putImage(file);await save({imageId:id});if(old)await removeImage(old)};
 const pasteImage=(e:ClipboardEvent<HTMLElement>)=>{const item=[...e.clipboardData.items].find(x=>x.type.startsWith("image/"));if(item){e.preventDefault();const file=item.getAsFile();if(file)void addImage(file)}};
 const onFile=(e:ChangeEvent<HTMLInputElement>)=>{const file=e.target.files?.[0];if(file)void addImage(file);e.target.value=""};

 useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="n"){e.preventDefault();void createNote()}};window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey)},[notes,activeId]);

 if(!ready)return <main className="loading">NoteKeep</main>;
 return <main className="app" onPaste={pasteImage}>
   <aside className="sidebar">
     <div className="brand">NoteKeep</div>
     <button className="new" onClick={()=>void createNote()}><FilePlus2 size={17}/> New note</button>
     <label className="search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search notes" inputMode="search"/></label>
     <div className="label">Notes</div>
     <div className="list">{filtered.map(note=><button className={"item "+(note.id===active.id?"active":"")} key={note.id} onClick={()=>setActiveId(note.id)}><b>{note.title||"Untitled note"}</b><span>{note.body.replace(/\n/g," ").slice(0,58)||"Empty note"}</span></button>)}</div>
   </aside>
   <section className="workspace">
     <header><div className="crumb">{active.title||"Untitled note"}</div><div className="actions">{active.imageId&&<button aria-label="Remove image" onClick={async()=>{const id=active.imageId;await save({imageId:undefined});if(id)await removeImage(id)}}><X size={18}/></button>}<button aria-label="Delete note" onClick={()=>void deleteActive()}><Trash2 size={18}/></button><button aria-label="More"><MoreHorizontal size={18}/></button></div></header>
     <div className="editor">
       <input className="title" value={active.title} onChange={e=>void save({title:e.target.value})} placeholder="Untitled note" enterKeyHint="done"/>
       <div className="grid">
         <div className={"visual "+(!imageUrl?"empty":"")}>{imageUrl?<div className="image"><img src={imageUrl} alt="Attached reference"/></div>:<button className="drop" onClick={()=>fileRef.current?.click()}><ImagePlus size={23}/><b>Add an image</b><span>Paste, drop, or choose a screenshot</span></button>}</div>
         <div className="write"><textarea value={active.body} onChange={e=>void save({body:e.target.value})} placeholder="Write your note…" autoCapitalize="sentences" autoCorrect="on" spellCheck inputMode="text"/><div className="footer"><button onClick={()=>fileRef.current?.click()}><ImagePlus size={16}/> Add image</button><span>Saved locally</span></div></div>
       </div>
     </div>
     <input ref={fileRef} hidden type="file" accept="image/*" capture="environment" onChange={onFile}/>
   </section>
 </main>;
}