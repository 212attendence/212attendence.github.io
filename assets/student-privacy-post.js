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

  function securePost(action,values,timeoutMs){
    return new Promise(function(resolve,reject){
      const responseToken="PRIV-"+Date.now()+"-"+Math.random().toString(36).slice(2),frame=document.createElement("iframe"),form=document.createElement("form");
      frame.name="privacyPostFrame_"+Date.now();frame.style.display="none";
      form.method="POST";form.action=APPS_SCRIPT_URL;form.target=frame.name;form.style.display="none";
      const fields=Object.assign({action:action,responseToken:responseToken,responseOrigin:location.origin,deviceName:navigator.userAgentData&&navigator.userAgentData.platform||navigator.platform||"",screenSize:window.innerWidth+"x"+window.innerHeight,clientTime:new Date().toISOString(),clientTimezone:Intl.DateTimeFormat().resolvedOptions().timeZone||"",userAgent:(navigator.userAgent||"").slice(0,180)},values||{});
      Object.keys(fields).forEach(function(key){const input=document.createElement("input");input.type="hidden";input.name=key;input.value=String(fields[key]==null?"":fields[key]);form.appendChild(input)});
      let finished=false;
      function cleanup(){window.removeEventListener("message",onMessage);clearTimeout(timer);setTimeout(function(){form.remove();frame.remove()},50)}
      function done(error,data){if(finished)return;finished=true;cleanup();error?reject(error):resolve(data)}
      function onMessage(event){if(!isAllowedOrigin(event.origin))return;const data=event.data||{};if(data.channel!==CHANNEL||data.responseToken!==responseToken)return;const payload=data.payload||{};if(!payload.ok)done(new Error(payload.message||"개인정보 설정을 처리하지 못했습니다."));else done(null,payload)}
      window.addEventListener("message",onMessage);document.body.appendChild(frame);document.body.appendChild(form);
      const timer=setTimeout(function(){done(new Error("개인정보 설정 응답 시간이 초과되었습니다."))},timeoutMs||30000);
      form.submit();
    });
  }

  StudentAttendance.api=function(action,values,timeoutMs){
    if(action==="studentSavePrivacyConsentJsonp")return securePost("studentSavePrivacyConsentPost",values,timeoutMs);
    if(action==="studentWithdrawPrivacyConsentJsonp")return securePost("studentWithdrawPrivacyConsentPost",values,timeoutMs);
    return originalApi(action,values,timeoutMs);
  };
  StudentAttendance.__securePrivacyPostWrapped=true;
})(window);
