import puppeteer from 'puppeteer-core'
const U='https://laksjdjf.github.io/kokusho-observatory'
const b = await puppeteer.launch({ executablePath:'/usr/bin/google-chrome', args:['--no-sandbox','--disable-gpu'], headless:'new' })
const p = await b.newPage()
const errs=[]; p.on('pageerror',e=>errs.push(e.message))
await p.goto(U+'/#/', { waitUntil:'networkidle2', timeout:90000 })
const home = await p.evaluate(()=>document.body.innerText.split('\n').filter(l=>l.trim()).slice(4,9).join(' / '))
console.log('■ トップ:', home)

await p.goto(U+'/#/rankings', { waitUntil:'networkidle2', timeout:90000 })
const tabs = await p.evaluate(()=>[...document.querySelectorAll('.tab')].map(t=>t.innerText))
for (const label of ['最長連続猛暑日','酷暑日一覧','平年差（異常な暑さ）']) {
  const i=tabs.indexOf(label); const t0=Date.now()
  await p.evaluate((i)=>document.querySelectorAll('.tab')[i].click(), i)
  try{ await p.waitForFunction(()=>document.querySelector('tbody tr'),{timeout:90000}) }catch{ console.log(label,'TIMEOUT'); continue }
  await new Promise(r=>setTimeout(r,400))
  const top=await p.evaluate(()=>[...document.querySelectorAll('tbody tr')].slice(0,2)
    .map(tr=>[...tr.children].map(td=>td.innerText.trim()).slice(0,5).join(' | ')).join('\n   '))
  console.log(`■ ${label} (${Date.now()-t0}ms)\n   ${top}`)
}
if(errs.length) console.log('ERR:',errs.slice(0,2))
await b.close()
