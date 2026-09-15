import { chromium } from 'playwright'
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1200, height: 700 } })
const p = await ctx.newPage()
await p.goto('http://localhost:4199/', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(400)
const before = await p.evaluate(() => ({
  scrollY, docH: document.documentElement.scrollHeight, bodyH: document.body.scrollHeight,
  bodyStyle: getComputedStyle(document.body).overflow + ' / ' + getComputedStyle(document.body).height,
  htmlOverflow: getComputedStyle(document.documentElement).overflow,
  h4top: Math.round(document.querySelector('h4').getBoundingClientRect().top),
}))
await p.evaluate(() => window.scrollTo(0, 2000))
await p.waitForTimeout(400)
const after = await p.evaluate(() => ({
  scrollY, h4top: Math.round(document.querySelector('h4').getBoundingClientRect().top),
}))
console.log('before:', JSON.stringify(before))
console.log('after :', JSON.stringify(after))
const raw = await (await fetch('http://localhost:4199/')).text()
console.log('body tag:', /<body[^>]*>/.exec(raw)?.[0]?.slice(0, 300))
await b.close()
