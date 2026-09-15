import { chromium } from 'playwright'
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1200, height: 700 } })
const p = await ctx.newPage()
await p.goto('http://localhost:4199/', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(300)
const geo = await p.evaluate(() => {
  const vh = window.innerHeight
  const info = (sel) => Array.from(document.querySelectorAll(sel)).map((e) => ({
    top: Math.round(e.getBoundingClientRect().top),
    style: e.getAttribute('style'),
  }))
  return { vh, docH: document.body.scrollHeight, h4: info('h4'), h5: info('h5') }
})
console.log(JSON.stringify(geo, null, 1))
// does the h5 carry its appearAt in the emitted payload?
const raw = await (await fetch('http://localhost:4199/')).text()
const m = /<h5[^>]*data-anim="([^"]*)"/.exec(raw)
console.log('h5 data-anim:', m ? m[1].replace(/&quot;/g, '"') : 'none')
await b.close()
