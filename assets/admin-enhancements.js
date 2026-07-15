(function(window){
  "use strict";

  function ensureResilience(){
    if(window.AttendanceFailover||document.querySelector('script[src*="/assets/resilience.js"]'))return;
    var script=document.createElement("script");script.src="/assets/resilience.js?v=1";script.defer=true;document.head.appendChild(script);
  }
  function loadSync(src){
    try{var request=new XMLHttpRequest();request.open("GET",src,false);request.send(null);if((request.status>=200&&request.status<300)||request.status===0){window.eval(request.responseText);return true}}catch(error){console.error("Admin extension load failed",error)}return false
  }
  function addLink(container,label,href,className){
    if(!container||container.querySelector('[href="'+href+'"]'))return;
    var link=document.createElement("a");link.className=className||"btn btn-soft";link.href=href;link.textContent=label;container.appendChild(link);
  }
  function setFavicon(){
    ["icon","shortcut icon","apple-touch-icon"].forEach(function(rel){var link=document.querySelector('link[rel="'+rel+'"]')||document.createElement("link");link.rel=rel;link.href="/favicon.png?v=31";if(rel!=="shortcut icon")link.sizes="300x300";if(!link.parentNode)document.head.appendChild(link)});
  }
  function enhanceDashboard(){
    if(location.pathname.indexOf("/admin/dashboard/")<0)return;
    var actions=document.querySelector(".actions");
    addLink(actions,"앱 배포","/admin/app-release/","btn btn-soft");
    addLink(actions,"시스템 상태","/admin/system-health/","btn btn-soft");
    addLink(actions,"개인정보 권한","/admin/privacy-permissions/","btn btn-soft");
  }
  function blockInsecurePasswordQuery(){
    if(!window.AttendanceApp||typeof AttendanceApp.jsonp!=="function"||AttendanceApp.__passwordQueryBlocked)return;
    var original=AttendanceApp.jsonp.bind(AttendanceApp);
    AttendanceApp.jsonp=function(url,options){
      if(String(url||"").indexOf("action=adminSetStudentPasswordJsonp")>=0)return Promise.reject(new Error("보안 POST 모듈을 불러오지 못해 직접 비밀번호 설정을 중단했습니다. 임시비밀번호 생성 기능을 사용하세요."));
      return original(url,options);
    };
    AttendanceApp.__passwordQueryBlocked=true;
  }
  function enhanceAccounts(){
    if(location.pathname!=="/accounts-s/"&&location.pathname!=="/accounts-s/index.html")return;
    var actions=document.querySelector(".top-actions");
    addLink(actions,"앱 배포","/admin/app-release/","btn btn-soft");
    blockInsecurePasswordQuery();
    var loaded=loadSync("/assets/accounts-password-post.js?v=1");
    if(!loaded&&window.AttendanceApp&&AttendanceApp.UI)AttendanceApp.UI.toast("보안 비밀번호 모듈을 불러오지 못했습니다. 직접 설정 기능은 차단됩니다.",5200);
  }
  document.addEventListener("DOMContentLoaded",function(){setFavicon();ensureResilience();enhanceDashboard();enhanceAccounts()});
})(window);
