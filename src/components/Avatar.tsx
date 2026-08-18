/**
 * Minecraft skin renders. Plain <img> on purpose: these are tiny pixel-art PNGs already sized
 * by the proxy, so next/image would add remote-pattern config and re-encoding for no gain.
 * `pixelated` keeps the blocky edges crisp instead of smearing them.
 */

export function Head({
  name,
  size = 28,
  className = '',
}: {
  name: string
  size?: number
  className?: string
}) {
  return (
    <img
      src={`/api/skin/head/${encodeURIComponent(name)}?s=${size * 2}`}
      width={size}
      height={size}
      alt=""
      aria-hidden
      loading="lazy"
      draggable={false}
      className={`shrink-0 rounded-md ring-1 ring-white/70 ${className}`}
      style={{ imageRendering: 'pixelated', width: size, height: size }}
    />
  )
}

export function Body({
  name,
  height = 160,
  className = '',
}: {
  name: string
  height?: number
  className?: string
}) {
  return (
    <img
      src={`/api/skin/body/${encodeURIComponent(name)}?s=${Math.round(height * 1.6)}`}
      alt={`${name} 的皮肤`}
      loading="lazy"
      draggable={false}
      className={className}
      style={{
        height,
        width: 'auto',
        imageRendering: 'pixelated',
        filter: 'drop-shadow(0 12px 16px rgba(31,38,135,0.18))',
      }}
    />
  )
}
