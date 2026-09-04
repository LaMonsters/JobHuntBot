"""Personal, loopback-only resume library. Python 3.10+, no dependencies."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import socket
import sqlite3
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, urlsplit
from urllib.request import ProxyHandler, build_opener
from uuid import uuid4

ROOT = Path(__file__).resolve().parent
MAX_FILE_SIZE = 20 * 1024 * 1024


class ResumeServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, data_dir):
        self.data_dir = Path(data_dir).resolve()
        self.files_dir = self.data_dir / "files"
        self.files_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = self.data_dir / "resumes.sqlite3"
        self.token = secrets.token_urlsafe(32)
        with self.connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS resumes (
                id TEXT PRIMARY KEY, title TEXT NOT NULL,
                original_name TEXT NOT NULL, size INTEGER NOT NULL,
                sha256 TEXT NOT NULL UNIQUE,
                uploaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
            )""")
        super().__init__(address, Handler)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.db_path, timeout=15)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()


class Handler(BaseHTTPRequestHandler):
    server: ResumeServer

    def setup(self):
        super().setup()
        self.connection.settimeout(60)

    def log_message(self, fmt, *args):
        # Avoid writing personal file names into access logs.
        pass

    def respond(self, status, body, content_type="application/json; charset=utf-8", headers=None):
        if not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-src 'self'; object-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'")
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def trusted(self, mutation=False):
        port = self.server.server_port
        hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        if self.headers.get("Host") not in hosts:
            self.respond(403, {"error": "请从本机地址打开简历管理。"})
            return False
        origin = self.headers.get("Origin")
        if origin and origin not in {f"http://{host}" for host in hosts}:
            self.respond(403, {"error": "不允许来自其他网站的请求。"})
            return False
        if self.headers.get("Sec-Fetch-Site") == "cross-site":
            self.respond(403, {"error": "请直接打开简历管理页面。"})
            return False
        if mutation and not secrets.compare_digest(self.headers.get("X-Resume-Token", ""), self.server.token):
            self.respond(403, {"error": "页面连接已更新，请刷新后重试。"})
            return False
        return True

    def do_GET(self):
        self.dispatch()

    def do_POST(self):
        self.dispatch()

    def do_PATCH(self):
        self.dispatch()

    def do_DELETE(self):
        self.dispatch()

    def dispatch(self):
        try:
            if not self.trusted(self.command != "GET"):
                return
            self.route()
        except (BrokenPipeError, ConnectionResetError):
            pass
        except (TimeoutError, socket.timeout):
            self.respond(408, {"error": "上传超时，请重试。"})
        except (OSError, sqlite3.Error):
            self.respond(500, {"error": "文件保存失败，请检查磁盘空间与文件夹权限后重试。"})
        except (ValueError, UnicodeError, json.JSONDecodeError):
            self.respond(400, {"error": "请求内容无效，请刷新页面后重试。"})

    def read_body(self, limit):
        if self.headers.get("Transfer-Encoding"):
            raise ValueError("Unsupported transfer encoding")
        size = int(self.headers.get("Content-Length", "0"))
        if size < 1 or size > limit:
            self.respond(413, {"error": "文件不能为空，单份 PDF 不能超过 20 MB。"})
            return None
        body = self.rfile.read(size)
        if len(body) != size:
            raise ValueError("Incomplete upload")
        return body

    def route(self):
        url = urlsplit(self.path)
        path = url.path
        if self.command == "GET" and path in {"/", "/index.html", "/app.js", "/styles.css", "/favicon.svg"}:
            filename = "index.html" if path == "/" else path[1:]
            types = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml"}
            asset = ROOT / "web" / filename
            self.respond(200, asset.read_bytes(), types[asset.suffix])
            return
        if path == "/api/resumes" and self.command == "GET":
            with self.server.connect() as db:
                rows = db.execute("SELECT id, title, original_name, size, uploaded_at FROM resumes ORDER BY uploaded_at DESC, rowid DESC").fetchall()
            self.respond(200, {"app": "qiuzhao-resume-manager", "resumes": [dict(row) for row in rows], "token": self.server.token, "max_file_size": MAX_FILE_SIZE})
            return
        if path == "/api/resumes" and self.command == "POST":
            self.upload(parse_qs(url.query).get("name", [""])[0])
            return
        match = re.fullmatch(r"/api/resumes/([a-f0-9]{32})(/file)?", path)
        if not match:
            self.respond(404, {"error": "找不到该页面或文件。"})
            return
        resume_id, file_route = match.groups()
        with self.server.connect() as db:
            row = db.execute("SELECT * FROM resumes WHERE id = ?", (resume_id,)).fetchone()
        if row is None:
            self.respond(404, {"error": "这份简历已被删除，请刷新列表。"})
            return
        file_path = self.server.files_dir / f"{resume_id}.pdf"
        if file_route and self.command == "GET":
            if not file_path.is_file():
                self.respond(404, {"error": "简历原文件缺失，请重新上传。"})
                return
            disposition = "attachment" if parse_qs(url.query).get("download") == ["1"] else "inline"
            self.respond(200, file_path.read_bytes(), "application/pdf", {"Content-Disposition": f"{disposition}; filename=resume.pdf; filename*=UTF-8''{quote(row['original_name'], safe='')}"})
            return
        if not file_route and self.command == "PATCH":
            body = self.read_body(4096)
            if body is None:
                return
            payload = json.loads(body)
            title = payload.get("title") if isinstance(payload, dict) else None
            if not isinstance(title, str) or not 1 <= len(title.strip()) <= 100 or any(ord(char) < 32 for char in title):
                self.respond(400, {"error": "简历名称请填写 1–100 个字符。"})
                return
            with self.server.connect() as db:
                changed = db.execute("UPDATE resumes SET title = ? WHERE id = ?", (title.strip(), resume_id)).rowcount
            self.respond(200 if changed else 404, {"ok": True} if changed else {"error": "这份简历已被删除。"})
            return
        if not file_route and self.command == "DELETE":
            # Removing metadata first leaves no broken list entry if file cleanup fails.
            with self.server.connect() as db:
                db.execute("DELETE FROM resumes WHERE id = ?", (resume_id,))
            try:
                file_path.unlink(missing_ok=True)
            except OSError:
                self.respond(200, {"ok": True, "warning": "列表记录已删除，但磁盘文件被占用；关闭文件后请手动清理 data/files 中对应文件。"})
                return
            self.respond(200, {"ok": True})
            return
        self.respond(405, {"error": "不支持的操作。"})

    def upload(self, filename):
        filename = filename.replace("\\", "/").split("/")[-1].strip()
        if not filename.lower().endswith(".pdf") or len(filename) > 240 or any(ord(char) < 32 for char in filename):
            self.respond(400, {"error": "请选择 PDF 文件，文件名不能超过 240 个字符。"})
            return
        body = self.read_body(MAX_FILE_SIZE)
        if body is None:
            return
        if not body.startswith(b"%PDF-"):
            self.respond(400, {"error": "文件内容不是有效的 PDF 格式，请重新导出后上传。"})
            return
        digest = hashlib.sha256(body).hexdigest()
        resume_id = uuid4().hex
        file_path = self.server.files_dir / f"{resume_id}.pdf"
        temp_path = self.server.files_dir / f"{resume_id}.tmp"
        try:
            with self.server.connect() as db:
                # Serialize duplicate checks and writes, including across browser tabs.
                db.execute("BEGIN IMMEDIATE")
                existing = db.execute("SELECT id, title FROM resumes WHERE sha256 = ?", (digest,)).fetchone()
                if existing:
                    self.respond(409, {"error": f"这份文件已上传：{existing['title']}", "duplicate": True})
                    return
                with temp_path.open("xb") as stream:
                    stream.write(body)
                    stream.flush()
                    os.fsync(stream.fileno())
                temp_path.replace(file_path)
                db.execute("INSERT INTO resumes (id, title, original_name, size, sha256) VALUES (?, ?, ?, ?, ?)", (resume_id, filename[:-4][:100] or "未命名简历", filename, len(body), digest))
                row = db.execute("SELECT id, title, original_name, size, uploaded_at FROM resumes WHERE id = ?", (resume_id,)).fetchone()
        except Exception:
            temp_path.unlink(missing_ok=True)
            file_path.unlink(missing_ok=True)
            raise
        self.respond(201, {"resume": dict(row)})


def main():
    parser = argparse.ArgumentParser(description="本地简历管理")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data")
    parser.add_argument("--open", action="store_true", help="启动后打开浏览器")
    args = parser.parse_args()
    url = f"http://127.0.0.1:{args.port}"
    # A second double-click reopens the running library instead of starting a copy.
    if args.open and args.port:
        try:
            with build_opener(ProxyHandler({})).open(url + "/api/resumes", timeout=2) as response:
                running = json.load(response)
            if running.get("app") == "qiuzhao-resume-manager":
                webbrowser.open(url)
                return
        except (OSError, ValueError):
            pass
    try:
        server = ResumeServer(("127.0.0.1", args.port), args.data_dir)
    except OSError as error:
        parser.exit(1, f"Unable to start the resume manager: {error}\n")
    print(f"Resume manager: http://127.0.0.1:{server.server_port}", flush=True)
    print("Keep this window open. Press Ctrl+C to stop.", flush=True)
    if args.open:
        threading.Timer(0.3, webbrowser.open, args=(f"http://127.0.0.1:{server.server_port}",)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
