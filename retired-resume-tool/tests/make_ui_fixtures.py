from pathlib import Path

root = Path(__file__).resolve().parents[1] / 'qa-output' / 'fixtures'


def pdf(text):
    objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ]
    content = f'BT /F1 24 Tf 72 740 Td ({text}) Tj ET'
    objects.append(f'<< /Length {len(content)} >>\nstream\n{content}\nendstream')
    result = '%PDF-1.4\n'
    offsets = []
    for index, obj in enumerate(objects):
        offsets.append(len(result))
        result += f'{index + 1} 0 obj\n{obj}\nendobj\n'
    start = len(result)
    result += f'xref\n0 {len(objects) + 1}\n0000000000 65535 f \n'
    result += ''.join(f'{offset:010d} 00000 n \n' for offset in offsets)
    result += f'trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n'
    return result.encode('ascii')


for filename, title in [('first/产品经理-秋招版.pdf', 'Product Resume Test'), ('second/产品经理-秋招版.pdf', 'Another Resume Version'), ('研发工程师-技术岗.pdf', 'Engineering Resume Test')]:
    path = root / filename
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(pdf(title))
(root / '不支持的文件.txt').write_text('not a resume', encoding='utf-8')
