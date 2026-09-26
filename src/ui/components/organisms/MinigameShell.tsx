import type { ReactNode } from 'react'
import type {
  ClassifyGiven, ClassifySolution,
  DialGiven, DialSolution, EvidenceGiven, EvidenceSolution, FillBlankGiven,
  FillBlankSolution, LogHuntGiven, LogHuntSolution, MinigameAnswer, MinigameSession, MonitorGiven,
  MonitorSolution, PatchGiven,
  PatchSolution, SequenceGiven,
  SequenceSolution, TerminalGiven, TerminalSolution, WiringGiven, WiringSolution, WrongOutcome,
} from '../../types'
import { Button, DifficultyDots, SectionLabel } from '../atoms'
import { RevealPanel, TeachesCallout, WrongOutcomeCard } from '../molecules'
import { DialGame } from './DialGame'
import { EvidenceGame } from './EvidenceGame'
import { FillBlankGame } from './FillBlankGame'
import { PatchGame } from './PatchGame'
import { ClassifyGame } from './ClassifyGame'
import { MonitorGame } from './MonitorGame'
import { SequenceGame } from './SequenceGame'
import { LogHuntGame } from './LogHuntGame'
import { TerminalGame } from './TerminalGame'
import { WiringGame } from './WiringGame'
import { cx, formatDuration, formatMoney } from '../../utils/format'
import s from './MinigameShell.module.css'

export interface MinigameShellProps {
  session: MinigameSession
  onAnswerChange: (answer: MinigameAnswer) => void
  onSubmit: () => void
  onCancel: () => void
  /** Every wrong outcome so far, oldest first. */
  history?: readonly WrongOutcome[]
  /** Set once the answer was accepted. */
  solved?: boolean
}

const ATTEMPTS_BEFORE_REVEAL = 3

/**
 * The frame around every minigame, and the teaching loop itself.
 *
 * Retries are unlimited and each failed attempt pays `on_fail`. After the third
 * failure the solution and `reveal` are shown in full: the player still executes
 * the action and still pays the time cost, but nobody is ever permanently stuck
 * without learning the lesson.
 *
 * ENGINE NOTE: no floor exists yet on repeated-failure `on_fail` damage. A player
 * on attempt four is the one most in need of teaching rather than punishing, and
 * the cap belongs in the engine - not worked around in data by zeroing `on_fail`.
 */
export function MinigameShell({
  session,
  onAnswerChange,
  onSubmit,
  onCancel,
  history = [],
  solved,
}: MinigameShellProps) {
  const { instance, minigame, format, action, attempt, revealed } = session
  const showReveal = revealed || attempt > ATTEMPTS_BEFORE_REVEAL
  const locked = solved || showReveal

  return (
    <div className={s.root} role="dialog" aria-modal="true" aria-label={minigame.name}>
      {/* ---- header ------------------------------------------------------ */}
      <header className={s.head}>
        <div className={s.titleRow}>
          <h2 className={s.title}>{minigame.name}</h2>
          <DifficultyDots difficulty={action.difficulty} />
          <span className={s.format}>{format.name}</span>
          {session.aiText && (
            <span className={s.live} title="Text written for your live system by AI; the answer is unchanged">
              ✦ live
            </span>
          )}
        </div>
        <p className={s.via}>
          via <b>{action.name}</b> · {formatDuration(action.time_cost_s)} ·{' '}
          {action.money_cost === 0 ? 'free' : formatMoney(action.money_cost)}
          <span className={s.attempts}>
            try {attempt}
            {!showReveal && ` of ${ATTEMPTS_BEFORE_REVEAL} before the answer is shown`}
          </span>
        </p>
      </header>

      {/* ---- brief ------------------------------------------------------- */}
      <p className={s.brief}>{instance.brief}</p>

      {/* ---- the puzzle -------------------------------------------------- */}
      <section className={s.body}>{renderFormat(session, onAnswerChange, locked, showReveal)}</section>

      {/* ---- what went wrong so far -------------------------------------- */}
      {history.length > 0 && (
        <section className={s.history}>
          <SectionLabel rule aside={`${history.length}`}>
            What happened
          </SectionLabel>
          <div className={s.historyList}>
            {history.map((outcome, i) => (
              <WrongOutcomeCard key={i} outcome={outcome} attempt={i + 1} />
            ))}
          </div>
        </section>
      )}

      {/* ---- reveal / takeaway ------------------------------------------- */}
      {showReveal && (
        <section className={s.reveal}>
          <RevealPanel reveal={instance.reveal} solution={renderSolution(session)} />
        </section>
      )}

      {(solved || showReveal) && (
        <section className={s.teaches}>
          <TeachesCallout teaches={instance.teaches} earned={solved} />
        </section>
      )}

      {/* ---- commit ------------------------------------------------------ */}
      <footer className={s.foot}>
        <Button variant="quiet" onClick={onCancel}>
          back to the board
        </Button>
        <span className={s.footSpacer} />
        <span className={s.footNote}>
          {showReveal
            ? 'The fix applies even after seeing the answer - the action still runs.'
            : 'A wrong answer costs time and worsens the incident. You cannot be locked out.'}
        </span>
        <Button variant="primary" size="md" onClick={onSubmit} disabled={solved}>
          {showReveal ? 'Apply fix' : 'Submit'}
        </Button>
      </footer>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * Dispatch on the format id.
 *
 * The `given`/`solution` casts are the one place the type system cannot help: an
 * instance names a MINIGAME id, not a format id, so the schema cannot discriminate
 * the payload shape. `checkInstanceShapes` in src/validate/minigameChecks.ts is
 * what guarantees these keys exist, which is why `npm run validate` is not
 * optional before trusting this component with new data.
 */
function renderFormat(
  session: MinigameSession,
  onAnswerChange: (answer: MinigameAnswer) => void,
  locked: boolean,
  showReveal: boolean,
): ReactNode {
  const { instance, format, answer } = session
  const levers = instance.levers

  switch (format.id) {
    case 'ordered_sequence': {
      const given = instance.given as SequenceGiven
      const solution = instance.solution as SequenceSolution
      return (
        <SequenceGame
          given={given}
          order={answer.kind === 'ordered_sequence' ? answer.order : given.steps.map((_, i) => i)}
          onChange={(order) => onAnswerChange({ kind: 'ordered_sequence', order })}
          disabled={locked}
          revealedOrder={showReveal ? solution.order : undefined}
        />
      )
    }
    case 'fill_blank': {
      const given = instance.given as FillBlankGiven
      const solution = instance.solution as FillBlankSolution
      return (
        <FillBlankGame
          given={given}
          blanks={answer.kind === 'fill_blank' ? answer.blanks : {}}
          onChange={(blanks) => onAnswerChange({ kind: 'fill_blank', blanks })}
          inputMode={levers.input_mode === 'free_text' ? 'free_text' : 'pick_from_list'}
          disabled={locked}
          revealedBlanks={showReveal ? solution.blanks : undefined}
        />
      )
    }
    case 'dial': {
      const given = instance.given as DialGiven
      const solution = instance.solution as DialSolution
      return (
        <DialGame
          given={given}
          value={answer.kind === 'dial' ? answer.value : given.range.min}
          onChange={(value) => onAnswerChange({ kind: 'dial', value })}
          tableComplete={levers.table_complete !== false}
          disabled={locked}
          revealedValue={showReveal ? solution.value : undefined}
          tolerancePct={typeof levers.tolerance_pct === 'number' ? levers.tolerance_pct : 0}
        />
      )
    }
    case 'wiring': {
      const given = instance.given as WiringGiven
      const solution = instance.solution as WiringSolution
      return (
        <WiringGame
          given={given}
          zone={answer.kind === 'wiring' ? answer.zone : null}
          connectTo={answer.kind === 'wiring' ? answer.connectTo : []}
          onChange={(next) => onAnswerChange({ kind: 'wiring', ...next })}
          disabled={locked}
          // The schema field is `connect_to`; the component prop is camelCase.
          revealed={
            showReveal ? { zone: solution.zone, connectTo: solution.connect_to } : undefined
          }
        />
      )
    }
    case 'evidence': {
      const given = instance.given as EvidenceGiven
      const solution = instance.solution as EvidenceSolution
      return (
        <EvidenceGame
          given={given}
          solutionChoice={solution.choice}
          distractors={instance.distractors}
          choice={answer.kind === 'evidence' ? answer.choice : null}
          onChange={(choice) => onAnswerChange({ kind: 'evidence', choice })}
          seed={instance.id}
          disabled={locked}
          revealed={showReveal}
        />
      )
    }
    case 'terminal': {
      const given = instance.given as TerminalGiven
      const solution = instance.solution as TerminalSolution
      return (
        <TerminalGame
          given={given}
          solution={solution}
          text={answer.kind === 'terminal' ? answer.text : ''}
          onChange={(text) => onAnswerChange({ kind: 'terminal', text })}
          showPlaceholder={levers.show_placeholder === true}
          disabled={locked}
          revealed={showReveal}
        />
      )
    }
    case 'log_hunt': {
      const given = instance.given as LogHuntGiven
      const solution = instance.solution as LogHuntSolution
      return (
        <LogHuntGame
          given={given}
          solution={solution}
          line={answer.kind === 'log_hunt' ? answer.line : null}
          onChange={(line) => onAnswerChange({ kind: 'log_hunt', line })}
          searchEnabled={levers.search_enabled !== false}
          disabled={locked}
          revealed={showReveal}
        />
      )
    }
    case 'patch': {
      const given = instance.given as PatchGiven
      const solution = instance.solution as PatchSolution
      return (
        <PatchGame
          given={given}
          solution={solution}
          content={answer.kind === 'patch' ? answer.content : given.content}
          onChange={(content) => onAnswerChange({ kind: 'patch', content })}
          targetHighlighted={levers.target_highlighted === true}
          disabled={locked}
          revealed={showReveal}
        />
      )
    }
    case 'monitor': {
      const given = instance.given as MonitorGiven
      const sol = instance.solution as MonitorSolution
      return (
        <MonitorGame
          given={given}
          solution={sol}
          metric={answer.kind === 'monitor' ? answer.metric : null}
          t={answer.kind === 'monitor' ? answer.t : 0}
          onChange={({ metric, t }) => onAnswerChange({ kind: 'monitor', metric, t })}
          disabled={locked}
          revealed={showReveal}
          attemptKey={session.attempt}
        />
      )
    }
    case 'classify': {
      const given = instance.given as ClassifyGiven
      const sol = instance.solution as ClassifySolution
      return (
        <ClassifyGame
          given={given}
          placements={answer.kind === 'classify' ? answer.placements : {}}
          onChange={(placements) => onAnswerChange({ kind: 'classify', placements })}
          disabled={locked}
          revealed={showReveal}
          solution={showReveal ? sol : undefined}
        />
      )
    }
  }
}

/** The solution, rendered for RevealPanel in each format's own terms. */
function renderSolution(session: MinigameSession): ReactNode {
  const { instance, format } = session
  switch (format.id) {
    case 'ordered_sequence': {
      const given = instance.given as SequenceGiven
      const solution = instance.solution as SequenceSolution
      return (
        <ol className={s.solutionList}>
          {solution.order.map((i, n) => (
            <li key={i}>
              <span className={s.solutionOrdinal}>{n + 1}</span>
              {given.steps[i]}
            </li>
          ))}
        </ol>
      )
    }
    case 'fill_blank': {
      const solution = instance.solution as FillBlankSolution
      return (
        <ul className={s.solutionList}>
          {Object.entries(solution.blanks).map(([key, value]) => (
            <li key={key}>
              <span className={s.solutionOrdinal}>{key}</span>
              <code className={s.solutionCode}>{value}</code>
            </li>
          ))}
        </ul>
      )
    }
    case 'dial': {
      const given = instance.given as DialGiven
      const solution = instance.solution as DialSolution
      return (
        <p className={s.solutionValue}>
          {solution.value.toLocaleString('en-US')} <span className={s.solutionUnit}>{given.unit}</span>
        </p>
      )
    }
    case 'wiring': {
      const given = instance.given as WiringGiven
      const solution = instance.solution as WiringSolution
      const label = (id: string) => given.nodes.find((n) => n.id === id)?.label ?? id
      return (
        <p className={s.solutionValue}>
          {given.place.label} in <b>{solution.zone}</b>, connected to{' '}
          <b>{solution.connect_to.map(label).join(' and ')}</b>
        </p>
      )
    }
    case 'evidence': {
      const solution = instance.solution as EvidenceSolution
      return <p className={cx(s.solutionValue, s.solutionText)}>{solution.choice}</p>
    }
    case 'terminal': {
      const given = instance.given as TerminalGiven
      const solution = instance.solution as TerminalSolution
      return (
        <code className={s.solutionCode}>
          $ {given.prefix}{solution.accepts[0]}
        </code>
      )
    }
    case 'log_hunt': {
      const given = instance.given as LogHuntGiven
      const solution = instance.solution as LogHuntSolution
      const answerLine = given.lines[solution.line - 1]
      return (
        <p className={cx(s.solutionValue, s.solutionText)}>
          Line {solution.line}: [{answerLine?.level}] {answerLine?.text}
        </p>
      )
    }
    case 'patch': {
      const given = instance.given as PatchGiven
      const solution = instance.solution as PatchSolution
      const origLine = given.content.split('\n')[solution.line - 1] ?? ''
      return (
        <>
          <p className={s.solutionValue}>
            Line {solution.line} — before: <code className={s.solutionCode}>{origLine.trim()}</code>
          </p>
          <p className={s.solutionValue}>
            Line {solution.line} — after contains: <code className={s.solutionCode}>{solution.must_contain.join(', ')}</code>
          </p>
        </>
      )
    }
    case 'monitor': {
      const given = instance.given as MonitorGiven
      const solution = instance.solution as MonitorSolution
      const m = given.metrics.find((x) => x.id === solution.metric)
      return (
        <p className={s.solutionValue}>
          Click <b>{m?.label ?? solution.metric}</b> ({m?.unit ?? ''}) when it crosses{' '}
          <b>{solution.direction}</b> <b>{solution.threshold}</b> — window is {solution.window_s} s wide
        </p>
      )
    }
    case 'classify': {
      const given = instance.given as ClassifyGiven
      const solution = instance.solution as ClassifySolution
      const binLabel = (id: string) => given.bins.find((b) => b.id === id)?.label ?? id
      return (
        <ul className={s.solutionList}>
          {given.items.map((item) => (
            <li key={item.id}>
              <span className={s.solutionOrdinal}>{item.label}</span>
              → <b>{binLabel(solution.bins[item.id])}</b>
            </li>
          ))}
        </ul>
      )
    }
  }
}
