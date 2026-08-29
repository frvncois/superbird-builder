// Shared background-media rendering logic, used by the Vue renderers and the
// static exporter alike. An image background becomes a CSS background-image on
// the host; a video background becomes an absolutely-positioned <video> layer
// behind the content (the host is made position:relative).

const FIT_RE = /^object-/
const BG_SIZE_RE = /^bg-(auto|cover|contain|\[)/

/**
 * @param {'image'|'video'|null|undefined} kind
 * @param {string|undefined} url  already resolved/rewritten media URL
 * @param {string[]} classTokens  the element's class tokens (for fit/size hints)
 * @returns {null | {
 *   kind: 'image'|'video',
 *   url: string,
 *   style: string,        // inline style to merge onto the host
 *   hostClass: string,    // extra host classes (e.g. 'relative' for video)
 *   layerClass: string,   // class for the <video> layer (video only)
 * }}
 */
export function backgroundRender(kind, url, classTokens = []) {
  if (!url || !kind) return null

  if (kind === 'video') {
    // object-fit / object-position steer the layer; default to cover
    const fit = classTokens.filter((c) => FIT_RE.test(c))
    return {
      kind: 'video',
      url,
      style: '',
      hostClass: 'relative',
      layerClass: ['absolute', 'inset-0', '-z-10', 'h-full', 'w-full', ...(fit.length ? fit : ['object-cover'])].join(' '),
    }
  }

  // image: rely on any bg-size/bg-repeat/bg-position classes; when none set,
  // default to a sensible cover/center so a raw pick looks right
  const hasSize = classTokens.some((c) => BG_SIZE_RE.test(c))
  const style = hasSize
    ? `background-image:url(${url})`
    : `background-image:url(${url});background-size:cover;background-position:center`
  return { kind: 'image', url, style, hostClass: '', layerClass: '' }
}
