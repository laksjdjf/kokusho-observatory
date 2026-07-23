import puppeteer from 'puppeteer-core'
const b = await puppeteer.launch({ executablePath:'/usr/bin/google-chrome', args:['--no-sandbox','--disable-gpu'], headless:'new' })
const p = await b.newPage()
const errs=[]; p.on('pageerror',e=>errs.push(e.message))
await p.goto('http://localhost:4200/#/rankings', { waitUntil:'networkidle2', timeout:90000 })
const tabs = await p.evaluate(()=>[...document.querySelectorAll('.tab')].map(t=>t.innerText))
for (let i=0;i<tabs.length;i++){
  const t0=Date.now()
  await p.evaluate((i)=>document.querySelectorAll('.tab')[i].click(), i)
  try{ await p.waitForFunction(()=>document.querySelector('tbody tr')||document.body.innerText.includes('失敗'),{timeout:90000}) }
  catch{ console.log(`${tabs[i]}: TIMEOUT`); continue }
  await new Promise(r=>setTimeout(r,400))
  const top = await p.evaluate(()=>{
    const tr=document.querySelector('tbody tr')
    return tr?[...tr.children].map(td=>td.innerText.trim()).slice(0,5).join(' | '):'(なし)'
  })
  console.log(`${String(Date.now()-t0).padStart(5)}ms  ${tabs[i].padEnd(22)} ${top}`)
}
if(errs.length) console.log('ERR:',errs.slice(0,2))
await b.close()
