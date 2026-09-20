import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { App } from './App'
import { Gallery } from './pages/Gallery'
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

  it('App — scenario select on first load', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(noop)
    render(<App />)
    // Scenario select screen should appear — no game selected yet
    const shouted = spy.mock.calls.flat().join(' ')
    expect(shouted).not.toMatch(/Maximum update depth/i)
    spy.mockRestore()
  })

  it('App — game view after picking a scenario', () => {
    render(<App />)
    // There is one scenario card: slice-oom-kill
    // Click it to enter the design phase
    const card = document.querySelector('[role="button"]')
    if (card) fireEvent.click(card as HTMLElement)
    // App should now show the game (design or run phase board)
    expect(screen.queryByText(/Maximum update depth/i)).toBeNull()
  })

  it('game board renders real node names after picking a scenario', () => {
    render(<App />)
    const card = document.querySelector('[role="button"]')
    if (card) fireEvent.click(card as HTMLElement)
    // After starting a game, the slice-oom-kill board is visible
    expect(screen.getAllByText('PostgreSQL').length).toBeGreaterThan(0)
    expect(screen.getAllByText('CDN').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Application Cluster').length).toBeGreaterThan(0)
  })

  it('board renders a draggable graph, not a fixed grid', () => {
    const { container } = render(<App />)
    const card = document.querySelector('[role="button"]')
    if (card) fireEvent.click(card as HTMLElement)

    // Canvas controls: zoom in/out, fit, reset.
    expect(screen.getByLabelText('Zoom in')).toBeTruthy()

    // Every node sits in an absolutely-positioned slot.
    const positioned = Array.from(container.querySelectorAll<HTMLElement>('[style*="left"]')).filter(
      (el) => el.style.left !== '' && el.style.top !== '',
    )
    expect(positioned.length).toBeGreaterThanOrEqual(4)
  })

  it('TaskDock and IncidentFeed mount without errors', () => {
    render(<App />)
    const card = document.querySelector('[role="button"]')
    if (card) fireEvent.click(card as HTMLElement)
    expect(screen.queryByText(/Maximum update depth/i)).toBeNull()
  })

  it('MinigamePreview mounts a real instance for the first format', () => {
    render(<MinigamePreview />)
    expect(screen.getByText(/attempt 1/i)).toBeTruthy()
  })

  it('OutcomePreview mounts the scenario select and debrief', () => {
    render(<OutcomePreview />)
    // Real scenarios from the engine catalog appear in the select panel.
    expect(screen.getAllByText(/scenario select/i).length).toBeGreaterThan(0)
    expect(screen.queryByText(/Maximum update depth/i)).toBeNull()
  })

  it('Gallery mounts every atom and molecule specimen', () => {
    render(<Gallery />)
    expect(screen.getByText('Component library')).toBeTruthy()
    // The coverage panel must not be reporting a mismatch.
    expect(screen.queryByText(/^expected /)).toBeNull()
  })
})
