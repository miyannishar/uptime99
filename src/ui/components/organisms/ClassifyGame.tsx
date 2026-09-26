import { useState, useCallback } from 'react'
import type { ClassifyGiven, ClassifySolution } from '../../types'
import { cx } from '../../utils/format'
import s from './ClassifyGame.module.css'

export interface ClassifyGameProps {
  given: ClassifyGiven
  /** Current placements: item id → bin id. */
  placements: Readonly<Record<string, string>>
  onChange: (placements: Readonly<Record<string, string>>) => void
  disabled?: boolean
  /** After three failures, colour each item by its correct bin. */
  revealed?: boolean
  solution?: ClassifySolution
}

/**
 * Format J - `classify`.
 *
 * Items start in the tray. The player drags each item into one of the labelled
 * bins, or uses click-to-place as a fallback: click an item to select it, then
 * click a bin to place it. Clicking a placed item returns it to the tray.
 *
 * When revealed, each item is coloured by whether it landed in the correct bin.
 */
export function ClassifyGame({
  given,
  placements,
  onChange,
  disabled,
  revealed,
  solution,
}: ClassifyGameProps) {
  const { items, bins } = given
  const [dragId, setDragId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dragOverBin, setDragOverBin] = useState<string | null>(null)

  const unplaced = items.filter((item) => !(item.id in placements))

  const placeItem = useCallback(
    (itemId: string, binId: string) => {
      if (disabled) return
      onChange({ ...placements, [itemId]: binId })
      setSelectedId(null)
    },
    [disabled, onChange, placements],
  )

  const returnToTray = useCallback(
    (itemId: string) => {
      if (disabled) return
      const next = { ...placements }
      delete next[itemId]
      onChange(next)
      setSelectedId(null)
    },
    [disabled, onChange, placements],
  )

  /* -------- drag handlers ------------------------------------------ */

  function handleItemDragStart(e: React.DragEvent, itemId: string) {
    if (disabled) return
    setDragId(itemId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', itemId)
  }

  function handleBinDragOver(e: React.DragEvent, binId: string) {
    if (disabled || !dragId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverBin(binId)
  }

  function handleBinDragLeave() {
    setDragOverBin(null)
  }

  function handleBinDrop(e: React.DragEvent, binId: string) {
    e.preventDefault()
    setDragOverBin(null)
    const id = e.dataTransfer.getData('text/plain') || dragId
    if (id) placeItem(id, binId)
    setDragId(null)
  }

  function handleTrayDragOver(e: React.DragEvent) {
    if (disabled || !dragId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverBin('__tray__')
  }

  function handleTrayDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOverBin(null)
    const id = e.dataTransfer.getData('text/plain') || dragId
    if (id) returnToTray(id)
    setDragId(null)
  }

  /* -------- click handlers ----------------------------------------- */

  function handleItemClick(itemId: string, currentBin: string | null) {
    if (disabled) return
    if (selectedId === itemId) {
      // Deselect
      setSelectedId(null)
      return
    }
    if (selectedId !== null) {
      // Clicking anything inside a bin while holding a selection drops the
      // selection into that bin; clicking another tray item switches selection.
      if (currentBin !== null) placeItem(selectedId, currentBin)
      else setSelectedId(itemId)
      return
    }
    if (currentBin !== null) {
      // Click placed item → return to tray
      returnToTray(itemId)
    } else {
      setSelectedId(itemId)
    }
  }

  function handleBinClick(binId: string) {
    if (disabled || !selectedId) return
    placeItem(selectedId, binId)
  }

  /* -------- reveal helpers ----------------------------------------- */

  function revealClass(itemId: string): string | undefined {
    if (!revealed || !solution) return undefined
    const correct = solution.bins[itemId]
    const placed = placements[itemId]
    if (placed === correct) return s.itemCorrect
    return s.itemWrong
  }

  /* -------- render --------------------------------------------------- */

  return (
    <div className={s.root}>
      {/* Unplaced tray */}
      <div
        className={cx(s.tray, dragOverBin === '__tray__' && s.trayDragOver)}
        onDragOver={handleTrayDragOver}
        onDragLeave={() => setDragOverBin(null)}
        onDrop={handleTrayDrop}
        aria-label="Unplaced items"
      >
        <span className={s.trayLabel}>
          {unplaced.length === 0 ? 'All items placed' : `${unplaced.length} unplaced`}
        </span>
        <div className={s.trayItems}>
          {unplaced.map((item) => (
            <div
              key={item.id}
              className={cx(
                s.item,
                selectedId === item.id && s.itemSelected,
                disabled && s.itemDisabled,
              )}
              draggable={!disabled}
              onDragStart={(e) => handleItemDragStart(e, item.id)}
              onDragEnd={() => setDragId(null)}
              onClick={() => handleItemClick(item.id, null)}
              role="button"
              tabIndex={disabled ? -1 : 0}
              aria-label={`${item.label}${selectedId === item.id ? ', selected' : ''}`}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleItemClick(item.id, null) }}
            >
              {item.label}
            </div>
          ))}
        </div>
      </div>

      {/* Bins */}
      <div className={s.bins}>
        {bins.map((bin) => {
          const binItems = items.filter((item) => placements[item.id] === bin.id)
          return (
            <div
              key={bin.id}
              className={cx(
                s.bin,
                dragOverBin === bin.id && s.binDragOver,
                selectedId !== null && !disabled && s.binClickable,
              )}
              onDragOver={(e) => handleBinDragOver(e, bin.id)}
              onDragLeave={handleBinDragLeave}
              onDrop={(e) => handleBinDrop(e, bin.id)}
              onClick={() => handleBinClick(bin.id)}
              role="region"
              aria-label={`Bin: ${bin.label}`}
            >
              <span className={s.binLabel}>{bin.label}</span>
              <div className={s.binItems}>
                {binItems.map((item) => (
                  <div
                    key={item.id}
                    className={cx(
                      s.item,
                      s.itemPlaced,
                      revealClass(item.id),
                      disabled && s.itemDisabled,
                    )}
                    draggable={!disabled}
                    onDragStart={(e) => handleItemDragStart(e, item.id)}
                    onDragEnd={() => setDragId(null)}
                    onClick={(e) => { e.stopPropagation(); handleItemClick(item.id, bin.id) }}
                    role="button"
                    tabIndex={disabled ? -1 : 0}
                    aria-label={`${item.label}, in ${bin.label}${revealed && solution ? (placements[item.id] === solution.bins[item.id] ? ', correct' : ', wrong') : ''}`}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); handleItemClick(item.id, bin.id) } }}
                  >
                    {item.label}
                    {revealed && solution && (
                      <span className={s.revealMark}>
                        {placements[item.id] === solution.bins[item.id] ? '✓' : `→ ${bins.find((b) => b.id === solution.bins[item.id])?.label ?? solution.bins[item.id]}`}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {selectedId !== null && !disabled && (
        <p className={s.hint}>
          Click a bin to place <b>{items.find((i) => i.id === selectedId)?.label}</b>
        </p>
      )}
    </div>
  )
}
