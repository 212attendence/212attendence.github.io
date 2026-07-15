(function(window){
  "use strict";

  const APPS_SCRIPT_URL="https://script.google.com/macros/s/AKfycbzE5SDb4aYv5MtyUCP1r0sAp24wBEfWbySKRQXxpuiLrv6irwSbG4L8ABSNWZY8pEvX/exec";
  const CHANNEL="attendance-admin-password-post";

  function currentAdminToken(){
    try{const session=AttendanceApp.Session.current();return session&&session.sessionToken||""}catch(error){return ""}
  }
  function isAllowedOrigin(origin){
    if(origin==="https://script.google.com")return true;
    try{return /\.googleusercontent\.com$/.test(new URL(origin).hostname)}catch(error){return false}
  }
  function postPassword(values,timeoutMs){
    return new Promise(function(resolve,reject){
      const responseToken="PW-"+Date.now()+"-"+Math.random().toString(36).slice(2),frame=document.createElement("iframe"),form=document.createElement("form");
      frame.name="passwordPostFrame_"+Date.now();frame.style.display="none";form.method="POST";form.action=APPS_SCRIPT_URL;form.target=frame.name;form.style.display="none";
      const fields=Object.assign({action:"adminSetStudentPasswordPost",responseToken:responseToken,responseOrigin:location.origin,sessionToken:currentAdminToken(),deviceName:navigator.userAgentData&&navigator.userAgentData.platform||navigator.platform||"",userAgent:(navigator.userAgent||"").slice(0,180)},values||{});
      Object.keys(fields).forEach(function(key){const input=document.createElement("input");input.type="hidden";input.name=key;input.value=String(fields[key]==null?"":fields[key]);form.appendChild(input)});
      let finished=false;
      function cleanup(){window.removeEventListener("message",onMessage);clearTimeout(timer);setTimeout(function(){form.remove();frame.remove()},50)}
      function done(error,data){if(finished)return;finished=true;cleanup();error?reject(error):resolve(data)}
      function onMessage(event){if(!isAllowedOrigin(event.origin))return;const data=event.data||{};if(data.channel!==CHANNEL||data.responseToken!==responseToken)return;const payload=data.payload||{};if(!payload.ok)done(new Error(payload.message||"비밀번호를 설정하지 못했습니다."));else done(null,payload)}
      window.addEventListener("message",onMessage);document.body.appendChild(frame);document.body.appendChild(form);const timer=setTimeout(function(){done(new Error("비밀번호 설정 응답 시간이 초과되었습니다."))},timeoutMs||30000);form.submit();
    });
  }

  window.saveCustomPassword=async function(){
    if(busy||!passwordStudentId)return;
    const password=document.getElementById("customPassword").value,confirmPassword=document.getElementById("customPasswordConfirm").value;
    if(password!==confirmPassword){AttendanceApp.UI.toast("비밀번호 확인이 일치하지 않습니다.");return}
    if(password.length<8||password.length>64||!/[A-Za-z]/.test(password)||!/\d/.test(password)){AttendanceApp.UI.toast("영문과 숫자를 포함해 8~64자로 입력하세요.",4200);return}
    if(!confirm("새 비밀번호를 설정하고 기존 로그인 기기를 모두 해제할까요?"))return;
    busy=true;setLoading(true,"비밀번호 설정 중입니다",passwordStudentId);
    try{await postPassword({studentId:passwordStudentId,password:password},30000);closePasswordModal();busy=false;await loadAccounts(false);busy=true;AttendanceApp.UI.toast("관리자 지정 비밀번호를 안전하게 설정했습니다.")}
    catch(error){AttendanceFailover.report({errorType:"ADMIN_PASSWORD_POST_FAILED",message:error.message||String(error),fallbackUrl:"/accounts-s/"});AttendanceApp.UI.toast((error.message||String(error))+" 임시비밀번호 생성 기능을 대신 사용할 수 있습니다.",5200)}
    finally{busy=false;setLoading(false)}
  };
})(window);
