import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), '.whiteboard-data');

async function ensureDataDir() {
  try {
    await fs.access(DATA_DIR);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }
}

function docPath(id: string) {
  return path.join(DATA_DIR, `${id}.json`);
}

export async function POST(request: NextRequest) {
  await ensureDataDir();
  const doc = await request.json();
  if (!doc.id) {
    return Response.json({ error: 'Missing document id' }, { status: 400 });
  }
  doc.updatedAt = Date.now();
  await fs.writeFile(docPath(doc.id), JSON.stringify(doc, null, 2), 'utf-8');
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
