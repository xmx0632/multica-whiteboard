import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { docFilePath } from '@/lib/docFile';

const DATA_DIR = path.join(process.cwd(), '.whiteboard-data');

async function ensureDataDir() {
  try {
    await fs.access(DATA_DIR);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }
}

export async function POST(request: NextRequest) {
  await ensureDataDir();
  const doc = await request.json().catch(() => null);
  // id 校验（ZOO-253）：客户端载荷不可信，非法形态拒绝写入（原实现 !doc.id
  // 只挡空值，'../x' 形态会逃逸出数据目录覆盖任意 .json）
  const file = docFilePath(DATA_DIR, doc?.id);
  if (!file) {
    return Response.json({ error: 'Missing or invalid document id' }, { status: 400 });
  }
  doc.updatedAt = Date.now();
  await fs.writeFile(file, JSON.stringify(doc, null, 2), 'utf-8');
  return Response.json({ ok: true, id: doc.id });
}

export async function GET() {
  await ensureDataDir();
  const files = await fs.readdir(DATA_DIR);
  const docs = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const raw = await fs.readFile(path.join(DATA_DIR, file), 'utf-8');
      const doc = JSON.parse(raw);
      docs.push({
        id: doc.id,
        title: doc.title,
        updatedAt: doc.updatedAt,
        createdAt: doc.createdAt,
      });
    } catch {
      // skip malformed files
    }
  }
  docs.sort((a, b) => b.updatedAt - a.updatedAt);
  return Response.json(docs);
}
