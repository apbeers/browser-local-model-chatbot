// Dedicated module worker that hosts the WebLLM engine so the UI stays smooth.
//
// GitHub rejects files over 100 MB, so a few large weight shards are stored as
// numbered parts (file.part0, file.part1, ...). We wrap fetch() here so that
// WebLLM can request the original file name and receive the parts stitched
// back together as a single streamed response.

import { WebWorkerMLCEngineHandler } from "../vendor/web-llm/index.js";
import { loadCatalog, splitMap } from "./catalog.js";

const realFetch = self.fetch.bind(self);
let splits = {};

const ready = loadCatalog()
  .then((cat) => {
    splits = splitMap(cat);
  })
  .catch((err) => {
    console.warn("[worker] catalog unavailable, split files disabled", err);
  });

function stitched(url, info, init) {
  const signal = init && init.signal;
  let i = 0;
  let reader = null;
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        for (;;) {
          if (!reader) {
            if (i >= info.parts) {
              controller.close();
              return;
            }
            const res = await realFetch(`${url}.part${i++}`, { signal });
            if (!res.ok) throw new Error(`Missing part ${i - 1} of ${url} (${res.status})`);
            reader = res.body.getReader();
          }
          const { value, done } = await reader.read();
          if (done) {
            reader = null;
            continue;
          }
          controller.enqueue(value);
          return;
        }
      } catch (err) {
        controller.error(err);
      }
    },
    cancel(reason) {
      if (reader) reader.cancel(reason);
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(info.size),
    },
  });
}

self.fetch = async (input, init) => {
  await ready;
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const info = splits[url];
  if (info) {
    const sig = (init && init.signal) || (input instanceof Request ? input.signal : undefined);
    return stitched(url, info, { signal: sig });
  }
  return realFetch(input, init);
};

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg) => handler.onmessage(msg);
