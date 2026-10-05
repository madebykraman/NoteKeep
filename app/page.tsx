"use client";
import { useEffect, useRef, useState } from "react";
import type { ClipboardEvent } from "react";
import { Camera, ChevronLeft, Download, Eye, FilePlus2, ImagePlus, Menu, Search, Trash2, X } from "lucide-react";

type TextBlock={id:string;type:"text";text:string};
type ImageBlock={id:string;type:"image";imageId:string};
type Block=TextBlock|ImageBlock;
type Note={id:string;title:string;body?:string;images?:string[];blocks:Block[];updatedAt:number};
type ImageRecord={id:string;blob:Blob};
const DB="notekeep",VERSION=5;
const makeText=(text=""):TextBlock=>({id:crypto.randomUUID(),type:"text",text});
const blank=():Note=>({id:crypto.randomUUID(),title:"Untitled note",blocks:[makeText()],updatedAt:Date.now()});

function database(){return new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open(DB,VERSION);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains("notes"))d.createObjectStore("notes",{keyPath:"id"});if(!d.objectStoreNames.contains("images"))d.createObjectStore("images",{keyPath:"id"})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
function idb<T>(store:"notes"|"images",mode:IDBTransactionMode,fn:(s:IDBObjectStore)=>IDBRequest){return database().then(d=>new Promise<T>((resolve,reject)=>{const r=fn(d.transaction(store,mode).objectStore(store));r.onsuccess=()=>resolve(r.result as T);r.onerror=()=>reject(r.error)}))}
const getNotes=()=>idb<Note[]>("notes","readonly",s=>s.getAll());
const putNote=(n:Note)=>idb("notes","readwrite",s=>s.put(n));
const getImage=(id:string)=>idb<ImageRecord|undefined>("images","readonly",s=>s.get(id));
const putImage=(blob:Blob)=>{const id=crypto.randomUUID();return idb("images","readwrite",s=>s.put({id,blob} as ImageRecord)).then(()=>id)};
const deleteItem=(store:"notes"|"images",id:string)=>idb(store,"readwrite",s=>s.delete(id));

export default function Home(){
 const [notes,setNotes]=useState<Note[]>([]),[id,setId]=useState(""),[search,setSearch]=useState(""),[drawer,setDrawer]=useState(false),[actions,setActions]=useState(false),[review,setReview]=useState(false),[urls,setUrls]=useState<Record<string,string>>({}),[status,setStatus]=useState("Saved"),[ready,setReady]=useState(false),[activeBlock,setActiveBlock]=useState("");
 const save=useRef<ReturnType<typeof setTimeout>|null>(null),photos=useRef<HTMLInputElement>(null),camera=useRef<HTMLInputElement>(null),editors=useRef<Record<string,HTMLTextAreaElement|null>>({}),selection=useRef<{blockId:string;start:number;end:number}|null>(null);
 const note=notes.find(n=>n.id===id)??notes[0];

 const normalize=(raw:Note&{imageIds?:string[]}):Note=>{
  if(Array.isArray(raw.blocks)&&raw.blocks.length)return {...raw,blocks:raw.blocks};
  const ids=Array.isArray(raw.images)?raw.images:(Array.isArray(raw.imageIds)?raw.imageIds:[]);
  const blocks:Block[]=ids.map(imageId=>({id:crypto.randomUUID(),type:"image",imageId}));
  blocks.push(makeText(raw.body??""));
  return {...raw,blocks};
 };
 useEffect(()=>{(async()=>{let n=await getNotes();if(!n.length){const x=blank();await putNote(x);n=[x]}n=n.map(x=>normalize(x as Note&{imageIds?:string[]})).sort((a,b)=>b.updatedAt-a.updatedAt);setNotes(n);setId(n[0].id);setActiveBlock(n[0].blocks.find(b=>b.type==="text")?.id??n[0].blocks[0]?.id??"");setReady(true)})().catch(()=>{const x=blank();setNotes([x]);setId(x.id);setActiveBlock(x.blocks[0].id);setReady(true)})},[]);
 useEffect(()=>{let dead=false;const made:string[]=[];(async()=>{const ids=(note?.blocks??[]).filter((b):b is ImageBlock=>b.type==="image").map(b=>b.imageId);const next:Record<string,string>={};for(const imageId of ids){const item=await getImage(imageId);if(item&&!dead){const u=URL.createObjectURL(item.blob);next[imageId]=u;made.push(u)}}if(!dead)setUrls(next)})().catch(()=>{});return()=>{dead=true;made.forEach(URL.revokeObjectURL)}},[note?.id,note?.blocks]);
 useEffect(()=>()=>{if(save.current)clearTimeout(save.current)},[]);
 useEffect(()=>{Object.values(editors.current).forEach(resizeText)},[note?.blocks]);

 const textOf=(n:Note)=>n.blocks.filter((b):b is TextBlock=>b.type==="text").map(b=>b.text).join("\n");
 const update=(patch:Partial<Note>)=>{if(!note)return;const n={...note,...patch,updatedAt:Date.now()};setNotes(v=>v.map(x=>x.id===note.id?n:x));setStatus("Saving");if(save.current)clearTimeout(save.current);save.current=setTimeout(()=>void putNote(n).then(()=>setStatus("Saved")).catch(()=>setStatus("Not saved")),300)};
 const resizeText=(el:HTMLTextAreaElement|null)=>{if(!el)return;el.style.height="0px";el.style.height=Math.max(el.scrollHeight,44)+"px"};
 const updateBlock=(blockId:string,text:string)=>{if(!note)return;update({blocks:note.blocks.map(b=>b.id===blockId&&b.type==="text"?{...b,text}:b)})};
 const rememberSelection=(blockId:string,e:React.SyntheticEvent<HTMLTextAreaElement>)=>{const el=e.currentTarget;setActiveBlock(blockId);selection.current={blockId,start:el.selectionStart,end:el.selectionEnd}};
 const insertImages=async(files:File[])=>{
  if(!note)return;const valid=files.filter(f=>f.type.startsWith("image/"));if(!valid.length)return;
  const ids:string[]=[];for(const f of valid)ids.push(await putImage(f));
  const targetId=selection.current?.blockId||activeBlock||note.blocks.find(b=>b.type==="text")?.id||note.blocks[0]?.id;
  const targetIndex=note.blocks.findIndex(b=>b.id===targetId);
  const target=targetIndex>=0?note.blocks[targetIndex]:undefined;
  const imageBlocks:ImageBlock[]=ids.map(imageId=>({id:crypto.randomUUID(),type:"image",imageId}));
  let blocks:Block[];
  if(target?.type==="text"){
   const pos=selection.current?.blockId===target.id?selection.current.start:target.text.length;
   const end=selection.current?.blockId===target.id?selection.current.end:pos;
   const before=target.text.slice(0,pos),after=target.text.slice(end);
   const replacement:Block[]=[];if(before)replacement.push({...target,text:before});else replacement.push({...target,text:""});
   replacement.push(...imageBlocks);replacement.push(makeText(after));
   blocks=[...note.blocks.slice(0,targetIndex),...replacement,...note.blocks.slice(targetIndex+1)];
   setActiveBlock(replacement[replacement.length-1].id);
   selection.current={blockId:replacement[replacement.length-1].id,start:0,end:0};
  }else{
   blocks=[...note.blocks.slice(0,targetIndex+1),...imageBlocks,makeText(),...note.blocks.slice(targetIndex+1)];
   setActiveBlock(blocks[targetIndex+imageBlocks.length+1].id);
  }
  update({blocks});setActions(false);
 };
 const addFromPaste=async(f:File)=>insertImages([f]);
 const removeImage=async(imageId:string)=>{if(!note)return;await deleteItem("images",imageId);const blocks=note.blocks.filter(b=>!(b.type==="image"&&b.imageId===imageId));if(!blocks.some(b=>b.type==="text"))blocks.push(makeText());update({blocks});setActiveBlock(blocks.find(b=>b.type==="text")!.id)};
 const clear=async()=>{if(!note||!window.confirm("Clear this note?"))return;for(const b of note.blocks)if(b.type==="image")await deleteItem("images",b.imageId);update({blocks:[makeText()]});setActiveBlock(note.blocks.find(b=>b.type==="text")?.id??"")};
 const paste=(e:ClipboardEvent<HTMLTextAreaElement>)=>{const item=Array.from(e.clipboardData.items).find(x=>x.type.startsWith("image/"));if(item){e.preventDefault();const f=item.getAsFile();if(f)void addFromPaste(f)}};
 const create=async()=>{const n=blank();await putNote(n);setNotes(v=>[n,...v]);setId(n.id);setActiveBlock(n.blocks[0].id);setDrawer(false)};
 const deleteNote=async()=>{if(!note)return;if(!window.confirm("Delete this note?"))return;for(const b of note.blocks)if(b.type==="image")await deleteItem("images",b.imageId);await deleteItem("notes",note.id);const left=notes.filter(x=>x.id!==note.id);if(left.length){setNotes(left);setId(left[0].id);setActiveBlock(left[0].blocks.find(b=>b.type==="text")?.id??"")}else await create()};
 const exportPNG=async()=>{if(!note)return;const w=1200,p=72;let h=170;const loaded:({block:ImageBlock;image:HTMLImageElement})[]=[];for(const b of note.blocks){if(b.type==="image"&&urls[b.imageId]){const image=new Image();image.src=urls[b.imageId];await new Promise<void>(r=>{image.onload=()=>r();image.onerror=()=>r()});if(image.width){loaded.push({block:b,image});h+=image.height*Math.min((w-p*2)/image.width,650/image.height,1)+32}}else if(b.type==="text")h+=Math.max(1,b.text.split("\n").length)*38}const c=document.createElement("canvas");c.width=w;c.height=h;const ctx=c.getContext("2d")!;ctx.fillStyle="#f7f7f4";ctx.fillRect(0,0,w,h);ctx.fillStyle="#171717";ctx.font="600 50px Geist, sans-serif";ctx.fillText(note.title||"Untitled note",p,90);ctx.font="400 25px Geist, sans-serif";let y=140;for(const b of note.blocks){if(b.type==="text"){for(const line of b.text.split("\n")){ctx.fillText(line,p,y);y+=38}y+=10}else{const image=loaded.find(x=>x.block.id===b.id)?.image;if(image){const s=Math.min((w-p*2)/image.width,650/image.height,1),iw=image.width*s,ih=image.height*s;ctx.drawImage(image,p,y,iw,ih);y+=ih+32}}}const a=document.createElement("a");a.download="notekeep-"+Date.now()+".png";a.href=c.toDataURL("image/png");a.click()};

 if(!ready||!note)return <main className="loading">NoteKeep</main>;
 const filtered=notes.filter(x=>(x.title+" "+textOf(x)).toLowerCase().includes(search.toLowerCase()));
 return <main className="app">
  <aside className={"drawer "+(drawer?"open":"")}><div className="drawer-head"><div><small>NoteKeep</small><h1>Notes</h1></div><button onClick={()=>setDrawer(false)}><ChevronLeft size={19}/></button></div><button className="create" onClick={()=>void create()}><FilePlus2 size={18}/> New note</button><label className="search"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search notes"/></label><div className="note-list">{filtered.map(n=><button className={"note-row "+(n.id===note.id?"selected":"")} key={n.id} onClick={()=>{setId(n.id);setActiveBlock(n.blocks.find(b=>b.type==="text")?.id??"");setDrawer(false)}}><b>{n.title||"Untitled note"}</b><small>{textOf(n)||"No text yet"}</small></button>)}</div></aside>
  {drawer&&<button className="scrim" onClick={()=>setDrawer(false)} aria-label="Close notes"/>}
  <section className="main">
   <header className="topbar"><button className="top-icon" onClick={()=>setDrawer(true)} aria-label="Notes"><Menu size={21}/></button><span>NoteKeep</span><div className="top-actions"><button className="top-icon" onClick={()=>setReview(true)} aria-label="Review note"><Eye size={19}/></button><button className="top-icon" onClick={()=>setActions(true)} aria-label="Add photo"><ImagePlus size={19}/></button><button className="top-icon" onClick={()=>void deleteNote()} aria-label="Delete note"><Trash2 size={19}/></button></div></header>
   <div className="canvas"><div className="note-surface">
     <input className="note-title" value={note.title} onChange={e=>update({title:e.target.value})} placeholder="Untitled note"/>
     <div className="note-content">{note.blocks.map((b,i)=>b.type==="image"?(urls[b.imageId]?<div className="inline-image" key={b.id}><img src={urls[b.imageId]} alt="Attached to this note"/><button className="attachment-delete" onClick={()=>void removeImage(b.imageId)} aria-label="Remove image"><X size={15}/></button></div>:null):<textarea key={b.id} ref={el=>{editors.current[b.id]=el}} className="note-editor" value={b.text} onFocus={e=>rememberSelection(b.id,e)} onClick={e=>rememberSelection(b.id,e)} onKeyUp={e=>rememberSelection(b.id,e)} onSelect={e=>rememberSelection(b.id,e)} onChange={e=>{rememberSelection(b.id,e);updateBlock(b.id,e.target.value);requestAnimationFrame(()=>resizeText(e.currentTarget))}} onInput={e=>resizeText(e.currentTarget)} onPaste={paste} placeholder={i===0?"Write your note…":""} autoCapitalize="sentences" autoCorrect="on" spellCheck/>)}</div>
     <div className="note-toolbar"><button onClick={()=>setActions(true)}><ImagePlus size={17}/> Add photo</button><div><span>{status}</span><button className="clear" onClick={clear}>Clear</button></div></div>
    </div>
   </div>
  </section>
  <input ref={photos} className="file-input" type="file" accept="image/*" multiple onChange={e=>{if(e.target.files)void insertImages(Array.from(e.target.files));e.target.value=""}}/>
  <input ref={camera} className="file-input" type="file" accept="image/*" capture="environment" onChange={e=>{if(e.target.files)void insertImages(Array.from(e.target.files));e.target.value=""}}/>
  {actions&&<div className="sheet-backdrop" onClick={()=>setActions(false)}><div className="action-sheet" onClick={e=>e.stopPropagation()}><div className="grabber"/><h2>Add to note</h2><button onClick={()=>camera.current?.click()}><Camera size={21}/><span><b>Camera</b><small>Open camera</small></span></button><button onClick={()=>photos.current?.click()}><ImagePlus size={21}/><span><b>Photos</b><small>Choose from library</small></span></button><button className="cancel" onClick={()=>setActions(false)}>Cancel</button></div></div>}
  {review&&<div className="sheet-backdrop" onClick={()=>setReview(false)}><div className="review" onClick={e=>e.stopPropagation()}><div className="review-head"><div><small>Review</small><h2>{note.title||"Untitled note"}</h2></div><button onClick={()=>setReview(false)}><X size={20}/></button></div><div className="review-content">{note.blocks.map(b=>b.type==="text"?(b.text&&<p key={b.id}>{b.text}</p>):(urls[b.imageId]&&<img key={b.id} src={urls[b.imageId]} alt=""/>))}</div><div className="review-actions"><button className="primary" onClick={()=>void exportPNG()}><Download size={17}/> PNG</button><button onClick={()=>setReview(false)}>Done</button></div></div></div>}
 </main>;
}