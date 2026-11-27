// Dedicated module worker that hosts the WebLLM engine so the UI stays smooth.
//
// It also measures GPU memory exactly: every GPU buffer WebLLM creates or
// destroys in this worker (weights, KV cache, scratch space) is counted, and
// the total is reported to the page through a MessagePort the page sends first
// ({__gpuMemPort}). Browsers have no API for free GPU memory, so this is the
// app's own usage, which is what decides whether a model fits.
import { WebWorkerMLCEngineHandler } from "../../vendor/web-llm/index.js";

let port = null;
let bytes = 0;
let peak = 0;
let buffers = 0;
let timer = null;
const sizes = new WeakMap();

function report() {
  if (!port || timer) return;
  timer = setTimeout(() => {
    timer = null;
    port.postMessage({ bytes, peak, buffers });
  }, 200);
}

if (self.GPUDevice && self.GPUBuffer) {
  const create = GPUDevice.prototype.createBuffer;
  GPUDevice.prototype.createBuffer = function (desc) {
    const buf = create.call(this, desc);
    const size = Number(desc && desc.size) || 0;
    sizes.set(buf, size);
    bytes += size;
    buffers++;
    if (bytes > peak) peak = bytes;
    report();
    return buf;
  };
  const destroy = GPUBuffer.prototype.destroy;
  GPUBuffer.prototype.destroy = function () {
    const size = sizes.get(this);
    if (size !== undefined) {
      sizes.delete(this);
      bytes -= size;
      buffers--;
      report();
    }
    return destroy.call(this);
  };
  const destroyDevice = GPUDevice.prototype.destroy;
  GPUDevice.prototype.destroy = function () {
    bytes = 0;
    buffers = 0;
    report();
    return destroyDevice.call(this);
  };
}

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg) => {
  if (msg.data && msg.data.__gpuMemPort) {
    port = msg.data.__gpuMemPort;
    report();
    return;
  }
  if (msg.data && msg.data.__gpuMemResetPeak) {
    peak = bytes;
    report();
    return;
  }
  handler.onmessage(msg);
};
