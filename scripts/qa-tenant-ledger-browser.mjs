// Real React UI -> local HTTP RPC adapter -> isolated Postgres-compatible database.
// Requires Playwright in CODEX_PRIMARY_RUNTIME_NODE_MODULES and QA_CHROMIUM_EXECUTABLE.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdirSync} from 'node:fs'
const require=createRequire(import.meta.url)
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright')
process.env.VITE_SUPABASE_URL='http://127.0.0.1:4180'
process.env.VITE_SUPABASE_ANON_KEY='isolated-test-public-key'
const {server:api,db}=await import('../tests/browser/ledger-api.mjs')
const {createServer}=await import('vite')
const vite=await createServer({root:process.cwd(),server:{host:'127.0.0.1',port:4181,strictPort:true}})
await vite.listen()
const browser=await chromium.launch({headless:true,executablePath:process.env.QA_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--no-zygote','--single-process','--disable-gpu','--disable-software-rasterizer']})
const page=await browser.newPage({viewport:{width:1280,height:900}})
const errors=[];let correctionRequests=0
page.on('pageerror',e=>errors.push(e.message))
page.on('request',r=>{if(r.url().endsWith('/correct_tenant_payment'))correctionRequests++})
const screenshotDir=process.env.QA_SCREENSHOT_DIR||'/tmp/pg95-ledger-qa'
mkdirSync(screenshotDir,{recursive:true})
const contains=async text=>{await page.getByText(text,{exact:true}).waitFor()}
const accept=()=>page.once('dialog',dialog=>void dialog.accept())
try{
  await page.goto('http://127.0.0.1:4181/tests/browser/ledger.html')
  await page.getByRole('heading',{name:'Payment History & Corrections'}).waitFor()
  await contains('Rent due: ₹3800');await contains('Cashbook: ₹8800')
  assert.equal(await page.locator('vite-error-overlay').count(),0)
  await page.screenshot({path:screenshotDir+'/before.png',fullPage:true})
  await page.getByRole('button',{name:/^Revise Rent/}).click()
  await page.getByLabel('rent received correction',{exact:true}).fill('6300')
  await page.getByLabel('security received correction',{exact:true}).fill('2500')
  await page.getByLabel('Correction reason',{exact:true}).fill('Security entered under rent by mistake')
  await page.screenshot({path:screenshotDir+'/correction-form.png',fullPage:true})
  await page.request.get('http://127.0.0.1:4180/fail-next-refresh')
  accept();await page.getByRole('button',{name:'Save correction',exact:true}).click()
  await contains('The change was saved. Refresh is still pending.')
  // A remount after a confirmed write must reconcile, never post a second correction.
  await page.getByRole('button',{name:'Close ledger',exact:true}).click()
  await page.getByRole('button',{name:'Open ledger',exact:true}).click()
  await contains('The change was saved. Refresh is still pending.')
  await page.getByRole('button',{name:'Retry confirmation',exact:true}).dblclick()
  await contains('Security received: ₹2500');await contains('Rent due: ₹6300');await contains('Cashbook: ₹8800');await contains('Receipt rows: 2')
  assert.equal(correctionRequests,1)
  accept();await page.getByRole('button',{name:'Undo last change',exact:true}).click()
  await contains('Security received: ₹0');await contains('Rent due: ₹3800');await contains('Receipt rows: 1')
  accept();await page.getByRole('button',{name:'Redo',exact:true}).click()
  await contains('Security received: ₹2500');await contains('Rent due: ₹6300');await contains('Receipt rows: 2')
  await contains('Cashbook: ₹8800')
  await page.setViewportSize({width:390,height:844})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  await page.screenshot({path:screenshotDir+'/mobile.png',fullPage:true})
  await page.getByText(/Undo \/ redo history/).click()
  await page.screenshot({path:screenshotDir+'/history.png',fullPage:true})
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({status:'PASS',checks:['renders real controls','8800 corrected to 6300 rent + 2500 security','rent month recalculated','cash remains 8800','save/refresh failure recovery','modal remount preserves request','double retry posts once','undo exact','redo exact','mobile has no page overflow','no browser errors'],correctionRequests,screenshotDir}))
} catch(e){console.error({message:e.message,body:await page.locator('body').innerText(),errors});process.exitCode=1}
finally{await browser.close();await vite.close();await new Promise(resolve=>api.close(resolve));await db.close()}
