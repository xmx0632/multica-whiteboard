import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { docFilePath } from '@/lib/docFile';

const DATA_DIR = path.join(process.cwd(), '.whiteboard-data');

/** id 校验（ZOO-253）：URL 段不可信，非法形态返回 null → 走 404 */
function docPath(id: string) {
  return docFilePath(DATA_DIR, id);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const file = docPath(id);
  if (!file) return Response.json({ error: 'Not found' }, { status: 404 });
  try {
    const raw = await fs.readFile(file, 'utf-8');
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
  const file = docPath(id);
  if (!file) return Response.json({ error: 'Not found' }, { status: 404 });
  const body = await request.json().catch(() => null);
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (!title) {
    return Response.json({ error: 'Missing or empty title' }, { status: 400 });
  }
  try {
    const raw = await fs.readFile(file, 'utf-8');
    const doc = JSON.parse(raw);
    doc.title = title;
    await fs.writeFile(file, JSON.stringify(doc, null, 2), 'utf-8');
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
  const file = docPath(id);
  if (!file) return Response.json({ error: 'Not found' }, { status: 404 });
  try {
    await fs.unlink(file);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
}
