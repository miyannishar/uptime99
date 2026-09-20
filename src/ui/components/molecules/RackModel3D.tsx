import type { LedState } from '../atoms'
import { Led } from '../atoms'
import { cx } from '../../utils/format'
import s from './RackModel3D.module.css'

export interface RackModel3DProps {
  /** One entry per sled, top to bottom. Length sets the rack height. */
  sleds: readonly LedState[]
  /** Tints the chassis, e.g. red while the node is down. */
  alarm?: boolean
}

/**
 * The 3D object in the node inspector - CSS 3D transforms, no engine, no assets.
 *
 * DECORATIVE BY CONTRACT. It restates facts the inspector already prints in
 * text, and it is removed entirely in FLAT mode via `--rack-display`. Nothing
 * may be encoded here alone: if a sled is dead, the inspector says "sled 2
 * failed" in words as well. It is also `aria-hidden`, so assistive tech skips it
 * and loses nothing.
 */
export function RackModel3D({ sleds, alarm }: RackModel3DProps) {
  return (
    <div className={s.stage} aria-hidden="true">
      <div className={cx(s.rack, alarm && s.alarm)}>
        <div className={cx(s.face, s.top)} />
        <div className={cx(s.face, s.side)} />
        <div className={cx(s.face, s.front)}>
          {sleds.map((state, i) => (
            <div key={i} className={cx(s.sled, state === 'bad' && s.dead)}>
              <Led state={state} delayMs={i * 140} />
              <Led state={state === 'ok' ? 'off' : state} delayMs={i * 140 + 70} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
