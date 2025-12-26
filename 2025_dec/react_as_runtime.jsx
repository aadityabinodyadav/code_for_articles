import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

type LoadState = 'loading' | 'ok' | 'not_found' | 'error'

const MIRROR_PREFIX = '/doa'
const MIRROR_MARK = 'data-mirror'
const MIRROR_MARK_VALUE = 'doa'

const loadedScriptSrc = new Set<string>()

type CalendarFunctions = {
  getBsDateByAdDate: (adYear: number, adMonth: number, adDay: number) => {
    bsYear: number
    bsMonth: number
    bsDate: number
  }
  bsDateFormat: (format: string, bsYear: number, bsMonth: number, bsDay: number) => string
}

type JQueryNiceSelect = ((selector: string) => { niceSelect: (command: string) => unknown }) & {
  fn?: { niceSelect?: unknown }
}

function getCookie(name: string) {
  const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`))
  return match ? match[2] : null
}

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=31536000`
}

function isReloadableScriptSrc(src: string) {
  return (
    src.startsWith(`${MIRROR_PREFIX}/_assets/giwmscdnone.gov.np/`) ||
    src.startsWith(`${MIRROR_PREFIX}/_assets/doa.gov.np/`) ||
    src.startsWith(`${MIRROR_PREFIX}/_assets/www.doa.gov.np/`)
  )
}

function applyPreferredLanguage(root: ParentNode) {
  const preferred = getCookie('preferred_language') || 'ne'

  root.querySelectorAll('#language-select').forEach((el) => {
    if (!(el instanceof HTMLSelectElement)) return
    el.value = preferred
    if (!(el as unknown as { dataset?: Record<string, string> }).dataset) return
  })

  const w = window as unknown as { $?: JQueryNiceSelect }
  const $ = w.$
  if ($?.fn?.niceSelect) {
    try {
      $('#language-select').niceSelect('update')
    } catch (err) {
      void err
    }
  }

  root.querySelectorAll('.translate-title').forEach((node) => {
    if (!(node instanceof HTMLElement)) return
    const nepaliText = node.getAttribute('data-custom-nepalitext') || ''
    const englishText = node.getAttribute('data-custom-englishtext') || ''
    const h3 = node.querySelector('h3')
    if (!h3) return
    if (preferred === 'en' && englishText) h3.textContent = englishText
    if (preferred !== 'en' && nepaliText) h3.textContent = nepaliText
  })

  const dateEl = root.querySelector('#nepaliDateBs')
  if (dateEl) {
    const now = new Date()
    if (preferred === 'en') {
      const text = now.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Kathmandu',
        hour12: false,
      })
      dateEl.textContent = text.replace('at', ',')
    } else {
      const anyWindow = window as unknown as { calendarFunctions?: CalendarFunctions }
      const calendarFunctions = anyWindow.calendarFunctions
      if (calendarFunctions?.getBsDateByAdDate && calendarFunctions?.bsDateFormat) {
        const nepaliWeekdays = ['आइतबार', 'सोमबार', 'मंगलबार', 'बुधबार', 'बिहीबार', 'शुक्रबार', 'शनिबार']
        const nepaliDigits = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९']
        const convertToNepaliDigits = (n: string) => n.split('').map((d) => nepaliDigits[Number(d)] ?? d).join('')
        const bs = calendarFunctions.getBsDateByAdDate(now.getFullYear(), now.getMonth() + 1, now.getDate())
        const formatted = calendarFunctions.bsDateFormat('%y %M %d गते %D', bs.bsYear, bs.bsMonth, bs.bsDate)
        const parts = formatted.split(' ')
        parts[parts.length - 1] = nepaliWeekdays[now.getDay()]
        const timeFormatter = new Intl.DateTimeFormat('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone: 'Asia/Kathmandu',
        })
        const p = timeFormatter.formatToParts(now)
        const hour = p.find((x) => x.type === 'hour')?.value ?? '00'
        const minute = p.find((x) => x.type === 'minute')?.value ?? '00'
        dateEl.textContent = `${parts.join(' ')}, ${convertToNepaliDigits(hour)}:${convertToNepaliDigits(minute)} बजे`
      }
    }
  }
}

function normalizePathname(pathname: string) {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1)
  return pathname
}

function candidatesForPathLang(pathname: string, lang: 'ne' | 'en') {
  const normalized = normalizePathname(pathname)
  const base = `${MIRROR_PREFIX}/${lang}`

  if (normalized === '/') return [`${base}/index.html`, `${MIRROR_PREFIX}/index.html`]

  return [
    `${base}${normalized}/index.html`,
    `${base}${normalized}.html`,
    `${base}${normalized}/`,
    `${MIRROR_PREFIX}${normalized}/index.html`,
    `${MIRROR_PREFIX}${normalized}.html`,
    `${MIRROR_PREFIX}${normalized}/`,
  ]
}

function removeMarkedElements(root: ParentNode) {
  root.querySelectorAll(`[${MIRROR_MARK}="${MIRROR_MARK_VALUE}"]`).forEach((n) => n.remove())
}

function shouldHandleAsSpaNavigation(anchor: HTMLAnchorElement, currentOrigin: string) {
  if (anchor.target && anchor.target !== '_self') return false
  if (anchor.hasAttribute('download')) return false
  const href = anchor.getAttribute('href')?.trim() ?? ''
  if (href === '') return false
  if (href.startsWith('#')) return false
  if (href.startsWith('mailto:')) return false
  if (href.startsWith('tel:')) return false
  if (href.startsWith('javascript:')) return false
  const url = new URL(href, currentOrigin)
  return url.origin === currentOrigin
}

async function loadHtmlFromCandidates(candidateUrls: string[]) {
  let lastStatus: number | null = null
  for (const url of candidateUrls) {
    const res = await fetch(url, { cache: 'no-cache' })
    lastStatus = res.status
    if (res.ok) return { url, html: await res.text() }
  }
  return { url: candidateUrls[0], html: null, lastStatus }
}

function extractHeadResources(doc: Document) {
  const head = doc.head
  const styles = [...head.querySelectorAll('link[rel="stylesheet"][href]')].map((el) => ({
    href: el.getAttribute('href') ?? '',
    media: el.getAttribute('media'),
  }))
  const inlineStyles = [...head.querySelectorAll('style')].map((el) => el.textContent ?? '')
  const scripts = [...doc.querySelectorAll('script')].map((el) => ({
    type: el.getAttribute('type') ?? '',
    src: el.getAttribute('src'),
    async: el.hasAttribute('async'),
    defer: el.hasAttribute('defer'),
    text: el.getAttribute('src') ? null : el.textContent ?? '',
  }))
  return { styles, inlineStyles, scripts }
}

function applyHeadResources(resources: ReturnType<typeof extractHeadResources>) {
  removeMarkedElements(document.head)

  for (const style of resources.styles) {
    if (!style.href) continue
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = style.href
    if (style.media) link.media = style.media
    link.setAttribute(MIRROR_MARK, MIRROR_MARK_VALUE)
    document.head.appendChild(link)
  }

  for (const cssText of resources.inlineStyles) {
    if (!cssText) continue
    const style = document.createElement('style')
    style.textContent = cssText
    style.setAttribute(MIRROR_MARK, MIRROR_MARK_VALUE)
    document.head.appendChild(style)
  }
}

async function applyScripts(resources: ReturnType<typeof extractHeadResources>) {
  removeMarkedElements(document.body)

  for (const s of resources.scripts) {
    const type = s.type.trim()
    if (type && type !== 'text/javascript' && type !== 'module') continue

    if (s.src && !isReloadableScriptSrc(s.src) && loadedScriptSrc.has(s.src)) continue

    const script = document.createElement('script')
    if (s.type) script.type = s.type
    if (s.src) script.src = s.src
    if (s.async) script.async = true
    if (s.defer) script.defer = true
    if (!s.src && s.text) script.text = s.text
    script.setAttribute(MIRROR_MARK, MIRROR_MARK_VALUE)

    const shouldAwait = Boolean(s.src) && !s.async

    const done = shouldAwait
      ? new Promise<void>((resolve) => {
          script.onload = () => resolve()
          script.onerror = () => resolve()
        })
      : Promise.resolve()

    document.body.appendChild(script)
    if (s.src && !isReloadableScriptSrc(s.src)) loadedScriptSrc.add(s.src)
    await done
  }
}

export default function MirroredPage() {
  const { pathname, hash } = useLocation()
  const navigate = useNavigate()
  const containerRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [errorText, setErrorText] = useState<string | null>(null)
  const [lang, setLang] = useState<'ne' | 'en'>(() => (getCookie('preferred_language') === 'en' ? 'en' : 'ne'))

  const candidates = useMemo(() => candidatesForPathLang(pathname, lang), [pathname, lang])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    function handleClick(e: MouseEvent) {
      if (e.defaultPrevented) return
      if (e.button !== 0) return
      if (e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return
      const target = e.target
      if (!(target instanceof Element)) return
      const anchor = target.closest('a')
      if (!(anchor instanceof HTMLAnchorElement)) return
      if (!shouldHandleAsSpaNavigation(anchor, window.location.origin)) return
      e.preventDefault()
      const url = new URL(anchor.href)
      navigate(`${url.pathname}${url.search}${url.hash}`)
    }

    function handleChange(e: Event) {
      const target = e.target
      if (!(target instanceof HTMLSelectElement)) return
      if (target.id !== 'language-select') return
      const next = target.value === 'en' ? 'en' : 'ne'
      setCookie('preferred_language', next)
      setLang(next)
      applyPreferredLanguage(document)
      const anyWindow = window as unknown as { updateDate?: () => void }
      if (typeof anyWindow.updateDate === 'function') {
        try {
          anyWindow.updateDate()
        } catch (err) {
          void err
        }
      }
    }

    container.addEventListener('click', handleClick)
    container.addEventListener('change', handleChange)

    return () => {
      container.removeEventListener('click', handleClick)
      container.removeEventListener('change', handleChange)
    }
  }, [navigate])

  useEffect(() => {
    let cancelled = false

    async function run() {
      setState('loading')
      setErrorText(null)

      const container = containerRef.current
      if (!container) return

      const result = await loadHtmlFromCandidates(candidates)
      if (cancelled) return

      if (!result.html) {
        setState(result.lastStatus === 404 ? 'not_found' : 'error')
        return
      }

      const parser = new DOMParser()
      const doc = parser.parseFromString(result.html, 'text/html')
      document.title = doc.title || 'DOA'
      document.documentElement.lang = doc.documentElement.lang || document.documentElement.lang || 'en'

      const resources = extractHeadResources(doc)
      applyHeadResources(resources)

      doc.body.querySelectorAll('script').forEach((s) => s.remove())
      container.innerHTML = doc.body.innerHTML
      await applyScripts(resources)

      if (cancelled) return
      setState('ok')

      applyPreferredLanguage(document)
      const anyWindow = window as unknown as { updateDate?: () => void }
      if (typeof anyWindow.updateDate === 'function') {
        try {
          anyWindow.updateDate()
        } catch (err) {
          void err
        }
      }
      setTimeout(() => {
        applyPreferredLanguage(document)
        if (typeof anyWindow.updateDate === 'function') {
          try {
            anyWindow.updateDate()
          } catch (err) {
            void err
          }
        }
      }, 0)

      if (hash) {
        const id = hash.startsWith('#') ? hash.slice(1) : hash
        const target = document.getElementById(id) ?? document.querySelector(`[name="${CSS.escape(id)}"]`)
        if (target && 'scrollIntoView' in target) target.scrollIntoView()
      } else {
        window.scrollTo({ top: 0 })
      }
    }

    run().catch((err) => {
      if (cancelled) return
      setErrorText(err?.message ?? String(err))
      setState('error')
    })

    return () => {
      cancelled = true
    }
  }, [candidates, hash])

  if (state === 'not_found') {
    return (
      <div className="min-h-screen bg-white text-slate-900 p-6">
        <div className="mx-auto max-w-xl rounded-lg border border-slate-200 p-5">
          <h2 className="text-lg font-semibold">Page not downloaded</h2>
          <div className="mt-2 text-sm text-slate-700">Run: npm run mirror:doa</div>
        </div>
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="min-h-screen bg-white text-slate-900 p-6">
        <div className="mx-auto max-w-3xl rounded-lg border border-slate-200 p-5">
          <h2 className="text-lg font-semibold">Failed to load page</h2>
          {errorText ? (
            <pre className="mt-3 whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-xs text-slate-800">
              {errorText}
            </pre>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} />
  )
}
