import puppeteer from 'puppeteer-core'
const b = await puppeteer.launch({ executablePath:'/usr/bin/google-chrome', args:['--no-sandbox','--disable-gpu'], headless:'new' })
const p = await b.newPage()
const errs=[]; p.on('pageerror',e=>errs.push(e.message))
await p.goto('http://localhost:4200/#/rankings', { waitUntil:'networkidle2', timeout:60000 })
for (const [tab,label] of [[2,'猛暑日回数'],[3,'暑かった日']]) {
  const t0=Date.now()
  await p.evaluate((i)=>document.querySelectorAll('.tab')[i-1].click(), tab)
  await p.waitForFunction(()=>document.querySelector('tbody tr')||document.body.innerText.includes('失敗'),{timeout:60000})
  await new Promise(r=>setTimeout(r,600))
  const txt = await p.evaluate(()=>{
    const rows=[...document.querySelectorAll('tbody tr')].slice(0,4)
      .map(tr=>[...tr.children].map(td=>td.innerText.trim()).join(' | '))
    return rows.join('\n')
  })
  console.log(`\n=== ${label} (${Date.now()-t0}ms) ===\n${txt}`)
}
if(errs.length) console.log('\nERR:', errs.slice(0,2))
await b.close()
