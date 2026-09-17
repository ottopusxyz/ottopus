import { readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PUBLIC_ROUTES, SHELL_ROUTES } from '@/components/shell/routes'

const APP = fileURLToPath(new URL('.', import.meta.url))

/** Directories under app/ that hold routes, as opposed to assets or styles. */
const GROUPS = ['(shell)', '(public)']

const dirs = (path: string) =>
  readdirSync(path, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)

/**
 * A page is inside the shell unless someone wrote down why it is not.
 *
 * The filesystem cannot enforce that on its own — Next puts a new folder
 * wherever you create it, and a route dropped at app/foo/ would silently render
 * with no nav, no skip link and no page header. This closes it: every route
 * lives in a group, and every route outside the shell needs an entry in
 * PUBLIC_ROUTES giving the reason.
 */
describe('route shape', () => {
  it('puts every route in a group, so none is accidentally outside the shell', () => {
    const loose = dirs(APP).filter((d) => !GROUPS.includes(d) && d !== 'styles')
    expect(loose, 'create routes inside (shell) or (public), not directly under app/').toEqual([])
  })

  it('has a reason recorded for every route outside the shell', () => {
    const publicDirs = dirs(join(APP, '(public)'))
    const declared = new Set(Object.keys(PUBLIC_ROUTES))

    // The group's own page.tsx is the root route.
    if (existsSync(join(APP, '(public)', 'page.tsx'))) {
      expect(declared.has('/'), 'PUBLIC_ROUTES needs an entry for "/"').toBe(true)
    }
    for (const dir of publicDirs) {
      expect(declared.has(`/${dir}`), `PUBLIC_ROUTES needs an entry for /${dir}`).toBe(true)
    }
  })

  it('gives every reason a route that still exists', () => {
    for (const path of Object.keys(PUBLIC_ROUTES)) {
      const dir = path === '/' ? '' : path.replace(/^\//, '')
      const target = dir ? join(APP, '(public)', dir) : join(APP, '(public)', 'page.tsx')
      expect(existsSync(target), `PUBLIC_ROUTES lists ${path}, which no longer exists`).toBe(true)
    }
  })

  it('has a page for every nav item, so the sidebar never links to a 404', () => {
    for (const route of SHELL_ROUTES) {
      const page = join(APP, '(shell)', route.href.replace(/^\//, ''), 'page.tsx')
      expect(existsSync(page), `${route.label} links to ${route.href}, which has no page`).toBe(
        true,
      )
    }
  })

  it('gives every reason in PUBLIC_ROUTES actual prose', () => {
    for (const [path, reason] of Object.entries(PUBLIC_ROUTES)) {
      expect(reason.length, `${path} needs a real reason, not a placeholder`).toBeGreaterThan(20)
    }
  })
})
