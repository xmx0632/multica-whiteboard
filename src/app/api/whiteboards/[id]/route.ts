import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), '.whiteboard-data');

function docPath(id: string) {
  return path.join(DATA_DIR, `${id}.json`);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const raw = await fs.readFile(docPath(id), 'utf-8');
    return Response.json(JSON.parse(raw));
  } catch {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
}

/** 重命名（ZOO-158）：只改 title，不触碰 elements/updatedAt——改名不是内容变更，不重排列表 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (!title) {
    return Response.json({ error: 'Missing or empty title' }, { status: 400 });
  }
  try {
    const raw = await fs.readFile(docPath(id), 'utf-8');
    const doc = JSON.parse(raw);
    doc.title = title;
    await fs.writeFile(docPath(id), JSON.stringify(doc, null, 2), 'utf-8');
    return Response.json({ ok: true, id, title });
  } catch {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await fs.unlink(docPath(id));
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
}
