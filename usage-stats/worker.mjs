const installationId = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname !== '/first-use') return new Response(null, { status: 404 })
    const origin = request.headers.get('origin')
    if (!origin || origin !== env.SITE_ORIGIN) return new Response(null, { status: 403 })
    const headers = { 'Access-Control-Allow-Origin': origin, 'Cache-Control': 'no-store' }
    if (request.method !== 'POST') return new Response(null, { status: 405, headers })
    if (Number(request.headers.get('content-length')) > 36) return new Response(null, { status: 413, headers })
    const id = await request.text()
    if (!installationId.test(id)) return new Response(null, { status: 400, headers })
    await env.USAGE.prepare('INSERT OR IGNORE INTO first_use (installation_id) VALUES (?)').bind(id).run()
    return new Response(null, { status: 204, headers })
  },
}
