import { useEffect, useRef, useState } from 'react'
import { ZONE_IDS, type ZoneId } from '@/domain/params'

type Deploy = Record<ZoneId, number>

const SPEED_PER_MS = 1 / 900

/** Eases each zone toward its target, or jumps there when motion is reduced. */
export function useDeploy(target: Deploy) {
  const [deploy, setDeploy] = useState(target)
  const current = useRef(target)
  const signature = ZONE_IDS.map((z) => target[z]).join()

  useEffect(() => {
    const goal = target
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      current.current = goal
      setDeploy(goal)
      return
    }
    let frame = 0
    let last = performance.now()
    const tick = (now: number) => {
      const step = (now - last) * SPEED_PER_MS
      last = now
      const next = { ...current.current }
      let moving = false
      for (const z of ZONE_IDS) {
        const delta = goal[z] - next[z]
        next[z] = Math.abs(delta) <= step ? goal[z] : next[z] + Math.sign(delta) * step
        if (next[z] !== goal[z]) moving = true
      }
      current.current = next
      setDeploy(next)
      if (moving) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  return deploy
}
