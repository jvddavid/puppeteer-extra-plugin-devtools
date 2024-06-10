import Plugin from '@/index'
import { describe, expect, it } from 'bun:test'
import { ArgumentError } from 'ow'
import type { Browser } from 'puppeteer'

const PLUGIN_NAME = 'devtools'

describe('Plugin', () => {
  it('should be is a function', () => {
    expect(Plugin).toBeInstanceOf(Function)
  })
  it('should have the basic class members', () => {
    const plugin = Plugin()
    expect(plugin.name).toBe(PLUGIN_NAME)
    expect(plugin._isPuppeteerExtraPlugin).toBeTruthy()
  })
  it('should have opts with default values', () => {
    const plugin = Plugin()
    expect(plugin.opts.prefix).toBe('devtools-tunnel')
    expect(plugin.opts.auth.user).toBe('user')
    expect(plugin.opts.auth.pass.length).toBe(40)
  })
  it('will throw without browser when creating a tunnel', () => {
    const plugin = Plugin()
    expect(() => plugin.createTunnel({} as unknown as Browser)).toThrow(ArgumentError)
  })
})
