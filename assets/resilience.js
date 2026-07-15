(function(window){
  "use strict";

  const API_URL="https://script.google.com/macros/s/AKfycbzE5SDb4aYv5MtyUCP1r0sAp24wBEfWbySKRQXxpuiLrv6irwSbG4L8ABSNWZY8pEvX/exec";
  const QUEUE_KEY="attendanceFailoverQueueV1";
  const LOOP_KEY="attendanceFailoverLoopV1";
  const MAX_QUEUE=25;

  function readJson(key,fallback,storage){try{return JSON.parse((storage||localStorage).getItem(key)||"")||fallback}catch(error){return fallback}}
  function writeJson(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true}catch(error){return false}}
  function clean(value,max){return String(value==null?"":value).replace(/[\r\n\t]+/g," ").slice(0,max||300)}
  function strictBool(value){if(value===true||value===1)return true;const text=String(value==null?"":value).trim().toLowerCase();return text==="1"||text==="true"||text==="yes"||text==="y"||text==="동의"}
  function studentContext(){
    try{
      const temporary=readJson("attendanceStudentSessionV1",null,sessionStorage),persistent=readJson("attendanceStudentSessionV1",null,localStorage),session=temporary||persistent||{};
      return {studentId:clean(session.studentId,40),studentName:clean(session.name,80),studentToken:clean(session.token,160)};
    }catch(error){return {studentId:"",studentName:"",studentToken:""}}
  }
  function diagnosticsAllowed(studentId){
    if(!studentId)return false;
    try{const store=readJson("attendanceStudentConsentV2",{},localStorage),consent=store[String(studentId)]||{};return strictBool(consent.diagnosticsOptional)&&String(consent.status||"ACTIVE").toUpperCase()!=="WITHDRAWN"}catch(error){return false}
  }
  function eventPayload(values){
    const context=studentContext(),detailed=diagnosticsAllowed(context.studentId);
    return Object.assign({
      eventId:"FB-"+Date.now()+"-"+Math.random().toString(36).slice(2,9),
      createdAt:new Date().toISOString(),
      errorType:"UNKNOWN",
      message:"",
      sourcePage:location.pathname+location.search,
      fallbackUrl:"/student/recovery/",
      online:navigator.onLine?"1":"0",
      userAgent:detailed?clean(navigator.userAgent,180):"",
      deviceName:detailed?clean(navigator.userAgentData&&navigator.userAgentData.platform||navigator.platform||"",100):"",
      clientTimezone:detailed?(Intl.DateTimeFormat().resolvedOptions().timeZone||""):"",
      diagnosticsConsent:detailed?"1":"0",
      studentId:context.studentId,
      studentName:context.studentName,
      studentToken:context.studentToken
    },values||{});
  }
  function enqueue(payload){const queue=readJson(QUEUE_KEY,[]);queue.push(payload);writeJson(QUEUE_KEY,queue.slice(-MAX_QUEUE))}
  function jsonp(payload,timeoutMs){
    return new Promise(function(resolve,reject){
      const callback="attendance_failover_"+Date.now()+"_"+Math.floor(Math.random()*100000),script=document.createElement("script");
      let finished=false;
      function done(error,data){if(finished)return;finished=true;clearTimeout(timer);try{delete window[callback]}catch(e){}if(script.parentNode)script.remove();error?reject(error):resolve(data)}
      window[callback]=function(data){done(null,data)};
      const params=new URLSearchParams(Object.assign({action:"studentFallbackEventJsonp",callback:callback},payload));
      script.src=API_URL+"?"+params.toString();script.async=true;script.onerror=function(){done(new Error("fallback report failed"))};
      const timer=setTimeout(function(){done(new Error("fallback report timeout"))},timeoutMs||9000);
      document.head.appendChild(script);
    });
  }
  async function report(values){
    const payload=eventPayload(values);
    if(!navigator.onLine){enqueue(payload);return false}
    try{const result=await jsonp(payload,9000);if(!result||!result.ok)throw new Error("report rejected");return true}catch(error){enqueue(payload);return false}
  }
  async function flush(){
    if(!navigator.onLine)return;
    const queue=readJson(QUEUE_KEY,[]);if(!queue.length)return;
    const remaining=[];
    for(const payload of queue){try{const result=await jsonp(payload,7000);if(!result||!result.ok)remaining.push(payload)}catch(error){remaining.push(payload)}}
    writeJson(QUEUE_KEY,remaining.slice(-MAX_QUEUE));
  }
  function loopBlocked(type,target){
    const now=Date.now(),record=readJson(LOOP_KEY,{}),key=clean(type,60)+"|"+clean(target,180),item=record[key]||{count:0,at:0};
    item.count=now-Number(item.at||0)<30000?Number(item.count||0)+1:1;item.at=now;record[key]=item;writeJson(LOOP_KEY,record);
    return item.count>2;
  }
  function safeTarget(target){
    try{const url=new URL(target||"/student/recovery/",location.origin);return url.origin===location.origin?url.pathname+url.search+url.hash:"/student/recovery/"}catch(error){return "/student/recovery/"}
  }
  function redirect(type,target,message,delayMs,extra){
    const fallback=safeTarget(target);
    report(Object.assign({errorType:clean(type,60),message:clean(message,300),fallbackUrl:fallback},extra||{}));
    const finalTarget=loopBlocked(type,fallback)?"/student/recovery/?reason=loop&from="+encodeURIComponent(location.pathname):fallback;
    setTimeout(function(){location.replace(finalTarget)},Number(delayMs==null?900:delayMs));
  }
  function externalFallback(type,target,message,delayMs,extra){
    report(Object.assign({errorType:clean(type,60),message:clean(message,300),fallbackUrl:clean(target,500)},extra||{}));
    setTimeout(function(){location.href=target},Number(delayMs==null?900:delayMs));
  }
  function install(){
    window.addEventListener("online",flush);
    window.addEventListener("error",function(event){report({errorType:"JAVASCRIPT_ERROR",message:clean(event.message||"script error",300),sourcePage:location.pathname+location.search})});
    window.addEventListener("unhandledrejection",function(event){report({errorType:"PROMISE_REJECTION",message:clean(event.reason&&event.reason.message||event.reason||"promise rejection",300),sourcePage:location.pathname+location.search})});
    setTimeout(flush,1200);
  }

  window.AttendanceFailover={version:"1.1.0",report:report,flush:flush,redirect:redirect,externalFallback:externalFallback,safeTarget:safeTarget};
  install();
})(window);
