'use client';

/**
 * Motion — framer-motion client primitives for the pilotage UI.
 * ---------------------------------------------------------------------------
 * These are the JS-driven counterpart to the pure-CSS animation utilities in
 * `globals.css` (.page-transition, .stagger-N, …). Because they are `'use client'`
 * they can still be rendered *from server components* (children pass through the
 * server/client boundary), so pages keep their server-side `api()` data fetching
 * while gaining rich entrance / scroll / hover / count-up animations.
 *
 * Every primitive honours `prefers-reduced-motion` via `useReducedMotion()`.
 */

import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  animate,
  motion,
  useInView,
  useReducedMotion,
  type Variants,
} from 'framer-motion';

import { cn } from '../lib/cn';

/** Shared easing — mirrors the `--ease-out` design token. Typed as a mutable
 * bezier tuple so framer-motion's `ease` prop accepts it (a `readonly` tuple
 * from `as const` would not be assignable). */
const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

/* ───────────────────────── FadeIn ───────────────────────── */

export interface FadeInProps {
  children: ReactNode;
  className?: string;
  /** Delay before the animation starts (seconds). */
  delay?: number;
  /** Vertical travel distance (px). Positive = rises from below. */
  y?: number;
  /** Horizontal travel distance (px). */
  x?: number;
  /** Duration (seconds). */
  duration?: number;
}

/** Fade + translate in on mount. The workhorse entrance wrapper. */
export function FadeIn({ children, className, delay = 0, y = 12, x = 0, duration = 0.4 }: FadeInProps) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y, x }}
      animate={{ opacity: 1, y: 0, x: 0 }}
      transition={{ duration, delay, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}

/* ───────────────────────── Stagger ───────────────────────── */

const staggerContainer = (stagger: number, delayChildren: number): Variants => ({
  hidden: {},
  visible: { transition: { staggerChildren: stagger, delayChildren } },
});

const staggerItemVariants: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.42, ease: EASE_OUT } },
};

export interface StaggerProps {
  children: ReactNode;
  className?: string;
  /** Seconds between each child entrance. */
  stagger?: number;
  /** Initial delay before the first child (seconds). */
  delayChildren?: number;
}

/**
 * Orchestrates a staggered entrance for its `StaggerItem` descendants.
 * Variant state propagates through React context, so items may sit inside
 * intermediate wrappers (e.g. a grid) and still animate in sequence.
 */
export function Stagger({ children, className, stagger = 0.06, delayChildren = 0.04 }: StaggerProps) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      variants={staggerContainer(stagger, delayChildren)}
      initial="hidden"
      animate="visible"
    >
      {children}
    </motion.div>
  );
}

export interface StaggerItemProps {
  children: ReactNode;
  className?: string;
}

/** A single staggered child. Must be rendered under a `Stagger`. */
export function StaggerItem({ children, className }: StaggerItemProps) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div className={className} variants={staggerItemVariants}>
      {children}
    </motion.div>
  );
}

/* ───────────────────────── Reveal (scroll-triggered) ───────────────────────── */

export interface RevealProps {
  children: ReactNode;
  className?: string;
  y?: number;
  delay?: number;
  /** Animate only the first time it enters the viewport (default true). */
  once?: boolean;
}

/** Fades content in when it scrolls into view. */
export function Reveal({ children, className, y = 18, delay = 0, once = true }: RevealProps) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once, margin: '-60px' });
  return (
    <motion.div
      ref={ref}
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      animate={inView || reduce ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.5, delay, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}

/* ───────────────────────── HoverLift ───────────────────────── */

export interface HoverLiftProps {
  children: ReactNode;
  className?: string;
  /** Hover scale factor. */
  scale?: number;
  /** Hover lift distance (px). */
  lift?: number;
}

/** Springy hover lift + tap feedback for interactive tiles/cards. */
export function HoverLift({ children, className, scale = 1.02, lift = 4 }: HoverLiftProps) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      whileHover={{ y: -lift, scale }}
      whileTap={{ scale: 0.99 }}
      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
    >
      {children}
    </motion.div>
  );
}

/* ───────────────────────── PageTransition ───────────────────────── */

export interface PageTransitionProps {
  children: ReactNode;
  className?: string;
}

/**
 * Re-runs an entrance animation on every route change. Keyed by pathname so the
 * subtree remounts on navigation — no AnimatePresence exit pitfalls in the App
 * Router. Drop around the main content region (sidebar/topbar stay put).
 */
export function PageTransition({ children, className }: PageTransitionProps) {
  const pathname = usePathname();
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      key={pathname}
      className={className}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}

/* ───────────────────────── AnimatedNumber (count-up) ───────────────────────── */

export interface AnimatedNumberProps {
  value: number;
  /** Custom formatter for both the animated frames and the final value. */
  format?: (n: number) => string;
  /** Decimal places when no custom `format` is supplied. */
  decimals?: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  className?: string;
}

const defaultNumberFormat = (decimals: number) => {
  const nf = new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return (n: number) => nf.format(n);
};

/**
 * Counts up from 0 to `value` the first time it scrolls into view.
 * SSR-safe: the real value is rendered server-side / on first paint, so the
 * number is correct even before JS hydrates (then it briefly resets and counts).
 */
export function AnimatedNumber({
  value,
  format,
  decimals = 0,
  prefix = '',
  suffix = '',
  duration = 1.1,
  className,
}: AnimatedNumberProps) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  const fmt = format ?? defaultNumberFormat(decimals);
  const [text, setText] = useState(() => fmt(value));

  useEffect(() => {
    if (reduce) {
      setText(fmt(value));
      return;
    }
    if (!inView) return;
    const controls = animate(0, value, {
      duration,
      ease: EASE_OUT,
      onUpdate: (latest) => setText(fmt(latest)),
    });
    return () => controls.stop();
    // fmt is recreated each render; value/inView are the real triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, value, duration, reduce]);

  return (
    <span ref={ref} className={cn('tabular-nums', className)}>
      {prefix}
      {text}
      {suffix}
    </span>
  );
}
