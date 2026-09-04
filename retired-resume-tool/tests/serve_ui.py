"""Temporary library for browser checks; never uses the user's data directory."""
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from resume_manager import ResumeServer

with tempfile.TemporaryDirectory(prefix='resume-manager-ui-') as directory:
    server = ResumeServer(('127.0.0.1', 8766), directory)
    print('Isolated browser test: http://127.0.0.1:8766', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
