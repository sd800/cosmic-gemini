// Bounded, context-specific explanations for recorded metadata values only.
// Never scans the message body, evaluates results, or fetches header targets.
const route={from:'routeFrom',by:'routeBy',with:'routeWith',id:'routeId',for:'routeFor',via:'routeVia'};
const mime={'text/plain':'mimePlain','text/html':'mimeHtml','multipart/mixed':'mimeMixed','multipart/alternative':'mimeAlternative','multipart/related':'mimeRelated','application/octet-stream':'mimeBinary'};
const auth=new Set(['Authentication-Results','ARC-Authentication-Results','Received-SPF']);
export function emailInfoTokens(name,value) {
  const result=[],add=(start,length,keys)=>result.push({start,end:start+length,keys});
  if(name==='route') {
    const prefix=/^(from|by|with|id|for|via)(?=\s)/i.exec(value);
    if(prefix)add(0,prefix[0].length,[route[prefix[0].toLowerCase()]]);
    if(prefix?.[0].toLowerCase()==='with') {
      const match=/^(with\s+)(ESMTPSA|ESMTPS|ESMTPA|ESMTP|SMTP|LMTP)\b/i.exec(value);
      if(match)add(match[1].length,match[2].length,['protocol'+match[2].toUpperCase()]);
    }
    for(const match of value.matchAll(/\bTLS(?:v?1\.[0-3])?\b/gi)) {
      if(!/[\w.@-]/.test(value[match.index-1]||'')&&!/[\w.@-]/.test(value[match.index+match[0].length]||''))add(match.index,match[0].length,['protocolTLS']);
    }
  } else if(auth.has(name)) {
    for(const match of value.matchAll(/\b(spf|dkim|dmarc|arc)\s*=\s*(pass|fail|softfail|neutral|none|temperror|permerror)\b/gi))add(match.index,match[0].length,['auth'+match[1].toUpperCase(),'result'+match[2].toLowerCase()]);
    const spf=name==='Received-SPF'&&/^(pass|fail|softfail|neutral|none|temperror|permerror)\b/i.exec(value);
    if(spf)add(0,spf[0].length,['authSPF','result'+spf[0].toLowerCase()]);
  } else if(name==='Content-Type') {
    const match=/^([\w.+-]+\/[\w.+-]+)/.exec(value);
    if(match&&mime[match[0].toLowerCase()])add(0,match[0].length,[mime[match[0].toLowerCase()]]);
  } else if(name==='Content-Transfer-Encoding') {
    const match=/^(base64|quoted-printable|7bit|8bit|binary)\b/i.exec(value);
    if(match)add(0,match[0].length,['encoding'+match[0].toLowerCase()]);
  } else if(name==='Content-Disposition') {
    const match=/^(inline|attachment)\b/i.exec(value);
    if(match)add(0,match[0].length,['disposition'+match[0].toLowerCase()]);
  } else if(['Importance','Priority','X-Priority'].includes(name)) {
    const match=/^(high|normal|low|urgent|non-urgent|[1-5])\b/i.exec(value);
    const keys={high:'priorityHigh',urgent:'priorityHigh',normal:'priorityNormal',low:'priorityLow','non-urgent':'priorityLow',1:'priorityHigh',2:'priorityHigh',3:'priorityNormal',4:'priorityLow',5:'priorityLow'};
    if(match)add(0,match[0].length,[keys[match[0].toLowerCase()]]);
  }
  return result.sort((a,b)=>a.start-b.start);
}
