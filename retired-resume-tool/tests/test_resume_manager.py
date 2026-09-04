import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from resume_manager import ResumeServer


class ResumeManagerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.start_server()

    def start_server(self):
        self.server = ResumeServer(('127.0.0.1', 0), self.temp.name)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f'http://127.0.0.1:{self.server.server_port}'

    def stop_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def tearDown(self):
        self.stop_server()
        self.temp.cleanup()

    def request(self, path, method='GET', data=None, headers=None):
        request_headers = {'X-Resume-Token': self.server.token}
        request_headers.update(headers or {})
        request = Request(self.base + path, data=data, method=method, headers=request_headers)
        try:
            response = urlopen(request, timeout=5)
        except HTTPError as error:
            response = error
        with response:
            body = response.read()
            if 'application/json' in response.headers.get('Content-Type', ''):
                body = json.loads(body)
            return response.status, body, response.headers

    def upload(self, name='简历.pdf', content=b'%PDF-1.4\n% resume fixture\n%%EOF'):
        return self.request('/api/resumes?name=' + quote(name), 'POST', content)

    def test_multiple_same_name_and_restart_persistence(self):
        a = self.upload()[1]['resume']
        b = self.upload(content=b'%PDF-1.4\n% another version\n%%EOF')[1]['resume']
        self.assertNotEqual(a['id'], b['id'])
        self.assertEqual(a['original_name'], b['original_name'])
        self.stop_server()
        self.start_server()
        records = self.request('/api/resumes')[1]['resumes']
        self.assertEqual(len(records), 2)
        self.assertEqual({r['id'] for r in records}, {a['id'], b['id']})

    def test_duplicate_is_skipped(self):
        self.assertEqual(self.upload()[0], 201)
        status, body, _ = self.upload(name='别名.pdf')
        self.assertEqual(status, 409)
        self.assertTrue(body['duplicate'])
        self.assertEqual(len(list(self.server.files_dir.glob('*.pdf'))), 1)

    def test_upload_validation_and_later_success(self):
        self.assertEqual(self.upload(name='简历.docx')[0], 400)
        self.assertEqual(self.upload(content=b'not a PDF')[0], 400)
        self.assertEqual(self.upload(content=b'')[0], 413)
        self.assertEqual(self.request('/api/resumes?name=a.pdf', 'POST', b'%PDF-', {'Content-Length': str(21 * 1024 * 1024)})[0], 413)
        self.assertEqual(self.upload(name='Valid.PDF')[0], 201)

    def test_pdf_bytes_download_and_unicode_name(self):
        original = b'%PDF-1.4\n% bytes must remain unchanged\n%%EOF'
        resume = self.upload(name='研发工程师 2026.pdf', content=original)[1]['resume']
        status, data, headers = self.request(f"/api/resumes/{resume['id']}/file")
        self.assertEqual(status, 200)
        self.assertEqual(data, original)
        self.assertEqual(headers['Content-Type'], 'application/pdf')
        self.assertTrue(headers['Content-Disposition'].startswith('inline;'))
        headers = self.request(f"/api/resumes/{resume['id']}/file?download=1")[2]
        self.assertTrue(headers['Content-Disposition'].startswith('attachment;'))
        self.assertIn(quote('研发工程师 2026.pdf'), headers['Content-Disposition'])

    def test_rename_and_delete_do_not_touch_other_resume(self):
        a = self.upload()[1]['resume']
        b = self.upload(content=b'%PDF-1.4\n% second\n%%EOF')[1]['resume']
        route = f"/api/resumes/{a['id']}"
        self.assertEqual(self.request(route, 'PATCH', json.dumps({'title': '技术岗 · 秋招版'}).encode())[0], 200)
        records = self.request('/api/resumes')[1]['resumes']
        self.assertEqual(next(r for r in records if r['id'] == a['id'])['title'], '技术岗 · 秋招版')
        self.assertEqual(self.request(route, 'DELETE')[0], 200)
        self.assertEqual(self.request(route + '/file')[0], 404)
        self.assertFalse((self.server.files_dir / f"{a['id']}.pdf").exists())
        self.assertEqual(self.request(f"/api/resumes/{b['id']}/file")[0], 200)

    def test_invalid_title(self):
        resume = self.upload()[1]['resume']
        route = f"/api/resumes/{resume['id']}"
        for payload in [{'title': '  '}, {'title': 'a' * 101}, {'title': None}, {'title': '\nhello'}, []]:
            with self.subTest(payload=payload):
                self.assertEqual(self.request(route, 'PATCH', json.dumps(payload).encode())[0], 400)

    def test_local_access_boundaries(self):
        self.assertEqual(self.request('/api/resumes', headers={'Host': 'evil.example'})[0], 403)
        self.assertEqual(self.request('/api/resumes', headers={'Origin': 'https://evil.example'})[0], 403)
        self.assertEqual(self.request('/api/resumes', headers={'Sec-Fetch-Site': 'cross-site'})[0], 403)
        self.assertEqual(self.request('/api/resumes?name=a.pdf', 'POST', b'%PDF-', {'X-Resume-Token': ''})[0], 403)
        for route in ['/data/resumes.sqlite3', '/../../resume_manager.py', '/%2e%2e/resume_manager.py']:
            self.assertEqual(self.request(route)[0], 404)

    def test_concurrent_duplicates_have_one_record(self):
        results = []
        threads = [threading.Thread(target=lambda: results.append(self.upload()[0])) for _ in range(3)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(sorted(results), [201, 409, 409])
        self.assertEqual(len(self.request('/api/resumes')[1]['resumes']), 1)

    def test_assets_and_no_optimization_controls(self):
        for path in ['/', '/app.js', '/styles.css', '/favicon.svg']:
            self.assertEqual(self.request(path)[0], 200)
        html = self.request('/')[1].decode('utf-8')
        self.assertIn('multiple', html)
        self.assertNotIn('简历优化', html)
        self.assertNotIn('简历制作', html)


if __name__ == '__main__':
    unittest.main()
