"use client";
import { ChangeEvent, ClipboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { FilePlus2, ImagePlus, MoreHorizontal, Search, Trash2, X } from "lucide-react";

type Note = { id:string; title:string; body:string; image?:string; updatedAt:number };
const storageKey="notekeep-notes-v1";
const starter:Note={id:"welcome",title:"Welcome to NoteKeep",body:"Paste an image, add context, and keep the thought with it.\n\nThis space is intentionally simple.",updatedAt:Date.now()};

export default function Home(){
 const [notes,setNotes]=useState<Note[]>([starter]),[activeId,setActiveId]=useState(starter.id),[query,setQuery]=useState("");
 const fileRef=useRef<HTMLInputElement>(null);
 useEffect(()=>{try{const saved=localStorage.getItem(storageKey);if(saved){const p=JSON.parse(saved) as Note[];if(p.length){setNotes(p);setActiveId(p[0].id)}}}catch{}},[]);
 useEffect(()=>{localStorage.setItem(storageKey,JSON.stringify(notes))},[notes]);
 const active=notes.find(n=>n.id===activeId)??notes[0];
 const filtered=useMemo(()=>{const q=query.trim().toLowerCase();return q?notes.filter(n=>(n.title+" "+n.body).toLowerCase().includes(q)):notes},[notes,query]);
 const patch=(p:Partial<Note>)=>setNotes(xs=>xs.map(n=>n.id===active.id?{...n,...p,updatedAt:Date.now()}:n));
 const newNote=()=>{const n:Note={id:crypto.randomUUID(),title:"Untitled note",body:"",updatedAt:Date.now()};setNotes(xs=>[n,...xs]);setActiveId(n.id)};
 const remove=()=>{const xs=notes.filter(n=>n.id!==active.id);if(!xs.length){newNote();return}setNotes(xs);setActiveId(xs[Math.max(0,notes.findIndex(n=>n.id===active.id)-1)].id)};
 const readImage=(file:File)=>{if(!file.type.startsWith("image/"))return;const r=new FileReader();r.onload=()=>patch({image:String(r.result)});r.readAsDataURL(file)};
 const onFile=(e:ChangeEvent<HTMLInputElement>)=>{const f=e.target.files?.[0];if(f)readImage(f);e.target.value=""};
 const onPaste=(e:ClipboardEvent<HTMLElement>)=>{const i=[...e.clipboardData.items].find(x=>x.type.startsWith("image/"));if(i){e.preventDefault();const f=i.getAsFile();if(f)readImage(f)}};
 return <main className="app" onPaste={onPaste}>
  <aside className="sidebar"><div className="brand">NoteKeep</div><button className="new" onClick={newNote}><FilePlus2 size={17}/> New note</button>
   <label className="search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search notes"/></label>
   <div className="label">Notes</div><div className="list">{filtered.map(n=><button className={"item "+(n.id===active.id?"active":"")} key={n.id} onClick={()=>setActiveId(n.id)}><b>{n.title||"Untitled note"}</b><span>{n.body.replace(/\n/g," ").slice(0,58)||"Empty note"}</span></button>)}</div>
  </aside>
  <section className="workspace"><header><div className="crumb">Notes <i>/</i> {active.title||"Untitled note"}</div><div className="actions">{active.image&&<button onClick={()=>patch({image:undefined})}><X size={17}/></button>}<button onClick={remove}><Trash2 size={17}/></button><button><MoreHorizontal size={18}/></button></div></header>
   <div className="editor"><input className="title" value={active.title} onChange={e=>patch({title:e.target.value})} placeholder="Untitled note"/>
    <div className={"grid "+(!active.image?"single":"")}><div className="visual">{active.image?<div className="image"><img src={active.image} alt=""/></div>:<button className="drop" onClick={()=>fileRef.current?.click()}><ImagePlus size={23}/><b>Add an image</b><span>Paste, drop, or choose a screenshot</span></button>}</div>
     <div className="write"><textarea value={active.body} onChange={e=>patch({body:e.target.value})} placeholder="Write your note…"/><div className="footer"><button onClick={()=>fileRef.current?.click()}><ImagePlus size={16}/> Add image</button><span>Saved automatically</span></div></div>
    </div></div><input ref={fileRef} hidden type="file" accept="image/*" onChange={onFile}/></section>
 </main>;
}