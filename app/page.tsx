"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  Archive, ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown, ChevronRight,
  Command, Copy, Download, File, FileDown, FilePlus, Folder, FolderOpen, GitBranch,
  Hash, ImagePlus, Link2, Menu, MoreHorizontal, PanelLeft, PanelRight,
  Plus, Search, Settings, Sparkles, Tags, Trash2, X, ZoomIn, ZoomOut
} from "lucide-react";

type Block =
  | { id: string; type: "text"; text: string }
  | { id: string; type: "image"; imageId: string; text: string };

type Note = {
  id: string;
  title: string;
  path: string;
  blocks: Block[];
  properties: Record<string, string>;
  updatedAt: number;
  createdAt: number;
};

type ImageRecord = { id: string; blob: Blob };

const DB = "notekeep";
const VERSION = 9;
const uid = () => crypto.randomUUID();

const blank = (title = "Untitled"): Note => ({
  id: uid(),
  title,
  path: title === "Untitled" ? "Untitled.md" : title + ".md",
  blocks: [{ id: uid(), type: "text", text: "" }],
  properties: {},
  updatedAt: Date.now(),
  createdAt: Date.now(),
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

function idb<T>(store: "notes" | "images", mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest) {
  return database().then(db => new Promise<T>((resolve, reject) => {
    const request = fn(db.transaction(store, mode).objectStore(store));
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
  }));
}

const getNotes = () => idb<Note[]>("notes", "readonly", s => s.getAll());
const putNote = (note: Note) => idb("notes", "readwrite", s => s.put(note));
const getImage = (id: string) => idb<ImageRecord | undefined>("images", "readonly", s => s.get(id));
const putImage = (blob: Blob) => {
  const id = uid();
  return idb("images", "readwrite", s => s.put({ id, blob } as ImageRecord)).then(() => id);
};
const del = (store: "notes" | "images", id: string) => idb(store, "readwrite", s => s.delete(id));

const normalize = (raw: any): Note => {
  const blocks: Block[] = Array.isArray(raw.blocks)
    ? raw.blocks.filter((b: any) => b && (b.type === "text" || (b.type === "image" && b.imageId))).map((b: any) =>
        b.type === "image"
          ? { id: b.id || uid(), type: "image", imageId: b.imageId, text: b.text || "" }
          : { id: b.id || uid(), type: "text", text: b.text || "" })
    : Array.isArray(raw.cards)
      ? raw.cards.map((c: any) => c?.imageId
          ? ({ id: uid(), type: "image", imageId: c.imageId, text: c.text || "" } as Block)
          : ({ id: uid(), type: "text", text: c?.text || "" } as Block))
      : [];
  const title = raw.title || "Untitled";
  return {
    id: raw.id || uid(), title, path: raw.path || title + ".md",
    blocks: blocks.length ? blocks : [{ id: uid(), type: "text", text: "" }],
    properties: raw.properties || {}, updatedAt: raw.updatedAt || Date.now(), createdAt: raw.createdAt || raw.updatedAt || Date.now()
  };
};

const resize = (el: HTMLTextAreaElement | null) => {
  if (!el) return;
  el.style.height = "0px";
  el.style.height = Math.max(30, el.scrollHeight) + "px";
};

const dateLabel = (ts: number) => new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });

function noteText(note: Note) {
  return note.blocks.map(b => b.text).join("\n");
}

function linksIn(note: Note) {
  const text = noteText(note);
  return Array.from(text.matchAll(/\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]/g)).map(m => m[1].trim().toLowerCase());
}

function tagsIn(note: Note) {
  return Array.from(new Set((noteText(note).match(/(^|\s)#([a-zA-Z0-9_-]+)/g) || []).map(x => x.trim().slice(1))));
}

export default function Home() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeId, setActiveId] = useState("");
  const [tabs, setTabs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState("");
  const [query, setQuery] = useState("");
  const [ready, setReady] = useState(false);
  const [leftOpen, setLeftOpen] = useState(false);
  const [formatOpen, setFormatOpen] = useState(false);
  const [imageViewer, setImageViewer] = useState<string | null>(null);
  const [rightOpen, setRightOpen] = useState(true);
  const [rightPanel, setRightPanel] = useState<"backlinks" | "outline" | "tags">("backlinks");
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [sourceMode, setSourceMode] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("Ready");
  const [zoom, setZoom] = useState(1);
  const [sheet, setSheet] = useState<{ blockId: string; mode: "insert" | "replace" } | null>(null);
  const [propertyKey, setPropertyKey] = useState("");
  const [propertyValue, setPropertyValue] = useState("");

  const photos = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const importFile = useRef<HTMLInputElement>(null);
  const imageTarget = useRef<typeof sheet>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const active = notes.find(n => n.id === activeId) || notes[0];
  const visibleNotes = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return notes;
    return notes.filter(n => (n.title + " " + n.path + " " + noteText(n)).toLowerCase().includes(q));
  }, [notes, query]);

  const incoming = useMemo(() => {
    if (!active) return [];
    const name = active.title.toLowerCase();
    return notes.filter(n => n.id !== active.id && linksIn(n).some(l => l === name || l.endsWith("/" + name)));
  }, [notes, active]);

  const outgoing = useMemo(() => {
    if (!active) return [];
    return linksIn(active).map(link => notes.find(n => n.title.toLowerCase() === link || n.path.toLowerCase() === link + ".md")).filter(Boolean) as Note[];
  }, [notes, active]);

  const unresolvedLinks = useMemo(() => {
    if (!active) return [];
    return [...new Set(linksIn(active))].filter(link => !notes.some(n => n.title.toLowerCase() === link || n.path.toLowerCase() === link + ".md"));
  }, [notes, active]);

  const outline = useMemo(() => {
    if (!active) return [];
    return active.blocks.flatMap(b => b.type === "text"
      ? b.text.split("\n").map((line, index) => {
          const match = line.match(/^(#{1,6})\s+(.+)$/);
          return match ? { level: match[1].length, text: match[2].trim(), id: b.id + "-" + index } : null;
        }).filter(Boolean) as { level:number; text:string; id:string }[]
      : []);
  }, [active]);

  const allTags = useMemo(() => {
    const map = new Map<string, number>();
    notes.forEach(n => tagsIn(n).forEach(t => map.set(t, (map.get(t) || 0) + 1)));
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [notes]);

  useEffect(() => {
    const syncSidebar = () => setLeftOpen(window.innerWidth > 800);
    syncSidebar();
    window.addEventListener("resize", syncSidebar);
    return () => window.removeEventListener("resize", syncSidebar);
  }, []);

  useEffect(() => {
    (async () => {
      let all = await getNotes();
      if (!all.length) {
        const fresh = blank();
        fresh.title = "Welcome to NoteKeep";
        fresh.path = "Welcome to NoteKeep.md";
        fresh.blocks = [{ id: uid(), type: "text", text: "A local-first knowledge base with Obsidian-style links and your visual screenshot workflow.\n\nTry [[Daily Notes]], add #ideas, or paste a screenshot directly into this note." }];
        await putNote(fresh);
        all = [fresh];
      }
      all = all.map(normalize).sort((a, b) => b.updatedAt - a.updatedAt);
      setNotes(all);
      setActiveId(all[0].id);
      setTabs([all[0].id]);
      setActiveTab(all[0].id);
      setReady(true);
    })().catch(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const created: string[] = [];
    (async () => {
      const ids = active.blocks.filter((b): b is Extract<Block, { type: "image" }> => b.type === "image").map(b => b.imageId);
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
    })();
    return () => { cancelled = true; created.forEach(URL.revokeObjectURL); };
  }, [active?.id, active?.blocks.map(b => b.type === "image" ? b.imageId : "").join("|")]);

  const openNote = (note: Note, newTab = false) => {
    setActiveId(note.id);
    if (newTab || !tabs.includes(note.id)) setTabs(current => current.includes(note.id) ? current : [...current, note.id]);
    setActiveTab(note.id);
    setLeftOpen(window.innerWidth > 800 ? leftOpen : false);
  };

  const createNote = async (title = "Untitled") => {
    const n = blank(title);
    await putNote(n);
    setNotes(current => [n, ...current]);
    openNote(n, true);
    setTimeout(() => document.querySelector<HTMLInputElement>(".note-title")?.focus(), 30);
  };

  const update = (patch: Partial<Note>) => {
    if (!active) return;
    const next = { ...active, ...patch, updatedAt: Date.now() };
    setNotes(current => current.map(n => n.id === active.id ? next : n));
    setStatus("Saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void putNote(next).then(() => setStatus("Saved")).catch(() => setStatus("Not saved")), 220);
  };

  const updateBlock = (blockId: string, text: string) => {
    update({ blocks: active.blocks.map(b => b.id === blockId ? { ...b, text } : b) });
  };

  const insertText = (after?: string) => {
    const block: Block = { id: uid(), type: "text", text: "" };
    const blocks = [...active.blocks];
    const i = after ? blocks.findIndex(b => b.id === after) + 1 : blocks.length;
    blocks.splice(Math.max(0, i), 0, block);
    update({ blocks });
    setTimeout(() => document.getElementById("block-" + block.id)?.focus(), 20);
  };

  const insertImage = async (file: File, target = imageTarget.current) => {
    if (!active || !target) return;
    const imageId = await putImage(file);
    if (target.mode === "replace") {
      const old = active.blocks.find(b => b.id === target.blockId);
      if (old?.type === "image") await del("images", old.imageId);
      update({ blocks: active.blocks.map(b => b.id === target.blockId ? { ...b, imageId } : b) });
    } else {
      const blocks = [...active.blocks];
      const i = blocks.findIndex(b => b.id === target.blockId);
      blocks.splice(i >= 0 ? i + 1 : blocks.length, 0, { id: uid(), type: "image", imageId, text: "" });
      update({ blocks });
    }
    imageTarget.current = null;
    setSheet(null);
  };

  const pasteImage = async (e: React.ClipboardEvent<HTMLTextAreaElement>, blockId: string) => {
    const item = Array.from(e.clipboardData.items).find(i => i.type.startsWith("image/"));
    if (!item) return;
    const file = item.getAsFile();
    if (!file) return;
    e.preventDefault();
    await insertImage(file, { blockId, mode: "insert" });
  };

  const removeBlock = async (blockId: string) => {
    const b = active.blocks.find(x => x.id === blockId);
    if (b?.type === "image") await del("images", b.imageId);
    const blocks = active.blocks.filter(x => x.id !== blockId);
    update({ blocks: blocks.length ? blocks : [{ id: uid(), type: "text", text: "" }] });
  };

  const deleteNote = async () => {
    if (!active || !confirm("Delete this note?")) return;
    for (const b of active.blocks) if (b.type === "image") await del("images", b.imageId);
    await del("notes", active.id);
    const left = notes.filter(n => n.id !== active.id);
    if (!left.length) { await createNote(); return; }
    setNotes(left);
    setTabs(t => t.filter(id => id !== active.id));
    openNote(left[0], false);
  };

  const addProperty = () => {
    if (!active || !propertyKey.trim()) return;
    update({ properties: { ...active.properties, [propertyKey.trim()]: propertyValue } });
    setPropertyKey(""); setPropertyValue("");
  };

  type NoteFormat = "md" | "md-zip" | "txt" | "html" | "html-zip" | "json";

  const markdownFor = (note: Note) => {
    const props = Object.entries(note.properties);
    const frontmatter = props.length
      ? "---\n" + props.map(([k,v]) => k + ": " + v.replace(/\n/g, " ")).join("\n") + "\n---\n\n"
      : "";
    const body = note.blocks.map(b => b.type === "text"
      ? b.text
      : "![Screenshot](notekeep://"+b.imageId+")\n\n" + (b.text ? b.text + "\n\n" : "")
    ).join("\n");
    return frontmatter + "# " + note.title + "\n\n" + body.trimEnd() + "\n";
  };

  const plainTextFor = (note: Note) =>
    note.title + "\n\n" + note.blocks.map(b => b.text).filter(Boolean).join("\n\n");

  const htmlFor = (note: Note) => {
    const esc = (value: string) => value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    const body = note.blocks.map(b => b.type === "image"
      ? '<figure><img src="notekeep://'+esc(b.imageId)+'" alt="Screenshot"><figcaption>'+esc(b.text || "")+'</figcaption></figure>'
      : '<p>'+esc(b.text).replace(/\n/g,"<br>")+'</p>'
    ).join("\n");
    return '<!doctype html><html><head><meta charset="utf-8"><title>'+esc(note.title)+'</title></head><body><main><h1>'+esc(note.title)+'</h1>'+body+'</main></body></html>';
  };

  const jsonFor = (note: Note) => JSON.stringify({
    format: "notekeep-note",
    version: 1,
    title: note.title,
    path: note.path,
    properties: note.properties,
    blocks: note.blocks,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  }, null, 2);

  const safeFileName = (value: string) =>
    value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "Untitled";

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.download = filename;
    a.href = url;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const exportNote = async (note = active, format: NoteFormat = "md") => {
    if (!note) return;

    const baseName = safeFileName(note.path.replace(/\.md$/i, "") || note.title || "Untitled");
    const bundled = format === "md-zip" || format === "html-zip";
    const imageBlocks = note.blocks.filter((b): b is Extract<Block, { type: "image" }> => b.type === "image");
    const imagePaths = new Map<string, string>();
    const files: Record<string, Uint8Array> = {};

    if (bundled) {
      let assetIndex = 0;
      for (const block of imageBlocks) {
        const image = await getImage(block.imageId);
        if (!image) continue;
        assetIndex += 1;
        const type = image.blob.type || "image/png";
        const extension = type.split("/")[1]?.split("+")[0] || "png";
        const path = `assets/${String(assetIndex).padStart(2, "0")}-screenshot.${extension}`;
        imagePaths.set(block.imageId, path);
        files[path] = new Uint8Array(await image.blob.arrayBuffer());
      }
    }

    const portableMarkdown = () => {
      const props = Object.entries(note.properties);
      const frontmatter = props.length
        ? "---\\n" + props.map(([k,v]) => k + ": " + v.replace(/\\n/g, " ")).join("\\n") + "\\n---\\n\\n"
        : "";
      const body = note.blocks.map(b => {
        if (b.type === "text") return b.text;
        const path = imagePaths.get(b.imageId);
        return path
          ? `![Screenshot](${path})\\n\\n${b.text ? b.text + "\\n\\n" : ""}`
          : `<!-- Missing screenshot: ${b.imageId} -->`;
      }).join("\\n").trimEnd();
      return frontmatter + "# " + note.title + "\\n\\n" + body + "\\n";
    };

    const portableHtml = () => {
      const esc = (value: string) => value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
      const body = note.blocks.map(b => b.type === "image"
        ? `<figure><img src="${esc(imagePaths.get(b.imageId) || "")}" alt="Screenshot"><figcaption>${esc(b.text || "")}</figcaption></figure>`
        : `<p>${esc(b.text).replace(/\\n/g,"<br>")}</p>`
      ).join("\\n");
      return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(note.title)}</title></head><body><main><h1>${esc(note.title)}</h1>${body}</main></body></html>`;
    };

    if (format === "md-zip" || format === "html-zip") {
      const content = format === "md-zip" ? portableMarkdown() : portableHtml();
      const extension = format === "md-zip" ? "md" : "html";
      files[`note.${extension}`] = strToU8(content);
      files["notekeep.json"] = strToU8(JSON.stringify({
        format: "notekeep-bundle",
        version: 1,
        note: {
          ...note,
          id: undefined,
          blocks: note.blocks.map(block => block.type === "image"
            ? { ...block, imagePath: imagePaths.get(block.imageId) || null }
            : block
          )
        },
        assets: Object.fromEntries(imagePaths)
      }, null, 2));
      files["README.txt"] = strToU8(
        `Exported from NoteKeep\n\nOpen note.${extension} for a portable document. The notekeep.json manifest preserves block structure and screenshot/commentary relationships; screenshot files are in assets/.\n`
      );
      downloadBlob(new Blob([zipSync(files)], { type: "application/zip" }), `${baseName}-notekeep.zip`);
    } else {
      const content = format === "md" ? markdownFor(note)
        : format === "txt" ? plainTextFor(note)
        : format === "html" ? htmlFor(note)
        : jsonFor(note);
      const mime = format === "md" ? "text/markdown;charset=utf-8"
        : format === "txt" ? "text/plain;charset=utf-8"
        : format === "html" ? "text/html;charset=utf-8"
        : "application/json;charset=utf-8";
      const ext = format === "md" ? "md" : format;
      downloadBlob(new Blob([content], { type: mime }), `${baseName}.${ext}`);
    }

    setFormatOpen(false);
    setStatus("Exported");
  };

  const importNote = async (file: File) => {
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    let note: Note;

    if (extension === "zip") {
      const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
      const manifestBytes = entries["notekeep.json"];
      if (!manifestBytes) throw new Error("This ZIP is not a NoteKeep export.");
      const manifest = JSON.parse(strFromU8(manifestBytes));
      if (manifest?.format !== "notekeep-bundle") throw new Error("Unsupported NoteKeep bundle.");

      const source = normalize({ ...(manifest.note || {}), id: uid() });
      const assets = manifest.assets && typeof manifest.assets === "object" ? manifest.assets as Record<string,string> : {};
      const mimeFor = (path: string) => {
        const ext = path.split(".").pop()?.toLowerCase();
        return ext === "jpg" || ext === "jpeg" ? "image/jpeg"
          : ext === "webp" ? "image/webp"
          : ext === "gif" ? "image/gif"
          : ext === "svg" ? "image/svg+xml"
          : "image/png";
      };

      const restoredBlocks: Block[] = [];
      for (const block of source.blocks) {
        if (block.type !== "image") {
          restoredBlocks.push(block);
          continue;
        }
        const path = assets[block.imageId];
        const bytes = path ? entries[path] : undefined;
        if (!bytes) {
          restoredBlocks.push({ ...block, imageId: "" } as Block);
          continue;
        }
        const imageId = await putImage(new Blob([bytes], { type: mimeFor(path) }));
        restoredBlocks.push({ ...block, imageId });
      }
      note = normalize({ ...source, blocks: restoredBlocks.filter(b => b.type !== "image" || b.imageId) });
    } else {
      const raw = await file.text();

      if (extension === "json") {
      const parsed = JSON.parse(raw);
      const source = parsed?.format === "notekeep-note" ? parsed : parsed?.note || parsed;
      note = normalize({ ...source, id: uid(), title: source?.title || file.name.replace(/\.json$/i, ""), path: source?.path || file.name.replace(/\.json$/i, ".md") });
    } else if (extension === "html" || extension === "htm") {
      const doc = new DOMParser().parseFromString(raw, "text/html");
      const title = doc.querySelector("title")?.textContent?.trim() || doc.querySelector("h1")?.textContent?.trim() || file.name.replace(/\.html?$/i, "");
      const body = doc.querySelector("main")?.textContent?.trim() || doc.body?.textContent?.trim() || "";
      note = { id: uid(), title: title || "Untitled", path: (title || "Untitled") + ".md", blocks: body ? [{ id: uid(), type: "text", text: body }] : [{ id: uid(), type: "text", text: "" }], properties: {}, updatedAt: Date.now(), createdAt: Date.now() };
    } else if (extension === "txt" || extension === "text") {
      const title = file.name.replace(/\.(txt|text)$/i, "") || "Untitled";
      note = { id: uid(), title, path: title + ".md", blocks: [{ id: uid(), type: "text", text: raw.trim() }], properties: {}, updatedAt: Date.now(), createdAt: Date.now() };
    } else {
      const lines = raw.split(/\r?\n/);
      let start = 0;
      const properties: Record<string,string> = {};
      if (lines[0]?.trim() === "---") {
        const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
        if (end > 0) {
          lines.slice(1, end).forEach(line => {
            const i = line.indexOf(":");
            if (i > 0) properties[line.slice(0,i).trim()] = line.slice(i + 1).trim();
          });
          start = end + 1;
        }
      }
      while (start < lines.length && !lines[start].trim()) start++;
      const title = lines[start]?.match(/^#\s+(.+)$/)?.[1]?.trim() || file.name.replace(/\.(md|markdown)$/i, "") || "Untitled";
      if (lines[start]?.match(/^#\s+/)) start++;
      while (start < lines.length && !lines[start].trim()) start++;
      const body = lines.slice(start).join("\n").trim();
      const blocks: Block[] = body ? body.split(/\n{2,}/).map(text => ({ id: uid(), type: "text", text })) : [{ id: uid(), type: "text", text: "" }];
        note = { id: uid(), title, path: title + ".md", blocks, properties, updatedAt: Date.now(), createdAt: Date.now() };
      }
    }

    await putNote(note);
    setNotes(current => [note, ...current]);
    openNote(note, true);
    setStatus("Imported");
  };

  const createLinkedNote = async (link: string) => {
    const title = link.split("/").pop()?.trim() || "Untitled";
    const existing = notes.find(n => n.title.toLowerCase() === title.toLowerCase());
    if (existing) return openNote(existing, true);
    await createNote(title);
  };

  const closeTab = (id: string) => {
    setTabs(current => {
      const next = current.filter(x => x !== id);
      if (id === activeTab) {
        const idx = current.indexOf(id);
        const fallback = next[Math.max(0, idx - 1)] || next[0];
        if (fallback) { setActiveId(fallback); setActiveTab(fallback); }
      }
      return next.length ? next : [activeId];
    });
  };

  const runCommand = (command: string) => {
    setCommandOpen(false); setCommandQuery("");
    if (command === "New note") void createNote();
    if (command === "Search") { setLeftOpen(true); setTimeout(() => document.querySelector<HTMLInputElement>(".vault-search")?.focus(), 30); }
    if (command === "Graph view") setGraphOpen(true);
    if (command === "Export note") setFormatOpen(true);
    if (command === "Import note") importFile.current?.click();
    if (command === "Toggle right sidebar") setRightOpen(v => !v);
    if (command === "Toggle left sidebar") setLeftOpen(v => !v);
    if (command === "Toggle source mode") setSourceMode(v => !v);
    if (command === "Open settings") setSettingsOpen(true);
    if (command === "Daily note") {
      const title = new Date().toISOString().slice(0, 10);
      const existing = notes.find(n => n.title === title);
      if (existing) openNote(existing, true); else void createNote(title);
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "p") { e.preventDefault(); setCommandOpen(true); setTimeout(() => document.querySelector<HTMLInputElement>(".command-input")?.focus(), 20); }
      if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); setCommandOpen(true); }
      if (mod && e.key.toLowerCase() === "n") { e.preventDefault(); void createNote(); }
      if (mod && e.key.toLowerCase() === "o") { e.preventDefault(); setLeftOpen(true); setTimeout(() => document.querySelector<HTMLInputElement>(".vault-search")?.focus(), 20); }
      if (e.key === "Escape") { setCommandOpen(false); setSettingsOpen(false); setGraphOpen(false); setPropertiesOpen(false); setFormatOpen(false); setSheet(null); setImageViewer(null); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  const commands = ["New note", "Search", "Daily note", "Graph view", "Export note", "Import note", "Toggle left sidebar", "Toggle right sidebar", "Toggle source mode", "Open settings"];
  const filteredCommands = commands.filter(c => c.toLowerCase().includes(commandQuery.toLowerCase()));

  if (!ready || !active) return <main className="loading"><div><div className="loading-mark" /><span>NoteKeep</span></div></main>;

  return (
    <main className="obsidian-app">
      <aside className={"left-sidebar " + (leftOpen ? "is-open" : "")}>
        <div className="vault-head">
          <div className="vault-name"><BookOpen size={15} /><span>NoteKeep Vault</span></div>
          <div className="vault-actions">
            <button className="side-icon" onClick={() => setSettingsOpen(true)} aria-label="Settings"><Settings size={15} /></button>
            <button className="side-icon mobile-close-sidebar" onClick={() => setLeftOpen(false)} aria-label="Close sidebar"><X size={15} /></button>
          </div>
        </div>
        <div className="ribbon">
          <button onClick={() => void createNote()} title="New note"><FilePlus size={16} /></button>
          <button onClick={() => setGraphOpen(true)} title="Graph"><GitBranch size={16} /></button>
          <button onClick={() => setCommandOpen(true)} title="Command palette"><Command size={16} /></button>
        </div>
        <label className="vault-search"><Search size={14}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search vault" /><kbd>⌘ K</kbd></label>
        <div className="explorer-head"><span>EXPLORER</span><div><button onClick={() => void createNote()} title="New note"><Plus size={13}/></button><button title="More"><MoreHorizontal size={13}/></button></div></div>
        <div className="file-tree">
          <div className="folder-row"><ChevronDown size={13}/><FolderOpen size={14}/><span>Notes</span></div>
          {visibleNotes.map(n => (
            <button key={n.id} className={"file-row " + (n.id === active.id ? "active" : "")} onClick={() => openNote(n)}>
              <File size={14}/><span>{n.title || "Untitled"}</span><small>.md</small>
            </button>
          ))}
          {!visibleNotes.length && <div className="empty-tree">No matching notes</div>}
        </div>
        <div className="left-footer">
          <button onClick={() => setGraphOpen(true)}><GitBranch size={14}/> Graph view</button>
          <button onClick={() => setSettingsOpen(true)}><Settings size={14}/> Settings</button>
        </div>
      </aside>

      <section className="main-area">
        {leftOpen && <button className="sidebar-scrim" onClick={() => setLeftOpen(false)} aria-label="Close sidebar" />}
        <header className="appbar">
          <div className="appbar-left">
            <button className="chrome-icon" onClick={() => setLeftOpen(v => !v)} title="Toggle left sidebar"><PanelLeft size={17}/></button>
            <div className="breadcrumbs"><span>Notes</span><span>/</span><b>{active.title || "Untitled"}</b></div>
          </div>
          <div className="appbar-actions">
            <span className={"save-label " + (status === "Saving" ? "saving" : "")}>{status}</span>
            <button className="chrome-icon" onClick={() => setRightOpen(v => !v)} title="Toggle right sidebar"><PanelRight size={17}/></button>
            <button className="chrome-icon danger" onClick={() => void deleteNote()} title="Delete note"><Trash2 size={16}/></button>
          </div>
        </header>

        <div className="tabs">
          <div className="tab-strip">
            {tabs.map(tabId => {
              const n = notes.find(x => x.id === tabId);
              if (!n) return null;
              return <button key={tabId} className={"tab " + (tabId === activeTab ? "active" : "")} onClick={() => { setActiveTab(tabId); setActiveId(tabId); }}>
                <File size={13}/><span>{n.title || "Untitled"}</span><i onClick={e => { e.stopPropagation(); closeTab(tabId); }}><X size={12}/></i>
              </button>;
            })}
            <button className="new-tab" onClick={() => void createNote()}><Plus size={15}/></button>
          </div>
        </div>

        <div className="editor-wrap">
          <article className="note-editor" style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }}>
            <div className="note-head">
              <input className="note-title" value={active.title} onChange={e => update({ title: e.target.value, path: e.target.value.trim() ? e.target.value.trim() + ".md" : "Untitled.md" })} placeholder="Untitled" />
              <div className="note-actions">
                <DropdownMenu.Root open={formatOpen} onOpenChange={setFormatOpen}>
                  <DropdownMenu.Trigger asChild>
                    <button className="more-note" title="Export note" aria-label="Export note"><FileDown size={16}/></button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content className="export-menu" align="end" sideOffset={8}>
                      <div className="format-title">Export note</div>
                      <DropdownMenu.Item className="export-item" onSelect={() => void exportNote(active, "md-zip")}><span>Markdown + images</span><small>.zip</small></DropdownMenu.Item>
                      <DropdownMenu.Item className="export-item" onSelect={() => void exportNote(active, "md")}><span>Markdown only</span><small>.md</small></DropdownMenu.Item>
                      <DropdownMenu.Item className="export-item" onSelect={() => void exportNote(active, "txt")}><span>Plain text</span><small>.txt</small></DropdownMenu.Item>
                      <DropdownMenu.Item className="export-item" onSelect={() => void exportNote(active, "html-zip")}><span>HTML + images</span><small>.zip</small></DropdownMenu.Item>
                      <DropdownMenu.Item className="export-item" onSelect={() => void exportNote(active, "html")}><span>HTML only</span><small>.html</small></DropdownMenu.Item>
                      <DropdownMenu.Item className="export-item" onSelect={() => void exportNote(active, "json")}><span>NoteKeep JSON</span><small>.json</small></DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
                <button className="more-note" onClick={() => setPropertiesOpen(v => !v)} title="Properties"><MoreHorizontal size={18}/></button>

              </div>
            </div>

            {Object.keys(active.properties).length > 0 && (
              <div className="properties-inline">
                {Object.entries(active.properties).map(([k,v]) => <span key={k}><b>{k}</b><em>{v}</em></span>)}
              </div>
            )}

            {propertiesOpen && (
              <div className="properties-pop">
                <div className="pop-head"><b>Properties</b><button onClick={() => setPropertiesOpen(false)}><X size={14}/></button></div>
                {Object.entries(active.properties).map(([k,v]) => <div className="property-row" key={k}><input value={k} readOnly/><input value={v} onChange={e => update({properties:{...active.properties,[k]:e.target.value}})}/><button onClick={() => { const p={...active.properties}; delete p[k]; update({properties:p}); }}><X size={13}/></button></div>)}
                <div className="property-row new-property"><input placeholder="name" value={propertyKey} onChange={e=>setPropertyKey(e.target.value)}/><input placeholder="value" value={propertyValue} onChange={e=>setPropertyValue(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addProperty()}/><button onClick={addProperty}><Plus size={13}/></button></div>
                <div className="property-tip">Properties are stored with the note and stay local.</div>
              </div>
            )}

            {sourceMode ? (
              <textarea className="source-editor" value={markdownFor(active)} onChange={e => {
                const lines = e.target.value.split("\n");
                let start = 0;
                const properties: Record<string,string> = {};
                if (lines[0]?.trim() === "---") {
                  const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
                  if (end > 0) {
                    lines.slice(1, end).forEach(line => {
                      const i = line.indexOf(":");
                      if (i > 0) properties[line.slice(0,i).trim()] = line.slice(i + 1).trim();
                    });
                    start = end + 1;
                  }
                }
                while (start < lines.length && !lines[start].trim()) start++;
                const title = lines[start]?.replace(/^#\s*/, "") || "Untitled";
                if (lines[start]?.match(/^#\s+/)) start++;
                while (start < lines.length && !lines[start].trim()) start++;
                const body = lines.slice(start).join("\n");
                update({title, path:title + ".md", properties, blocks:[{id:active.blocks[0]?.id||uid(),type:"text",text:body}]});
              }} />
            ) : (
              <div className="document">
                {active.blocks.map((block, index) => block.type === "text" ? (
                  <section className="text-block" key={block.id}>
                    <textarea id={"block-"+block.id} ref={resize} value={block.text} onChange={e=>{resize(e.currentTarget);updateBlock(block.id,e.target.value)}} onPaste={e=>void pasteImage(e,block.id)} placeholder={index===0?"Start writing…":"Continue writing…"} rows={1}/>
                    <div className="block-tools">
                      <button onClick={()=>{imageTarget.current={blockId:block.id,mode:"insert"};setSheet({blockId:block.id,mode:"insert"})}} title="Insert image"><ImagePlus size={14}/></button>
                      <button onClick={()=>insertText(block.id)} title="New paragraph"><Plus size={14}/></button>
                      {active.blocks.length>1&&<button onClick={()=>void removeBlock(block.id)} title="Delete block"><X size={14}/></button>}
                    </div>
                  </section>
                ) : (
                  <figure className="image-block" key={block.id}>
                    {urls[block.imageId]&&<button className="image-frame" onClick={() => setImageViewer(urls[block.imageId])} aria-label="Open screenshot preview"><img src={urls[block.imageId]} alt="" draggable={false}/><span className="image-open-hint">Open preview</span></button>}
                    <textarea ref={resize} value={block.text} onChange={e=>{resize(e.currentTarget);updateBlock(block.id,e.target.value)}} placeholder="Describe what this screenshot means…"/>
                    <figcaption>
                      <button onClick={()=>{if(urls[block.imageId]){const a=document.createElement("a");a.download="notekeep-"+Date.now()+".png";a.href=urls[block.imageId];a.click()}}} title="Save this screenshot"><Download size={13}/> Save image</button>
                      <button onClick={()=>{imageTarget.current={blockId:block.id,mode:"replace"};setSheet({blockId:block.id,mode:"replace"})}}><ImagePlus size={13}/> Replace</button>
                      <button className="danger" onClick={()=>void removeBlock(block.id)}><Trash2 size={13}/></button>
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}

            <div className="insert-line"><button onClick={()=>insertText()}><Plus size={14}/> Add paragraph</button><button onClick={()=>{const last=active.blocks[active.blocks.length-1];imageTarget.current={blockId:last?.id||"",mode:"insert"};setSheet({blockId:last?.id||"",mode:"insert"})}}><ImagePlus size={14}/> Screenshot</button></div>
          </article>
        </div>

        <footer className="statusbar">
          <span>{active.path}</span><span>{noteText(active).split(/\s+/).filter(Boolean).length} words</span><span>{active.blocks.length} blocks</span>
          <div className="zoom"><button onClick={()=>setZoom(z=>Math.max(.8,z-.1))}><ZoomOut size={13}/></button><span>{Math.round(zoom*100)}%</span><button onClick={()=>setZoom(z=>Math.min(1.2,z+.1))}><ZoomIn size={13}/></button></div>
        </footer>
      </section>

      {rightOpen && <aside className="right-sidebar">
        <div className="right-tabs"><button className={rightPanel==="backlinks"?"active":""} onClick={()=>setRightPanel("backlinks")}><Link2 size={13}/> Backlinks</button><button className={rightPanel==="outline"?"active":""} onClick={()=>setRightPanel("outline")}><ListIcon/> Outline</button><button className={rightPanel==="tags"?"active":""} onClick={()=>setRightPanel("tags")}><Hash size={13}/> Tags</button></div>
        {rightPanel==="backlinks"&&<div className="side-content"><h4>Linked mentions</h4>{incoming.length?<>{incoming.map(n=><button className="mention" key={n.id} onClick={()=>openNote(n)}><b>{n.title}</b><span>{noteText(n).slice(0,110)||"No text"}</span></button>)}</>:<div className="side-empty">No backlinks yet.</div>}<h4>Outgoing links</h4>{outgoing.length?outgoing.map(n=><button className="mention compact" key={n.id} onClick={()=>openNote(n)}><Link2 size={12}/>{n.title}</button>):<div className="side-empty">No outgoing links.</div>}{unresolvedLinks.length>0&&<><h4>Unresolved links</h4>{unresolvedLinks.map(link=><button className="mention compact" key={link} onClick={()=>void createLinkedNote(link)}><Plus size={12}/>Create “{link}”</button>)}</>}</div>}
        {rightPanel==="outline"&&<div className="side-content"><h4>Outline</h4>{outline.length?outline.map(item=><button className="outline-row" key={item.id} style={{paddingLeft:7+item.level*9}} onClick={()=>document.getElementById("block-"+item.id.split("-")[0])?.scrollIntoView({behavior:"smooth",block:"center"})}>{item.text}</button>):<div className="side-empty">Add Markdown headings such as # Heading or ## Section to build an outline.</div>}</div>}
        {rightPanel==="tags"&&<div className="side-content"><h4>All tags</h4>{allTags.map(([tag,count])=><button className="tag-row" key={tag} onClick={()=>setQuery("#"+tag)}><Hash size={12}/>{tag}<span>{count}</span></button>)}</div>}
      </aside>}

      <input ref={photos} className="hidden-file" type="file" accept="image/*" onChange={e=>{const f=e.target.files?.[0];if(f)void insertImage(f);e.target.value=""}}/>
      <input ref={camera} className="hidden-file" type="file" accept="image/*" capture="environment" onChange={e=>{const f=e.target.files?.[0];if(f)void insertImage(f);e.target.value=""}}/>
      <input ref={importFile} className="hidden-file" type="file" accept=".md,.markdown,.txt,.text,.html,.htm,.json,.zip,text/markdown,text/plain,text/html,application/json,application/zip" onChange={e=>{const f=e.target.files?.[0];if(f)void importNote(f).catch(()=>setStatus("Import failed"));e.target.value=""}}/>

      {sheet&&<div className="modal-backdrop" onClick={()=>setSheet(null)}><div className="image-sheet" onClick={e=>e.stopPropagation()}><div className="grabber"/><div className="sheet-title"><b>{sheet.mode==="replace"?"Replace screenshot":"Add screenshot"}</b><button onClick={()=>setSheet(null)}><X size={16}/></button></div><button onClick={()=>{imageTarget.current=sheet;setSheet(null);camera.current?.click()}}><CameraIcon/><span><b>Camera</b><small>Capture an image</small></span></button><button onClick={()=>{imageTarget.current=sheet;setSheet(null);photos.current?.click()}}><ImagePlus size={19}/><span><b>Photos</b><small>Choose from your device</small></span></button></div></div>}

      {commandOpen&&<div className="modal-backdrop" onClick={()=>setCommandOpen(false)}><div className="command-palette" onClick={e=>e.stopPropagation()}><div className="command-search"><Command size={16}/><input autoFocus className="command-input" value={commandQuery} onChange={e=>setCommandQuery(e.target.value)} placeholder="Type a command…"/><kbd>ESC</kbd></div><div className="command-list">{filteredCommands.map(c=><button key={c} onClick={()=>runCommand(c)}><span>{c}</span><ChevronRight size={14}/></button>)}{!filteredCommands.length&&<div className="command-empty">No commands found</div>}</div></div></div>}

      {imageViewer&&<div className="image-viewer" onClick={()=>setImageViewer(null)}>
        <button className="image-viewer-close" onClick={()=>setImageViewer(null)} aria-label="Close image preview"><X size={20}/></button>
        <img src={imageViewer} alt="Screenshot preview" onClick={e=>e.stopPropagation()} />
      </div>}

      <Dialog.Root open={settingsOpen} onOpenChange={setSettingsOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="settings-overlay"/>
          <Dialog.Content className="settings-modal" aria-describedby={undefined}>
            <Dialog.Title className="sr-only">NoteKeep Settings</Dialog.Title>
            <div className="settings-nav"><b>Settings</b>{["Editor","Appearance","Files & Links","Core plugins","Hotkeys","About"].map((x,i)=><button className={i===0?"active":""} key={x}>{x}</button>)}</div>
            <div className="settings-main"><div className="settings-top"><div><small>SETTINGS</small><h2>Editor</h2></div><Dialog.Close asChild><button aria-label="Close settings"><X size={17}/></button></Dialog.Close></div>
              <label className="setting-toggle"><span><b>Live Preview</b><small>Render Markdown while you type.</small></span><input type="checkbox" defaultChecked/></label>
              <label className="setting-toggle"><span><b>Spellcheck</b><small>Check spelling in note editors.</small></span><input type="checkbox" defaultChecked/></label>
              <label className="setting-toggle"><span><b>Inline properties</b><small>Show note metadata above the document.</small></span><input type="checkbox" defaultChecked/></label>
              <div className="settings-note">NoteKeep keeps the vault local to this browser. No account or server is required.</div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {graphOpen&&<Graph notes={notes} active={active} onOpen={openNote} onClose={()=>setGraphOpen(false)}/>}
    </main>
  );
}

function ListIcon(){return <span className="list-icon">≡</span>}
function CameraIcon(){return <span className="camera-icon">◉</span>}

function Graph({notes,active,onOpen,onClose}:{notes:Note[];active:Note;onOpen:(n:Note)=>void;onClose:()=>void}) {
  const nodes = notes.slice(0,24);
  const cx=500, cy=310, r=Math.min(230,Math.max(100,nodes.length*13));
  const points=nodes.map((n,i)=>({n,x:cx+(nodes.length===1?0:Math.cos(i/nodes.length*Math.PI*2)*r),y:cy+(nodes.length===1?0:Math.sin(i/nodes.length*Math.PI*2)*r)}));
  const pos=new Map(points.map(p=>[p.n.id,p]));
  return <div className="graph-overlay"><div className="graph-toolbar"><b>Graph view</b><span>{notes.length} notes</span><button onClick={onClose}><X size={17}/></button></div><svg viewBox="0 0 1000 620" className="graph-svg">{nodes.flatMap(n=>linksIn(n).map(l=>{const to=nodes.find(x=>x.title.toLowerCase()===l);const a=pos.get(n.id),b=to&&pos.get(to.id);return a&&b?<line key={n.id+l} x1={a.x} y1={a.y} x2={b.x} y2={b.y}/>:null})).filter(Boolean)}{points.map(p=><g key={p.n.id} onClick={()=>onOpen(p.n)} className={p.n.id===active.id?"graph-node active": "graph-node"}><circle cx={p.x} cy={p.y} r={p.n.id===active.id?10:7}/><text x={p.x+13} y={p.y+4}>{p.n.title.slice(0,24)}</text></g>)}</svg></div>;
}
