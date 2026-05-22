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
