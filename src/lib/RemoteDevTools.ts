import debug from 'debug'
import getPort from 'get-port'
import httpAuth from 'http-auth'
import httpProxy from 'http-proxy'
import ky from 'ky'
import localtunnel, { type Tunnel, type TunnelConfig } from 'localtunnel'
import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import ow from 'ow'
import { generate } from 'randomstring'
import { modifyResponse } from './HttpResponseRewrite'

type BasicAuth = ReturnType<typeof httpAuth.basic>
type CheckedRequestListener = Parameters<BasicAuth['check']>[0]

const dbg = debug('remote-devtools')

export class DevToolsCommon {
  protected wsUrl: string
  protected wsHost: string
  protected wsPort: number

  constructor(webSocketDebuggerUrl: string) {
    ow(webSocketDebuggerUrl, ow.string)
    ow(webSocketDebuggerUrl, ow.string.includes('ws://'))

    this.wsUrl = webSocketDebuggerUrl
    const wsUrlParts = new URL(webSocketDebuggerUrl)
    this.wsHost = wsUrlParts.hostname === '127.0.0.1' || wsUrlParts.hostname === '[::1]' ? 'localhost' : wsUrlParts.hostname
    this.wsPort = Number.isNaN(Number(wsUrlParts.port)) ? 9222 : Number(wsUrlParts.port)
  }

  async fetchVersion() {
    const res = await ky.get(`http://${this.wsHost}:${this.wsPort}/json/version`)
    if (!res.ok) {
      throw new Error(`Failed to fetch version: ${res.statusText}`)
    }
    const body = await res.json()
    return body as Record<string, any>
  }

  async fetchList() {
    // const { body } = await got(`http://${this.wsHost}:${this.wsPort}/json/list`, { json: true })
    const res = await ky.get(`http://${this.wsHost}:${this.wsPort}/json/list`)
    if (!res.ok) {
      throw new Error(`Failed to fetch list: ${res.statusText}`)
    }
    const body = await res.json()
    return body as Record<string, any>
  }
}

export class DevToolsLocal extends DevToolsCommon {
  get url() {
    return `http://${this.wsHost}:${this.wsPort}`
  }

  getUrlForPageId(pageId: string) {
    return `${this.url}/devtools/inspector.html?ws=${this.wsHost}:${this.wsPort}/devtools/page/${pageId}`
  }
}

interface DevToolsTunnelOptions {
  prefix: string
  subdomain: string | null
  auth: { user: string | null; pass: string | null }
  localtunnel: Record<string, any>
}

export class DevToolsTunnel extends DevToolsCommon {
  public tunnelHost = ''
  public tunnel?: Tunnel
  public opts: DevToolsTunnelOptions

  private server: Server<typeof IncomingMessage, typeof ServerResponse> | null = null
  private proxyServer: httpProxy<http.IncomingMessage, http.ServerResponse<http.IncomingMessage>> | null = null

  constructor(webSocketDebuggerUrl: string, opts: Partial<DevToolsTunnelOptions> = {}) {
    super(webSocketDebuggerUrl)
    this.opts = Object.assign(this.defaults, opts)
  }

  get defaults() {
    return {
      prefix: 'devtools-tunnel',
      subdomain: null,
      auth: { user: null, pass: null },
      localtunnel: {}
    }
  }

  get url() {
    return this.tunnel?.url
  }

  getUrlForPageId(pageId: string) {
    return `https://${this.tunnelHost}/devtools/inspector.html?wss=${this.tunnelHost}/devtools/page/${pageId}`
  }

  async create() {
    const subdomain = this.opts.subdomain || this._generateSubdomain(this.opts.prefix)
    const basicAuth = this.opts.auth.user && this.opts.auth.pass ? this._createBasicAuth(this.opts.auth.user, this.opts.auth.pass) : undefined
    const serverPort = await getPort() // only preference, will return an available one

    this.proxyServer = this._createProxyServer(this.wsHost, this.wsPort)
    this.server = await this._createServer(serverPort, basicAuth)
    this.tunnel = await this._createTunnel({
      local_host: this.wsHost,
      port: serverPort,
      subdomain,
      ...this.opts.localtunnel
    })

    this.tunnelHost = new URL(this.tunnel.url).hostname

    dbg(
      'tunnel created.',
      `
      local:  http://${this.wsHost}:${this.wsPort}
      proxy:  http://localhost:${serverPort}
      tunnel: ${this.tunnel.url}
    `
    )
    return this
  }

  close() {
    this.tunnel?.close()
    this.server?.close()
    this.proxyServer?.close()
    debug('all closed')
    return this
  }

  _generateSubdomain(prefix: string) {
    const rand = generate({
      length: 10,
      readable: true,
      capitalization: 'lowercase'
    })
    return `${prefix}-${rand}`
  }

  _createBasicAuth(user: string, pass: string): BasicAuth {
    const basicAuth = httpAuth.basic({}, (username, password, callback) => {
      const isValid = username === user && password === pass
      return callback(isValid)
    })
    basicAuth.on('success', result => {
      dbg(`User authenticated: ${result.user}`)
    })
    basicAuth.on('fail', result => {
      dbg(`User authentication failed: ${result.user}`)
    })
    basicAuth.on('error', error => {
      dbg(`Authentication error: ${`${error} - ${error.message}`}`)
    })
    return basicAuth
  }

  /**
   * `fetch` used by the index page doesn't include credentials by default.
   *
   *           LOVELY
   *           THANKS
   *             <3
   *
   * @ignore
   */
  _modifyFetchToIncludeCredentials(body: string | undefined) {
    if (!body) {
      return
    }
    let nBody = body.replace('fetch(url).', "fetch(url, {credentials: 'include'}).")
    // Fix for headless index pages that use weird client-side JS to modify the devtoolsFrontendUrl to something not working for us
    // https://github.com/berstend/puppeteer-extra/issues/566
    nBody = nBody.replace('link.href = `https://chrome-devtools-frontend.appspot.com', 'link.href = item.devtoolsFrontendUrl; // ')
    dbg('fetch:after', nBody)
    return nBody
  }

  _modifyJSONResponse(body: string | undefined) {
    if (!body) {
      return
    }
    dbg('list body:before', body)
    let nBody = body.replace(new RegExp(this.wsHost, 'g'), `${this.tunnelHost}`)
    nBody = nBody.replace(/ws=/g, 'wss=')
    nBody = nBody.replace(/ws:\/\//g, 'wss://')
    dbg('list body:after', nBody)
    return nBody
  }

  _createProxyServer(targetHost = 'localhost', targetPort: string | number = 9222) {
    // eslint-disable-next-line
    const proxyServer = httpProxy.createProxyServer({
      target: { host: targetHost, port: Number(targetPort) }
    })
    proxyServer.on('proxyReq', (proxyReq, req, _, __) => {
      dbg('proxyReq', req.url)
      // https://github.com/GoogleChrome/puppeteer/issues/2242
      proxyReq.setHeader('Host', 'localhost')
    })
    proxyServer.on('proxyRes', (proxyRes, req, res) => {
      dbg('proxyRes', req.url)
      if (req.url === '/') {
        proxyRes.headers['content-length'] = undefined
        modifyResponse(res, proxyRes.headers['content-encoding'], this._modifyFetchToIncludeCredentials.bind(this))
      }
      if (['/json/list', '/json/version'].includes(req.url || '')) {
        proxyRes.headers['content-length'] = undefined
        modifyResponse(res, proxyRes.headers['content-encoding'], this._modifyJSONResponse.bind(this))
      }
    })
    return proxyServer
  }

  async _createServer(port: number, auth?: BasicAuth) {
    const handler: CheckedRequestListener = (req, res) => {
      this.proxyServer?.web(req, res)
    }
    const server = http.createServer(auth ? auth.check(handler) : handler)
    server.on('upgrade', (req, socket, head) => {
      dbg('upgrade request', req.url)
      this.proxyServer?.ws(req, socket, head)
    })
    server.listen(port)
    return server
  }

  async _createTunnel(
    options: TunnelConfig & {
      port: number
    }
  ) {
    const tunnel = await localtunnel(options)

    tunnel.on('close', () => {
      dbg('tunnel:close')
    })

    tunnel.on('error', err => {
      dbg('tunnel:error', err)
    })

    dbg('tunnel:created', tunnel.url)
    return tunnel
  }
}
