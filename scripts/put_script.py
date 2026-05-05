#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import os
import sys
import urllib.request
import urllib.error
from argparse import ArgumentParser

parser = ArgumentParser(description="Upload a script to a Shelly device (stop, upload, start)")
parser.add_argument("host", help="IP address or hostname of the Shelly device")
parser.add_argument("id", type=int, help="ID of the script slot on the device")
parser.add_argument("file", help="Local file containing the script code to upload")

CHUNK_SIZE = 1024


class RpcError(Exception):
    def __init__(self, method, message, status_code=None, error_code=None):
        self.method = method
        self.message = message
        self.status_code = status_code
        self.error_code = error_code
        super().__init__(self.__str__())

    def __str__(self):
        if self.status_code is not None:
            return f"HTTP error {self.status_code} calling {self.method}: {self.message}"
        if self.error_code is not None:
            return f"RPC error [{self.error_code}] calling {self.method}: {self.message}"
        return f"Connection error calling {self.method}: {self.message}"


def decode_json(text):
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


def build_http_error(method, status_code, body):
    payload = decode_json(body)
    if isinstance(payload, dict) and payload.get("code", 0) < 0:
        return RpcError(
            method,
            payload.get("message", body),
            status_code=status_code,
            error_code=payload["code"],
        )
    return RpcError(method, body, status_code=status_code)


def raise_if_rpc_error(method, result):
    if isinstance(result, dict) and result.get("code", 0) < 0:
        raise RpcError(method, result.get("message", "unknown"), error_code=result["code"])


def call_rpc(host, method, params):
    url = f"http://{host}/rpc/{method}"
    req_data = json.dumps(params, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=req_data,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise build_http_error(method, e.code, body)
    except urllib.error.URLError as e:
        raise RpcError(method, str(e.reason))

    raise_if_rpc_error(method, result)
    return result


def is_missing_script_error(error, script_id):
    return (
        error.error_code == -105
        and f"value {script_id} not found" in error.message
    )


def extract_scripts(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        if isinstance(payload.get("scripts"), list):
            return payload["scripts"]
        result = payload.get("result")
        if isinstance(result, dict) and isinstance(result.get("scripts"), list):
            return result["scripts"]
    return []


def find_script_id_by_name(payload, name):
    for script in extract_scripts(payload):
        if isinstance(script, dict) and script.get("name") == name:
            return script.get("id")
    return None


def ensure_script(host, script_id, name):
    try:
        call_rpc(host, "Script.GetConfig", {"id": script_id})
        return script_id, True
    except RpcError as error:
        if not is_missing_script_error(error, script_id):
            raise

    script_list = call_rpc(host, "Script.List", {})
    existing_id = find_script_id_by_name(script_list, name)
    if isinstance(existing_id, int):
        print(f"Requested slot {script_id} is empty; reusing '{name}' from slot {existing_id}")
        return existing_id, True

    print(f"Script {script_id} does not exist; creating '{name}'...")
    result = call_rpc(host, "Script.Create", {"name": name})
    created_id = result.get("id")
    if not isinstance(created_id, int):
        raise RpcError("Script.Create", f"Unexpected response: {result}")
    if created_id != script_id:
        print(f"Requested slot {script_id}, device created slot {created_id}")
    return created_id, False


def stop_script(host, script_id):
    print(f"Stopping script {script_id}...")
    call_rpc(host, "Script.Stop", {"id": script_id})


def start_script(host, script_id):
    print(f"Starting script {script_id}...")
    call_rpc(host, "Script.Start", {"id": script_id})


def configure_script(host, script_id, name):
    print(f"Setting name to '{name}'...")
    call_rpc(host, "Script.SetConfig", {"id": script_id, "config": {"name": name, "enable": True}})


def upload_script(host, script_id, code):
    total = len(code)
    print(f"Uploading {total} bytes in {CHUNK_SIZE}-byte chunks", end="", flush=True)

    pos = 0
    append = False
    while pos < total:
        chunk = code[pos : pos + CHUNK_SIZE]
        call_rpc(host, "Script.PutCode", {
            "id": script_id,
            "code": chunk,
            "append": append,
        })
        pos += len(chunk)
        append = True
        print(".", end="", flush=True)

    print(f" done ({total} bytes)")


def main():
    args = parser.parse_args()

    with open(args.file, mode="r", encoding="utf-8") as f:
        code = f.read()

    name = os.path.basename(args.file)
    try:
        script_id, exists = ensure_script(args.host, args.id, name)
        if exists:
            stop_script(args.host, script_id)
        configure_script(args.host, script_id, name)
        upload_script(args.host, script_id, code)
        start_script(args.host, script_id)
        print("Done")
    except RpcError as error:
        print(error)
        sys.exit(1)


if __name__ == "__main__":
    main()
