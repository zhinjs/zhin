import { cn, pickMediaRawUrl, resolveMediaSrc } from '@zhin.js/client'
import type { ReceivedMessage } from './types'

export function MessageBody({ content }: { content: ReceivedMessage['content'] }) {
  return (
    <>
      {content.map((seg, i) => {
        const d = (seg.data ?? {}) as Record<string, unknown>

        if (seg.type === 'text' && d.text != null)
          return <span key={i}>{String(d.text)}</span>

        if (seg.type === 'at')
          return (
            <span key={i} className="im-at font-medium">
              @{String(d.name ?? d.qq ?? '')}
            </span>
          )

        if (seg.type === 'face')
          return (
            <img
              key={i}
              src={`https://face.viki.moe/apng/${d.id}.png`}
              alt=""
              className="w-6 h-6 inline-block align-middle mx-0.5"
            />
          )

        if (seg.type === 'image') {
          const raw = pickMediaRawUrl(d)
          const src = resolveMediaSrc(raw, 'image')
          if (!src)
            return (
              <span key={i} className="text-muted-foreground text-xs">
                [图片]
              </span>
            )
          return (
            <div key={i} className="my-1.5 block w-full max-w-full">
              <a href={src} target="_blank" rel="noreferrer" className="inline-block max-w-full">
                <img
                  src={src}
                  alt=""
                  className={cn(
                    'max-w-[min(280px,88vw)] max-h-64 rounded-lg border border-border/50 object-contain bg-muted/20',
                  )}
                  onError={(e) => {
                    ;(e.target as HTMLImageElement).style.display = 'none'
                  }}
                />
              </a>
            </div>
          )
        }

        if (seg.type === 'video') {
          const raw = pickMediaRawUrl(d)
          const src = resolveMediaSrc(raw, 'video')
          if (!src)
            return (
              <span key={i} className="text-muted-foreground text-xs">
                [视频]
              </span>
            )
          return (
            <div key={i} className="my-1.5 w-full max-w-full">
              <video
                src={src}
                controls
                playsInline
                preload="metadata"
                className="max-w-[min(320px,92vw)] max-h-72 rounded-lg border border-border/50 bg-black/10"
              />
            </div>
          )
        }

        if (seg.type === 'audio' || seg.type === 'record') {
          const raw = pickMediaRawUrl(d)
          const src = resolveMediaSrc(raw, 'audio')
          if (!src)
            return (
              <span key={i} className="text-muted-foreground text-xs">
                [语音]
              </span>
            )
          return (
            <div key={i} className="my-1.5 w-full max-w-[min(320px,100%)]">
              <audio src={src} controls preload="metadata" className="w-full h-9" />
            </div>
          )
        }

        if (seg.type === 'file')
          return (
            <span key={i} className="text-muted-foreground text-xs">
              📎 {String(d.name ?? '文件')}
            </span>
          )

        return (
          <span key={i} className="text-muted-foreground text-xs">
            [{seg.type}]
          </span>
        )
      })}
    </>
  )
}
