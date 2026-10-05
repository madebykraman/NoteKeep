"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  Archive, ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown, ChevronRight,
  Bold, CalendarDays, Command, Copy, Download, File, FileDown, FilePlus, FilePenLine, Folder, FolderOpen, GitBranch,
  Hash, Heading2, ImagePlus, Link2, Menu, MoreHorizontal, PanelLeft, PanelRight,
  Plus, Redo2, Search, Settings, Share2, Sparkles, Tags, Trash2, Undo2, X, ZoomIn, ZoomOut
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
type PluginFlags = {
  search: boolean; commandPalette: boolean; graph: boolean; properties: boolean;
  backlinks: boolean; dailyNotes: boolean; sourceMode: boolean;
};

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

function renderInline(value: string, onLink: (target: string) => void) {
  return value.split(/(\[\[[^\]]+\]\]|\*\*[^*]+\*\*|#[a-zA-Z0-9_-]+)/g).map((part, i) => {
    if (part.startsWith("[[") && part.endsWith("]]")) {
      const target = part.slice(2, -2).split("|")[0].trim();
      return <button type="button" className="rendered-link" key={i} onClick={() => onLink(target)}>[[{target}]]</button>;
    }
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (/^#[a-zA-Z0-9_-]+$/.test(part)) return <span className="rendered-tag" key={i}>{part}</span>;
    return <span key={i}>{part}</span>;
  });
}

function renderMarkdownBlock(value: string, onLink: (target: string) => void) {
  return <div className="rendered-block">
    {value.split("\n").map((line, i) => {
      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (!line.trim()) return <div className="rendered-spacer" key={i} aria-hidden="true"/>;
      const content = heading ? renderInline(heading[2], onLink) : renderInline(line, onLink);
      if (!heading) return <p key={i}>{content}</p>;
      const level = heading[1].length;
      if (level === 1) return <h1 key={i}>{content}</h1>;
      if (level === 2) return <h2 key={i}>{content}</h2>;
      if (level === 3) return <h3 key={i}>{content}</h3>;
      if (level === 4) return <h4 key={i}>{content}</h4>;
      if (level === 5) return <h5 key={i}>{content}</h5>;
      return <h6 key={i}>{content}</h6>;
    })}
  </div>;
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
  const [mobileSheet, setMobileSheet] = useState<"more" | "search" | "tabs" | "backlinks" | null>(null);
  const [mobileImageMenu, setMobileImageMenu] = useState<string | null>(null);
  const [readingMode, setReadingMode] = useState(false);
  const [editorFocused, setEditorFocused] = useState(false);
  const [rightOpen, setRightOpen] = useState(true);
  const [rightPanel, setRightPanel] = useState<"backlinks" | "outline" | "tags">("backlinks");
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"Editor" | "Appearance" | "Files & Links" | "Core plugins" | "Hotkeys" | "About">("Editor");
  const [spellcheckEnabled, setSpellcheckEnabled] = useState(true);
  const [inlinePropertiesEnabled, setInlinePropertiesEnabled] = useState(true);
  const [compactInterface, setCompactInterface] = useState(true);
  const [accentTheme, setAccentTheme] = useState<"violet" | "blue" | "cyan" | "amber">("violet");
  const [confirmDelete, setConfirmDelete] = useState(true);
  const [openLinksInNewTab, setOpenLinksInNewTab] = useState(false);
  const [exportFrontmatter, setExportFrontmatter] = useState(true);
  const [hotkeysEnabled, setHotkeysEnabled] = useState(true);
  const [plugins, setPlugins] = useState<PluginFlags>({
    search: true, commandPalette: true, graph: true, properties: true,
    backlinks: true, dailyNotes: true, sourceMode: true
  });
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

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("notekeep-preferences") || "{}");
      if (typeof saved.spellcheck === "boolean") setSpellcheckEnabled(saved.spellcheck);
      if (typeof saved.inlineProperties === "boolean") setInlinePropertiesEnabled(saved.inlineProperties);
      if (typeof saved.compactInterface === "boolean") setCompactInterface(saved.compactInterface);
      if (["violet","blue","cyan","amber"].includes(saved.accentTheme)) setAccentTheme(saved.accentTheme);
      if (typeof saved.confirmDelete === "boolean") setConfirmDelete(saved.confirmDelete);
      if (typeof saved.openLinksInNewTab === "boolean") setOpenLinksInNewTab(saved.openLinksInNewTab);
      if (typeof saved.exportFrontmatter === "boolean") setExportFrontmatter(saved.exportFrontmatter);
      if (typeof saved.hotkeysEnabled === "boolean") setHotkeysEnabled(saved.hotkeysEnabled);
      if (saved.plugins && typeof saved.plugins === "object") setPlugins(current => ({...current, ...saved.plugins}));
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("notekeep-preferences", JSON.stringify({
        spellcheck: spellcheckEnabled,
        inlineProperties: inlinePropertiesEnabled,
        compactInterface,
        accentTheme,
        confirmDelete,
        openLinksInNewTab,
        exportFrontmatter,
        hotkeysEnabled,
        plugins
      }));
    } catch {}
  }, [spellcheckEnabled, inlinePropertiesEnabled, compactInterface, accentTheme, confirmDelete, openLinksInNewTab, exportFrontmatter, hotkeysEnabled, plugins]);

  useEffect(() => {
    if (!plugins.backlinks && rightPanel === "backlinks") setRightPanel("outline");
    if (!plugins.commandPalette) setCommandOpen(false);
    if (!plugins.graph) setGraphOpen(false);
    if (!plugins.search && mobileSheet === "search") setMobileSheet(null);
  }, [plugins, rightPanel, mobileSheet]);

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

  const updateFocusedText = (transform: (value: string, start: number, end: number) => { text: string; start: number; end: number }) => {
    const el = document.activeElement;
    if (!(el instanceof HTMLTextAreaElement)) return;
    const match = el.id.match(/^block-(.+)$/);
    if (!match) return;
    const block = active?.blocks.find(b => b.id === match[1]);
    if (!block || block.type !== "text") return;
    const result = transform(block.text, el.selectionStart, el.selectionEnd);
    updateBlock(block.id, result.text);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(result.start, result.end);
    });
  };

  const wrapFocusedText = (prefix: string, suffix = prefix) => {
    updateFocusedText((value, start, end) => ({
      text: value.slice(0, start) + prefix + value.slice(start, end) + suffix + value.slice(end),
      start: start + prefix.length,
      end: end + prefix.length
    }));
  };

  const prependFocusedLine = (prefix: string) => {
    updateFocusedText((value, start, end) => {
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const text = value.slice(0, lineStart) + prefix + value.slice(lineStart);
      return { text, start: start + prefix.length, end: end + prefix.length };
    });
  };

  const shareNote = async () => {
    if (!active) return;
    const text = markdownFor(active);
    if (navigator.share) {
      await navigator.share({ title: active.title || "NoteKeep note", text }).catch(() => {});
    } else {
      await navigator.clipboard?.writeText(text);
      setStatus("Copied to clipboard");
    }
  };

  const shareImage = async (blockId: string) => {
    const block = active?.blocks.find(b => b.id === blockId);
    if (!block || block.type !== "image") return;
    const record = await getImage(block.imageId);
    if (!record) return;
    const blob = record.blob;
    if (navigator.share) {
      try {
        await navigator.share({
          title: active.title || "NoteKeep screenshot",
          files: [new globalThis.File([blob], "screenshot.png", { type: blob.type || "image/png" })]
        });
        setStatus("Shared");
        return;
      } catch {}
    }
    try {
      await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
      setStatus("Image copied");
    } catch {
      const url = URL.createObjectURL(blob);
      downloadBlob(blob, "notekeep-screenshot.png");
      URL.revokeObjectURL(url);
      setStatus("Saved image");
    }
  };

  const copyImage = async (blockId: string) => {
    const block = active?.blocks.find(b => b.id === blockId);
    if (!block || block.type !== "image") return;
    const record = await getImage(block.imageId);
    if (!record) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ [record.blob.type || "image/png"]: record.blob })]);
      setStatus("Image copied");
    } catch {
      setStatus("Copy image unavailable");
    }
  };

  const deleteNote = async () => {
    if (!active || (confirmDelete && !confirm("Delete this note?"))) return;
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
    const frontmatter = exportFrontmatter && props.length
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
    if (existing) return openNote(existing, openLinksInNewTab);
    await createNote(title);
  };

  const followLink = (link: string) => {
    const title = link.split("/").pop()?.trim() || "Untitled";
    const existing = notes.find(n => n.title.toLowerCase() === title.toLowerCase());
    if (existing) openNote(existing, openLinksInNewTab);
    else void createLinkedNote(title);
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
    if (command === "Search" && plugins.search) { setLeftOpen(true); if (window.innerWidth <= 800) setMobileSheet("search"); setTimeout(() => document.querySelector<HTMLInputElement>(".vault-search input")?.focus(), 30); }
    if (command === "Graph view" && plugins.graph) setGraphOpen(true);
    if (command === "Export note") setFormatOpen(true);
    if (command === "Import note") importFile.current?.click();
    if (command === "Toggle right sidebar") setRightOpen(v => !v);
    if (command === "Toggle left sidebar") setLeftOpen(v => !v);
    if (command === "Toggle source mode" && plugins.sourceMode) setSourceMode(v => !v);
    if (command === "Open settings") setSettingsOpen(true);
    if (command === "Daily note" && plugins.dailyNotes) {
      const title = new Date().toISOString().slice(0, 10);
      const existing = notes.find(n => n.title === title);
      if (existing) openNote(existing, true); else void createNote(title);
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "p") { e.preventDefault(); setCommandOpen(true); setTimeout(() => document.querySelector<HTMLInputElement>(".command-input")?.focus(), 20); }
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (window.innerWidth <= 800) {
          setMobileSheet("search");
        } else {
          setLeftOpen(true);
          setTimeout(() => document.querySelector<HTMLInputElement>(".vault-search input")?.focus(), 20);
        }
      }
      if (mod && e.key.toLowerCase() === "n") { e.preventDefault(); void createNote(); }
      if (mod && e.key.toLowerCase() === "o") { e.preventDefault(); importFile.current?.click(); }
      if (e.key === "Escape") { setCommandOpen(false); setSettingsOpen(false); setGraphOpen(false); setPropertiesOpen(false); setFormatOpen(false); setSheet(null); setImageViewer(null); setMobileSheet(null); setMobileImageMenu(null); setEditorFocused(false); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  const commands = [
    "New note",
    ...(plugins.search ? ["Search"] : []),
    ...(plugins.dailyNotes ? ["Daily note"] : []),
    ...(plugins.graph ? ["Graph view"] : []),
    "Export note", "Import note", "Toggle left sidebar", "Toggle right sidebar",
    ...(plugins.sourceMode ? ["Toggle source mode"] : []),
    "Open settings"
  ];
  const filteredCommands = commands.filter(c => c.toLowerCase().includes(commandQuery.toLowerCase()));

  if (!ready || !active) return <main className="loading"><div><div className="loading-mark" /><span>NoteKeep</span></div></main>;

  return (
    <main className={"obsidian-app opal-ui " + (compactInterface ? "compact-interface" : "")} data-accent={accentTheme}>
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
          {plugins.graph && <button onClick={() => setGraphOpen(true)} title="Graph"><GitBranch size={16} /></button>}
          {plugins.commandPalette && <button onClick={() => setCommandOpen(true)} title="Command palette"><Command size={16} /></button>}
        </div>
        {plugins.search && <label className="vault-search"><Search size={14}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search vault" /><kbd>⌘ K</kbd></label>}
        <div className="explorer-head"><span>EXPLORER</span><div><button onClick={() => void createNote()} title="New note"><Plus size={13}/></button></div></div>
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
          {plugins.graph && <button onClick={() => setGraphOpen(true)}><GitBranch size={14}/> Graph view</button>}
          <button onClick={() => setSettingsOpen(true)}><Settings size={14}/> Settings</button>
        </div>
      </aside>

      <section className="main-area">
        <div className="mobile-chrome">
          <button className="mobile-chrome-button" onClick={()=>setLeftOpen(true)} aria-label="Open vault"><PanelLeft size={21}/></button>
          <div className="mobile-title">{active.title || "Untitled"}</div>
          <div className="mobile-chrome-actions">
            <button className="mobile-chrome-button" onClick={()=>setMobileSheet("tabs")} aria-label="Open tabs"><BookOpen size={21}/></button>
            <button className="mobile-chrome-button" onClick={()=>setMobileSheet("more")} aria-label="More actions"><MoreHorizontal size={21}/></button>
          </div>
        </div>
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
          <article className={"note-editor " + (readingMode ? "reading-mode" : "")} style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }}>
            <div className="note-head">
              <input readOnly={readingMode} className="note-title" value={active.title} onChange={e => update({ title: e.target.value, path: e.target.value.trim() ? e.target.value.trim() + ".md" : "Untitled.md" })} placeholder="Untitled" spellCheck={spellcheckEnabled} />
              <div className="note-actions">
                <DropdownMenu.Root open={formatOpen} onOpenChange={setFormatOpen}>
                  <DropdownMenu.Trigger asChild>
                    <button className="more-note" title="Export note" aria-label="Export note"><FileDown size={16}/></button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content className="export-menu" align="end" sideOffset={8}>
                      <DropdownMenu.Label className="export-label">Portable bundle</DropdownMenu.Label>
                      <DropdownMenu.Item className="export-item" onSelect={() => void exportNote(active, "md-zip")}><span>Markdown + images</span><small>.zip</small></DropdownMenu.Item>
                      <DropdownMenu.Item className="export-item" onSelect={() => void exportNote(active, "html-zip")}><span>HTML + images</span><small>.zip</small></DropdownMenu.Item>
                      <DropdownMenu.Separator className="export-separator"/>
                      <DropdownMenu.Label className="export-label">Single file</DropdownMenu.Label>
                      <DropdownMenu.Item className="export-item" onSelect={() => void exportNote(active, "md")}><span>Markdown</span><small>.md</small></DropdownMenu.Item>
                      <DropdownMenu.Item className="export-item" onSelect={() => void exportNote(active, "html")}><span>HTML</span><small>.html</small></DropdownMenu.Item>
                      <DropdownMenu.Item className="export-item" onSelect={() => void exportNote(active, "txt")}><span>Plain text</span><small>.txt</small></DropdownMenu.Item>
                      <DropdownMenu.Item className="export-item" onSelect={() => void exportNote(active, "json")}><span>NoteKeep JSON</span><small>.json</small></DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
                {plugins.properties && <button className="more-note" onClick={() => setPropertiesOpen(v => !v)} title="Properties"><MoreHorizontal size={18}/></button>}

              </div>
            </div>

            {inlinePropertiesEnabled && Object.keys(active.properties).length > 0 && (
              <div className="properties-inline">
                {Object.entries(active.properties).map(([k,v]) => <span key={k}><b>{k}</b><em>{v}</em></span>)}
              </div>
            )}

            {plugins.properties && propertiesOpen && (
              <div className="properties-pop">
                <div className="pop-head"><b>Properties</b><button onClick={() => setPropertiesOpen(false)}><X size={14}/></button></div>
                {Object.entries(active.properties).map(([k,v]) => <div className="property-row" key={k}><input value={k} readOnly/><input value={v} onChange={e => update({properties:{...active.properties,[k]:e.target.value}})}/><button onClick={() => { const p={...active.properties}; delete p[k]; update({properties:p}); }}><X size={13}/></button></div>)}
                <div className="property-row new-property"><input placeholder="name" value={propertyKey} onChange={e=>setPropertyKey(e.target.value)}/><input placeholder="value" value={propertyValue} onChange={e=>setPropertyValue(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addProperty()}/><button onClick={addProperty}><Plus size={13}/></button></div>
                <div className="property-tip">Properties are stored with the note and stay local.</div>
              </div>
            )}

            {(plugins.sourceMode && sourceMode) ? (
              <textarea readOnly={readingMode} spellCheck={spellcheckEnabled} className="source-editor" value={markdownFor(active)} onChange={e => {
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
                const bodyLines = lines.slice(start);
                const blocks: Block[] = [];
                let textLines: string[] = [];
                const flushText = () => {
                  const value = textLines.join("\n").trimEnd();
                  if (value.trim()) blocks.push({id:uid(),type:"text",text:value});
                  textLines = [];
                };
                for (let i=0;i<bodyLines.length;i++) {
                  const line = bodyLines[i];
                  const image = line.match(/^!\[Screenshot\]\(notekeep:\/\/([^)]+)\)$/);
                  if (image) {
                    flushText();
                    let commentary = "";
                    let j = i + 1;
                    while (j < bodyLines.length && bodyLines[j].trim()) {
                      commentary += (commentary ? "\n" : "") + bodyLines[j];
                      j++;
                    }
                    blocks.push({id:uid(),type:"image",imageId:image[1],text:commentary});
                    i = j - 1;
                  } else {
                    textLines.push(line);
                  }
                }
                flushText();
                update({title, path:title + ".md", properties, blocks:blocks.length ? blocks : [{id:uid(),type:"text",text:""}]});
              }} />
            ) : (
              <div className="document">
                {active.blocks.map((block, index) => block.type === "text" ? (
                  <section className="text-block" key={block.id}>
                    {readingMode ? renderMarkdownBlock(block.text, followLink) : <textarea spellCheck={spellcheckEnabled} id={"block-"+block.id} ref={resize} value={block.text} onFocus={()=>setEditorFocused(true)} onBlur={()=>setTimeout(()=>setEditorFocused(false),120)} onChange={e=>{resize(e.currentTarget);updateBlock(block.id,e.target.value)}} onPaste={e=>void pasteImage(e,block.id)} placeholder={index===0?"Start writing…":"Continue writing…"} rows={1}/>} 
                    <div className="block-tools">
                      <button onClick={()=>{imageTarget.current={blockId:block.id,mode:"insert"};setSheet({blockId:block.id,mode:"insert"})}} title="Insert image"><ImagePlus size={14}/></button>
                      <button onClick={()=>insertText(block.id)} title="New paragraph"><Plus size={14}/></button>
                      {active.blocks.length>1&&<button onClick={()=>void removeBlock(block.id)} title="Delete block"><X size={14}/></button>}
                    </div>
                  </section>
                ) : (
                  <figure className={"image-block " + (mobileImageMenu === block.id ? "context-open" : "")} key={block.id}>
                    {urls[block.imageId]&&<button className="image-frame" onClick={() => setImageViewer(urls[block.imageId])} aria-label="Open screenshot preview"><img src={urls[block.imageId]} alt="" draggable={false}/><span className="image-open-hint">Open preview</span></button>}
                    <button className="image-context-trigger" onClick={()=>setMobileImageMenu(block.id)} aria-label="Image actions"><MoreHorizontal size={17}/></button>
                    {readingMode ? renderMarkdownBlock(block.text, followLink) : <textarea spellCheck={spellcheckEnabled} ref={resize} value={block.text} onFocus={()=>setEditorFocused(true)} onBlur={()=>setTimeout(()=>setEditorFocused(false),120)} onChange={e=>{resize(e.currentTarget);updateBlock(block.id,e.target.value)}} placeholder="Describe what this screenshot means…"/>}
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

        {editorFocused && !readingMode && <div className="mobile-editor-toolbar" aria-label="Editor toolbar">
          <button onMouseDown={e=>{e.preventDefault();document.execCommand("undo")}} aria-label="Undo"><Undo2/></button>
          <button onMouseDown={e=>{e.preventDefault();document.execCommand("redo")}} aria-label="Redo"><Redo2/></button>
          <button onMouseDown={e=>{e.preventDefault();prependFocusedLine("## ")}} aria-label="Heading"><Heading2/></button>
          <button onMouseDown={e=>{e.preventDefault();wrapFocusedText("**")}} aria-label="Bold"><Bold/></button>
          <button onClick={()=>{const last=active.blocks[active.blocks.length-1];imageTarget.current={blockId:last?.id||"",mode:"insert"};setSheet({blockId:last?.id||"",mode:"insert"})}} aria-label="Attach screenshot"><ImagePlus/></button>
          <button onClick={()=>setEditorFocused(false)} aria-label="Dismiss toolbar"><X/></button>
        </div>}
        <footer className="statusbar">
          <span>{active.path}</span><span>{noteText(active).split(/\s+/).filter(Boolean).length} words</span><span>{active.blocks.length} blocks</span>
          <div className="zoom"><button onClick={()=>setZoom(z=>Math.max(.8,z-.1))}><ZoomOut size={13}/></button><span>{Math.round(zoom*100)}%</span><button onClick={()=>setZoom(z=>Math.min(1.2,z+.1))}><ZoomIn size={13}/></button></div>
        </footer>
      </section>

      {rightOpen && <aside className="right-sidebar">
        <div className="right-tabs">{plugins.backlinks && <button className={rightPanel==="backlinks"?"active":""} onClick={()=>setRightPanel("backlinks")}><Link2 size={13}/> Backlinks</button>}<button className={rightPanel==="outline"?"active":""} onClick={()=>setRightPanel("outline")}><ListIcon/> Outline</button><button className={rightPanel==="tags"?"active":""} onClick={()=>setRightPanel("tags")}><Hash size={13}/> Tags</button></div>
        {rightPanel==="backlinks"&&<div className="side-content"><h4>Linked mentions</h4>{incoming.length?<>{incoming.map(n=><button className="mention" key={n.id} onClick={()=>openNote(n)}><b>{n.title}</b><span>{noteText(n).slice(0,110)||"No text"}</span></button>)}</>:<div className="side-empty">No backlinks yet.</div>}<h4>Outgoing links</h4>{outgoing.length?outgoing.map(n=><button className="mention compact" key={n.id} onClick={()=>openNote(n)}><Link2 size={12}/>{n.title}</button>):<div className="side-empty">No outgoing links.</div>}{unresolvedLinks.length>0&&<><h4>Unresolved links</h4>{unresolvedLinks.map(link=><button className="mention compact" key={link} onClick={()=>void createLinkedNote(link)}><Plus size={12}/>Create “{link}”</button>)}</>}</div>}
        {rightPanel==="outline"&&<div className="side-content"><h4>Outline</h4>{outline.length?outline.map(item=><button className="outline-row" key={item.id} style={{paddingLeft:7+item.level*9}} onClick={()=>document.getElementById("block-"+item.id.split("-")[0])?.scrollIntoView({behavior:"smooth",block:"center"})}>{item.text}</button>):<div className="side-empty">Add Markdown headings such as # Heading or ## Section to build an outline.</div>}</div>}
        {rightPanel==="tags"&&<div className="side-content"><h4>All tags</h4>{allTags.map(([tag,count])=><button className="tag-row" key={tag} onClick={()=>setQuery("#"+tag)}><Hash size={12}/>{tag}<span>{count}</span></button>)}</div>}
      </aside>}

      <input ref={photos} className="hidden-file" type="file" accept="image/*" onChange={e=>{const f=e.target.files?.[0];if(f)void insertImage(f);e.target.value=""}}/>
      <input ref={camera} className="hidden-file" type="file" accept="image/*" capture="environment" onChange={e=>{const f=e.target.files?.[0];if(f)void insertImage(f);e.target.value=""}}/>
      <input ref={importFile} className="hidden-file" type="file" accept=".md,.markdown,.txt,.text,.html,.htm,.json,.zip,text/markdown,text/plain,text/html,application/json,application/zip" onChange={e=>{const f=e.target.files?.[0];if(f)void importNote(f).catch(()=>setStatus("Import failed"));e.target.value=""}}/>

      {sheet&&<div className="modal-backdrop" onClick={()=>setSheet(null)}><div className="image-sheet" onClick={e=>e.stopPropagation()}><div className="grabber"/><div className="sheet-title"><b>{sheet.mode==="replace"?"Replace screenshot":"Add screenshot"}</b><button onClick={()=>setSheet(null)}><X size={16}/></button></div><button onClick={()=>{imageTarget.current=sheet;setSheet(null);camera.current?.click()}}><CameraIcon/><span><b>Camera</b><small>Capture an image</small></span></button><button onClick={()=>{imageTarget.current=sheet;setSheet(null);photos.current?.click()}}><ImagePlus size={19}/><span><b>Photos</b><small>Choose from your device</small></span></button></div></div>}

      {commandOpen && plugins.commandPalette && <div className="modal-backdrop" onClick={()=>setCommandOpen(false)}><div className="command-palette" onClick={e=>e.stopPropagation()}><div className="command-search"><Command size={16}/><input autoFocus className="command-input" value={commandQuery} onChange={e=>setCommandQuery(e.target.value)} placeholder="Type a command…"/><kbd>ESC</kbd></div><div className="command-list">{filteredCommands.map(c=><button key={c} onClick={()=>runCommand(c)}><span>{c}</span><ChevronRight size={14}/></button>)}{!filteredCommands.length&&<div className="command-empty">No commands found</div>}</div></div></div>}

      {imageViewer&&<div className="image-viewer" onClick={()=>setImageViewer(null)}>
        <button className="image-viewer-close" onClick={()=>setImageViewer(null)} aria-label="Close image preview"><X size={20}/></button>
        <img src={imageViewer} alt="Screenshot preview" onClick={e=>e.stopPropagation()} />
      </div>}

      <Dialog.Root open={settingsOpen} onOpenChange={setSettingsOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="settings-overlay"/>
          <Dialog.Content className="settings-modal" aria-describedby={undefined}>
            <Dialog.Title className="sr-only">NoteKeep Settings</Dialog.Title>
            <div className="settings-nav"><b>Settings</b>{["Editor","Appearance","Files & Links","Core plugins","Hotkeys","About"].map(x=><button className={settingsTab===x?"active":""} key={x} onClick={()=>setSettingsTab(x as typeof settingsTab)}>{x}</button>)}</div>
            <div className="settings-main"><div className="settings-top"><div><small>SETTINGS</small><h2>{settingsTab}</h2></div><Dialog.Close asChild><button aria-label="Close settings"><X size={17}/></button></Dialog.Close></div>
              {settingsTab==="Editor" && <>
                <label className="setting-toggle"><span><b>Spellcheck</b><small>Use the browser spelling engine while editing.</small></span><input type="checkbox" checked={spellcheckEnabled} onChange={e=>setSpellcheckEnabled(e.target.checked)}/></label>
                <label className="setting-toggle"><span><b>Inline properties</b><small>Show note metadata above the document.</small></span><input type="checkbox" checked={inlinePropertiesEnabled} onChange={e=>setInlinePropertiesEnabled(e.target.checked)}/></label>
                <div className="settings-section-label">Editor behavior</div>
                <div className="settings-note"><b>Live editor</b><br/>Markdown stays editable as text. Reading View renders headings, emphasis, tags and wikilinks.</div>
              </>}
              {settingsTab==="Appearance" && <>
                <div className="settings-note"><b>Opal Night</b><br/>Soft luminous surfaces, generous spacing and restrained color accents tuned for long writing sessions.</div>
                <div className="settings-section-label">Accent</div>
                <div className="accent-picker" role="group" aria-label="Accent color">
                  {(["violet","blue","cyan","amber"] as const).map(x=><button type="button" key={x} className={"accent-swatch "+x+(accentTheme===x?" active":"")} onClick={()=>setAccentTheme(x)} aria-label={x+" accent"}><span/></button>)}
                </div>
                <label className="setting-toggle"><span><b>Compact interface</b><small>Reduce secondary chrome and keep writing dominant.</small></span><input type="checkbox" checked={compactInterface} onChange={e=>setCompactInterface(e.target.checked)}/></label>
              </>}
              {settingsTab==="Files & Links" && <>
                <label className="setting-toggle"><span><b>Confirm before deleting</b><small>Ask before permanently removing a note and its screenshots.</small></span><input type="checkbox" checked={confirmDelete} onChange={e=>setConfirmDelete(e.target.checked)}/></label>
                <label className="setting-toggle"><span><b>Open wikilinks in new tab</b><small>Follow [[links]] without replacing the current tab.</small></span><input type="checkbox" checked={openLinksInNewTab} onChange={e=>setOpenLinksInNewTab(e.target.checked)}/></label>
                <label className="setting-toggle"><span><b>Export frontmatter</b><small>Include note properties in Markdown exports.</small></span><input type="checkbox" checked={exportFrontmatter} onChange={e=>setExportFrontmatter(e.target.checked)}/></label>
                <div className="settings-note"><b>Local vault</b><br/>{notes.length} note{notes.length===1?"":"s"} indexed in this browser's IndexedDB.</div>
              </>}
              {settingsTab==="Core plugins" && <>
                {(Object.entries({
                  search:["Search","Search the vault and create notes from the mobile finder."],
                  commandPalette:["Command palette","Run actions without reaching for the sidebar."],
                  graph:["Graph view","Explore wikilink relationships visually."],
                  properties:["Properties","Edit note metadata and frontmatter."],
                  backlinks:["Backlinks","See incoming links and unresolved links."],
                  dailyNotes:["Daily notes","Create or reopen today's date-named note."],
                  sourceMode:["Source mode","Edit the complete Markdown source directly."]
                }) as [keyof PluginFlags,string[]][]).map(([key,meta])=><label className="setting-toggle plugin-setting" key={key}><span><b>{meta[0]}</b><small>{meta[1]}</small></span><input type="checkbox" checked={plugins[key]} onChange={e=>setPlugins(current=>({...current,[key]:e.target.checked}))}/></label>)}
              </>}
              {settingsTab==="Hotkeys" && <>
                <label className="setting-toggle"><span><b>Keyboard shortcuts</b><small>Enable global NoteKeep shortcuts.</small></span><input type="checkbox" checked={hotkeysEnabled} onChange={e=>setHotkeysEnabled(e.target.checked)}/></label>
                {["⌘ / Ctrl + P — Command palette","⌘ / Ctrl + K — Search","⌘ / Ctrl + N — New note","⌘ / Ctrl + O — Import file","Escape — Close overlays"].map(x=><div className="setting-row" key={x}><span>{x}</span></div>)}
                <button className="settings-action" type="button" onClick={()=>setHotkeysEnabled(true)}>Reset shortcuts</button>
              </>}
              {settingsTab==="About" && <>
                <div className="settings-note"><b>NoteKeep 0.1.0</b><br/>Local-first notes with an Obsidian-style knowledge foundation and contextual screenshot commentary.<br/><br/>Storage: {notes.length} notes in IndexedDB.</div>
                <button className="settings-action" type="button" onClick={()=>downloadBlob(new Blob([JSON.stringify({app:"NoteKeep",version:"0.1.0",notes:notes.length,plugins,preferences:{spellcheckEnabled,inlinePropertiesEnabled,compactInterface,accentTheme,confirmDelete,openLinksInNewTab,exportFrontmatter,hotkeysEnabled}},null,2)],{type:"application/json"}),"notekeep-diagnostics.json")}>Export diagnostics</button>
                <button className="settings-action" type="button" onClick={()=>{setSpellcheckEnabled(true);setInlinePropertiesEnabled(true);setCompactInterface(true);setAccentTheme("violet");setConfirmDelete(true);setOpenLinksInNewTab(false);setExportFrontmatter(true);setHotkeysEnabled(true);setPlugins({search:true,commandPalette:true,graph:true,properties:true,backlinks:true,dailyNotes:true,sourceMode:true});setStatus("Preferences reset")}}>Reset preferences</button>
              </>}            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {mobileSheet === "more" && <div className="mobile-sheet-backdrop" onClick={()=>setMobileSheet(null)}>
        <div className="mobile-action-sheet" onClick={e=>e.stopPropagation()}>
          <div className="sheet-grabber"/><div className="mobile-sheet-title">{active.title || "Untitled"}</div>
          {plugins.backlinks && <button onClick={()=>setMobileSheet("backlinks")}><Link2/><span>Backlinks in document</span></button>}
          <button onClick={()=>{setMobileSheet(null);setSourceMode(false);setReadingMode(v=>!v)}}><BookOpen/><span>{readingMode ? "Edit note" : "Reading view"}</span></button>
          {plugins.sourceMode && <button onClick={()=>{setMobileSheet(null);setReadingMode(false);setSourceMode(v=>!v)}}><Command/><span>{sourceMode ? "Live editor" : "Source mode"}</span></button>}
          <button onClick={()=>{setMobileSheet(null);setReadingMode(false);setTimeout(()=>document.querySelector<HTMLInputElement>(".note-title")?.focus(),50)}}><FilePenLine/><span>Rename…</span></button>
          <button onClick={()=>{setMobileSheet("search")}}><Search/><span>Find…</span></button>
          {plugins.commandPalette && <button onClick={()=>{setMobileSheet(null);setCommandOpen(true)}}><Command/><span>Command palette</span></button>}
          {plugins.graph && <button onClick={()=>{setMobileSheet(null);setGraphOpen(true)}}><GitBranch/><span>Graph view</span></button>}
          {plugins.dailyNotes && <button onClick={()=>{setMobileSheet(null);const title=new Date().toISOString().slice(0,10);const existing=notes.find(n=>n.title===title);if(existing)openNote(existing,true);else void createNote(title)}}><CalendarDays/><span>Daily note</span></button>}
          <button onClick={()=>{setMobileSheet(null);void shareNote()}}><Share2/><span>Share note</span></button>
          <button className="danger" onClick={()=>{setMobileSheet(null);void deleteNote()}}><Trash2/><span>Delete note</span></button>
        </div>
      </div>}

      {mobileSheet === "backlinks" && plugins.backlinks && <div className="mobile-sheet-backdrop" onClick={()=>setMobileSheet(null)}>
        <div className="mobile-action-sheet" onClick={e=>e.stopPropagation()}>
          <div className="sheet-grabber"/><div className="mobile-sheet-title">Backlinks in document</div>
          {incoming.length ? incoming.map(n=><button key={n.id} onClick={()=>{openNote(n);setMobileSheet(null)}}><Link2/><span>{n.title || "Untitled"}</span></button>) : <div className="mobile-sheet-empty">No notes link to this document yet.</div>}
        </div>
      </div>}

      {mobileSheet === "search" && plugins.search && <div className="mobile-sheet-backdrop" onClick={()=>setMobileSheet(null)}>
        <div className="mobile-search-sheet" onClick={e=>e.stopPropagation()}>
          <div className="sheet-grabber"/>
          <div className="mobile-search-field"><Search size={19}/><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){const q=query.trim();if(!q)return;const exact=notes.find(n=>n.title.toLowerCase()===q.toLowerCase());if(exact)openNote(exact);else void createNote(q);setQuery("");setMobileSheet(null)}}} placeholder="Find or create a note…"/><button onClick={()=>{setQuery("");setMobileSheet(null)}}><X/></button></div>
          <div className="mobile-search-results">{visibleNotes.map(n=><button key={n.id} onClick={()=>{openNote(n);setMobileSheet(null)}}><File size={17}/><span>{n.title||"Untitled"}</span><small>{n.path}</small></button>)}</div>
        </div>
      </div>}

      {mobileSheet === "tabs" && <div className="mobile-tabs-overlay" onClick={()=>setMobileSheet(null)}>
        <div className="mobile-tabs-panel" onClick={e=>e.stopPropagation()}>
          <div className="mobile-tabs-grid">{tabs.map(id=>{const n=notes.find(x=>x.id===id);if(!n)return null;return <button className={"mobile-tab-card "+(id===active.id?"active":"")} key={id} onClick={()=>{openNote(n);setMobileSheet(null)}}><span>{n.title||"Untitled"}</span><i onClick={e=>{e.stopPropagation();closeTab(id)}}><X size={16}/></i></button>})}</div>
          <div className="mobile-tabs-footer"><button onClick={()=>void createNote()}><Plus/><span>New note</span></button><b>{tabs.length} {tabs.length===1?"tab":"tabs"}</b><button onClick={()=>setMobileSheet(null)}>Done</button></div>
        </div>
      </div>}

      {mobileImageMenu && <div className="mobile-sheet-backdrop" onClick={()=>setMobileImageMenu(null)}>
        <div className="mobile-action-sheet image-actions-sheet" onClick={e=>e.stopPropagation()}>
          <div className="sheet-grabber"/><div className="mobile-sheet-title">Screenshot</div>
          <button onClick={()=>{void copyImage(mobileImageMenu);setMobileImageMenu(null)}}><Copy/><span>Copy image</span></button>
          <button onClick={()=>{const b=active.blocks.find(x=>x.id===mobileImageMenu);if(b?.type==="image"){imageTarget.current={blockId:b.id,mode:"replace"};setSheet({blockId:b.id,mode:"replace"})};setMobileImageMenu(null)}}><ImagePlus/><span>Replace image</span></button>
          <button onClick={()=>{const b=active.blocks.find(x=>x.id===mobileImageMenu);if(b?.type==="image"&&urls[b.imageId]){const a=document.createElement("a");a.download="notekeep-"+Date.now()+".png";a.href=urls[b.imageId];a.click()};setMobileImageMenu(null)}}><Download/><span>Save image</span></button>
          <button onClick={()=>{void shareImage(mobileImageMenu);setMobileImageMenu(null)}}><Share2/><span>Share image</span></button>
          <button className="danger" onClick={()=>{void removeBlock(mobileImageMenu);setMobileImageMenu(null)}}><Trash2/><span>Delete image</span></button>
        </div>
      </div>}

      {graphOpen && plugins.graph && <Graph notes={notes} active={active} onOpen={openNote} onClose={()=>setGraphOpen(false)}/>}
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
