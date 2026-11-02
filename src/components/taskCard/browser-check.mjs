import { chromium } from '/Users/kacpercichy/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
import {mkdirSync} from 'node:fs';
const browser = await chromium.launch({channel:'chrome',headless:true});
const page = await browser.newPage({viewport:{width:1440,height:900}});
page.on('pageerror',e=>console.log('PAGE ERROR',e.message));
await page.goto('http://localhost:5184');
await page.getByRole('button',{name:'Wczytaj przykładowe dane'}).click();
await page.goto('http://localhost:5184/tasks');
await page.getByText('Key visual i makieta katalogu',{exact:true}).first().click();
await page.waitForTimeout(500);
mkdirSync('docs/karta-v2/shots-L4',{recursive:true});
await page.screenshot({path:'docs/karta-v2/shots-L4/1440x900.png'});
console.log(await page.locator('.task-card-layout').count(),await page.locator('.task-card-breadcrumb').count());
const tile = name => page.locator(`[data-task-tile="${name}"] > .task-card-tile > button`);
for (const [name, selector] of [['Status','#t-status'], ['Priorytet','#t-priority'], ['Okres','#t-start'], ['Osoby','#t-assignees'], ['Godziny','.sold-hours-input']]) {
  await tile(name).click();
  await page.locator(selector).first().waitFor({state:'visible'});
  if (name === 'Status' || name === 'Priorytet') {
    const select = page.locator(selector);
    const options = await select.locator('option').evaluateAll(nodes => nodes.map(n=>n.value));
    const original = await select.inputValue();
    await select.selectOption(options.find(v=>v!==original));
    await page.waitForTimeout(1200);
    await page.getByText(/^Zapisano/).waitFor();
    console.log('PASS',name,'autosave');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);
  } else if(name === 'Okres') {
    const input = page.locator(selector); const original = await input.inputValue();
    await input.fill('2026-11-01'); await page.keyboard.press('Escape');
    await tile(name).click(); if(await input.inputValue() !== original) throw Error('Escape did not restore period'); await page.keyboard.press('Escape');
  } else if(name === 'Osoby') {
    await page.locator('#t-assignees input').first().uncheck(); await page.keyboard.press('Escape');
  } else {
    await page.locator(selector).first().fill('7'); await page.waitForTimeout(1200); await page.getByText(/^Zapisano/).waitFor(); await page.keyboard.press('Escape'); await page.waitForTimeout(1200);
  }
  if (!await tile(name).evaluate(n=>n===document.activeElement)) throw Error(`Focus not restored: ${name}`);
  console.log('PASS',name,'editor and Escape');
}
await page.getByRole('button',{name:'Siatka dni'}).click(); await page.locator('.alloc-grid').waitFor();
await page.getByRole('button',{name:'← Szczegóły zadania'}).click();
for(const [width,height] of [[1440,900],[1024,768],[390,844]]) {
  await page.setViewportSize({width,height}); await page.waitForTimeout(200);
  await page.screenshot({path:`docs/karta-v2/shots-L4/${width}x${height}.png`});
  if(width === 390) { await page.getByRole('button',{name:/^Rozmowa \(/}).click(); await page.screenshot({path:'docs/karta-v2/shots-L4/390x844-conversation.png'}); await page.getByRole('button',{name:'Szczegóły',exact:true}).click(); }
}
await page.setViewportSize({width:1440,height:900});
await page.getByRole('link',{name:'Otwórz pełny widok'}).click(); await page.waitForTimeout(200);
await page.screenshot({path:'docs/karta-v2/shots-L4/full-page.png'});
console.log('PASS screenshots, allocation subview, full-page');
await browser.close();
