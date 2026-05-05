#!/usr/bin/env python3
"""
Cherry AI License Server
Runs on admin's machine, accepts HTTP connections from client extensions
"""

import json
import http.server
import socketserver
import threading
import time
from urllib.parse import urlparse, parse_qs

PORT = 8080
HOST = "0.0.0.0"  # Listen on all interfaces

# Storage (in-memory, persists while server runs)
license_codes = {"cherry-admin-2024": {"created": time.time(), "uses": 0}, "cherry-vip-2024": {"created": time.time(), "uses": 0}}
devices = {}  # device_id -> {status, code, activated_at, last_seen}
activity_log = []

def log_activity(device_id, action, details=""):
    entry = {
        "timestamp": time.time(),
        "device_id": device_id,
        "action": action,
        "details": details
    }
    activity_log.insert(0, entry)
    if len(activity_log) > 1000:
        activity_log.pop()

class LicenseHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Silent
    
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        params = parse_qs(parsed.query)
        
        response = {"success": False, "error": "Unknown endpoint"}
        
        if path == "/health":
            response = {"status": "ok", "codes": len(license_codes), "devices": len(devices)}
        
        elif path == "/check":
            device_id = params.get("device_id", [None])[0]
            if device_id:
                device = devices.get(device_id, {})
                if device.get("status") == "revoked":
                    response = {"status": "revoked", "action": "uninstall"}
                elif device.get("status") == "active":
                    device["last_seen"] = time.time()
                    response = {"status": "active"}
                else:
                    response = {"status": "pending_activation"}
            else:
                response = {"error": "Missing device_id"}
        
        self.send_response(200)
        self.send_header("Content-type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(response).encode())
    
    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode()
        data = json.loads(body) if body else {}
        
        response = {"success": False}
        
        if self.path == "/activate":
            device_id = data.get("device_id")
            code = data.get("code")
            device_info = data.get("device_info", {})
            
            if not device_id or not code:
                response = {"success": False, "message": "Missing device_id or code"}
            elif code not in license_codes:
                response = {"success": False, "message": "Invalid license code"}
            else:
                license_codes[code]["uses"] += 1
                devices[device_id] = {
                    "status": "active",
                    "code": code,
                    "activated_at": time.time(),
                    "last_seen": time.time(),
                    "info": device_info
                }
                log_activity(device_id, "ACTIVATED", f"Code: {code}")
                response = {"success": True, "message": "License activated"}
        
        elif self.path == "/report":
            device_id = data.get("device_id")
            action = data.get("action")
            if device_id and action:
                log_activity(device_id, action)
                response = {"success": True}
        
        self.send_response(200)
        self.send_header("Content-type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(response).encode())
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

# Admin control endpoints (for admin panel)
class AdminHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass
    
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        
        response = {}
        
        if path == "/admin/codes":
            response = {"codes": license_codes}
        elif path == "/admin/devices":
            response = {"devices": devices}
        elif path == "/admin/activity":
            response = {"activity": activity_log[:100]}
        
        self.send_response(200)
        self.send_header("Content-type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(response).encode())
    
    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode()
        data = json.loads(body) if body else {}
        
        response = {"success": False}
        
        if self.path == "/admin/generate":
            import secrets
            new_code = "cherry-" + secrets.token_hex(8)
            license_codes[new_code] = {"created": time.time(), "uses": 0}
            response = {"success": True, "code": new_code}
        
        elif self.path == "/admin/revoke":
            device_id = data.get("device_id")
            if device_id and device_id in devices:
                devices[device_id]["status"] = "revoked"
                log_activity(device_id, "REVOKED")
                response = {"success": True}
        
        elif self.path == "/admin/unrevoke":
            device_id = data.get("device_id")
            if device_id and device_id in devices:
                devices[device_id]["status"] = "active"
                log_activity(device_id, "UNREVOKED")
                response = {"success": True}
        
        elif self.path == "/admin/delete-code":
            code = data.get("code")
            if code and code in license_codes:
                del license_codes[code]
                response = {"success": True}
        
        self.send_response(200)
        self.send_header("Content-type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(response).encode())
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    allow_reuse_address = True
    daemon_threads = True

def start_server():
    print(f"[License Server] Starting on {HOST}:{PORT}")
    print(f"[License Server] Your IP: Run 'ipconfig' (Windows) or 'ifconfig' (Mac)")
    print(f"[License Server] Clients connect to: http://YOUR_IP:{PORT}")
    
    # Main license API
    license_server = ThreadedHTTPServer((HOST, PORT), LicenseHandler)
    license_thread = threading.Thread(target=license_server.serve_forever)
    license_thread.daemon = True
    license_thread.start()
    
    # Admin API (port 8081)
    admin_server = ThreadedHTTPServer((HOST, PORT + 1), AdminHandler)
    admin_thread = threading.Thread(target=admin_server.serve_forever)
    admin_thread.daemon = True
    admin_thread.start()
    
    print(f"[License Server] Running on ports {PORT} (licenses) and {PORT + 1} (admin)")
    print("[License Server] Press Ctrl+C to stop")
    
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[License Server] Shutting down...")
        license_server.shutdown()
        admin_server.shutdown()

if __name__ == "__main__":
    start_server()
