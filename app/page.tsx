"use client";

import { useEffect, useRef, useState } from "react";
import {
  Camera, Download, ImagePlus, Menu, Plus, Search, Trash2, X
} from "lucide-react";

type Block =
  | { id: string; type: "text"; text: string }
  | { id: string; type: "image"; imageId: string; text: string };

type Note = {
  id: string;
  title: string;
  blocks: Block[];
  updatedAt: number;
};

type ImageRecord = { id: string; blob: Blob };
type ImageTarget = { blockId: string; mode: "insert" | "replace" };

const DB = "notekeep";
const VERSION = 8;

const uid = () => crypto.randomUUID();

const blank = (): Note => ({
  id: uid(),
  title: "",
  blocks: [{ id: uid(), type: "text", text: "" }],
  updatedAt: Date.now(),
});

function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("notes")) db.createObjectStore("notes", { keyPath: "id" });
      if (!db.objectStoreNames.contains("images")) db.createObjectStore("images", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idb<T>(
  store: "notes" | "images",
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest
) {
  return database().then(
    db =>
      new Promise<T>((resolve, reject) => {
        const request = fn(db.transaction(store, mode).objectStore(store));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error);
      })
  );
}

const getNotes = () => idb<Note[]>("notes", "readonly", store => store.getAll());
const putNote = (note: Note) => idb("notes", "readwrite", store => store.put(note));
const getImage = (id: string) =>
  idb<ImageRecord | undefined>("images", "readonly", store => store.get(id));
const putImage = (blob: Blob) => {
  const id = uid();
  return idb("images", "readwrite", store => store.put({ id, blob } as ImageRecord)).then(() => id);
};
const del = (store: "notes" | "images", id: string) =>
  idb(store, "readwrite", objectStore => objectStore.delete(id));

const sizeTextarea = (element: HTMLTextAreaElement | null) => {
  if (!element) return;
  element.style.height = "0px";
  element.style.height = Math.max(30, element.scrollHeight) + "px";
};

const formatDate = (timestamp: number) => {
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
};

const wrapText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
) => {
  const result: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph) {
      result.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? line + " " + word : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
      } else {
        if (line) result.push(line);
        line = word;
      }
    }
    if (line) result.push(line);
  }
  return result.length ? result : [""];
};

export default function Home() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [id, setId] = useState("");
  const [search, setSearch] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [ready, setReady] = useState(false);
  const [sheet, setSheet] = useState<ImageTarget | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("Saved");

  const photos = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const target = useRef<ImageTarget | null>(null);
  const activeBlock = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const note = notes.find(n => n.id === id) ?? notes[0];

  const normalize = (raw: any): Note => {
    if (Array.isArray(raw.blocks)) {
      return {
        id: raw.id || uid(),
        title: raw.title || "",
        updatedAt: raw.updatedAt || Date.now(),
        blocks: raw.blocks
          .filter((b: any) => b && (b.type === "text" || (b.type === "image" && b.imageId)))
          .map((b: any) =>
            b.type === "image"
              ? { id: b.id || uid(), type: "image", imageId: b.imageId, text: b.text || "" }
              : { id: b.id || uid(), type: "text", text: b.text || "" }
          ),
      };
    }

    if (Array.isArray(raw.cards)) {
      const blocks: Block[] = [];
      for (const card of raw.cards) {
        if (card?.imageId) {
          blocks.push({
            id: uid(),
            type: "image",
            imageId: card.imageId,
            text: card.text || "",
          });
        } else if (card?.text) {
          blocks.push({ id: uid(), type: "text", text: card.text });
        }
      }
      return {
        id: raw.id || uid(),
        title: raw.title || "",
        updatedAt: raw.updatedAt || Date.now(),
        blocks: blocks.length ? blocks : [{ id: uid(), type: "text", text: "" }],
      };
    }

    return blank();
  };

  useEffect(() => {
    (async () => {
      let all = await getNotes();
      if (!all.length) {
        const fresh = blank();
        await putNote(fresh);
        all = [fresh];
      }
      all = all.map(normalize).sort((a, b) => b.updatedAt - a.updatedAt);
      setNotes(all);
      setId(all[0].id);
      setReady(true);
    })().catch(() => {
      const fresh = blank();
      setNotes([fresh]);
      setId(fresh.id);
      setReady(true);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];

    (async () => {
      const ids = (note?.blocks || [])
        .filter((block): block is Extract<Block, { type: "image" }> => block.type === "image")
        .map(block => block.imageId);

      const next: Record<string, string> = {};
      for (const imageId of ids) {
        const item = await getImage(imageId);
        if (item && !cancelled) {
          const url = URL.createObjectURL(item.blob);
          next[imageId] = url;
          created.push(url);
        }
      }
      if (!cancelled) setUrls(next);
    })().catch(() => {});

    return () => {
      cancelled = true;
      created.forEach(URL.revokeObjectURL);
    };
  }, [note?.id, note?.blocks]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.querySelector<HTMLInputElement>(".search input")?.focus();
        setDrawer(true);
      }
      if (event.key === "Escape") {
        setSheet(null);
        setDrawer(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const update = (patch: Partial<Note>) => {
    if (!note) return;
    const next = { ...note, ...patch, updatedAt: Date.now() };
    setNotes(current => current.map(item => (item.id === note.id ? next : item)));
    setStatus("Saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(
      () =>
        void putNote(next)
          .then(() => setStatus("Saved"))
          .catch(() => setStatus("Not saved")),
      240
    );
  };

  const updateBlock = (blockId: string, text: string) =>
    update({
      blocks: note.blocks.map(block =>
        block.id === blockId ? { ...block, text } : block
      ),
    });

  const addText = (after?: string) => {
    const block: Block = { id: uid(), type: "text", text: "" };
    const index = after ? note.blocks.findIndex(blockItem => blockItem.id === after) + 1 : note.blocks.length;
    const blocks = [...note.blocks];
    blocks.splice(Math.max(0, index), 0, block);
    update({ blocks });
    setTimeout(() => {
      const element = document.getElementById("block-" + block.id) as HTMLTextAreaElement | null;
      element?.focus();
      sizeTextarea(element);
    }, 20);
  };

  const openImagePicker = (blockId: string, mode: ImageTarget["mode"]) => {
    const next = { blockId, mode };
    target.current = next;
    setSheet(next);
  };

  const chooseImageSource = (kind: "camera" | "photos") => {
    if (!target.current) return;
    setSheet(null);
    (kind === "camera" ? camera : photos).current?.click();
  };

  const addImage = async (files: File[]) => {
    const file = files.find(item => item.type.startsWith("image/"));
    const destination = target.current;
    if (!file || !note || !destination) return;

    const imageId = await putImage(file);

    if (destination.mode === "replace") {
      const existing = note.blocks.find(block => block.id === destination.blockId);
      if (existing?.type === "image") {
        if (existing.imageId !== imageId) await del("images", existing.imageId);
        update({
          blocks: note.blocks.map(block =>
            block.id === destination.blockId
              ? { ...block, imageId }
              : block
          ),
        });
      }
    } else {
      const index = note.blocks.findIndex(block => block.id === destination.blockId);
      const block: Block = { id: uid(), type: "image", imageId, text: "" };
      const blocks = [...note.blocks];
      blocks.splice(index >= 0 ? index + 1 : blocks.length, 0, block);
      update({ blocks });
      setTimeout(() => {
        document.getElementById("block-" + block.id)?.focus();
      }, 20);
    }

    target.current = null;
  };

  const removeBlock = async (blockId: string) => {
    const block = note.blocks.find(item => item.id === blockId);
    if (!block) return;
    if (block.type === "image") await del("images", block.imageId);

    const blocks = note.blocks.filter(item => item.id !== blockId);
    update({
      blocks: blocks.length ? blocks : [{ id: uid(), type: "text", text: "" }],
    });
  };

  const deleteNote = async () => {
    if (!note || !confirm("Delete this note?")) return;
    for (const block of note.blocks) {
      if (block.type === "image") await del("images", block.imageId);
    }
    await del("notes", note.id);

    const left = notes.filter(item => item.id !== note.id);
    if (left.length) {
      setNotes(left);
      setId(left[0].id);
    } else {
      const fresh = blank();
      await putNote(fresh);
      setNotes([fresh]);
      setId(fresh.id);
    }
  };

  const exportImageNote = async (block: Extract<Block, { type: "image" }>) => {
    const source = urls[block.imageId];
    if (!source) return;

    const image = new Image();
    image.src = source;
    await new Promise<void>(resolve => {
      image.onload = () => resolve();
      image.onerror = () => resolve();
    });
    if (!image.width || !image.height) return;

    const width = 1600;
    const padding = 96;
    const maxImageHeight = 1050;
    const scale = Math.min(
      (width - padding * 2) / image.width,
      maxImageHeight / image.height
    );
    const imageWidth = image.width * scale;
    const imageHeight = image.height * scale;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.font = "500 38px system-ui, sans-serif";
    const lines = wrapText(ctx, block.text, width - padding * 2);
    const lineHeight = 54;
    canvas.width = width;
    canvas.height = padding + imageHeight + 72 + lines.length * lineHeight + padding;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, (width - imageWidth) / 2, padding, imageWidth, imageHeight);

    ctx.fillStyle = "#151515";
    ctx.font = "500 38px system-ui, sans-serif";
    let y = padding + imageHeight + 64;
    for (const line of lines) {
      ctx.fillText(line, padding, y);
      y += lineHeight;
    }

    const link = document.createElement("a");
    link.download = "notekeep-" + Date.now() + ".png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  const exportText = (text: string) => {
    if (!text.trim()) return;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = 1600;
    const padding = 110;
    const lineHeight = 58;
    ctx.font = "500 42px system-ui, sans-serif";
    const lines = wrapText(ctx, text, width - padding * 2);

    canvas.width = width;
    canvas.height = Math.max(620, 150 + lines.length * lineHeight + padding);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#151515";
    ctx.font = "500 42px system-ui, sans-serif";

    let y = 135;
    for (const line of lines) {
      ctx.fillText(line, padding, y);
      y += lineHeight;
    }

    const link = document.createElement("a");
    link.download = "notekeep-text-" + Date.now() + ".png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  if (!ready || !note) return <main className="loading">NoteKeep</main>;

  const filtered = notes.filter(item =>
    (item.title + " " + item.blocks.map(block => block.text).join(" "))
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  return (
    <main className="app">
      <aside className={"sidebar " + (drawer ? "open" : "")}>
        <div className="sidebar-top">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true" />
            <span>NoteKeep</span>
          </div>
          <button className="sidebar-close mobile-only" onClick={() => setDrawer(false)} aria-label="Close notes">
            <X size={18} />
          </button>
        </div>

        <button
          className="new-note"
          onClick={() => {
            const fresh = blank();
            void putNote(fresh);
            setNotes(current => [fresh, ...current]);
            setId(fresh.id);
            setDrawer(false);
            setTimeout(() => document.querySelector<HTMLInputElement>(".title")?.focus(), 20);
          }}
        >
          <Plus size={17} />
          <span>New note</span>
          <kbd>⌘N</kbd>
        </button>

        <label className="search">
          <Search size={16} />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search notes"
            aria-label="Search notes"
          />
          <kbd>⌘K</kbd>
        </label>

        <div className="note-list" aria-label="Notes">
          {filtered.length ? (
            filtered.map(item => (
              <button
                className={"note-row " + (item.id === note.id ? "selected" : "")}
                key={item.id}
                onClick={() => {
                  setId(item.id);
                  setDrawer(false);
                }}
              >
                <strong>{item.title || "Untitled"}</strong>
                <span>
                  {item.blocks.map(block => block.text).join(" ") || "Empty note"}
                </span>
                <time>{formatDate(item.updatedAt)}</time>
              </button>
            ))
          ) : (
            <div className="no-results">No notes found</div>
          )}
        </div>
      </aside>

      {drawer && (
        <button className="scrim" onClick={() => setDrawer(false)} aria-label="Close notes" />
      )}

      <section className="editor-shell">
        <header className="toolbar">
          <button className="icon mobile-only" onClick={() => setDrawer(true)} aria-label="Open notes">
            <Menu size={19} />
          </button>
          <div className="toolbar-spacer" />
          <div className={"save-state " + (status === "Saving" ? "saving" : "")}>
            <span className="status-dot" />
            {status}
          </div>
          <button className="icon danger" onClick={() => void deleteNote()} aria-label="Delete note">
            <Trash2 size={17} />
          </button>
        </header>

        <article className="editor">
          <input
            className="title"
            value={note.title}
            onChange={event => update({ title: event.target.value })}
            placeholder="Untitled"
            aria-label="Note title"
          />

          <div className="document">
            {note.blocks.map((block, index) =>
              block.type === "text" ? (
                <section className="text-block" key={block.id}>
                  <textarea
                    id={"block-" + block.id}
                    ref={element => sizeTextarea(element)}
                    value={block.text}
                    onChange={event => {
                      sizeTextarea(event.currentTarget);
                      updateBlock(block.id, event.target.value);
                    }}
                    onFocus={() => {
                      activeBlock.current = block.id;
                    }}
                    placeholder={index === 0 ? "Start writing…" : "Write something…"}
                    rows={1}
                    spellCheck
                    autoCapitalize="sentences"
                    aria-label="Note text"
                  />
                  <div className="block-tools">
                    <button
                      onClick={() => openImagePicker(block.id, "insert")}
                      aria-label="Insert image"
                      title="Insert image"
                    >
                      <ImagePlus size={15} />
                    </button>
                    <button
                      onClick={() => addText(block.id)}
                      aria-label="Add text below"
                      title="Add text"
                    >
                      <Plus size={15} />
                    </button>
                    {block.text.trim() && (
                      <button
                        onClick={() => exportText(block.text)}
                        aria-label="Export text as PNG"
                        title="Export text as PNG"
                      >
                        <Download size={15} />
                      </button>
                    )}
                    {note.blocks.length > 1 && (
                      <button
                        onClick={() => void removeBlock(block.id)}
                        aria-label="Delete text block"
                        title="Delete block"
                      >
                        <X size={15} />
                      </button>
                    )}
                  </div>
                </section>
              ) : (
                <figure className="image-block" key={block.id}>
                  {urls[block.imageId] && (
                    <img src={urls[block.imageId]} alt="" draggable={false} />
                  )}
                  <textarea
                    id={"block-" + block.id}
                    ref={element => sizeTextarea(element)}
                    value={block.text}
                    onChange={event => {
                      sizeTextarea(event.currentTarget);
                      updateBlock(block.id, event.target.value);
                    }}
                    onFocus={() => {
                      activeBlock.current = block.id;
                    }}
                    placeholder="Add a note about this image…"
                    rows={1}
                    spellCheck
                    autoCapitalize="sentences"
                    aria-label="Image note"
                  />
                  <figcaption>
                    <button onClick={() => void exportImageNote(block)}>
                      <Download size={15} /> Export PNG
                    </button>
                    {block.text.trim() && (
                      <button onClick={() => exportText(block.text)}>
                        <Download size={15} /> Text PNG
                      </button>
                    )}
                    <button onClick={() => openImagePicker(block.id, "replace")}>
                      <ImagePlus size={15} /> Replace
                    </button>
                    <button
                      onClick={() => void removeBlock(block.id)}
                      className="danger"
                      aria-label="Delete image"
                    >
                      <Trash2 size={15} />
                    </button>
                  </figcaption>
                </figure>
              )
            )}
          </div>

          <div className="insert-bar">
            <button onClick={() => addText()}>
              <Plus size={16} />
              Text
            </button>
            <button
              onClick={() =>
                openImagePicker(note.blocks[note.blocks.length - 1]?.id ?? "", "insert")
              }
            >
              <ImagePlus size={16} />
              Image
            </button>
            <span>Everything stays on this device.</span>
          </div>
        </article>
      </section>

      <input
        ref={photos}
        className="file-input"
        type="file"
        accept="image/*"
        onChange={event => {
          if (event.target.files) void addImage(Array.from(event.target.files));
          event.target.value = "";
        }}
      />

      <input
        ref={camera}
        className="file-input"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={event => {
          if (event.target.files) void addImage(Array.from(event.target.files));
          event.target.value = "";
        }}
      />

      {sheet && (
        <div className="sheet-backdrop" onClick={() => setSheet(null)}>
          <div className="action-sheet" onClick={event => event.stopPropagation()}>
            <div className="grabber" />
            <div className="sheet-heading">
              <div>
                <span className="eyebrow">{sheet.mode === "replace" ? "IMAGE" : "INSERT"}</span>
                <h2>{sheet.mode === "replace" ? "Replace image" : "Add image"}</h2>
              </div>
              <button className="icon" onClick={() => setSheet(null)} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <button onClick={() => chooseImageSource("camera")}>
              <Camera size={20} />
              <span><b>Camera</b><small>Take a photo</small></span>
            </button>
            <button onClick={() => chooseImageSource("photos")}>
              <ImagePlus size={20} />
              <span><b>Photos</b><small>Choose from your library</small></span>
            </button>
            <button className="cancel" onClick={() => setSheet(null)}>Cancel</button>
          </div>
        </div>
      )}
    </main>
  );
}
