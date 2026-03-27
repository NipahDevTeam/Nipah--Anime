import { useEffect, useRef, useState } from 'react'
import { decode } from 'blurhash'

function drawBlurhash(canvas, hash) {
  if (!canvas || !hash) return
  const width = 32
  const height = 48
  const pixels = decode(hash, width, height)
  const ctx = canvas.getContext('2d')
  const imageData = ctx.createImageData(width, height)
  imageData.data.set(pixels)
  canvas.width = width
  canvas.height = height
  ctx.putImageData(imageData, 0, 0)
}

export default function BlurhashImage({
  src,
  blurhash,
  alt = '',
  className = '',
  imgClassName = '',
  placeholderClassName = '',
  onLoad,
}) {
  const [loaded, setLoaded] = useState(false)
  const canvasRef = useRef(null)

  useEffect(() => {
    setLoaded(false)
  }, [src])

  useEffect(() => {
    if (!blurhash) return
    drawBlurhash(canvasRef.current, blurhash)
  }, [blurhash])

  return (
    <div className={className} style={{ position: 'relative', overflow: 'hidden' }}>
      {!loaded && blurhash && (
        <canvas
          ref={canvasRef}
          className={placeholderClassName}
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            filter: 'blur(18px) saturate(1.1)',
            transform: 'scale(1.08)',
          }}
        />
      )}
      {src ? (
        <img
          src={src}
          alt={alt}
          className={imgClassName}
          onLoad={(event) => {
            setLoaded(true)
            onLoad?.(event)
          }}
          style={{
            opacity: loaded ? 1 : 0,
            transition: 'opacity 240ms ease',
          }}
        />
      ) : null}
    </div>
  )
}
