// Saved conversations in OPFS: app/chats/index.json + app/chats/<id>.json
import { readJSON, writeJSON, remove } from "./opfs.js";

const DIR = "app/chats";
let indexCache = null;

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export async function listChats() {
  if (!indexCache) indexCache = (await readJSON(`${DIR}/index.json`, [])) || [];
  return [...indexCache].sort((a, b) => b.updatedAt - a.updatedAt);
}

async function saveIndex() {
  await writeJSON(`${DIR}/index.json`, indexCache);
}

export async function getChat(id) {
  return readJSON(`${DIR}/${id}.json`);
}

export function newChat(modelId) {
  const now = Date.now();
  return { id: uid(), title: "New chat", modelId: modelId || null, createdAt: now, updatedAt: now, messages: [] };
}

export function titleFrom(text) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 48 ? t.slice(0, 47) + "…" : t || "New chat";
}

export async function saveChat(chat) {
  chat.updatedAt = Date.now();
  await listChats();
  const entry = { id: chat.id, title: chat.title, updatedAt: chat.updatedAt, modelId: chat.modelId, count: chat.messages.length };
  const i = indexCache.findIndex((c) => c.id === chat.id);
  if (i >= 0) indexCache[i] = entry;
  else indexCache.push(entry);
  await writeJSON(`${DIR}/${chat.id}.json`, chat);
  await saveIndex();
}

export async function renameChat(id, title) {
  const chat = await getChat(id);
  if (!chat) return;
  chat.title = title;
  await saveChat(chat);
}

export async function deleteChat(id) {
  await listChats();
  indexCache = indexCache.filter((c) => c.id !== id);
  await remove(`${DIR}/${id}.json`);
  await saveIndex();
}

export async function deleteAllChats() {
  await remove(DIR, true);
  indexCache = [];
}
