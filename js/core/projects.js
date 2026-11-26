// Projects: named groups of chats, stored in app/projects.json as
//   [{id, name, instructions, defaultModel, autoDeleteDays, createdAt, updatedAt}]
// instructions   -> system prompt sent first in every chat of the project ("" = none)
// defaultModel   -> model id new chats in the project start with (null = app default)
// autoDeleteDays -> null = use the global chat setting, 0 = never, N = days unused
import { readJSON, writeJSON } from "./opfs.js";
import { listChats, deleteChats, moveChat } from "./chats.js";

const FILE = "app/projects.json";
let cache = null;

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export async function listProjects() {
  if (!cache) cache = (await readJSON(FILE, [])) || [];
  return [...cache].sort((a, b) => a.name.localeCompare(b.name));
}

export async function getProject(id) {
  if (!id) return null;
  return (await listProjects()).find((p) => p.id === id) || null;
}

async function save() {
  await writeJSON(FILE, cache);
}

export async function createProject({ name, instructions = "", defaultModel = null, autoDeleteDays = null }) {
  await listProjects();
  const now = Date.now();
  const p = { id: uid(), name: name || "New project", instructions, defaultModel, autoDeleteDays, createdAt: now, updatedAt: now };
  cache.push(p);
  await save();
  return p;
}

export async function updateProject(id, patch) {
  await listProjects();
  const p = cache.find((x) => x.id === id);
  if (!p) return null;
  Object.assign(p, patch, { updatedAt: Date.now() });
  await save();
  return p;
}

// deleteChatsToo=false moves the project's chats out to "no project".
export async function deleteProject(id, { deleteChatsToo = false } = {}) {
  const chats = await listChats({ projectId: id });
  if (deleteChatsToo) await deleteChats(chats.map((c) => c.id));
  else for (const c of chats) await moveChat(c.id, null);
  await listProjects();
  cache = cache.filter((p) => p.id !== id);
  await save();
}
