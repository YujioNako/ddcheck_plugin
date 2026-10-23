// Tests extract the actual embedded implementation; no second runtime copy is maintained.
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../查成分.js',import.meta.url),'utf8');
const start=source.indexOf('// BEGIN EMBEDDED BILI SESSION');
const end=source.indexOf('// END EMBEDDED BILI SESSION');
if(start<0 || end<=start)throw new Error('Embedded session module is missing');
const moduleSource="import fs from 'node:fs';import path from 'node:path';import {publicEncrypt,createPublicKey,constants,randomBytes} from 'node:crypto';\n"+source.slice(start,end)+
    '\nexport const {BiliSession,atomicWrite,cookies,mergeCookies,setCookieLines,correspondPath}=biliSessionCore;';
const core=await import('data:text/javascript;base64,'+Buffer.from(moduleSource).toString('base64'));
export const {BiliSession,atomicWrite,cookies,mergeCookies,setCookieLines,correspondPath}=core;
