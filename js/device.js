// Collects device / browser / GPU details for stats records.
import { readJSON, writeJSON } from "./opfs.js";

let adapterInfoPromise = null;

export function webgpuAvailable() {
  return typeof navigator !== "undefined" && !!navigator.gpu;
}

export function getGPUInfo() {
  if (!adapterInfoPromise) adapterInfoPromise = probeGPU();
  return adapterInfoPromise;
}

async function probeGPU() {
  if (!webgpuAvailable()) return { available: false, reason: "navigator.gpu missing" };
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) return { available: false, reason: "No WebGPU adapter" };
    const info = adapter.info || (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : {});
    const limits = {};
    for (const k of [
      "maxBufferSize",
      "maxStorageBufferBindingSize",
      "maxComputeWorkgroupStorageSize",
      "maxComputeInvocationsPerWorkgroup",
      "maxComputeWorkgroupSizeX",
      "maxStorageBuffersPerShaderStage",
    ]) {
      if (adapter.limits && k in adapter.limits) limits[k] = adapter.limits[k];
    }
    return {
      available: true,
      vendor: info.vendor || "",
      architecture: info.architecture || "",
      device: info.device || "",
      description: info.description || "",
      isFallbackAdapter: !!(info.isFallbackAdapter || adapter.isFallbackAdapter),
      features: [...adapter.features].sort(),
      shaderF16: adapter.features.has("shader-f16"),
      limits,
    };
  } catch (err) {
    return { available: false, reason: String(err && err.message ? err.message : err) };
  }
}

export function gpuLabel(gpu) {
  if (!gpu || !gpu.available) return "No WebGPU";
  const parts = [gpu.vendor, gpu.architecture, gpu.device, gpu.description].filter(Boolean);
  return parts.length ? [...new Set(parts)].join(" · ") : "WebGPU adapter";
}

function parseBrowser(ua) {
  const tests = [
    [/Edg\/(\d+)/, "Edge"],
    [/OPR\/(\d+)/, "Opera"],
    [/SamsungBrowser\/(\d+)/, "Samsung Internet"],
    [/Firefox\/(\d+)/, "Firefox"],
    [/CriOS\/(\d+)/, "Chrome iOS"],
    [/Chrome\/(\d+)/, "Chrome"],
    [/Version\/(\d+[.\d]*).*Safari/, "Safari"],
  ];
  for (const [re, name] of tests) {
    const m = ua.match(re);
    if (m) return { name, version: m[1] };
  }
  return { name: "Unknown", version: "" };
}

function parseOS(ua) {
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Android/.test(ua)) return "Android";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Mac OS X|Macintosh/.test(ua)) return navigator.maxTouchPoints > 1 ? "iPadOS" : "macOS";
  if (/Windows/.test(ua)) return "Windows";
  if (/Linux/.test(ua)) return "Linux";
  return "Unknown";
}

export async function getBattery() {
  try {
    if (!navigator.getBattery) return null;
    const b = await navigator.getBattery();
    return { level: Math.round(b.level * 100), charging: b.charging };
  } catch {
    return null;
  }
}

export function memorySnapshot() {
  const m = performance && performance.memory;
  return m ? { jsHeapUsedMB: Math.round(m.usedJSHeapSize / 1048576), jsHeapLimitMB: Math.round(m.jsHeapSizeLimit / 1048576) } : null;
}

export async function getDeviceInfo() {
  const ua = navigator.userAgent;
  const browser = parseBrowser(ua);
  let hints = null;
  if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
    try {
      hints = await navigator.userAgentData.getHighEntropyValues([
        "platform",
        "platformVersion",
        "model",
        "architecture",
        "bitness",
        "mobile",
      ]);
    } catch {
      hints = null;
    }
  }
  let storage = null;
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const e = await navigator.storage.estimate();
      storage = { usageMB: Math.round(e.usage / 1048576), quotaMB: Math.round(e.quota / 1048576) };
    }
  } catch {
    /* ignore */
  }
  return {
    userAgent: ua,
    browser: browser.name,
    browserVersion: browser.version,
    os: hints && hints.platform ? hints.platform : parseOS(ua),
    osVersion: hints ? hints.platformVersion || "" : "",
    deviceModel: hints ? hints.model || "" : "",
    cpuArch: hints ? [hints.architecture, hints.bitness].filter(Boolean).join("/") : "",
    mobile: hints ? !!hints.mobile : /Mobi|Android|iPhone|iPad/.test(ua),
    cores: navigator.hardwareConcurrency || null,
    deviceMemoryGB: navigator.deviceMemory || null,
    screen: {
      w: screen.width,
      h: screen.height,
      dpr: window.devicePixelRatio || 1,
    },
    storage,
    gpu: await getGPUInfo(),
  };
}

// A stable random id per browser profile, plus a user-editable label so
// imported stats from several devices can be told apart.
export async function getDeviceIdentity() {
  let id = await readJSON("app/device.json");
  if (!id || !id.id) {
    const info = await getDeviceInfo();
    id = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2),
      label: `${info.os} · ${info.browser}${info.deviceModel ? " · " + info.deviceModel : ""}`,
      createdAt: Date.now(),
    };
    await writeJSON("app/device.json", id);
  }
  return id;
}

export async function setDeviceLabel(label) {
  const id = await getDeviceIdentity();
  id.label = label;
  await writeJSON("app/device.json", id);
  return id;
}
