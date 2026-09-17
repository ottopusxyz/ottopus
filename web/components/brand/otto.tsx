import { POSES, type PoseName } from './otto-poses'
import { cn } from '@/lib/cn'

const INK = '#16213E'
const CREAM = '#FFF0DC'

/** Suckers on the front arm, and on the raised arm when a pose tastes. */
const FRONT_SUCKERS: [number, number][] = [
  [53, 140],
  [54, 152],
  [64, 160],
  [77, 162],
]

export interface OttoProps {
  pose?: PoseName
  /** Pixel size of the square. The design system: badge below 32px, not Otto. */
  size?: number
  /**
   * Drops the navy outline and draws arms in the body colour. For dense or very
   * small placements; the design system wants the outline on every Otto ≤200px,
   * so this is the exception rather than a style choice.
   */
  flat?: boolean
  /** Arms sway and eyes blink. Off by default — motion is opt-in. */
  animated?: boolean
  /** Accessible name. Omit for decoration beside text that already says it. */
  label?: string
  className?: string
}

/**
 * Otto.
 *
 * Parts are marked with data attributes rather than ids: several Ottos share a
 * page, and duplicate ids would make any document-level selector or animation
 * hit only the first one. Query [data-arm="3"] rather than #arm-3.
 *
 * Body colour comes from --ot-coral, so he adapts to dark mode with the rest of
 * the palette rather than being pinned to the light-mode coral. The navy edge
 * and the cream underside are fixed, exactly as the design project has them —
 * they read against the body, not against the page.
 *
 * Each arm is stroked twice: a wide navy edge, then a narrower body-coloured
 * core over it. That is what produces the outlined look, and it is why an arm
 * is a group rather than a path — the group is what rotates.
 */
export function Otto({
  pose = 'base',
  size = 150,
  flat = false,
  animated = false,
  label,
  className,
}: OttoProps) {
  const art = POSES[pose]
  const body = 'var(--ot-coral)'
  const shade = 'var(--ot-coral-shade)'
  const edge = flat ? body : INK
  const outline = flat ? 'none' : INK

  const arm = (d: string, i: number, wide: number, narrow: number) => (
    <g
      key={`${d}-${i}`}
      data-arm={i + 1}
      className={animated ? 'otto-arm' : undefined}
      style={animated ? { animationDelay: `${-0.35 * i}s` } : undefined}
    >
      <path d={d} fill="none" stroke={edge} strokeWidth={wide} strokeLinecap="round" />
      <path d={d} fill="none" stroke={body} strokeWidth={narrow} strokeLinecap="round" />
    </g>
  )

  return (
    <svg
      viewBox="-22 -22 244 244"
      width={size}
      height={size}
      className={cn('block overflow-visible', className)}
      role={label ? 'img' : 'presentation'}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <g data-otto="">
        {art.arms.map((d, i) => arm(d, i, 30, 18))}

        <g data-part="body">
          <path
            d="M100,24 C57,24 30,54 30,98 C30,126 52,146 100,146 C148,146 170,126 170,98 C170,54 143,24 100,24 Z"
            fill={body}
            stroke={outline}
            strokeWidth={7}
          />
          <path
            d="M30 100 C30 130 54 146 100 146 C146 146 170 130 170 100 C170 118 150 133 100 133 C50 133 30 118 30 100 Z"
            fill={shade}
          />
          <ellipse cx="100" cy="131" rx="45" ry="13" fill={CREAM} />
        </g>

        {arm(art.frontArm, 7, 28, 17)}
        {art.suckers ? (
          <g fill={CREAM}>
            {FRONT_SUCKERS.map(([cx, cy]) => (
              <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={3.1} />
            ))}
          </g>
        ) : null}

        <g data-part="eyes">
          <circle cx="79" cy="76" r={art.eyeR ?? 17} fill="#fff" stroke={outline} strokeWidth={5} />
          <circle cx="121" cy="76" r={art.eyeR ?? 17} fill="#fff" stroke={outline} strokeWidth={5} />
          {art.pupils ? (
            <g data-part="pupils" className={animated ? 'otto-look' : undefined}>
              {art.pupils.map(([cx, cy, r]) => (
                <circle key={`p-${cx}`} cx={cx} cy={cy} r={r} fill={INK} />
              ))}
              {art.glints?.map(([cx, cy]) => (
                <circle key={`g-${cx}`} cx={cx} cy={cy} r={3} fill="#fff" />
              ))}
            </g>
          ) : null}
        </g>

        <g
          data-part="face"
          fill="none"
          stroke={INK}
          strokeWidth={art.faceWidth ?? 5}
          strokeLinecap="round"
        >
          {art.face.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
      </g>
    </svg>
  )
}

export { POSE_NAMES, type PoseName } from './otto-poses'
