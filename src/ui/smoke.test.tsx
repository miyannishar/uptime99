import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { App } from './App'
import { Gallery } from './pages/Gallery'
import { RunPreview } from './pages/RunPreview'
import { DesignPreview } from './pages/DesignPreview'
import { MinigamePreview } from './pages/MinigamePreview'
import { OutcomePreview } from './pages/OutcomePreview'
import { catalog } from './data/catalog'

/**
 * Mount smoke tests.
 *
 * These exist because the first build of this UI typechecked, bundled and served
 * a completely black page: BoardCanvas rebuilt a Map every render, which changed
 * a useLayoutEffect dependency, which called setState, which re-rendered — an
 * infinite loop React kills by unmounting the tree. Nothing in `tsc` or `vite
 * build` can see that. A mount is the cheapest thing that can.
 *
 * `happy-dom` has no layout engine, so getBoundingClientRect returns zeroes and
 * ResizeObserver is absent. Both are handled deliberately below: BoardCanvas is
 * written to tolerate a zero-size host and to skip the observer when it is
 * missing, and if that ever stops being true these tests fail rather than the
 * browser going dark.
 */

afterEach(cleanup)

describe('data reaches the UI', () => {
  it('loads the real catalog, not fixtures', () => {
    expect(catalog.nodes).toHaveLength(26)
    expect(catalog.tags).toHaveLength(47)
    expect(catalog.actions).toHaveLength(33)
    expect(catalog.incidents).toHaveLength(49)
    expect(catalog.instances).toHaveLength(29)
    expect(catalog.nodes.reduce((n, d) => n + d.tiers.length, 0)).toBe(80)
  })
})

describe('every view mounts without throwing', () => {
  const noop = () => {}

  it('App — the default Run phase view', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(noop)
    render(<App />)
    // If the render loop regressed, React logs "Maximum update depth exceeded"
    // and unmounts. Assert on both the symptom and the cause.
    const shouted = spy.mock.calls.flat().join(' ')
    expect(shouted).not.toMatch(/Maximum update depth/i)
    spy.mockRestore()
  })

  it('RunPreview renders the board and the failed node', () => {
    render(<RunPreview depthMode="depth" onDepthChange={noop} />)
    // A real node name off a real NodeDef — it appears on the board card AND in
    // the inspector header, so both are expected.
    expect(screen.getAllByText('PostgreSQL').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/DOWN/).length).toBeGreaterThan(0)
  })

  it('RunPreview renders in FLAT without losing any text', () => {
    const { unmount } = render(<RunPreview depthMode="depth" onDepthChange={noop} />)
    const deep = document.body.textContent ?? ''
    unmount()
    document.documentElement.dataset.depth = 'flat'
    render(<RunPreview depthMode="flat" onDepthChange={noop} />)
    const flat = document.body.textContent ?? ''
    // The core invariant of the depth toggle: FLAT removes presentation, never
    // information. The rack is CSS-hidden, so the text content must be identical.
    expect(flat).toBe(deep)
  })

  it('board renders a draggable graph, not a fixed grid', () => {
    const { container } = render(<RunPreview depthMode="depth" onDepthChange={noop} />)
    // Canvas controls: zoom in/out, fit, reset.
    expect(screen.getByLabelText('Zoom in')).toBeTruthy()
    expect(screen.getByLabelText('Zoom out')).toBeTruthy()
    expect(screen.getByText('fit')).toBeTruthy()
    expect(screen.getByText('reset')).toBeTruthy()
    expect(screen.getByText('100%')).toBeTruthy()

    // Every node sits in an absolutely-positioned slot with a real coordinate.
    // If this regresses to a flow layout the links, which are pure arithmetic off
    // these same coordinates, would silently point at the wrong places.
    const positioned = Array.from(container.querySelectorAll<HTMLElement>('[style*="left"]')).filter(
      (el) => el.style.left !== '' && el.style.top !== '',
    )
    expect(positioned.length).toBeGreaterThanOrEqual(12)

    // Links are drawn for the wired edges.
    expect(container.querySelectorAll('svg path').length).toBeGreaterThan(0)
  })

  it('TaskDock reports what the player is waiting on', () => {
    render(<RunPreview depthMode="depth" onDepthChange={noop} />)
    expect(screen.getByText(/in flight/i)).toBeTruthy()
    expect(screen.getByText(/cooling down/i)).toBeTruthy()
    // Appears in the dock group heading AND on the ci-01 card, which is mid-build.
    expect(screen.getAllByText(/provisioning/i).length).toBeGreaterThanOrEqual(2)
    // app-us-01 has `restart` on a 34s cooldown in the fixture.
    expect(screen.getByText('restart')).toBeTruthy()
  })

  it('DesignPreview mounts and blocks commit on an unwired required port', () => {
    render(<DesignPreview depthMode="depth" onDepthChange={noop} />)
    expect(screen.getByText(/required port is unwired/i)).toBeTruthy()
    const commit = screen.getByRole('button', { name: /commit and run/i })
    expect(commit.hasAttribute('disabled')).toBe(true)
  })

  it('MinigamePreview mounts a real instance for the first format', () => {
    render(<MinigamePreview />)
    expect(screen.getByText(/attempt 1/i)).toBeTruthy()
  })

  it('OutcomePreview mounts scenarios and the debrief', () => {
    render(<OutcomePreview />)
    // Present twice by design: once as a scenario card, once as the debrief's
    // subject.
    expect(screen.getAllByText('The First Nine')).toHaveLength(2)
  })

  it('Gallery mounts every atom and molecule specimen', () => {
    render(<Gallery />)
    expect(screen.getByText('Component library')).toBeTruthy()
    // The coverage panel must not be reporting a mismatch.
    expect(screen.queryByText(/^expected /)).toBeNull()
  })
})
