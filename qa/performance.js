async page => {
  const origin = new URL(page.url()).origin;
  await page.goto(origin + '/?renderer=none');
  // Same viewport, network throttle and unthrottled CPU as the original audit.
  const cfg = {name:'prepared-mobile-10mbps',mobile:true,mbps:10,latency:80,warm:true};
  const context = await page.context().browser().newContext({
    viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true,
    userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });
  const outputs=[],errors=[];
  let completed=false;
  try {
    const target=await context.newPage(),cdp=await context.newCDPSession(target);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:cfg.latency,downloadThroughput:cfg.mbps*1000000/8,uploadThroughput:1000000});
    let requests=new Map(),consoleErrors=[],lastNetworkActivity=Date.now();
    cdp.on('Network.requestWillBeSent',event=>{
      lastNetworkActivity=Date.now();
      requests.set(event.requestId,{id:event.requestId,url:event.request.url,type:event.type,
        status:null,headers:{},cache:false,protocol:null,mime:null,bytes:0,receivedBytes:0,finished:false,error:null});
    });
    cdp.on('Network.requestServedFromCache',event=>{
      const record=requests.get(event.requestId);if(record)record.cache=true;
    });
    cdp.on('Network.responseReceived',event=>{
      const record=requests.get(event.requestId);if(!record)return;
      lastNetworkActivity=Date.now();
      Object.assign(record,{status:event.response.status,headers:event.response.headers,
        cache:record.cache||event.response.fromDiskCache||event.response.fromPrefetchCache||event.response.fromServiceWorker||false,
        protocol:event.response.protocol,mime:event.response.mimeType});
    });
    cdp.on('Network.dataReceived',event=>{
      const record=requests.get(event.requestId);if(!record)return;
      lastNetworkActivity=Date.now();
      record.receivedBytes+=event.encodedDataLength;
      record.bytes=record.receivedBytes;
    });
    cdp.on('Network.loadingFinished',event=>{
      const record=requests.get(event.requestId);if(!record)return;
      lastNetworkActivity=Date.now();
      // Final encoded length includes overhead. Unfinished responses keep their
      // observed body bytes instead of silently contributing zero.
      record.bytes=event.encodedDataLength;record.finished=true;
    });
    cdp.on('Network.loadingFailed',event=>{
      const record=requests.get(event.requestId);if(!record)return;
      lastNetworkActivity=Date.now();
      record.error=event.errorText;record.canceled=Boolean(event.canceled);
    });
    target.on('pageerror',error=>consoleErrors.push(error.message));
    await target.addInitScript(()=>{
      performance.setResourceTimingBufferSize(1500);
      const audit=window.__startupAudit={marks:{},gallery:[],longtasks:[]};
      const mark=key=>{if(audit.marks[key]===undefined)audit.marks[key]=performance.now();};
      try{new PerformanceObserver(list=>{for(const entry of list.getEntries())audit.longtasks.push({start:entry.startTime,duration:entry.duration});}).observe({type:'longtask',buffered:true});}catch{}
      let count=-1;
      const sample=()=>{
        const experience=document.querySelector('.experience'),d=window.__sceneDiagnostics;
        if(experience)mark('experienceMounted');
        if(d){
          mark('pipelineCreated');
          if(d.computer?.loaded)mark('computerReady');
          if(d.heroReel?.ready)mark('videoAndTrackReady');
          if(d.gallery?.readyCount!==count){count=d.gallery?.readyCount;audit.gallery.push({time:performance.now(),count});}
          if(d.gallery?.readyCount===d.gallery?.total)mark('galleryReady');
          if(d.assetsReady)mark('heroAssetsReady');
          if(d.shaderReady)mark('heroShaderReady');
          if(d.contentReady)mark('contentReady');
          if(d.intro>0)mark('introStarted');
          if(d.intro>=.999)mark('introComplete');
        }
        if(experience?.classList.contains('is-ready'))mark('interactive');
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    const snapshot=()=>{
      const responses=[...requests.values()].map(record=>({...record,headers:{...record.headers}}));
      return {responses,bytes:responses.reduce((sum,response)=>sum+response.bytes,0),
        unfinished:responses.filter(response=>!response.finished&&!response.error).map(response=>response.url)};
    };
    for(let run=0;run<2;run++){
      requests=new Map();consoleErrors=[];lastNetworkActivity=Date.now();
      let timeout=false,runError=null;
      try{
        await target.goto(origin+'/',{waitUntil:'domcontentloaded',timeout:60000});
        await target.waitForFunction(()=>{
          const experience=document.querySelector('.experience');
          return experience?.classList.contains('is-fallback')
            ||(experience?.classList.contains('is-ready')&&window.__sceneDiagnostics?.contentReady);
        },null,{timeout:60000});
        if(await target.locator('.is-fallback').count())throw new Error('Startup entered fallback instead of the prepared GPU scene.');
        await target.waitForFunction(()=>window.__startupAudit?.marks.interactive!==undefined,null,{timeout:5000});
      }catch(error){runError=error.message;timeout=error.name==='TimeoutError';}
      const atReady=snapshot();
      const state=await target.evaluate(()=>({audit:window.__startupAudit,diagnostics:window.__sceneDiagnostics,
        navigation:performance.getEntriesByType('navigation')[0]?.toJSON(),
        paints:performance.getEntriesByType('paint').map(entry=>entry.toJSON()),
        status:document.querySelector('.experience')?.dataset.rendererStatus,
        ready:document.querySelector('.experience')?.classList.contains('is-ready')}));
      // A usable video may still be streaming. Its completed transfer is
      // measured separately, with a bounded settling window after readiness.
      const settleDeadline=Date.now()+15000;
      while(Date.now()<settleDeadline){
        if([...requests.values()].every(request=>request.finished||request.error)&&Date.now()-lastNetworkActivity>=300)break;
        await target.waitForTimeout(50);
      }
      const settled=snapshot();
      const failures=settled.responses.filter(response=>response.error).map(response=>{
        const replacement=settled.responses.find(candidate=>candidate.id!==response.id&&candidate.url===response.url
          &&candidate.finished&&!candidate.error&&[200,206].includes(candidate.status));
        const allowedVideoRangeReplacement=response.canceled&&response.error==='net::ERR_ABORTED'
          &&response.type==='Media'&&/\/showreel\.mp4(?:\?|$)/.test(response.url)&&Boolean(replacement);
        return {url:response.url,error:response.error,allowedVideoRangeReplacement:Boolean(allowedVideoRangeReplacement)};
      });
      outputs.push({cfg,run:run?'warm':'cold',timeout,runError,...state,
        transfer:{atReadyBytes:atReady.bytes,atReadyUnfinished:atReady.unfinished,
          settledBytes:settled.bytes,settledComplete:settled.unfinished.length===0,settledUnfinished:settled.unfinished},
        responsesAtReady:atReady.responses,responses:settled.responses,failures,consoleErrors:[...consoleErrors],
        resources:await target.evaluate(()=>performance.getEntriesByType('resource').map(entry=>entry.toJSON()))});
      if(runError){errors.push(runError);break;}
    }
    completed=outputs.length===2&&errors.length===0;
  }catch(error){errors.push(error.message);}
  finally{await context.close().catch(error=>errors.push(error.message));}
  const cold=outputs[0],warm=outputs[1];
  const modelRequests=cold?.responses.filter(response=>new URL(response.url).pathname.includes('/models/'))??[];
  const model=modelRequests.find(response=>new URL(response.url).pathname.endsWith('/models/furkan-crt/furkan-crt-computer.glb')&&response.finished);
  const modelResource=cold?.resources.find(resource=>resource.name===model?.url);
  const clean=run=>!run.timeout&&!run.runError&&run.consoleErrors.length===0
    &&run.failures.every(failure=>failure.allowedVideoRangeReplacement)
    &&run.responses.every(response=>response.status===null||response.status<400);
  const checks=[
    {name:'both controlled visits completed',pass:completed&&outputs.length===2&&errors.length===0},
    {name:'all destinations prepared before intro starts',pass:completed&&outputs.every(run=>
      Number.isFinite(run.audit?.marks.contentReady)&&Number.isFinite(run.audit?.marks.introStarted)
      &&run.audit.marks.contentReady<=run.audit.marks.introStarted)},
    {name:'cold mobile readiness under 45s at 10Mbps / 80ms',pass:cold?.audit?.marks.interactive<45000},
    {name:'completed cold mobile transfer below 32MB',pass:cold?.transfer.settledComplete&&cold.transfer.settledBytes<32000000},
    {name:'one complete 362152-byte CRT model transfers compressed below 400KB',pass:modelRequests.length===1
      &&model?.bytes>0&&model.bytes<400000&&modelResource?.decodedBodySize===362152
      &&Object.entries(model.headers).some(([key,value])=>key.toLowerCase()==='content-encoding'&&['br','gzip'].includes(value))
      &&cold?.diagnostics?.computer?.assetVariant==='shared'&&cold.diagnostics.computer.meshes===6
      &&cold.diagnostics.computer.triangles===9848},
    {name:'completed warm visit transfers under 3MB',pass:warm?.transfer.settledComplete&&warm.transfer.settledBytes<3000000},
    {name:'both visits use prepared GPU content',pass:completed&&outputs.every(run=>run.ready&&['webgpu','webgl2'].includes(run.status)
      &&run.diagnostics?.contentReady&&run.diagnostics.preparedPosters===7)},
    {name:'no timeouts, HTTP failures, or unexpected request/page errors',pass:completed&&outputs.every(clean)},
  ].map(check=>({...check,pass:Boolean(check.pass)}));
  return {completed,passed:checks.filter(check=>check.pass).length,total:checks.length,checks,errors,
    modelTransfer:{requests:modelRequests.length,transferredBytes:model?.bytes,decodedBytes:modelResource?.decodedBodySize},runs:outputs};
}
