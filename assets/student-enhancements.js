(function(window){
  "use strict";

  const STUDENT_PATH=location.pathname.indexOf("/student/")===0;
  const LEGACY_PERMISSION_KEY="attendanceCombinedPermissionAskedV1";
  const PUSH_REGISTERED_KEY="attendancePushRegisteredV1";

  if(STUDENT_PATH){
    try{localStorage.setItem(LEGACY_PERMISSION_KEY,"managed-by-privacy-onboarding") }catch(error){}
  }

  function setFavicon(){
    ["icon","shortcut icon","apple-touch-icon"].forEach(function(rel){
      var link=document.querySelector('link[rel="'+rel+'"]')||document.createElement("link");
      link.rel=rel;link.href="/favicon.png?v=31";
      if(rel!=="shortcut icon")link.sizes="300x300";
      if(!link.parentNode)document.head.appendChild(link);
    });
  }

  function ensureLatestStudentClient(){
    if(window.StudentAttendance&&String(window.StudentAttendance.version||"")>="1.3.0")return;
    try{var request=new XMLHttpRequest();request.open("GET","/assets/student.js?v=32",false);request.send(null);if((request.status>=200&&request.status<300)||request.status===0)window.eval(request.responseText)}catch(error){console.error("Student client refresh failed",error)}
  }

  function currentConsent(){
    try{var session=window.StudentAttendance&&StudentAttendance.Session.current();return session&&StudentAttendance.Consent.current(session.studentId)}catch(error){return null}
  }
  function pushAllowed(){var consent=currentConsent();return Boolean(consent&&consent.requiredAccepted&&consent.pushOptional)}

  function enforceOptionalNotificationConsent(){
    if(!STUDENT_PATH)return;
    var overlay=document.getElementById("combinedPermissionOverlay");if(overlay)overlay.remove();

    if(window.AttendanceApp&&typeof AttendanceApp.jsonp==="function"&&!AttendanceApp.__studentPrivacyJsonpWrapped){
      var originalJsonp=AttendanceApp.jsonp.bind(AttendanceApp);
      AttendanceApp.jsonp=function(url,options){
        var text=String(url||"");
        if((text.indexOf("action=pushClientConfigJsonp")>=0||text.indexOf("action=saveStudentPushTokenJsonp")>=0)&&!pushAllowed()){
          return Promise.resolve({ok:false,code:"PUSH_CONSENT_REQUIRED",message:"알림 선택 동의가 필요합니다."});
        }
        return originalJsonp(url,options);
      };
      AttendanceApp.__studentPrivacyJsonpWrapped=true;
    }

    if(window.AttendanceRoleApp&&!AttendanceRoleApp.__studentPrivacyWrapped){
      var originalRegister=AttendanceRoleApp.registerPushToken&&AttendanceRoleApp.registerPushToken.bind(AttendanceRoleApp);
      var originalLocal=AttendanceRoleApp.showLocalNotification&&AttendanceRoleApp.showLocalNotification.bind(AttendanceRoleApp);
      AttendanceRoleApp.registerPushToken=async function(){if(!pushAllowed())return false;return originalRegister?originalRegister():false};
      AttendanceRoleApp.showLocalNotification=async function(title,body,targetUrl){if(!pushAllowed())return false;return originalLocal?originalLocal(title,body,targetUrl):false};
      AttendanceRoleApp.requestCombinedPermissions=async function(){return {notification:"managed-by-privacy",location:"managed-by-onboarding"}};
      AttendanceRoleApp.__studentPrivacyWrapped=true;
    }

    if(window.StudentAttendance&&StudentAttendance.Consent&&!StudentAttendance.Consent.__notificationWrapped){
      var originalSave=StudentAttendance.Consent.save.bind(StudentAttendance.Consent);
      StudentAttendance.Consent.save=function(value){
        var saved=originalSave(value),consent=currentConsent();
        if(consent&&consent.pushOptional){
          setTimeout(function(){if(window.AttendanceRoleApp)AttendanceRoleApp.registerPushToken()},50);
        }else{
          try{localStorage.removeItem(PUSH_REGISTERED_KEY)}catch(error){}
        }
        return saved;
      };
      StudentAttendance.Consent.__notificationWrapped=true;
    }
  }

  function ensureResilience(){
    if(window.AttendanceFailover||document.querySelector('script[src*="/assets/resilience.js"]'))return;
    var script=document.createElement("script");script.src="/assets/resilience.js?v=1";script.defer=true;document.head.appendChild(script);
  }

  function addNetworkBanner(){
    if(document.getElementById("studentNetworkBanner"))return;
    var banner=document.createElement("div");
    banner.id="studentNetworkBanner";
    banner.setAttribute("role","status");
    banner.style.cssText="position:fixed;left:50%;top:max(10px,env(safe-area-inset-top));z-index:900;display:none;transform:translateX(-50%);width:min(520px,calc(100vw - 24px));padding:11px 14px;border:1px solid var(--line);border-radius:16px;background:var(--surface-strong);color:var(--text);box-shadow:var(--shadow);font-size:12px;font-weight:850;text-align:center";
    banner.textContent="인터넷 연결이 끊겼습니다. 연결되면 저장된 오류 알림을 자동 전송합니다.";
    document.body.appendChild(banner);
    function render(){banner.style.display=navigator.onLine?"none":"block"}
    window.addEventListener("online",render);window.addEventListener("offline",render);render();
  }

  function supportLink(href,label){var a=document.createElement("a");a.href=href;a.textContent=label;a.style.cssText="display:block;padding:11px 12px;border:1px solid var(--line);border-radius:14px;background:var(--surface-soft);color:var(--text);text-decoration:none;font-size:12px;font-weight:850;text-align:center";return a}
  function addSupportPanel(){
    if(!/^\/student\/(help|app-guide)\//.test(location.pathname)||document.getElementById("studentUnifiedSupport"))return;
    var main=document.querySelector("main");if(!main)return;
    var section=document.createElement("section");section.id="studentUnifiedSupport";section.style.cssText="margin-top:16px;padding:15px;border:1px solid var(--line);border-radius:19px;background:var(--surface-soft)";
    var title=document.createElement("strong");title.textContent="빠른 지원";title.style.cssText="display:block;margin-bottom:10px;font-size:14px";section.appendChild(title);
    var grid=document.createElement("div");grid.style.cssText="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px";
    grid.appendChild(supportLink("/student/check/","기기 점검"));
    grid.appendChild(supportLink("/student/privacy/","개인정보 동의 관리"));
    grid.appendChild(supportLink("/student/app/android/","Android 앱 다운로드"));
    grid.appendChild(supportLink("/student/recovery/","복구 센터"));
    section.appendChild(grid);main.appendChild(section);
  }

  document.addEventListener("DOMContentLoaded",function(){ensureLatestStudentClient();enforceOptionalNotificationConsent();setFavicon();ensureResilience();addNetworkBanner();addSupportPanel()});
})(window);
