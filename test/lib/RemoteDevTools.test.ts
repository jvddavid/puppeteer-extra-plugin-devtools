import { DevToolsCommon, DevToolsLocal, DevToolsTunnel } from '@/lib/RemoteDevTools'
import { describe, expect, it } from 'bun:test'
import type { Tunnel } from 'localtunnel'

const webSocketDebuggerUrl = 'ws://127.0.0.1:9222/devtools/browser/ec78d039-2f19-4c6f-a08e-bcaf88e34b69'

describe('RemoteDevTools', () => {
  it('should be is a function', () => {
    expect(DevToolsCommon).toBeInstanceOf(Function)
    expect(DevToolsLocal).toBeInstanceOf(Function)
    expect(DevToolsTunnel).toBeInstanceOf(Function)
  })
  it('will throw when missing webSocketDebuggerUrl', () => {
    expect(() => new DevToolsCommon(undefined as unknown as string)).toThrow('Expected argument to be of type `string` but received type `undefined`')
  })
  it('DevToolsLocal: has basic functionality', () => {
    const instance = new DevToolsLocal(webSocketDebuggerUrl)
    expect(instance.url).toBe('http://localhost:9222')
    expect(instance.getUrlForPageId('foobar')).toBe('http://localhost:9222/devtools/inspector.html?ws=localhost:9222/devtools/page/foobar')
  })
  it('DevToolsTunnel: has basic functionality', () => {
    const instance = new DevToolsTunnel(webSocketDebuggerUrl)
    instance.tunnel = { url: 'https://faketunnel.com' } as unknown as Tunnel
    instance.tunnelHost = 'faketunnel.com'
    expect(instance.url).toBe(instance.tunnel.url)
    expect(instance.getUrlForPageId('foobar')).toBe('https://faketunnel.com/devtools/inspector.html?wss=faketunnel.com/devtools/page/foobar')
  })
  it('DevToolsTunnel: has defaults', () => {
    const instance = new DevToolsTunnel(webSocketDebuggerUrl)
    expect(instance.opts.prefix).toBe('devtools')
    expect(instance.opts.subdomain).toBe(null)
    expect(instance.opts.auth.user).toBe(null)
    expect(instance.opts.auth.pass).toBe(null)
  })
  it('DevToolsTunnel: has public members', () => {
    const instance = new DevToolsTunnel(webSocketDebuggerUrl)

    expect(instance.create).toBeInstanceOf(Function)
    expect(instance.close).toBeInstanceOf(Function)
  })
})
