"use client";

import { useEffect, useRef, useState } from "react";
import {
  Camera, Download, ImagePlus, Menu, Plus, Search, Trash2, X
} from "lucide-react";

type Block =
  | { id: string; type: "text"; text: string }
  | { id: string; type: "image"; imageId: string; text: string };

type Note = { id: string; title: string; blocks: Block[]; updatedAt: number };
type ImageRecord = { id: string; blob: Blob };

const DB = "notekeep";
const VERSION = 7;

const uid = () => crypto.randomUUID();
const blank = (): Note => ({
  id: uid(),
  title: "",
  blocks: [{ id: uid(), type: "text", text: "" }],
  updatedAt: Date.now(),
});

function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains("notes")) d.createObjectStore("notes", { keyPath: "id" });
      if (!d.objectStoreNames.contains("images")) d.createObjectStore("images", { keyPath: "id" });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function idb<T>(
  store: "notes" | "images",
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest
) {
  return database().then(
    d =>
      new Promise<T>((resolve, reject) => {
        const r = fn(d.transaction(store, mode).objectStore(store));
        r.onsuccess = () => resolve(r.result as T);
        r.onerror = () => reject(r.error);
      })
  );
}

const getNotes = () => idb<Note[]>("notes", "readonly", s => s.getAll());
const putNote = (n: Note) => idb("notes", "readwrite", s => s.put(n));
const getImage = (id: string) => idb<ImageRecord | undefined>("images", "readonly", s => s.get(id));
const putImage = (blob: Blob) => {
  const id = uid();
  return idb("images", "readwrite", s => s.put({ id, blob } as ImageRecord)).then(() => id);
};
const del = (store: "notes" | "images", id: string) =>
  idb(store, "readwrite", s => s.delete(id));

export default function Home() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [id, setId] = useState("");
  const [search, setSearch] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [ready, setReady] = useState(false);
  const [sheet, setSheet] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("Saved");

  const photos = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const target = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const note = notes.find(n => n.id === id) ?? notes[0];

  const normalize = (raw: any): Note => {
    if (Array.isArray(raw.blocks)) {
      return {
        ...raw,
        blocks: raw.blocks.map((b: any) =>
          b.type === "image"
            ? { id: b.id || uid(), type: "image", imageId: b.imageId, text: b.text || "" }
            : { id: b.id || uid(), type: "text", text: b.text || "" }
        ),
      };
    }
    if (Array.isArray(raw.cards)) {
      return {
        id: raw.id || uid(),
        title: raw.title || "",
        updatedAt: raw.updatedAt || Date.now(),
        blocks: raw.cards.flatMap((c: any) => [
          ...(c.imageId ? [{ id: uid(), type: "image", imageId: c.imageId, text: c.text || "" }] : []),
          ...(!c.imageId || c.text ? [{ id: uid(), type: "text", text: c.imageId ? "" : c.text || "" }] : []),
        ]),
      };
    }
    return blank();
  };

  useEffect(() => {
    (async () => {
      let all = await getNotes();
      if (!all.length) {
        const n = blank();
        await putNote(n);
        all = [n];
      }
      all = all.map(normalize).sort((a, b) => b.updatedAt - a.updatedAt);
      setNotes(all);
      setId(all[0].id);
      setReady(true);
    })().catch(() => {
      const n = blank();
      setNotes([n]);
      setId(n.id);
      setReady(true);
    });
  }, []);

  useEffect(() => {
    let dead = false;
    const made: string[] = [];
    (async () => {
      const ids = (note?.blocks || [])
        .filter((b): b is Extract<Block, { type: "image" }> => b.type === "image")
        .map(b => b.imageId);
      const next: Record<string, string> = {};
      for (const imageId of ids) {
        const item = await getImage(imageId);
        if (item && !dead) {
          const url = URL.createObjectURL(item.blob);
          next[imageId] = url;
          made.push(url);
        }
      }
      if (!dead) setUrls(next);
    })();
    return () => {
      dead = true;
      made.forEach(URL.revokeObjectURL);
    };
  }, [note?.id, note?.blocks]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const update = (patch: Partial<Note>) => {
    if (!note) return;
    const next = { ...note, ...patch, updatedAt: Date.now() };
    setNotes(v => v.map(n => (n.id === note.id ? next : n)));
    setStatus("Saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(
      () => void putNote(next).then(() => setStatus("Saved")).catch(() => setStatus("Not saved")),
      250
    );
  };

  const updateBlock = (blockId: string, text: string) =>
    update({ blocks: note.blocks.map(b => (b.id === blockId ? { ...b, text } : b)) });

  const addText = (after?: string) => {
    const block: Block = { id: uid(), type: "text", text: "" };
    const index = after ? note.blocks.findIndex(b => b.id === after) + 1 : note.blocks.length;
    const blocks = [...note.blocks];
    blocks.splice(index, 0, block);
    update({ blocks });
    setTimeout(() => document.getElementById("block-" + block.id)?.focus(), 20);
  };

  const chooseImage = (blockId: string, kind: "camera" | "photos") => {
    target.current = blockId;
    setSheet(null);
    (kind === "camera" ? camera : photos).current?.click();
  };

  const addImage = async (files: File[]) => {
    const file = files.find(f => f.type.startsWith("image/"));
    if (!file || !note) return;
    const imageId = await putImage(file);
    const index = target.current ? note.blocks.findIndex(b => b.id === target.current) : -1;
    const block: Block = { id: uid(), type: "image", imageId, text: "" };
    const blocks = [...note.blocks];
    blocks.splice(index >= 0 ? index + 1 : blocks.length, 0, block);
    update({ blocks });
    setTimeout(() => document.getElementById("block-" + block.id)?.focus(), 20);
    setSheet(null);
  };

  const removeBlock = async (blockId: string) => {
    const block = note.blocks.find(b => b.id === blockId);
    if (!block) return;
    if (block.type === "image") await del("images", block.imageId);
    const blocks = note.blocks.filter(b => b.id !== blockId);
    update({ blocks: blocks.length ? blocks : [{ id: uid(), type: "text", text: "" }] });
  };

  const deleteNote = async () => {
    if (!note || !confirm("Delete this note?")) return;
    for (const b of note.blocks) if (b.type === "image") await del("images", b.imageId);
    await del("notes", note.id);
    const left = notes.filter(n => n.id !== note.id);
    if (left.length) {
      setNotes(left);
      setId(left[0].id);
    } else {
      const n = blank();
      await putNote(n);
      setNotes([n]);
      setId(n.id);
    }
  };

  const exportImageNote = async (block: Extract<Block, { type: "image" }>) => {
    const src = urls[block.imageId];
    if (!src) return;
    const img = new Image();
    img.src = src;
    await new Promise<void>(resolve => {
      img.onload = () => resolve();
      img.onerror = () => resolve();
    });
    if (!img.width) return;

    const width = 1600;
    const pad = 96;
    const maxImageHeight = 1050;
    const scale = Math.min((width - pad * 2) / img.width, maxImageHeight / img.height);
    const iw = img.width * scale;
    const ih = img.height * scale;
    const lines = block.text.split("\n");
    const height = pad + ih + 70 + Math.max(1, lines.length) * 52 + pad;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, (width - iw) / 2, pad, iw, ih);
    ctx.fillStyle = "#151515";
    ctx.font = "500 38px system-ui, sans-serif";
    let y = pad + ih + 64;
    for (const line of lines) {
      ctx.fillText(line, pad, y);
      y += 52;
    }
    const a = document.createElement("a");
    a.download = "notekeep-" + Date.now() + ".png";
    a.href = canvas.toDataURL("image/png");
    a.click();
  };

  const exportText = (text: string) => {
    if (!text.trim()) return;
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = Math.max(620, 180 + text.split("\n").length * 58);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#151515";
    ctx.font = "500 42px system-ui, sans-serif";
    let y = 130;
    for (const line of text.split("\n")) {
      ctx.fillText(line, 96, y);
      y += 58;
    }
    const a = document.createElement("a");
    a.download = "notekeep-text-" + Date.now() + ".png";
    a.href = canvas.toDataURL("image/png");
    a.click();
  };

  if (!ready || !note) return <main className="loading">NoteKeep</main>;

  const filtered = notes.filter(n =>
    (n.title + " " + n.blocks.map(b => b.text).join(" ")).toLowerCase().includes(search.toLowerCase())
  );

  return (
    <main className="app">
      <aside className={"sidebar " + (drawer ? "open" : "")}>
        <div className="brand">NoteKeep</div>
        <button className="new-note" onClick={() => {
          const n = blank();
          void putNote(n);
          setNotes(v => [n, ...v]);
          setId(n.id);
          setDrawer(false);
        }}>
          <Plus size={17} /> New note
        </button>
        <label className="search">
          <Search size={16} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search" />
        </label>
        <div className="note-list">
          {filtered.map(n => (
            <button className={"note-row " + (n.id === note.id ? "selected" : "")} key={n.id}
              onClick={() => { setId(n.id); setDrawer(false); }}>
              <strong>{n.title || "Untitled"}</strong>
              <span>{n.blocks.map(b => b.text).join(" ") || "Empty note"}</span>
            </button>
          ))}
        </div>
      </aside>

      {drawer && <button className="scrim" onClick={() => setDrawer(false)} aria-label="Close notes" />}

      <section className="editor-shell">
        <header className="toolbar">
          <button className="icon mobile-only" onClick={() => setDrawer(true)} aria-label="Notes"><Menu size={19} /></button>
          <div className="toolbar-spacer" />
          <span className="save-state">{status}</span>
          <button className="icon" onClick={() => void deleteNote()} aria-label="Delete note"><Trash2 size={17} /></button>
        </header>

        <article className="editor">
          <input className="title" value={note.title} onChange={e => update({ title: e.target.value })} placeholder="Untitled" />
          <div className="document">
            {note.blocks.map((block, index) =>
              block.type === "text" ? (
                <div className="text-block" key={block.id}>
                  <textarea
                    id={"block-" + block.id}
                    value={block.text}
                    onChange={e => updateBlock(block.id, e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); addText(block.id); }
                    }}
                    placeholder={index === 0 ? "Start writing…" : "Write something…"}
                    rows={1}
                  />
                  <div className="block-tools">
                    <button onClick={() => setSheet(block.id)} aria-label="Add image"><ImagePlus size={15} /></button>
                    <button onClick={() => addText(block.id)} aria-label="Add text"><Plus size={15} /></button>
                    {block.text.trim() && <button onClick={() => exportText(block.text)} aria-label="Export text"><Download size={15} /></button>}
                    {note.blocks.length > 1 && <button onClick={() => void removeBlock(block.id)} aria-label="Delete block"><X size={15} /></button>}
                  </div>
                </div>
              ) : (
                <figure className="image-block" key={block.id}>
                  {urls[block.imageId] && <img src={urls[block.imageId]} alt="" />}
                  <textarea
                    id={"block-" + block.id}
                    value={block.text}
                    onChange={e => updateBlock(block.id, e.target.value)}
                    placeholder="Add a note about this image…"
                    rows={1}
                  />
                  <figcaption>
                    <button onClick={() => void exportImageNote(block)}><Download size={15} /> Export PNG</button>
                    {block.text.trim() && <button onClick={() => exportText(block.text)}><Download size={15} /> Text PNG</button>}
                    <button onClick={() => setSheet(block.id)}><ImagePlus size={15} /> Replace</button>
                    <button onClick={() => void removeBlock(block.id)} className="danger"><Trash2 size={15} /></button>
                  </figcaption>
                </figure>
              )
            )}
          </div>

          <div className="insert-bar">
            <button onClick={() => addText()}><Plus size={17} /> Text</button>
            <button onClick={() => setSheet(note.blocks[note.blocks.length - 1]?.id ?? null)}><ImagePlus size={17} /> Image</button>
          </div>
        </article>
      </section>

      <input ref={photos} className="file-input" type="file" accept="image/*" onChange={e => {
        if (e.target.files) void addImage(Array.from(e.target.files));
        e.target.value = "";
      }} />
      <input ref={camera} className="file-input" type="file" accept="image/*" capture="environment" onChange={e => {
        if (e.target.files) void addImage(Array.from(e.target.files));
        e.target.value = "";
      }} />

      {sheet && (
        <div className="sheet-backdrop" onClick={() => setSheet(null)}>
          <div className="action-sheet" onClick={e => e.stopPropagation()}>
            <div className="grabber" />
            <h2>Add image</h2>
            <button onClick={() => chooseImage(sheet, "camera")}><Camera size={20} /><span><b>Camera</b><small>Take a photo</small></span></button>
            <button onClick={() => chooseImage(sheet, "photos")}><ImagePlus size={20} /><span><b>Photos</b><small>Choose from library</small></span></button>
            <button className="cancel" onClick={() => setSheet(null)}>Cancel</button>
          </div>
        </div>
      )}
    </main>
  );
}
