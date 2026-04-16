import { NextRequest, NextResponse } from 'next/server'

const FLASK = process.env.FLASK_API_URL ?? 'http://localhost:5000'

async function proxy(req: NextRequest, segs: string[]): Promise<NextResponse> {
  const url = `${FLASK}/${segs.join('/')}${req.nextUrl.search}`
  const isPost = req.method === 'POST'
  try {
    const upstream = await fetch(url, {
      method:  req.method,
      headers: { 'Content-Type': 'application/json' },
      body:    isPost ? await req.text() : undefined,
      signal:  AbortSignal.timeout(300_000),
    })
    const body = await upstream.text()
    return new NextResponse(body, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: `Cannot reach Flask at ${FLASK} — ${msg}` },
      { status: 503 }
    )
  }
}

export const GET  = (req: NextRequest, { params }: { params: { proxy: string[] } }) =>
  proxy(req, params.proxy)
export const POST = (req: NextRequest, { params }: { params: { proxy: string[] } }) =>
  proxy(req, params.proxy)
