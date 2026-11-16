#!/usr/bin/env python3
"""Download MLC model folders from Hugging Face into <repo>/models/<id>/resolve/main/,
split files >= SPLIT_AT into PART-sized parts (name.partN), and download the model lib wasm."""
import json, os, subprocess, sys, urllib.request
SPLIT_AT = 95 * 1024 * 1024
PART = 48 * 1024 * 1024
LIBPREFIX = "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_87/base/"

def get(url, dest):
    tmp = dest + ".tmp"
    subprocess.run(["curl", "-sSfL", "--retry", "5", "-o", tmp, url], check=True)
    os.replace(tmp, dest)

def main(repo, model_id, lib):
    api = json.load(urllib.request.urlopen(f"https://huggingface.co/api/models/mlc-ai/{model_id}"))
    sha = api["sha"]
    files = [s["rfilename"] for s in api["siblings"] if s["rfilename"] not in (".gitattributes",)]
    out = os.path.join(repo, "models", model_id, "resolve", "main")
    os.makedirs(out, exist_ok=True)
    splits = {}
    for f in files:
        dest = os.path.join(out, f)
        if not (os.path.exists(dest) or os.path.exists(dest + ".part0")):
            get(f"https://huggingface.co/mlc-ai/{model_id}/resolve/{sha}/{f}", dest)
        if os.path.exists(dest) and os.path.getsize(dest) >= SPLIT_AT:
            size = os.path.getsize(dest)
            with open(dest, "rb") as fh:
                i = 0
                while True:
                    b = fh.read(PART)
                    if not b: break
                    open(f"{dest}.part{i}", "wb").write(b); i += 1
            os.remove(dest)
            splits[f] = {"parts": i, "size": size}
        elif os.path.exists(dest + ".part0") and f not in splits:
            i = 0; size = 0
            while os.path.exists(f"{dest}.part{i}"): size += os.path.getsize(f"{dest}.part{i}"); i += 1
            splits[f] = {"parts": i, "size": size}
    libdir = os.path.join(repo, "models", "libs"); os.makedirs(libdir, exist_ok=True)
    if not os.path.exists(os.path.join(libdir, lib)):
        get(LIBPREFIX + lib, os.path.join(libdir, lib))
    total = sum(os.path.getsize(os.path.join(dp, x)) for dp, _, fs in os.walk(out) for x in fs)
    meta = {"id": model_id, "source": f"https://huggingface.co/mlc-ai/{model_id}", "revision": sha,
            "lib": lib, "bytes": total, "splits": splits}
    json.dump(meta, open(os.path.join(repo, "models", model_id, "meta.json"), "w"), indent=2)
    print("done", model_id, total)

if __name__ == "__main__":
    main(*sys.argv[1:4])
