/**
 * dice.ts — Utilidades de dados
 * El juego usa d10 (1-10). El "0" en un d10 físico = 10.
 */

/** Lanza un d10 y devuelve un valor entre 1 y 10. */
export function rollD10(): number {
  return Math.floor(Math.random() * 10) + 1
}

/** Lanza N d10 y devuelve todos los resultados. */
export function rollND10(n: number): number[] {
  return Array.from({ length: n }, rollD10)
}
