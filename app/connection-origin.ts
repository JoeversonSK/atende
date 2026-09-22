export function connectionOrigin(saved: string | undefined, origin: string): string {
  if (!saved || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]):2785\/?$/i.test(saved)) return origin;
  return saved;
}
