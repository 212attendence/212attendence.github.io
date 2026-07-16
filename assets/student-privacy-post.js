(function(window){
  "use strict";

  if(!window.StudentAttendance||StudentAttendance.__securePrivacyPostWrapped)return;

  const APPS_SCRIPT_URL="https://script.google.com/macros/s/AKfycbzE5SDb4aYv5MtyUCP1r0sAp24wBEfWbySKRQXxpuiLrv6irwSbG4L8ABSNWZY8pEvX/exec";
  const CHANNEL="attendance-student-privacy-post";
  const originalApi=StudentAttendance.api.bind(StudentAttendance);

  function isAllowedOrigin(origin){
    if(origin==="https://script.google.com")return true;
    try{return /\.googleusercontent\.com$/.test(new URL(origin).hostname)}catch(error){return false}
  }

  function strictTrue(value){
    if(value===true||value===1)return true;
    const text=String(value==null?"":value).trim().toLowerCase();
    return text==="1"||text==="true"||text==="yes"||text==="y"||text==="동의"||text==="active";
  }

  function consentMatches(consent,values){
    if(!consent)return false;
    const required=["requiredAccepted","privacyRequired","locationRequired","accountRequired","deviceRequired","policyRequired"];
    if(!required.every(function(key){return strictTrue(consent[key])}))return false;
    if(values&&values.consentVersion&&String(consent.consentVersion||"")!==String(values.consentVersion))return false;
    const optionMap={pushOptional:"pushOptional",diagnosticsOptional:"diagnosticsOptional",updatesOptional:"updatesOptional",rememberOptional:"rememberOptional",backgroundLocationOptional:"backgroundLocationOptional"};
    return Object.keys(optionMap).every(function(key){return strictTrue(consent[key])===strictTrue(values[optionMap[key]])});
  }

  async function verifyServerState(action,values){
    try{
      const result=await originalApi("studentPrivacyStatusJsonp",{studentToken:values.studentToken},14000);
      if(!result||!result.ok)return null;
      if(action==="studentSavePrivacyConsentPost"&&consentMatches(result.consent,values))return {ok:true,consent:result.consent,recovered:true};
      if(action==="studentWithdrawPrivacyConsentPost"&&(!result.consent||String(result.consent.status||"").toUpperCase()==="WITHDRAWN"))return {ok:true,status:"WITHDRAWN",recovered:true};
    }catch(error){}
    return null;
  }

  async function compatibilityFallback(action,values){
    const legacyAction=action==="studentSavePrivacyConsentPost"?"studentSavePrivacyConsentJsonp":action==="studentWithdrawPrivacyConsentPost"?"studentWithdrawPrivacyConsentJsonp":"";
    if(!legacyAction)return null;
    try{
      const result=await originalApi(legacyAction,values,30000);
      return result&&result.ok?Object.assign({compatibilityFallback:true},result):null;
    }catch(error){return null}
  }

  function securePost(action,values,timeoutMs){
    return new Promise(function(resolve,reject){
      const responseToken="PRIV-"+Date.now()+"-"+Math.random().toString(36).slice(2),frame=document.createElement("iframe"),form=document.createElement("form");
      frame.name="privacyPostFrame_"+Date.now();frame.style.display="none";
      form.method="POST";form.action=APPS_SCRIPT_URL;form.target=frame.name;form.style.display="none";
      const fields=Object.assign({action:action,responseToken:responseToken,responseOrigin:location.origin,deviceName:navigator.userAgentData&&navigator.userAgentData.platform||navigator.platform||"",screenSize:window.innerWidth+"x"+window.innerHeight,clientTime:new Date().toISOString(),clientTimezone:Intl.DateTimeFormat().resolvedOptions().timeZone||"",userAgent:(navigator.userAgent||"").slice(0,180)},values||{});
      Object.keys(fields).forEach(function(key){const input=document.createElement("input");input.type="hidden";input.name=key;input.value=String(fields[key]==null?"":fields[key]);form.appendChild(input)});
      let finished=false,checking=false;
      function cleanup(){window.removeEventListener("message",onMessage);clearTimeout(timer);clearInterval(pollTimer);setTimeout(function(){form.remove();frame.remove()},50)}
      function done(error,data){if(finished)return;finished=true;cleanup();error?reject(error):resolve(data)}
      function onMessage(event){if(!isAllowedOrigin(event.origin))return;const data=event.data||{};if(data.channel!==CHANNEL||data.responseToken!==responseToken)return;const payload=data.payload||{};if(!payload.ok)done(new Error(payload.message||"개인정보 설정을 처리하지 못했습니다."));else done(null,payload)}
      async function recover(){
        if(finished||checking)return;
        checking=true;
        try{
          const verified=await verifyServerState(action,fields);
          if(verified){done(null,verified);return}
        }finally{checking=false}
      }
      window.addEventListener("message",onMessage);document.body.appendChild(frame);document.body.appendChild(form);
      const pollTimer=setInterval(recover,3500);
      const timer=setTimeout(async function(){
        if(finished)return;
        await recover();
        if(finished)return;
        const fallback=await compatibilityFallback(action,fields);
        if(fallback){done(null,fallback);return}
        done(new Error("개인정보 설정 서버와 연결하지 못했습니다. 페이지를 새로고침한 뒤 다시 저장하세요."));
      },Math.max(Number(timeoutMs||0),60000));
      form.submit();
      setTimeout(recover,2500);
    });
  }

  StudentAttendance.api=function(action,values,timeoutMs){
    if(action==="studentSavePrivacyConsentJsonp")return securePost("studentSavePrivacyConsentPost",values,timeoutMs);
    if(action==="studentWithdrawPrivacyConsentJsonp")return securePost("studentWithdrawPrivacyConsentPost",values,timeoutMs);
    return originalApi(action,values,timeoutMs);
  };
  StudentAttendance.__securePrivacyPostWrapped=true;
})(window);