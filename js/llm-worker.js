// Dedicated module worker that hosts the WebLLM engine so the UI stays smooth.
import { WebWorkerMLCEngineHandler } from "../vendor/web-llm/index.js";

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg) => handler.onmessage(msg);
