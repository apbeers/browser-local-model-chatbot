// Shared UI state for the default UI. Only UI files use this; core services
// never import from js/ui/.
export const state = {
  view: "chat", // chat | models | dashboard | benchmark | studio | settings
  chat: null, // the open chat object (see js/core/chats.js)
  newChatProject: null, // project id for the next new chat
  live: null, // {tokens, tFirst, tps} while a reply streams
  lastGen: null, // last generation stats record
  els: {}, // DOM elements created by layout.js, by name
};

export const $ = (name) => state.els[name];

export function lsGet(k, d = null) {
  try {
    const v = localStorage.getItem(k);
    return v == null ? d : v;
  } catch {
    return d;
  }
}

export function lsSet(k, v) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}
