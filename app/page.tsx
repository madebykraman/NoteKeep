"use client";

import { ChangeEvent, ClipboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera, Check, ChevronLeft, Download, FilePlus2, ImagePlus, Menu, MoreHorizontal,
  Search, Share2, Trash2, X
} from "lucide-react";

type Note={id:string;title:string;body:string;imageIds:string[];updatedAt:number};
type StoredImage={id:string;blob:Blob};

const DB_NAME="notekeep";
const DB_VERSION=2;
const starter:Note={id:"welcome",title:"Welcome to NoteKeep",body:"Keep the thought next to the thing it belongs to.",imageIds:[],updatedAt:Date.now()};

function openDB():Promise<IDBDatabase>{
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,DB_VERSION);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains("notes"))db.createObjectStore("notes",{keyPath:"id"});
      if(!db.objectStoreNames.contains("images"))db.createObjectStore("images",{keyPath:"id"});
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
async function storeGetAll<T>(name:"notes"|"images"):Promise<T[]>{
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const req=db.transaction(name,"readonly").objectStore(name).getAll();
    req.onsuccess=()=>resolve(req.result as T[]);
    req.onerror=()=>reject(req.error);
  });
}
async function storePut(name:"notes"|"images",value:unknown){
  const db=await openDB();
  return new Promise<void>((resolve,reject)=>{
    const req=db.transaction(name,"readwrite").objectStore(name).put(value);
    req.onsuccess=()=>resolve();
    req.onerror=()=>reject(req.error);
  });
}
async function storeGet<T>(name:"notes"|"images",id:string):Promise<T|undefined>{
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const req=db.transaction(name,"readonly").objectStore(name).get(id);
    req.onsuccess=()=>resolve(req.result as T|undefined);
    req.onerror=()=>reject(req.error);
  });
}
async function storeDelete(name:"notes"|"images",id:string){
  const db=await openDB();
  return new Promise<void>((resolve,reject)=>{
    const req=db.transaction(name,"readwrite").objectStore(name).delete(id);
    req.onsuccess=()=>resolve();
    req.onerror=()=>reject(req.error);
  });
}

export default function Home(){
  const [notes,setNotes]=useState<Note[]>([]);
  const [activeId,setActiveId]=useState("");
  const [query,setQuery]=useState("");
  const [urls,setUrls]=useState<Record<string,string>>({});
  const [selectedImage,setSelectedImage]=useState(0);
  const [ready,setReady]=useState(false);
  const [drawer,setDrawer]=useState(false);
  const [photoSheet,setPhotoSheet]=useState(false);
  const [review,setReview]=useState(false);
  const [saveState,setSaveState]=useState<"saved"|"saving"|"error">("saved");
  const fileRef=useRef<HTMLInputElement>(null);
  const cameraRef=useRef<HTMLInputElement>(null);
  const timerRef=useRef<ReturnType<typeof setTimeout>|null>(null);
  const active=notes.find(n=>n.id===activeId)??notes[0];

  useEffect(()=>{
    (async()=>{
      try{
        const stored=(await storeGetAll<Note>("notes")).map(n=>({...n,imageIds:Array.isArray(n.imageIds)?n.imageIds:[]}));
        if(stored.length){stored.sort((a,b)=>b.updatedAt-a.updatedAt);setNotes(stored);setActiveId(stored[0].id)}
        else{await storePut("notes",starter);setNotes([starter]);setActiveId(starter.id)}
      }catch{
        setNotes([starter]);setActiveId(starter.id);
      }finally{setReady(true)}
    })();
  },[]);

  useEffect(()=>{
    let cancelled=false;
    const oldUrls=Object.values(urls);
    (async()=>{
      const next:Record<string,string>={};
      for(const id of active?.imageIds??[]){const item=await storeGet<StoredImage>("images",id);if(item&&!cancelled)next[id]=URL.createObjectURL(item.blob)}
      if(!cancelled)setUrls(next);
    })();
    return()=>{cancelled=true;oldUrls.forEach(URL.revokeObjectURL)};
    // URL state intentionally scoped to active note.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[active?.id,active?.imageIds]);

  const filtered=useMemo(()=>{
    const q=query.trim().toLowerCase();
    return q?notes.filter(n=>(n.title+" "+n.body).toLowerCase().includes(q)):notes;
  },[notes,query]);

  const updateNote=(patch:Partial<Note>)=>{
    if(!active)return;
    const next={...active,...patch,updatedAt:Date.now()};
    setNotes(list=>list.map(n=>n.id===active.id?next:n));
    setSaveState("saving");
    if(timerRef.current)clearTimeout(timerRef.current);
    timerRef.current=setTimeout(()=>void storePut("notes",next).then(()=>setSaveState("saved")).catch(()=>setSaveState("error")),450);
  };

  const createNote=async()=>{
    const note:Note={id:crypto.randomUUID(),title:"Untitled note",body:"",imageIds:[],updatedAt:Date.now()};
    await storePut("notes",note);
    setNotes(list=>[note,...list]);
    setActiveId(note.id);setSelectedImage(0);setDrawer(false);
  };

  const clearBody=()=>{if(!active)return;if(window.confirm("Clear this note text?"))updateNote({body:""})};

  const deleteActive=async()=>{if(!active)return;if(!window.confirm("Delete this note?"))return;
    if(!active)return;
    for(const id of active.imageIds)await storeDelete("images",id);
    await storeDelete("notes",active.id);
    const next=notes.filter(n=>n.id!==active.id);
    if(next.length){setNotes(next);setActiveId(next[0].id);setSelectedImage(0)}
    else await createNote();
  };

  const addFiles=async(files:FileList|File[])=>{
    if(!active)return;
    const valid=Array.from(files).filter(f=>f.type.startsWith("image/"));
    if(!valid.length)return;
    const ids:string[]=[];
    for(const file of valid){const id=crypto.randomUUID();await storePut("images",{id,blob:file} as StoredImage);ids.push(id)}
    updateNote({imageIds:[...active.imageIds,...ids]});
    setSelectedImage(active.imageIds.length);
    setPhotoSheet(false);
  };

  const onFile=(e:ChangeEvent<HTMLInputElement>)=>{if(e.target.files)void addFiles(e.target.files);e.target.value=""};
  const onPaste=(e:ClipboardEvent<HTMLElement>)=>{
    const item=Array.from(e.clipboardData.items).find(i=>i.type.startsWith("image/"));
    if(item){e.preventDefault();const file=item.getAsFile();if(file)void addFiles([file])}
  };

  const exportPNG=async()=>{
    if(!active)return;
    const images=active.imageIds.map(id=>urls[id]).filter(Boolean);
    const canvas=document.createElement("canvas");
    const width=1200,pad=72;
    let height=320+Math.max(0,active.body.split("\n").length-1)*34;
    const loaded:HTMLImageElement[]=[];
    for(const src of images){
      const img=new Image();img.src=src;
      await new Promise<void>(resolve=>{img.onload=()=>resolve();img.onerror=()=>resolve()});
      if(img.width&&img.height){loaded.push(img);height+=Math.min(700,img.height*(width-pad*2)/img.width)+28}
    }
    canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext("2d");if(!ctx)return;
    ctx.fillStyle="#f7f7f4";ctx.fillRect(0,0,width,height);
    ctx.fillStyle="#171717";ctx.font="600 50px Geist, sans-serif";ctx.fillText(active.title||"Untitled note",pad,88);
    ctx.fillStyle="#30302d";ctx.font="400 24px Geist, sans-serif";
    let y=132;
    for(const line of active.body.split("\n")){ctx.fillText(line,pad,y);y+=34}
    y+=30;
    for(const img of loaded){
      const maxW=width-pad*2,maxH=700,scale=Math.min(maxW/img.width,maxH/img.height,1);
      const w=img.width*scale,h=img.height*scale;ctx.fillStyle="#ededeb";ctx.fillRect(pad,y,w+20,h+20);ctx.drawImage(img,pad+10,y+10,w,h);y+=h+40;
    }
    const a=document.createElement("a");a.download=(active.title||"note").replace(/[^a-z0-9]+/gi,"-").toLowerCase()+".png";a.href=canvas.toDataURL("image/png");a.click();
  };

  if(!ready)return <main className="loading">NoteKeep</main>;
  const currentId=active?.imageIds[selectedImage];
  const currentUrl=currentId?urls[currentId]:undefined;

  return <main className="app" onPaste={onPaste}>
    <aside className={"notes-drawer "+(drawer?"open":"")}>
      <div className="drawer-top"><strong>Notes</strong><button onClick={()=>setDrawer(false)}><ChevronLeft size={20}/></button></div>
      <button className="new-note" onClick={()=>void createNote()}><FilePlus2 size={17}/> New note</button>
      <label className="search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search"/></label>
      <div className="note-list">{filtered.map(note=><button key={note.id} className={"note-row "+(note.id===active.id?"active":"")} onClick={()=>{setActiveId(note.id);setSelectedImage(0);setDrawer(false)}}><span className="row-title">{note.title||"Untitled note"}</span><span className="row-preview">{note.body||"No text yet"}</span></button>)}</div>
    </aside>
    {drawer&&<button className="drawer-scrim" aria-label="Close notes" onClick={()=>setDrawer(false)}/>}
    <section className="workspace">
      <header>
        <button className="icon-button menu" aria-label="Notes" onClick={()=>setDrawer(true)}><Menu size={20}/></button>
        <span className="top-title">{active.title||"Untitled note"}</span>
        <div className="top-actions">
          <button className="icon-button" aria-label="Review" onClick={()=>setReview(true)}><Share2 size={18}/></button>
          <button className="icon-button" aria-label="Delete note" onClick={()=>void deleteActive()}><Trash2 size={19}/></button><button className="icon-button" aria-label="More"><MoreHorizontal size={19}/></button>
        </div>
      </header>

      <div className="note">
        <input className="note-title" value={active.title} onChange={e=>updateNote({title:e.target.value})} placeholder="Untitled note"/>
        <div className="workspace-grid">
          <div className="visual-column">
            <div className={"visual-stage "+(!currentUrl?"empty":"")}>
              {currentUrl?<img className="main-image" src={currentUrl} alt="Attached reference"/>:<button className="empty-visual" onClick={()=>setPhotoSheet(true)}><ImagePlus size={22}/><strong>Add photos</strong><span>Camera, Photos, or paste</span></button>}
            </div>
            {active.imageIds.length>0&&<div className="images-bar">
              {active.imageIds.map((id,i)=><button key={id} className={"image-thumb "+(i===selectedImage?"selected":"")} onClick={()=>setSelectedImage(i)}>{urls[id]?<img src={urls[id]} alt=""/>:<span/>}</button><button className="thumb-remove" onClick={()=>void (async()=>{await storeDelete("images",id);const next=active.imageIds.filter(x=>x!==id);updateNote({imageIds:next});setSelectedImage(Math.min(selectedImage,Math.max(0,next.length-1)))})()} aria-label="Remove image"><X size={12}/></button>)}
              <button className="add-thumb" onClick={()=>setPhotoSheet(true)} aria-label="Add another photo"><ImagePlus size={18}/></button>
            </div>}
          </div>
          <div className="writing">
            <textarea value={active.body} onChange={e=>updateNote({body:e.target.value})} placeholder="Write a note…" autoCapitalize="sentences" autoCorrect="on" spellCheck/>
            <div className="writing-bar"><button onClick={()=>setPhotoSheet(true)}><ImagePlus size={16}/> Photos</button><div className="writing-actions"><button className="clear-action" onClick={clearBody}>Clear</button><span>{saveState==="saving"?"Saving…":saveState==="error"?"Not saved":"Saved locally"}</span></div></div>
          </div>
        </div>
      </div>

      <input ref={fileRef} hidden type="file" accept="image/*" multiple onChange={onFile}/>
      <input ref={cameraRef} hidden type="file" accept="image/*" capture="environment" onChange={onFile}/>
    </section>

    {photoSheet&&<div className="sheet-backdrop" onClick={()=>setPhotoSheet(false)}><div className="photo-sheet" onClick={e=>e.stopPropagation()}>
      <div className="sheet-grabber"/><div className="sheet-title">Add photos</div>
      <button className="photo-option" onClick={()=>cameraRef.current?.click()}><Camera size={20}/><span><b>Camera</b><small>Take a new photo</small></span></button>
      <button className="photo-option" onClick={()=>fileRef.current?.click()}><ImagePlus size={20}/><span><b>Photos</b><small>Choose from your library</small></span></button>
      <button className="cancel-option" onClick={()=>setPhotoSheet(false)}>Cancel</button>
    </div></div>}

    {review&&<div className="review-backdrop" onClick={()=>setReview(false)}><section className="review-card" onClick={e=>e.stopPropagation()}>
      <div className="review-head"><div><small>Review</small><h2>{active.title||"Untitled note"}</h2></div><button onClick={()=>setReview(false)}><X size={20}/></button></div>
      <div className="review-content">{active.body&&<p>{active.body}</p>}{active.imageIds.map((id,i)=>urls[id]&&<img key={id} src={urls[id]} alt={"Reference "+(i+1)}/>)}</div>
      <div className="review-actions"><button className="primary" onClick={()=>void exportPNG()}><Download size={17}/> Export PNG</button><button onClick={()=>setReview(false)}>Done</button></div>
    </section></div>}
  </main>;
}