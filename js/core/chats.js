// Saved conversations in OPFS.
//   app/chats/index.json   -> [{id, title, updatedAt, openedAt, modelId, projectId, count}]
//   app/chats/<id>.json    -> full chat {id, title, modelId, projectId, createdAt, updatedAt, openedAt, messages}
// A message is {role: "user"|"assistant", content, at, model?, modelLabel?, stats?, error?}.
// Chats are never deleted unless the user deletes them or turns on auto-delete.
import { readJSON, writeJSON, remove } from "./opfs.js";

const DIR = "app/chats";
const DAY = 86400000;
let indexCache = null;

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export async function listChats({ projectId } = {}) {
  if (!indexCache) indexCache = (await readJSON(`${DIR}/index.json`, [])) || [];
  let out = [...indexCache];
  if (projectId !== undefined) out = out.filter((c) => (c.projectId || null) === projectId);
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

async function saveIndex() {
  await writeJSON(`${DIR}/index.json`, indexCache);
}

function indexEntry(chat) {
  return {
    id: chat.id,
    title: chat.title,
    updatedAt: chat.updatedAt,
    openedAt: chat.openedAt || chat.updatedAt,
    modelId: chat.modelId,
    projectId: chat.projectId || null,
    count: chat.messages.length,
  };
}

async function putIndex(chat) {
  await listChats();
  const i = indexCache.findIndex((c) => c.id === chat.id);
  if (i >= 0) indexCache[i] = indexEntry(chat);
  else indexCache.push(indexEntry(chat));
  await saveIndex();
}

export async function getChat(id) {
  return readJSON(`${DIR}/${id}.json`);
}

// Marks a chat as opened (auto-delete counts from the last time a chat was opened).
export async function openChat(id) {
  const chat = await getChat(id);
  if (!chat) return null;
  chat.openedAt = Date.now();
  await writeJSON(`${DIR}/${chat.id}.json`, chat);
  await putIndex(chat);
  return chat;
}

export function newChat({ modelId = null, projectId = null } = {}) {
  const now = Date.now();
  return { id: uid(), title: "New chat", modelId, projectId, createdAt: now, updatedAt: now, openedAt: now, messages: [] };
}

export function titleFrom(text) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 48 ? t.slice(0, 47) + "…" : t || "New chat";
}

export async function saveChat(chat) {
  chat.updatedAt = Date.now();
  chat.openedAt = chat.updatedAt;
  await writeJSON(`${DIR}/${chat.id}.json`, chat);
  await putIndex(chat);
}

export async function updateChat(id, patch) {
  const chat = await getChat(id);
  if (!chat) return null;
  Object.assign(chat, patch);
  await writeJSON(`${DIR}/${chat.id}.json`, chat);
  await putIndex(chat);
  return chat;
}

export const renameChat = (id, title) => updateChat(id, { title });
export const moveChat = (id, projectId) => updateChat(id, { projectId: projectId || null });

export async function deleteChat(id) {
  await listChats();
  indexCache = indexCache.filter((c) => c.id !== id);
  await remove(`${DIR}/${id}.json`);
  await saveIndex();
}

export async function deleteChats(ids) {
  for (const id of ids) await deleteChat(id);
}

export async function deleteAllChats() {
  await remove(DIR, true);
  indexCache = [];
}

// Full-text search over titles and message text. Returns
// [{chat: indexEntry, hits: [{index, role, snippet}]}], best matches first.
export async function searchChats(query, { limit = 50 } = {}) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/);
  const results = [];
  for (const entry of await listChats()) {
    const chat = await getChat(entry.id);
    if (!chat) continue;
    let score = words.every((w) => chat.title.toLowerCase().includes(w)) ? 5 : 0;
    const hits = [];
    chat.messages.forEach((m, index) => {
      const text = (m.content || "").toLowerCase();
      if (words.every((w) => text.includes(w))) {
        const at = text.indexOf(words[0]);
        const start = Math.max(0, at - 40);
        hits.push({ index, role: m.role, snippet: (start ? "…" : "") + m.content.slice(start, at + 80).replace(/\s+/g, " ") + "…" });
      }
    });
    score += hits.length;
    if (score) results.push({ chat: entry, hits: hits.slice(0, 3), score });
  }
  return results.sort((a, b) => b.score - a.score || b.chat.updatedAt - a.chat.updatedAt).slice(0, limit);
}

// ---------- export ----------
export function chatToMarkdown(chat) {
  let md = `# ${chat.title}\n\n_${new Date(chat.createdAt).toLocaleString()}_\n\n`;
  for (const m of chat.messages) {
    const who = m.role === "user" ? "You" : m.modelLabel || "Assistant";
    md += `### ${who}\n\n${m.content || ""}\n\n`;
    if (m.error) md += `> Error: ${m.error}\n\n`;
  }
  return md;
}

export async function exportChats(ids, format = "json") {
  const chats = [];
  for (const id of ids) {
    const c = await getChat(id);
    if (c) chats.push(c);
  }
  if (format === "md") return chats.map(chatToMarkdown).join("\n---\n\n");
  return JSON.stringify({ format: "browser-llm-chats/v1", exportedAt: Date.now(), chats }, null, 1);
}

// ---------- auto-delete ----------
// days: (projectId|null) => number of days (0 = never). Returns deleted index entries.
export async function runChatAutoDelete(daysFor, { keepId } = {}) {
  const now = Date.now();
  const gone = [];
  for (const c of await listChats()) {
    const days = daysFor(c.projectId || null);
    if (!days || c.id === keepId) continue;
    if (now - (c.openedAt || c.updatedAt) > days * DAY) {
      await deleteChat(c.id);
      gone.push(c);
    }
  }
  return gone;
}
