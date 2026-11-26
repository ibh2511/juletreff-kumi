// Kjør med: npm test. Sjekker at backend spør SpareBank 1 sjeldnere enn grensen (rundt 60 i timen), og tar pause ved 429.
const vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');
let naa = Date.UTC(2026, 10, 26, 9, 0, 0);
const KlokkeDate = class extends Date { constructor(...a) { super(...(a.length ? a : [naa])); } static now() { return naa; } };
const cache = {}, props = { BANK_REFRESH_TOKEN: 'rt', BANK_ACCOUNT_KEY: 'k', BANK_SIST_FORNYET: new Date(naa).toISOString() };
const ctx = { console, Date: KlokkeDate, JSON, Math, String, Number, Object, Array, encodeURIComponent,
  CacheService: { getScriptCache: () => ({
    get: k => (cache[k] && cache[k].til > naa ? cache[k].v : null),
    put: (k, v, sek) => { cache[k] = { v, til: naa + sek * 1000 }; } }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; },
    getProperties: () => ({ ...props }), setProperties: o => Object.assign(props, o) }) } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../backend/Code.gs'), 'utf8'), ctx);
ctx.cfg_ = (k, d) => (props[k] !== undefined ? props[k] : d);
ctx.alle_ = () => [{ status: 'UBETALT' }];
ctx.sendVentendeBetalingsinfo_ = () => {};
let kall = 0; ctx.sjekkBank_ = () => { kall++; };
ctx.venterPaBank_();
// En time rett etter en påmelding, med betalingssiden åpen: utløseren hvert minutt og siden hvert 10. sekund.
for (let s = 0; s < 3600; s += 10) {
  naa += 10000;
  if (s % 60 === 0) ctx.sjekkBankUtloser();
  ctx.sjekkBankHvisLenge_(ctx.BANK_MELLOMROM_SEK);
}
assert.ok(kall <= 40 && kall >= 30, 'banken spørres 30–40 ganger i timen, ikke ' + kall);

// Banken svarer 429: pause, og ingen nye kall før pausen er over.
ctx.bankToken_ = () => 'token';
ctx.UrlFetchApp = { fetch: () => ({ getResponseCode: () => 429, getContentText: () => '' }) };
assert.throws(() => ctx.bankGet_('/personal/banking/transactions'), /429/);
kall = 0;
for (let m = 0; m < 14; m++) { naa += 60000; ctx.sjekkBankUtloser(); ctx.sjekkBankHvisLenge_(ctx.BANK_MELLOMROM_SEK); }
assert.strictEqual(kall, 0, 'ingen kall under pausen');
assert.strictEqual(ctx.bankStatus_().pause, true);
naa += 120000; ctx.sjekkBankUtloser();
assert.strictEqual(kall, 1, 'spør igjen etter pausen');
console.log('bankgrense ok');
